# Thunderstore Discord Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Cloudflare Worker Discord bot that announces Thunderstore mod updates and new mods in a community, managed by slash commands.

**Architecture:** One Worker. `fetch` handles Discord HTTP interactions (signature-verified). `scheduled` (cron every 5 min) polls Thunderstore per distinct target and fans out posts. State in D1. Every module that talks to the network takes an injected `http: typeof fetch`, so tests use plain fake functions — no mocking library.

**Tech Stack:** TypeScript, Wrangler, Cloudflare D1, Vitest + `@cloudflare/vitest-pool-workers` (real D1 in tests). No Discord library; Ed25519 via `crypto.subtle`.

**Spec:** `docs/superpowers/specs/2026-10-17-thunderstore-watcher-design.md`

## Global Constraints

- Cloudflare **free plan**: ≤ 50 subrequests per invocation, 10 ms CPU. Cron run spends at most **45** fetches.
- Cron: `*/5 * * * *`.
- Secrets: `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID` — Worker secrets / `.dev.vars`, never committed (`.dev.vars` in `.gitignore`).
- Invalid interaction signature → HTTP **401**.
- `/watch` and `/unwatch` registered with `default_member_permissions: "32"` (MANAGE_GUILD); `/watches` has none. All commands `contexts: [0]` (guild only).
- All command replies ephemeral (`flags: 64`).
- Watches post to the channel the command ran in.
- Baseline on add: nothing posted for what exists when a watch is created.
- **No owner name, handle or email in any committed file.** Use placeholders (`<your-app-id>`) in docs.
- Node is at `C:\Program Files\nodejs` (on PATH in Git Bash).

## Review Focus

1. `/unwatch` given a watch id belonging to **another server** → "not found", nothing deleted. (Task 5 test)
2. Mod input with a version suffix (`Author-Mod-1.2.3`) or a `/c/<community>/p/...` URL with trailing path/query → parses to the right mod. (Task 2 test)
3. Same target watched in two channels → fetched once, posted to both; unwatching one keeps the other working. (Task 6 test)
4. Community with **zero** non-pinned mods when watched → first mod that later appears is announced. (Task 6 test)
5. Thunderstore 5xx during poll → state unchanged, `checked_at` still advances so a broken target can't hog the front of the queue. (Task 6 test)

---

### Task 1: Scaffold, schema, test harness

**Files:**
- Create: `package.json`, `tsconfig.json`, `wrangler.toml`, `vitest.config.ts`, `.gitignore`, `migrations/0001_init.sql`, `src/index.ts` (stub), `test/env.d.ts`, `test/apply-migrations.ts`, `test/smoke.test.ts`

**Interfaces:**
- Produces: `interface Env { DB: D1Database; DISCORD_TOKEN: string; DISCORD_PUBLIC_KEY: string; DISCORD_APP_ID: string }` exported from `src/index.ts`. In tests, `env.DB` has migrations applied.

- [ ] **Step 1:** `npm init -y`; `npm i -D wrangler typescript vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types` — take the vitest version `@cloudflare/vitest-pool-workers` peers on.
- [ ] **Step 2:** `wrangler.toml`: `name = "thunderstore-discord-watcher"`, `main = "src/index.ts"`, current `compatibility_date`, `[triggers] crons = ["*/5 * * * *"]`, `[[d1_databases]] binding = "DB"`, `database_name = "thunderstore-watcher"`, `database_id = "<set-after-wrangler-d1-create>"`, `migrations_dir = "migrations"`.
- [ ] **Step 3:** `migrations/0001_init.sql`:

```sql
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
```

- [ ] **Step 4:** `vitest.config.ts` uses `defineWorkersConfig` with `readD1Migrations("migrations")` passed as a `TEST_MIGRATIONS` binding, and `setupFiles: ["test/apply-migrations.ts"]` calling `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` (the pattern from the vitest-pool-workers D1 example).
- [ ] **Step 5:** `test/smoke.test.ts`: `insert into meta values ('k','v')` then select → `expect(row.value).toBe("v")`.
- [ ] **Step 6:** `npx vitest run` → PASS. `npx tsc --noEmit` → no errors.
- [ ] **Step 7:** Commit `chore: scaffold worker, D1 schema, test harness`.

---

