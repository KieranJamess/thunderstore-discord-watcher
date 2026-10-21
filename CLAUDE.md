# Thunderstore Watcher

Discord bot on a Cloudflare Worker (`src/index.ts`) with a D1 database (`migrations/`). Live at `thunderstore.trackerly.co.uk`.

## Privacy Policy and Terms of Service

`src/legal.ts` serves `/privacy` and `/terms`, linked from the Discord Developer Portal for the App Directory listing. They must describe what the bot actually does, so check them whenever a change:

- stores new data or keeps data for longer (new tables or columns in `migrations/`, new fields on watches or the outbox), especially anything about users;
- changes how data is removed (`/unwatch`, gone-channel cleanup in `src/db.ts`);
- adds a new external service the bot sends data to, or a new kind of content it posts;
- changes what the bot can do in a server (new commands, permissions or intents in `src/command-definitions.json` or the invite link in `README.md`).

When you change either page, update `UPDATED` in `src/legal.ts` to that day's date.

## Deploying

Pushing to `main` runs `.github/workflows/deploy.yml`: type check, tests, `npm run migrate`, `npm run deploy`. The committed `wrangler.toml` holds a placeholder D1 database ID (local copy is skip-worktree); CI fills it from the `D1_DATABASE_ID` secret, so don't commit the real ID.

## Changelog

After a successful deploy, the workflow posts the subjects of the pushed `feat:` and `fix:` commits to #changelog in the community Discord server, through the `DISCORD_CHANGELOG_WEBHOOK` secret. Other prefixes (`ci:`, `docs:`, `chore:`, `test:`, `refactor:`) are not posted. Because users read these subjects:

- use `feat:`/`fix:` only for changes a bot user would notice, and write the subject for them (`feat: watch a mod by pasting its Thunderstore link`, not `feat: add parseUrl helper`);
- use another prefix for internal changes;
- keep the subject on one line; the body is never posted.
