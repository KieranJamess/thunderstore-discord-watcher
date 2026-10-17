CREATE TABLE targets (
  id TEXT PRIMARY KEY,            -- 'mod:Namespace-Name' | 'community:slip-skid'
  state TEXT,                     -- mod: version; community: newest datetime_created ('' if none)
  checked_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  target_id TEXT NOT NULL REFERENCES targets(id),
  UNIQUE (guild_id, channel_id, target_id)
);
CREATE TABLE communities (identifier TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