### Task 2: Thunderstore client

**Files:** Create `src/thunderstore.ts`, `test/thunderstore.test.ts`

**Interfaces:**
- Produces:
  - `type Http = typeof fetch`
  - `type ModRef = { namespace: string; name: string }`
  - `type ModInfo = { namespace: string; name: string; version: string; description: string; iconUrl: string; url: string }`
  - `type ListedMod = { namespace: string; name: string; description: string; iconUrl: string; createdAt: string }`
  - `parseModRef(input: string): ModRef | null`
  - `isNewerVersion(candidate: string, current: string): boolean`
  - `fetchMod(http: Http, ref: ModRef): Promise<ModInfo | null>` — null on 404, throws on other non-2xx
  - `fetchNewestMods(http: Http, community: string): Promise<ListedMod[] | null>` — page 1 of `/api/cyberstorm/listing/{community}/?ordering=newest`, pinned removed, newest first; null on 404; throws otherwise
  - `fetchCommunities(http: Http): Promise<{ identifier: string; name: string }[]>` — follows `pagination.next_link` from `/api/experimental/community/`
  - `modUrl(ref: ModRef): string` → `https://thunderstore.io/package/{ns}/{name}/`

- [ ] **Step 1: Failing tests** (fake `http` returns `new Response(JSON.stringify(fixture), { status })`; fixtures trimmed from real responses):

```ts
expect(parseModRef("https://thunderstore.io/c/slip-skid/p/SlipSkid_Modding/BepInExPack_SlipSkid/")).toEqual({ namespace: "SlipSkid_Modding", name: "BepInExPack_SlipSkid" });
expect(parseModRef("https://thunderstore.io/c/slip-skid/p/A/B/changelog/?x=1")).toEqual({ namespace: "A", name: "B" });
expect(parseModRef("https://thunderstore.io/package/A/B/")).toEqual({ namespace: "A", name: "B" });
expect(parseModRef("A-B")).toEqual({ namespace: "A", name: "B" });
expect(parseModRef("A-B-1.2.3")).toEqual({ namespace: "A", name: "B" });
expect(parseModRef("nonsense")).toBeNull();
expect(parseModRef("https://example.com/package/A/B/")).toBeNull();

expect(isNewerVersion("1.0.10", "1.0.9")).toBe(true);
expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
expect(isNewerVersion("1.0.0", "1.2.0")).toBe(false);

// fetchMod maps latest.version_number / latest.description / latest.icon / package_url
// fetchMod → null on 404; rejects on 500
// fetchNewestMods drops is_pinned entries, keeps order, maps icon_url/datetime_created; null on 404
// fetchCommunities follows two pages (fake returns next_link on first, null on second) → 3 items total
```

- [ ] **Step 2:** `npx vitest run test/thunderstore.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement. Namespaces and names contain no `-`, so split `Author-Mod[-version]` on `-`. URLs: only host `thunderstore.io`; match `/c/<c>/p/<ns>/<name>` or `/package/<ns>/<name>`.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit `feat: thunderstore client`.

---

### Task 3: Storage

**Files:** Create `src/db.ts`, `test/db.test.ts`

**Interfaces:**
- Produces:
  - `type Watch = { id: number; guildId: string; channelId: string; targetId: string }`
  - `type Target = { id: string; state: string | null; checkedAt: number }`
  - `modTargetId(ref: ModRef): string` → `"mod:A-B"`; `communityTargetId(c: string): string` → `"community:c"`
  - `addWatch(db, guildId, channelId, targetId, baselineState: string): Promise<boolean>` — inserts target if absent (existing target keeps its state), inserts watch; `false` if that watch already existed
  - `removeWatch(db, guildId: string, watchId: number): Promise<boolean>` — only deletes if `guild_id` matches; deletes the target if no watches remain
  - `listWatches(db, guildId): Promise<Watch[]>`
  - `dueTargets(db, limit: number): Promise<Target[]>` — oldest `checked_at` first
  - `watchesFor(db, targetId): Promise<Watch[]>`
  - `saveTarget(db, targetId, state: string | null, checkedAt: number): Promise<void>`
  - `deleteChannelWatches(db, channelId): Promise<void>` — plus orphaned targets
  - `replaceCommunities(db, list: {identifier,name}[])`, `searchCommunities(db, q: string): Promise<{identifier,name}[]>` (≤ 25, matches identifier or name, case-insensitive)
  - `getMeta(db, key): Promise<string | null>`, `setMeta(db, key, value)`

- [ ] **Step 1: Failing tests** against `env.DB`:
  - `addWatch(...,"1.0.0")` → true; same again → false; second channel same target → true and target state still `"1.0.0"` even if passed `"9.9.9"`.
  - `removeWatch("other-guild", id)` → false and watch still listed.
  - `removeWatch(guild, id)` for the last watch on a target → target row gone; with another watch remaining → target kept.
  - `dueTargets(db, 1)` returns the lower `checked_at`.
  - `deleteChannelWatches` removes only that channel's watches.
  - `searchCommunities(db, "slip")` finds `slip-skid`; returns ≤ 25 when 30 match.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement with prepared statements; use `db.batch` where several writes go together. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat: D1 storage`.

