import type { ModRef } from "./thunderstore";

export type Watch = { id: number; guildId: string; channelId: string; targetId: string };
export type Target = { id: string; state: string | null; checkedAt: number };
export type Community = { identifier: string; name: string };

const WATCH_COLS = "id, guild_id AS guildId, channel_id AS channelId, target_id AS targetId";
const DROP_ORPHANS = "DELETE FROM targets WHERE id NOT IN (SELECT target_id FROM watches)";

export const modTargetId = (ref: ModRef) => `mod:${ref.namespace}-${ref.name}`;
export const communityTargetId = (community: string) => `community:${community}`;

/** Returns false if this exact watch already exists. An existing target keeps its state. */
export async function addWatch(
  db: D1Database,
  guildId: string,
  channelId: string,
  targetId: string,
  baselineState: string,
): Promise<boolean> {
  const [, watch] = await db.batch([
    db.prepare("INSERT INTO targets (id, state) VALUES (?, ?) ON CONFLICT DO NOTHING").bind(targetId, baselineState),
    db
      .prepare("INSERT INTO watches (guild_id, channel_id, target_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
      .bind(guildId, channelId, targetId),
  ]);
  return watch.meta.changes > 0;
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

export async function watchesFor(db: D1Database, targetId: string): Promise<Watch[]> {
  const r = await db.prepare(`SELECT ${WATCH_COLS} FROM watches WHERE target_id = ? ORDER BY id`).bind(targetId).all<Watch>();
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

export async function deleteChannelWatches(db: D1Database, channelId: string): Promise<void> {
  await db.batch([db.prepare("DELETE FROM watches WHERE channel_id = ?").bind(channelId), db.prepare(DROP_ORPHANS)]);
}

export async function replaceCommunities(db: D1Database, list: Community[]): Promise<void> {
  const insert = db.prepare("INSERT INTO communities (identifier, name) VALUES (?, ?)");
  await db.batch([db.prepare("DELETE FROM communities"), ...list.map((c) => insert.bind(c.identifier, c.name))]);
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
