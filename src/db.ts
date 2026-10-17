import type { ModRef } from "./thunderstore";

export type Watch = { id: number; guildId: string; channelId: string; targetId: string };
export type Target = { id: string; state: string | null; checkedAt: number };
export type Community = { identifier: string; name: string };

const WATCH_COLS = "id, guild_id AS guildId, channel_id AS channelId, target_id AS targetId";
const DROP_ORPHANS = "DELETE FROM targets WHERE id NOT IN (SELECT target_id FROM watches)";

export const modTargetId = (ref: ModRef) => `mod:${ref.namespace}-${ref.name}`;
export const communityTargetId = (community: string) => `community:${community}`;

export const MAX_WATCHES_PER_GUILD = 25;

/** An existing target keeps its state. */
export async function addWatch(
  db: D1Database,
  guildId: string,
  channelId: string,
  targetId: string,
  baselineState: string,
): Promise<"added" | "exists" | "full"> {
  const [, watch] = await db.batch([
    db.prepare("INSERT INTO targets (id, state) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(targetId, baselineState),
    db
      .prepare(
        `INSERT INTO watches (guild_id, channel_id, target_id)
         SELECT ?1, ?2, ?3 WHERE (SELECT count(*) FROM watches WHERE guild_id = ?1) < ${MAX_WATCHES_PER_GUILD}
         ON CONFLICT DO NOTHING`,
      )
      .bind(guildId, channelId, targetId),
    db.prepare(DROP_ORPHANS),
  ]);
  if (watch.meta.changes > 0) return "added";
  const exists = await db
    .prepare("SELECT 1 FROM watches WHERE guild_id = ? AND channel_id = ? AND target_id = ?")
    .bind(guildId, channelId, targetId)
    .first();
  return exists ? "exists" : "full";
}

/** Only removes a watch belonging to `guildId`. */
export async function removeWatch(db: D1Database, guildId: string, watchId: number): Promise<boolean> {
  const [del] = await db.batch([
    db.prepare("DELETE FROM watches WHERE id = ? AND guild_id = ?").bind(watchId, guildId),
    db.prepare(DROP_ORPHANS),
  ]);
  return del.meta.changes > 0;
}

export async function listWatches(db: D1Database, guildId: string): Promise<Watch[]> {
  const r = await db.prepare(`SELECT ${WATCH_COLS} FROM watches WHERE guild_id = ? ORDER BY id`).bind(guildId).all<Watch>();
  return r.results;
}

export async function dueTargets(db: D1Database, limit: number): Promise<Target[]> {
  const r = await db
    .prepare("SELECT id, state, checked_at AS checkedAt FROM targets ORDER BY checked_at, id LIMIT ?")
    .bind(limit)
    .all<Target>();
  return r.results;
}

export async function saveTarget(db: D1Database, targetId: string, state: string | null, checkedAt: number): Promise<void> {
  await db.prepare("UPDATE targets SET state = ?, checked_at = ? WHERE id = ?").bind(state, checkedAt, targetId).run();
}

/** Marks targets checked without changing their state. */
export async function touchTargets(db: D1Database, targetIds: string[], checkedAt: number): Promise<void> {
  if (!targetIds.length) return;
  await db
    .prepare("UPDATE targets SET checked_at = ? WHERE id IN (SELECT value FROM json_each(?))")
    .bind(checkedAt, JSON.stringify(targetIds))
    .run();
}

/** Saves new state and queues one post per watching channel, atomically. */
export async function queueAnnouncement(
  db: D1Database,
  targetId: string,
  state: string,
  checkedAt: number,
  body: object,
): Promise<void> {
  await db.batch([
    db.prepare("INSERT INTO outbox (channel_id, body) SELECT channel_id, ? FROM watches WHERE target_id = ?").bind(JSON.stringify(body), targetId),
    db.prepare("UPDATE targets SET state = ?, checked_at = ? WHERE id = ?").bind(state, checkedAt, targetId),
  ]);
}

export type PendingPost = { id: number; channelId: string; body: string };

export async function pendingPosts(db: D1Database, limit: number): Promise<PendingPost[]> {
  if (limit < 1) return [];
  const r = await db
    .prepare("SELECT id, channel_id AS channelId, body FROM outbox ORDER BY id LIMIT ?")
    .bind(limit)
    .all<PendingPost>();
  return r.results;
}

export const MAX_POST_ATTEMPTS = 5;

/** Records a drain pass: sent rows go, failed rows count an attempt (dropped at the cap), gone channels lose their watches. */
export async function finishPosts(db: D1Database, sent: number[], failed: number[], goneChannels: string[]): Promise<void> {
  const ids = (xs: unknown[]) => JSON.stringify(xs);
  const stmts = [
    db.prepare("DELETE FROM outbox WHERE id IN (SELECT value FROM json_each(?))").bind(ids(sent)),
    db.prepare("UPDATE outbox SET attempts = attempts + 1 WHERE id IN (SELECT value FROM json_each(?))").bind(ids(failed)),
    db.prepare(`DELETE FROM outbox WHERE attempts >= ${MAX_POST_ATTEMPTS}`),
  ];
  if (goneChannels.length) {
    const channels = "(SELECT value FROM json_each(?))";
    stmts.push(
      db.prepare(`DELETE FROM watches WHERE channel_id IN ${channels}`).bind(ids(goneChannels)),
      db.prepare(`DELETE FROM outbox WHERE channel_id IN ${channels}`).bind(ids(goneChannels)),
      db.prepare(DROP_ORPHANS),
    );
  }
  await db.batch(stmts);
}

/** Two statements regardless of size: the per-invocation D1 query limit counts statements. */
export async function replaceCommunities(db: D1Database, list: Community[]): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM communities"),
    db
      .prepare(
        "INSERT INTO communities (identifier, name) SELECT value ->> 'identifier', value ->> 'name' FROM json_each(?) WHERE true ON CONFLICT DO NOTHING",
      )
      .bind(JSON.stringify(list)),
  ]);
}

export async function searchCommunities(db: D1Database, q: string): Promise<Community[]> {
  const like = `%${q.toLowerCase()}%`;
  const r = await db
    .prepare(
      "SELECT identifier, name FROM communities WHERE lower(identifier) LIKE ?1 OR lower(name) LIKE ?1 ORDER BY name LIMIT 25",
    )
    .bind(like)
    .all<Community>();
  return r.results;
}

export async function getMeta(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setMeta(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}
