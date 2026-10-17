# thunderstore-discord-watcher

A Discord bot that posts to a channel when something changes on [Thunderstore](https://thunderstore.io):

- **Mod watch**: a post when a mod publishes a new version.
- **Community watch**: a post when a brand-new mod appears in a community (for example, all of `slip-skid`).

It runs as a single Cloudflare Worker on the free plan. It checks Thunderstore every 5 minutes, so posts can be up to about 5 minutes late.

## Commands

| Command | What it does |
|---|---|
| `/watch mod <link or Author-ModName>` | Announce new versions of one mod in this channel |
| `/watch community <community>` | Announce new mods in a community in this channel (autocompletes) |
| `/unwatch <watch>` | Stop a watch (autocompletes from this server's watches) |
| `/watches` | List this server's watches |
| `/help` | Explain the commands and how the bot behaves |

When you add a watch, the bot records what already exists and only posts changes after that.

Each server can have up to 25 watches.

By default, only members with **Manage Server** can use `/watch` and `/unwatch`. Admins can change who can use each command in **Server Settings → Integrations → (this bot)**.

## Self-hosting

You need Node.js 22.9+, a Cloudflare account and a Discord account.

1. **Create the Discord app.** In the [Developer Portal](https://discord.com/developers/applications), create an application and add a bot. Copy the **Application ID**, the **Public Key** and the bot **Token**.
2. **Install.** Run `npm install`.
3. **Create the database.** Run `npx wrangler d1 create thunderstore-watcher`, paste the printed `database_id` into `wrangler.toml`, then run `npm run migrate`.
4. **Add secrets.** Run each of these:
   ```sh
   npx wrangler secret put DISCORD_TOKEN
   npx wrangler secret put DISCORD_PUBLIC_KEY
   npx wrangler secret put DISCORD_APP_ID
   ```
5. **Deploy.** Run `npm run deploy` and copy the Worker URL it prints.
6. **Point Discord at the Worker.** In the Developer Portal, under **General Information**, set **Interactions Endpoint URL** to the Worker URL.
7. **Register the commands.** Create a `.dev.vars` file containing these two lines, then run `npm run register`. `.dev.vars` is git-ignored.
   ```
   DISCORD_APP_ID=<your-app-id>
   DISCORD_TOKEN=<your-bot-token>
   ```
8. **Invite the bot** to your server by opening this URL:
   `https://discord.com/oauth2/authorize?client_id=<your-app-id>&scope=bot+applications.commands&permissions=19456`
   (permissions: View Channel, Send Messages and Embed Links)

## Development

`npm test` runs the test suite locally against a real D1 database (Miniflare). It makes no network calls.

## Caveats

- Community watches read the newest-first listing that thunderstore.io's own website uses. That listing isn't an officially documented API, so if Thunderstore changes it, community watches may stop working until the bot is updated. Mod watches use the documented API.
- If a community gets more new mods in one 5-minute window than fit on the first page of that listing, the extra mods aren't announced. One post shows at most 10 mods.
- If the bot loses access to a channel, it removes that channel's watches.
- On the Workers free plan, each run can make only about 50 web requests and 50 database queries, so a run checks around 10 to 20 targets and sends around 20 to 30 posts. When many targets are watched, each one is checked less often than every 5 minutes, and posts for a widely watched mod spread over a few runs. A post that fails is retried up to 5 times.

Found a bug? Open an issue.
