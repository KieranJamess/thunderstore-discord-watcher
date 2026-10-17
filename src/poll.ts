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
import { modUpdateMessage, newModsMessage, postMessage } from "./discord";
import {
  fetchChangelog,
  fetchCommunities,
  fetchMod,
  fetchNewestMods,
  fetchRecentlyUpdated,
  isNewerVersion,
  parseModRef,
  type Http,
  type ListedMod,
} from "./thunderstore";

export type PollDeps = { db: D1Database; http: Http; token: string; now: number; budget?: number };

const DAY = 24 * 3600_000;
const MAX_EMBEDS = 10; // Discord's per-message limit
const MAX_UPDATES_PER_CHECK = 5;
const BRAND_NEW_MS = 60_000;
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

  // Check. Mod/community targets: up to 2 fetches and 2 statements, plus 1 for the final touch.
  // Updates targets: 1 listing fetch and 1 statement, plus 2 fetches and 1 statement per updated mod.
  const checkBudget = Math.floor(budget / 2);
  const touched: string[] = [];
  for (const target of await dueTargets(db, 50)) {
    const maxUpdates = Math.min(MAX_UPDATES_PER_CHECK, Math.floor((checkBudget - spent - 3) / 3));
    if (target.id.startsWith("updates:") ? maxUpdates < 1 : spent + 5 > checkBudget) break;
    let result: Result;
    try {
      result = await check(counted, target, maxUpdates);
    } catch {
      result = { kind: "unchanged" };
    }
    if (result.kind === "unchanged") touched.push(target.id);
    else if (result.kind === "state") await saveTarget(db, target.id, result.state, now);
    else await queueAnnouncement(db, target.id, result.state, now, result.messages);
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

type Result =
  | { kind: "unchanged" }
  | { kind: "state"; state: string }
  | { kind: "announce"; state: string; messages: object[] };

/** Fetches a target's current state and decides what to do with it. Throws on Thunderstore errors. */
async function check(http: Http, target: Target, maxUpdates: number): Promise<Result> {
  const sep = target.id.indexOf(":");
  const [kind, ref] = [target.id.slice(0, sep), target.id.slice(sep + 1)];

  if (kind === "mod") {
    const mod = await fetchMod(http, parseModRef(ref)!);
    if (!mod || mod.version === target.state) return { kind: "unchanged" };
    if (target.state && !isNewerVersion(mod.version, target.state)) return { kind: "state", state: mod.version };
    const changelog = await fetchChangelog(http, mod, mod.version);
    return { kind: "announce", state: mod.version, messages: [modUpdateMessage(mod, changelog)] };
  }

  if (kind === "updates") return checkUpdates(http, ref, target.state, maxUpdates);

  const mods = await fetchNewestMods(http, ref);
  if (!mods) return { kind: "unchanged" };
  const since = target.state ? Date.parse(target.state) : -Infinity;
  const fresh = mods.filter((m) => Date.parse(m.createdAt) > since).slice(0, MAX_EMBEDS);
  if (!fresh.length) return { kind: "unchanged" };
  return {
    kind: "announce",
    state: fresh[0].createdAt,
    messages: [newModsMessage(fresh.reverse(), ref)],
  };
}

/** Every mod in a community updated since `state`, oldest first, at most `max` per check. */
async function checkUpdates(http: Http, community: string, state: string | null, max: number): Promise<Result> {
  const mods = await fetchRecentlyUpdated(http, community);
  if (!mods) return { kind: "unchanged" };
  const since = state ? Date.parse(state) : -Infinity;
  const at = (m: ListedMod) => Date.parse(m.updatedAt!);
  const batch = mods
    .filter((m) => at(m) > since)
    .sort((a, b) => at(a) - at(b))
    .slice(0, max);
  if (!batch.length) return { kind: "unchanged" };

  const messages: object[] = [];
  for (const m of batch) {
    // A mod's first release also bumps its update time; /watch community covers new mods.
    if (at(m) - Date.parse(m.createdAt) < BRAND_NEW_MS) continue;
    const mod = await fetchMod(http, m);
    if (!mod) continue;
    messages.push(modUpdateMessage(mod, await fetchChangelog(http, mod, mod.version)));
  }
  const newState = batch[batch.length - 1].updatedAt!;
  return messages.length ? { kind: "announce", state: newState, messages } : { kind: "state", state: newState };
}
