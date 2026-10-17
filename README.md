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

Bug reports and pull requests are welcome.
