# Thunderstore Discord Watcher — Design

## Intent

A public Discord bot that any server can add, which posts to a channel when
something changes on [Thunderstore](https://thunderstore.io). No existing bot
does this. Test target: the **Slip & Skid** community (`slip-skid`).

## Goals

1. **Mod watch** — post when a specific mod publishes a new version.
2. **Community watch** — post when a brand-new mod appears anywhere in a
   Thunderstore community (e.g. all of `slip-skid`).
3. Servers can list and remove their watches.
4. Works for any mod / any community, not just Slip & Skid.
5. Free to host.

## Non-goals (for now)

- Role pings on announcements (explicitly deferred by the owner).
- Community watches announcing *updates* to existing mods (my call: would
  flood busy communities; mod watches cover updates).
- Nexus or any other mod site.
- A bot-side permission system (Discord handles it — see below).
- Auto-deploy from GitHub (can be added later).

## Anti-goals

- Spamming a channel with backlog when a watch is first added.
- Requiring the owner's PC to be on.

## Decided by the owner

- Both watch types, plus unwatch.
- Any mod or community supported; Slip & Skid for testing.
- Who can add/remove watches is controlled by **Discord permissions**.
- **Free hosting**, using the owner's GitHub and Cloudflare accounts.
- Code lives in `github.com/KieranJamess/thunderstore-discord-watcher`.
- No role pings yet.

## Architecture (my call, agreed in conversation)

Single **Cloudflare Worker** (free plan), TypeScript:

- **Slash commands** via Discord's HTTP *Interactions Endpoint URL* pointed at
  the Worker. No gateway connection. Requests verified with the app's Ed25519
  public key (required by Discord; reject invalid signatures with 401).
- **Polling** via a Cloudflare **Cron Trigger** every 5 minutes.
- **Storage** in **Cloudflare D1**.
- **Posting** via Discord REST `POST /channels/{id}/messages` using the bot token.
- Secrets (`DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID`) as Worker
  secrets, never committed.
- A small script registers the global slash commands.

## Commands

| Command | Does |
|---|---|
| `/watch mod <mod>` | Watch one mod. Accepts a Thunderstore URL or `Author-ModName`. Validated against the API before saving. |
| `/watch community <community>` | Watch a community for new mods. Autocompletes community identifiers. |
| `/unwatch <watch>` | Remove a watch. Autocompletes from this server's watches. |
| `/watches` | List this server's watches and their channels. |

- Watches post to the **channel the command was run in**.
- Commands are registered with `default_member_permissions = MANAGE_GUILD`
  (my call) so only managers can use them by default; admins can widen or
  narrow access per role/channel in *Server Settings → Integrations*.
  `/watches` may be open to everyone (my call: read-only).
- Guild-only (not usable in DMs).
- Duplicate watch (same server + channel + target) → friendly "already
  watching" reply, no new row.
- Replies to commands are ephemeral.
- `/watch` commands that call Thunderstore reply with a **deferred** response
  first, then edit it with the result (my call), so they always meet Discord's
  3-second deadline.

## Thunderstore data sources

- **Mod:** `GET https://thunderstore.io/api/experimental/package/{namespace}/{name}/`
  → `latest.version_number`, `latest.description`, `latest.icon`,
  `package_url`, `owner`. Documented API.
- **Community new mods:**
  `GET https://thunderstore.io/api/cyberstorm/listing/{community}/?ordering=newest`
  → paged, newest first, fields include `namespace`, `name`, `is_pinned`,
  `datetime_created`, `icon_url`, `description`. **Undocumented** (it's what the
  website uses) — the main risk. Pinned packages appear first regardless of
  age and must be ignored. Only page 1 is read per check. Verified 2026-10-17:
  non-pinned results are sorted by `datetime_created` descending.
- **Community list (autocomplete):** `GET https://thunderstore.io/api/experimental/community/`
  (cursor-paged). Cache in D1, refreshed at most daily.
- Thunderstore URLs may include a community prefix
  (`/c/{community}/p/{namespace}/{name}/`) or not (`/package/{namespace}/{name}/`);
  parse both.

## Change detection

- **Baseline on add:** when a watch is created, record current state (mod's
  latest version; community's newest non-pinned `datetime_created`) and post
  nothing. Only later changes are announced.
- **Mod:** announce when `latest.version_number` is **higher** than the stored
  value (numeric compare of dotted parts); store whatever is latest either way
  (my call: a deleted release rolling the version back isn't announced).
- **Community:** announce each non-pinned package on page 1 whose
  `datetime_created` is newer than the stored high-water mark, oldest first;
  then advance the mark.
- Fetch each distinct target **once per cron run**, even if many servers watch
  it, and fan out to all its watches. State is stored per target, not per watch.
- If more new mods than fit on page 1 appear in one interval, the extras are
  skipped (my call: acceptable at 5-minute intervals).

## Announcement format

Discord embed: mod name (linked to its Thunderstore page), version, author,
description, icon as thumbnail. Mod-update embeds say "updated to vX";
community embeds say "New mod in <community>".

## Failure handling

- Thunderstore error/timeout: skip that target this run, keep state, retry next run.
- Mod deleted (404): skip; don't delete the watch (my call). Revisit if noisy.
- Discord 403/404 posting to a channel (bot removed, channel deleted, missing
  permission): delete the watches for that channel (my call) so we stop
  retrying forever.
- Bot removed from a server: watches stay until a post fails, then are cleaned
  up by the rule above.

## Constraints

- Cloudflare free plan: 50 subrequests per invocation, 10 ms CPU per
  invocation, 100k requests/day, D1 free limits. The cron run must stay within
  the subrequest limit (D1 binding calls are assumed not to count; builder to
  confirm against current Cloudflare docs). If distinct targets + posts exceed it, process a
  bounded batch per run, oldest-checked first (rotating).
- No Node.js on the owner's PATH — setup instructions must cover installing
  Node (for `wrangler`) or use an alternative.

## Left to the builder

- Exact D1 schema, file layout, test approach.
- Embed colours and wording.
- How the command-registration script is run.

## Setup the owner will do

1. Create a Discord application + bot in the Developer Portal.
2. Create the Cloudflare D1 database and deploy the Worker with `wrangler`.
3. Set Worker secrets; set the Interactions Endpoint URL to the Worker URL.
4. Register commands; invite the bot to a test server; `/watch community slip-skid`.
