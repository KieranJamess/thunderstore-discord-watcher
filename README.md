# Thunderstore Watcher for Discord

Get a message in your Discord server when your favourite [Thunderstore](https://thunderstore.io) mods update, or when new mods are released for your game.

- **Follow a mod:** get a post whenever it releases a new version, with the changelog for that version.
- **Follow a whole community:** get a post whenever a brand-new mod appears for a game, such as every new Slip & Skid mod.

Works with every game on Thunderstore.

## What the posts look like

When a mod you follow updates:

> **ExampleMod** has been updated to v1.3.0
> ┃ **ExampleMod v1.3.0**
> ┃ ### Features
> ┃ * Added a settings menu
> ┃ ### Bug Fixes
> ┃ * Fixed a crash when joining mid-round

When new mods appear in a community you follow:

> New mods found for slip-skid:
> ┃ **CoconutMall**: The Coconut Mall Mario Kart map with proper layout to fit with Slip & Skid and working boost pads.
> ┃ **SlipSkid_RarityWeights**: Allows you to set the rarity weights of items in Slip & Skid.

Each mod appears as a card with its icon, author and a link to its Thunderstore page.

## Add it to your server

1. [**Invite the bot**](https://discord.com/oauth2/authorize?client_id=1560970600569245821&scope=bot+applications.commands&permissions=19456). You need the **Manage Server** permission in the server you add it to.
2. Go to the channel where you want the posts.
3. Use `/watch mod` or `/watch community`.

That's it. Use `/help` at any time for a reminder.

## Commands

| Command | What it does | Example |
|---|---|---|
| `/watch mod` | Post in this channel when a mod gets a new version | `/watch mod https://thunderstore.io/c/slip-skid/p/Kjoekjoe/MoreCards/` |
| `/watch community` | Post in this channel when a new mod appears in a community | `/watch community slip-skid` |
| `/unwatch` | Stop a watch. Start typing and pick from the list | `/unwatch` |
| `/watches` | List everything this server is watching | `/watches` |
| `/help` | Show how the bot works | `/help` |

For `/watch mod`, you can paste the mod's Thunderstore link or type `Author-ModName` (for example `Kjoekjoe-MoreCards`).

For `/watch community`, start typing the game's name and pick it from the list, or paste a Thunderstore link for that game.

## Good to know

- **Checks run every 5 minutes**, so a post can arrive a few minutes after the release.
- **No backlog spam.** Adding a watch never posts what already exists, only changes after that.
- **Replies to commands are private.** Only you see them; announcements go to the channel.
- **Each server can have up to 25 watches.**
- **Who can manage watches:** by default, only members with **Manage Server** can use `/watch` and `/unwatch`. Anyone can use `/watches` and `/help`. Admins can change this per command, role or channel in **Server Settings → Integrations →** (the bot).
- **Announcements never ping anyone**, even if a changelog contains `@everyone`.

## Troubleshooting

| Problem | What to do |
|---|---|
| The commands don't show up | Discord can take a minute to show new commands. Press Ctrl+R (or restart Discord). |
| You can't see `/watch` | You need **Manage Server**, or an admin needs to give you access under **Server Settings → Integrations**. |
| A watch was added but nothing gets posted | The bot needs **View Channel**, **Send Messages** and **Embed Links** in that channel. If it loses access, it removes that channel's watches, so add them again after fixing permissions. |
| "Mod not found on Thunderstore" | Check the link, or try `Author-ModName` exactly as it appears on Thunderstore. |
| "Community not found" | Pick the game from the autocomplete list instead of typing it in full. |
| Something else | [Open an issue](../../issues). |

## Limitations

- Community watches use the newest-first list that Thunderstore's own website uses. It isn't an officially documented API, so if Thunderstore changes it, community watches may stop working until the bot is updated. Mod watches use Thunderstore's documented API.
- One post shows at most 10 new mods. If a community gets more new mods than fit on the first page of Thunderstore's list within 5 minutes, the extras aren't announced.
- On Cloudflare's free plan, each check can only do a limited amount of work. When lots of servers use the bot, each watch is checked less often than every 5 minutes, and a post for a widely watched mod can take a few runs to reach every channel.

---

## Host your own copy

You don't need to do this to use the bot. It's for running your own copy under your own Discord app, for example to change how it works. Everything fits on Cloudflare's free plan.

You need [Node.js](https://nodejs.org) 22.9 or newer, a free [Cloudflare](https://dash.cloudflare.com/sign-up) account and a Discord account.

1. **Create a Discord app.** In the [Discord Developer Portal](https://discord.com/developers/applications), click **New Application**. On the **Bot** tab, reset the token and copy it. On **General Information**, copy the **Application ID** and **Public Key**.
2. **Download and install.**
   ```sh
   git clone <this repo's URL>
   cd thunderstore-discord-watcher
   npm install
   npx wrangler login
   ```
3. **Create the database.** Run `npx wrangler d1 create thunderstore-watcher`. Paste the `database_id` it prints into `wrangler.toml`, then run `npm run migrate`.
4. **Deploy.** Run `npm run deploy` and note the URL it prints, ending in `workers.dev`.
5. **Add your Discord keys.** Create a file called `.dev.vars` in the project folder:
   ```
   DISCORD_TOKEN=<bot token>
   DISCORD_PUBLIC_KEY=<public key>
   DISCORD_APP_ID=<application id>
   ```
   Then run `npx wrangler secret bulk .dev.vars`. Git ignores `.dev.vars`, so it never gets committed.
6. **Connect Discord to your copy.** In the Developer Portal, under **General Information**, set **Interactions Endpoint URL** to your Worker URL followed by `/interactions`, then save. Discord checks the URL when you save, so if it saves, it works.
7. **Register the commands.** Run `npm run register`.
8. **Invite your bot** with this link, after putting in your Application ID:
   `https://discord.com/oauth2/authorize?client_id=<your-app-id>&scope=bot+applications.commands&permissions=19456`

**Optional extras:**
- **Your own domain.** If the domain is on your Cloudflare account, add `routes = [{ pattern = "bot.example.com", custom_domain = true }]` to `wrangler.toml` and deploy again.
- **Flood protection.** In the Cloudflare dashboard, go to **Security → WAF → Rate limiting rules** for your domain. Add a rule with **URI Path** equals `/interactions`, **50 requests per 10 seconds**, action **Block** for **10 seconds**. This stops spam from using up the free plan's daily request allowance.

### Development

`npm test` runs the full test suite on your machine against a local copy of the database. It makes no network calls, so it never touches Thunderstore or Discord.

Bug reports and pull requests are welcome.
