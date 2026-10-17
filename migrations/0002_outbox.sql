-- Announcements waiting to be posted; lets one target's fan-out span several cron runs.
CREATE TABLE outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  body TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);
