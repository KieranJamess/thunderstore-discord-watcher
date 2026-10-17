import { deleteChannelWatches, dueTargets, getMeta, replaceCommunities, saveTarget, setMeta, watchesFor, type Target } from "./db";
import { modUpdateEmbed, newModEmbed, postMessage } from "./discord";
import { fetchCommunities, fetchMod, fetchNewestMods, isNewerVersion, parseModRef, type Http } from "./thunderstore";

export type PollDeps = { db: D1Database; http: Http; token: string; now: number; budget?: number };

const DAY = 24 * 3600_000;
const MAX_EMBEDS = 10; // Discord's per-message limit

/** One cron run. `budget` caps outbound fetches (Workers free plan allows 50 subrequests). */
export async function runPoll({ db, http, token, now, budget = 45 }: PollDeps): Promise<void> {
  let spent = 0;
  const counted: Http = (input, init) => {
    spent++;
    return http(input, init);
  };

  if (now - Number((await getMeta(db, "communities_at")) ?? 0) > DAY) {
    try {
      await replaceCommunities(db, await fetchCommunities(counted));
      await setMeta(db, "communities_at", String(now));
    } catch {
      // Autocomplete just stays stale until the next run.
    }
  }

  for (const target of await dueTargets(db, 50)) {
    const watches = await watchesFor(db, target.id);
    if (spent + 1 + watches.length > budget) break;
    let result: { state: string | null; message: object | null };
    try {
      result = await check(counted, target);
    } catch {
      result = { state: target.state, message: null };
    }
    if (result.message) {
      for (const w of watches) {
        if ((await postMessage(counted, token, w.channelId, result.message)) === "gone") {
          await deleteChannelWatches(db, w.channelId);
        }
      }
    }
    await saveTarget(db, target.id, result.state, now);
  }
}

/** Fetches a target's current state and the announcement to post, if any. */
async function check(http: Http, target: Target): Promise<{ state: string | null; message: object | null }> {
  const unchanged = { state: target.state, message: null };
  const [kind, ref] = [target.id.slice(0, target.id.indexOf(":")), target.id.slice(target.id.indexOf(":") + 1)];

  if (kind === "mod") {
    const mod = await fetchMod(http, parseModRef(ref)!);
    if (!mod) return unchanged;
    const newer = !target.state || isNewerVersion(mod.version, target.state);
    return { state: mod.version, message: newer ? { embeds: [modUpdateEmbed(mod)] } : null };
  }

  const mods = await fetchNewestMods(http, ref);
  if (!mods) return unchanged;
  const since = target.state ? Date.parse(target.state) : -Infinity;
  const fresh = mods.filter((m) => Date.parse(m.createdAt) > since).slice(0, MAX_EMBEDS);
  if (!fresh.length) return unchanged;
  return { state: fresh[0].createdAt, message: { embeds: fresh.reverse().map((m) => newModEmbed(m, ref)) } };
}
