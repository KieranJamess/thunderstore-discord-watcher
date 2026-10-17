import {
  dueTargets,
  finishPosts,
  getMeta,
  pendingPosts,
  queueAnnouncement,
  replaceCommunities,
  saveTarget,
  setMeta,
  touchTargets,
  type Target,
} from "./db";
import { modUpdateEmbed, newModEmbed, postMessage } from "./discord";
import { fetchCommunities, fetchMod, fetchNewestMods, isNewerVersion, parseModRef, type Http } from "./thunderstore";

export type PollDeps = { db: D1Database; http: Http; token: string; now: number; budget?: number };

const DAY = 24 * 3600_000;
const MAX_EMBEDS = 10; // Discord's per-message limit
const FINISH_COST = 3; // statements in finishPosts without gone channels
const GONE_COST = 3; // extra statements once any channel is gone

/**
 * One cron run. `budget` caps fetches plus D1 statements together: on the Workers
 * free plan each is limited to 50 per invocation. Checking gets half the budget,
 * posting queued announcements gets the rest, so a target with many watches
 * drains over several runs instead of blocking the others.
 */
export async function runPoll({ db: rawDb, http, token, now, budget = 45 }: PollDeps): Promise<void> {
  let spent = 0;
  const counted: Http = (input, init) => {
    spent++;
    return http(input, init);
  };
  const db = new Proxy(rawDb, {
    get(target, prop) {
      if (prop === "prepare") spent++;
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });

  if (now - Number((await getMeta(db, "communities_at")) ?? 0) > DAY) {
    // Set first so a failing refresh waits a day instead of retrying every run.
    await setMeta(db, "communities_at", String(now));
    try {
      await replaceCommunities(db, await fetchCommunities(counted));
    } catch {
      // Autocomplete stays stale until tomorrow.
    }
  }

  // Check: per target 1 fetch + at most 2 statements; 1 more for the final touch.
  const checkBudget = Math.floor(budget / 2);
  const touched: string[] = [];
  for (const target of await dueTargets(db, 50)) {
    if (spent + 4 > checkBudget) break;
    let result: Result;
    try {
      result = await check(counted, target);
    } catch {
      result = { kind: "unchanged" };
    }
    if (result.kind === "unchanged") touched.push(target.id);
    else if (result.kind === "state") await saveTarget(db, target.id, result.state, now);
    else await queueAnnouncement(db, target.id, result.state, now, result.message);
  }
  await touchTargets(db, touched, now);

  // Post: 1 statement to read, 1 fetch per post, then finishPosts.
  const posts = await pendingPosts(db, budget - spent - 1 - FINISH_COST - GONE_COST);
  const sent: number[] = [];
  const failed: number[] = [];
  const gone = new Set<string>();
  for (const p of posts) {
    if (gone.has(p.channelId)) continue;
    let outcome: "ok" | "gone" | "error";
    try {
      outcome = await postMessage(counted, token, p.channelId, JSON.parse(p.body));
    } catch {
      outcome = "error";
    }
    if (outcome === "ok") sent.push(p.id);
    else if (outcome === "gone") gone.add(p.channelId);
    else failed.push(p.id);
  }
  if (posts.length) await finishPosts(db, sent, failed, [...gone]);
}

type Result = { kind: "unchanged" } | { kind: "state"; state: string } | { kind: "announce"; state: string; message: object };

/** Fetches a target's current state and decides what to do with it. Throws on Thunderstore errors. */
async function check(http: Http, target: Target): Promise<Result> {
  const sep = target.id.indexOf(":");
  const [kind, ref] = [target.id.slice(0, sep), target.id.slice(sep + 1)];

  if (kind === "mod") {
    const mod = await fetchMod(http, parseModRef(ref)!);
    if (!mod || mod.version === target.state) return { kind: "unchanged" };
    if (target.state && !isNewerVersion(mod.version, target.state)) return { kind: "state", state: mod.version };
    return { kind: "announce", state: mod.version, message: { embeds: [modUpdateEmbed(mod)] } };
  }

  const mods = await fetchNewestMods(http, ref);
  if (!mods) return { kind: "unchanged" };
  const since = target.state ? Date.parse(target.state) : -Infinity;
  const fresh = mods.filter((m) => Date.parse(m.createdAt) > since).slice(0, MAX_EMBEDS);
  if (!fresh.length) return { kind: "unchanged" };
  return {
    kind: "announce",
    state: fresh[0].createdAt,
    message: { embeds: fresh.reverse().map((m) => newModEmbed(m, ref)) },
  };
}
