-- Lets /unwatch drop announcements already queued for that watch.
ALTER TABLE outbox ADD COLUMN watch_id INTEGER;