---

### Task 4: Discord primitives

**Files:** Create `src/discord.ts`, `test/discord.test.ts`

**Interfaces:**
- Consumes: `Http`, `ModInfo`, `ListedMod`
- Produces:
  - `verifyDiscordRequest(body: string, signatureHex: string | null, timestamp: string | null, publicKeyHex: string): Promise<boolean>` — `crypto.subtle.verify("Ed25519", key, sig, timestamp + body)`; false on missing headers or bad hex
  - `postMessage(http, token, channelId, body: object): Promise<"ok" | "gone" | "error">` — `gone` on 403/404
  - `editOriginal(http, appId, interactionToken, content: string): Promise<void>` — `PATCH /webhooks/{appId}/{token}/messages/@original`
  - `modUpdateEmbed(m: ModInfo): object` — title `"{name} updated to v{version}"`, url, author `namespace`, description, thumbnail
  - `newModEmbed(m: ListedMod, community: string): object` — title `"New mod in {community}: {name}"`, url `modUrl`, author, description, thumbnail
- [ ] **Step 1: Failing tests:** generate an Ed25519 key pair in-test with `crypto.subtle.generateKey`, sign `ts+body` → `verifyDiscordRequest` true; flipped byte → false; null header → false. `postMessage` with fake http returning 403 → `"gone"`, 200 → `"ok"`, 500 → `"error"`; assert request URL `https://discord.com/api/v10/channels/123/messages` and header `Authorization: Bot t`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: discord primitives`.

---

### Task 5: Slash commands and interaction routing

**Files:** Create `src/commands.json`, `src/commands.ts`, `test/commands.test.ts`; modify `src/index.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4.
- Produces:
  - `src/commands.json` — the definitions (also used by Task 7's register script): `watch` (subcommands `mod` with required string `mod`; `community` with required string `community`, `autocomplete: true`), `unwatch` (required string `watch`, `autocomplete: true`), `watches`. Permissions/contexts per Global Constraints.
  - `handleInteraction(i: any, deps: { db: D1Database; http: Http; appId: string; waitUntil: (p: Promise<unknown>) => void }): Promise<object>` — returns the interaction response JSON
  - `src/index.ts` `fetch`: POST only; verify signature (401 on fail); `Response.json(await handleInteraction(...))`
- Behaviour:
  - type 1 → `{ type: 1 }`
  - no `guild_id` → ephemeral `"Use this in a server."`
  - `/watch mod` → `{ type: 5, data: { flags: 64 } }`; via `waitUntil`: parse (invalid → edit "Couldn't read that. Paste a Thunderstore link or use Author-ModName."), `fetchMod` (null → "Mod not found on Thunderstore."), `addWatch` with baseline `version` (false → "Already watching {name} here."), else "Watching {name} (currently v{version}) in this channel."
  - `/watch community` → same deferred pattern; `fetchNewestMods` null → "Community not found."; baseline = newest `createdAt` or `""`; success "Watching {community} for new mods in this channel."
  - `/unwatch` → `removeWatch(guild, Number(value))` → "Stopped watching." / "Watch not found."
  - `/watches` → list lines `"#<channel mention> — {target}"`, or "No watches in this server."
  - type 4 autocomplete: `community` → `searchCommunities`; `watch` → this guild's watches as `{ name: "{target} in #{channelId}", value: String(id) }` filtered by typed text; respond `{ type: 8, data: { choices } }` (≤ 25)
- [ ] **Step 1: Failing tests** (fake http; `waitUntil` collects promises, tests `await Promise.all`): ping; `/watch mod` with valid URL → deferred response, then `listWatches` has it and editOriginal body contains `"currently v1.0.0"`; repeat → "Already watching"; 404 → "Mod not found"; `/unwatch` with other guild's watch id → "Watch not found." and watch remains; `/watches` empty message; community autocomplete returns `slip-skid` choice; `fetch` handler returns 401 for an unsigned request.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: slash commands`.

---

### Task 6: Poller

**Files:** Create `src/poll.ts`, `test/poll.test.ts`; modify `src/index.ts`

**Interfaces:**
- Consumes: Tasks 2–4.
- Produces:
  - `runPoll(deps: { db: D1Database; http: Http; token: string; now: number; budget?: number }): Promise<void>` (budget default 45)
  - `src/index.ts` `scheduled`: `ctx.waitUntil(runPoll({ db: env.DB, http: fetch, token: env.DISCORD_TOKEN, now: Date.now() }))`
- Algorithm (budget-bound):
  1. If `getMeta("communities_at")` older than 24 h (or missing): `replaceCommunities(fetchCommunities(...))`, `setMeta`; costs pages fetched. Failure is ignored.
  2. `dueTargets(db, 50)`; for each, skip remaining once `budget < 1 + watchesFor(target).length`.
  3. Fetch once per target. On throw: `saveTarget(id, oldState, now)`, continue. On null (404): same.
  4. Mod: if `isNewerVersion(new, old)` → one `modUpdateEmbed` message per watch. Always save latest version.
  5. Community: new = mods with `createdAt > state`, oldest first, last 10 kept (Discord's 10-embed limit) → one message per watch with those embeds. Save newest `createdAt` (unchanged if none).
  6. `postMessage` → `"gone"` → `deleteChannelWatches(channelId)`.
- [ ] **Step 1: Failing tests:**
  - mod 1.0.0 → fake returns 1.0.1 → one post, state `"1.0.1"`; next run same → no post.
  - two channels on one target → fake http called once for Thunderstore, two posts.
  - community state `""`, listing returns 2 mods → one post with 2 embeds, oldest first.
  - community with pinned + older mods only → no post.
  - Thunderstore 500 → no post, state unchanged, `checked_at === now`.
  - post returns 404 → that channel's watches deleted.
  - `budget: 2` with two targets each one watch → only first target processed.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5:** Commit `feat: poller`.

---

### Task 7: Command registration and setup docs

**Files:** Create `scripts/register.mjs`; modify `README.md`, `package.json` (scripts)

**Interfaces:**
- Consumes: `src/commands.json`.
- [ ] **Step 1:** `scripts/register.mjs`: reads `DISCORD_APP_ID`, `DISCORD_TOKEN` from env (or `.dev.vars`), `PUT https://discord.com/api/v10/applications/{appId}/commands` with the JSON; prints count or the error body and exits 1.
- [ ] **Step 2:** `package.json` scripts: `test` → `vitest run`, `deploy` → `wrangler deploy`, `register` → `node scripts/register.mjs`, `migrate` → `wrangler d1 migrations apply thunderstore-watcher --remote`.
- [ ] **Step 3:** README: what it does, commands table, self-host setup (create Discord app → `wrangler d1 create` → paste id into `wrangler.toml` → `npm run migrate` → `wrangler secret put` ×3 → `npm run deploy` → set Interactions Endpoint URL → `npm run register` → invite URL with `bot applications.commands` scopes and Send Messages + Embed Links), note that admins can change who uses commands in Server Settings → Integrations, and the undocumented-listing caveat. Placeholders only — no owner identifiers.
- [ ] **Step 4:** `npm test` → all PASS; `npx tsc --noEmit` clean; `npx wrangler deploy --dry-run` succeeds.
- [ ] **Step 5:** Commit `docs: setup and command registration`.

---

## After the plan

The owner does the live setup in README order, then: `/watch community slip-skid` and `/watch mod <a Slip & Skid mod link>` in a test server; confirm `/watches` lists both and `/unwatch` removes one.
