import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { addWatch, communityTargetId, dueTargets, getMeta, listWatches, modTargetId, searchCommunities, setMeta } from "../src/db";
import { runPoll } from "../src/poll";
import { fakeHttp, json, type Call } from "./helpers";

const NOW = 1_000_000;
const MOD = modTargetId({ namespace: "A", name: "B" });
const COMMUNITY = communityTargetId("slip-skid");
const MOD_API = "https://thunderstore.io/api/experimental/package/A/B/";
const LISTING = "https://thunderstore.io/api/cyberstorm/listing/slip-skid/?ordering=newest";
const changelog = (v: string) => `https://thunderstore.io/api/experimental/package/A/B/${v}/changelog/`;
const post = (channel: string) => `POST https://discord.com/api/v10/channels/${channel}/messages`;

const modBody = (version: string) => ({
  namespace: "A",
  name: "B",
  package_url: "https://thunderstore.io/package/A/B/",
  latest: { version_number: version, description: "d", icon: "i" },
});
const listed = (name: string, created: string, pinned = false) => ({
  namespace: "A",
  name,
  description: "d",
  icon_url: "i",
  datetime_created: created,
  is_pinned: pinned,
});

const posted: Record<string, any[]> = {};
const recordPost = (channel: string, status = 200) => ({
  [post(channel)]: (c: Call) => {
    (posted[channel] ??= []).push(JSON.parse(c.body));
    return json({}, status);
  },
});
const state = async (id: string) => (await dueTargets(env.DB, 50)).find((t) => t.id === id);
const poll = (http: typeof fetch, budget?: number) => runPoll({ db: env.DB, http, token: "t", now: NOW, budget });

beforeEach(async () => {
  for (const k of Object.keys(posted)) delete posted[k];
  await setMeta(env.DB, "communities_at", String(NOW)); // skip the daily refresh unless a test wants it
});

describe("mod watches", () => {
  it("announces a newer version once", async () => {
    await addWatch(env.DB, "g1", "c1", MOD, "1.0.0");
    const { http } = fakeHttp({
      [MOD_API]: () => json(modBody("1.0.1")),
      [changelog("1.0.1")]: () => json({ markdown: "## 1.0.1\n* fixed things\n## 1.0.0\n* first" }),
      ...recordPost("c1"),
    });
    await poll(http);
    expect(posted.c1).toHaveLength(1);
    expect(posted.c1[0].content).toBe("**B** has been updated to v1.0.1");
    expect(posted.c1[0].embeds[0].description).toBe("* fixed things");
    expect(await state(MOD)).toEqual({ id: MOD, state: "1.0.1", checkedAt: NOW });
    await poll(http);
    expect(posted.c1).toHaveLength(1);
  });
  it("doesn't announce a version going backwards", async () => {
    await addWatch(env.DB, "g1", "c1", MOD, "1.2.0");
    const { http } = fakeHttp({ [MOD_API]: () => json(modBody("1.1.0")), ...recordPost("c1") });
    await poll(http);
    expect(posted.c1).toBeUndefined();
    expect((await state(MOD))!.state).toBe("1.1.0");
  });
  it("fetches once for two channels and posts to both", async () => {
    await addWatch(env.DB, "g1", "c1", MOD, "1.0.0");
    await addWatch(env.DB, "g2", "c2", MOD, "1.0.0");
    const { http, calls } = fakeHttp({ [MOD_API]: () => json(modBody("2.0.0")), ...recordPost("c1"), ...recordPost("c2") });
    await poll(http);
    expect(calls.filter((c) => c.url === MOD_API)).toHaveLength(1);
    expect([posted.c1.length, posted.c2.length]).toEqual([1, 1]);
  });
});

describe("community watches", () => {
  it("announces new mods oldest first in one message", async () => {
    await addWatch(env.DB, "g1", "c1", COMMUNITY, "2026-10-01T00:00:00Z");
    const { http } = fakeHttp({
      [LISTING]: () =>
        json({
          results: [
            listed("Pinned", "2026-01-01T00:00:00Z", true),
            listed("Newer", "2026-10-12T00:00:00Z"),
            listed("New", "2026-10-11T00:00:00Z"),
            listed("Seen", "2026-10-01T00:00:00Z"),
          ],
        }),
      ...recordPost("c1"),
    });
    await poll(http);
    expect(posted.c1).toHaveLength(1);
    expect(posted.c1[0].content).toBe("New mods found for slip-skid:");
    expect(posted.c1[0].embeds.map((e: any) => e.title)).toEqual(["New", "Newer"]);
    expect((await state(COMMUNITY))!.state).toBe("2026-10-12T00:00:00Z");
  });
  it("announces the first mod of a community that was empty", async () => {
    await addWatch(env.DB, "g1", "c1", COMMUNITY, "");
    const { http } = fakeHttp({ [LISTING]: () => json({ results: [listed("First", "2026-10-12T00:00:00Z")] }), ...recordPost("c1") });
    await poll(http);
    expect(posted.c1[0].embeds).toHaveLength(1);
  });
  it("stays quiet when only pinned or seen mods exist", async () => {
    await addWatch(env.DB, "g1", "c1", COMMUNITY, "2026-10-01T00:00:00Z");
    const { http } = fakeHttp({
      [LISTING]: () => json({ results: [listed("Pinned", "2026-10-20T00:00:00Z", true), listed("Seen", "2026-10-01T00:00:00Z")] }),
      ...recordPost("c1"),
    });
    await poll(http);
    expect(posted.c1).toBeUndefined();
  });
  it("caps one message at 10 embeds, keeping the newest", async () => {
    await addWatch(env.DB, "g1", "c1", COMMUNITY, "");
    const results = Array.from({ length: 12 }, (_, i) => listed(`M${11 - i}`, `2026-10-${String(20 - i).padStart(2, "0")}T00:00:00Z`));
    const { http } = fakeHttp({ [LISTING]: () => json({ results }), ...recordPost("c1") });
    await poll(http);
    const titles = posted.c1[0].embeds.map((e: any) => e.title);
    expect(titles).toHaveLength(10);
    expect(titles[9]).toBe("M11");
  });
});

describe("failures", () => {
  it("keeps state but advances checked_at when Thunderstore errors", async () => {
    await addWatch(env.DB, "g1", "c1", MOD, "1.0.0");
    const { http } = fakeHttp({ [MOD_API]: () => json({}, 500), ...recordPost("c1") });
    await poll(http);
    expect(posted.c1).toBeUndefined();
    expect(await state(MOD)).toEqual({ id: MOD, state: "1.0.0", checkedAt: NOW });
  });
  it("keeps the watch when the mod 404s", async () => {
    await addWatch(env.DB, "g1", "c1", MOD, "1.0.0");
    const { http } = fakeHttp({ [MOD_API]: () => json({}, 404) });
    await poll(http);
    expect(await listWatches(env.DB, "g1")).toHaveLength(1);
  });
  it("deletes a channel's watches when Discord says it's gone", async () => {
    await addWatch(env.DB, "g1", "c1", MOD, "1.0.0");
    await addWatch(env.DB, "g1", "c2", MOD, "1.0.0");
    const { http } = fakeHttp({ [MOD_API]: () => json(modBody("2.0.0")), ...recordPost("c1", 404), ...recordPost("c2") });
    await poll(http);
    expect((await listWatches(env.DB, "g1")).map((w) => w.channelId)).toEqual(["c2"]);
  });
});

it("stops checking when the budget runs out, leaving the rest for next run", async () => {
  await addWatch(env.DB, "g1", "c1", MOD, "1.0.0");
  await addWatch(env.DB, "g1", "c1", COMMUNITY, "");
  const { http, calls } = fakeHttp({
    [MOD_API]: () => json(modBody("1.0.0")),
    [LISTING]: () => json({ results: [] }),
  });
  await poll(http, 14);
  expect(calls).toHaveLength(1);
  expect((await dueTargets(env.DB, 50)).filter((t) => t.checkedAt === 0)).toHaveLength(1);
});

it("counts D1 queries against the budget, not just fetches", async () => {
  // 30 targets: one fetch each would fit in 45, but not with a D1 write per target on top.
  for (let i = 0; i < 30; i++) await addWatch(env.DB, "g1", "c1", modTargetId({ namespace: "A", name: `M${i}` }), "1.0.0");
  const routes: Record<string, () => Response> = {};
  for (let i = 0; i < 30; i++) {
    routes[`https://thunderstore.io/api/experimental/package/A/M${i}/`] = () => json({ ...modBody("2.0.0"), name: `M${i}` });
  }
  let queries = 0;
  const db = new Proxy(env.DB, {
    get(target, prop) {
      if (prop === "prepare") queries++;
      const v = Reflect.get(target, prop);
      return typeof v === "function" ? v.bind(target) : v;
    },
  });
  const { http, calls } = fakeHttp({ ...routes, ...recordPost("c1") });
  await runPoll({ db, http, token: "t", now: NOW });
  expect(calls.length + queries).toBeLessThanOrEqual(45);
});

it("spreads a target with more watches than the budget over several runs", async () => {
  for (let i = 0; i < 60; i++) await addWatch(env.DB, `g${i}`, `c${i}`, MOD, "1.0.0");
  await addWatch(env.DB, "gx", "cx", COMMUNITY, "");
  const routes: Record<string, (c: Call) => Response> = {
    [MOD_API]: () => json(modBody("2.0.0")),
    [LISTING]: () => json({ results: [] }),
    ...recordPost("cx"),
  };
  for (let i = 0; i < 60; i++) Object.assign(routes, recordPost(`c${i}`));
  const { http, calls } = fakeHttp(routes);
  for (let run = 0; run < 5; run++) await runPoll({ db: env.DB, http, token: "t", now: NOW + run });
  // Both targets got checked (the big one didn't block the other)...
  expect(calls.filter((c) => c.url === LISTING).length).toBeGreaterThan(0);
  // ...and every channel got exactly one post.
  for (let i = 0; i < 60; i++) expect(posted[`c${i}`]).toHaveLength(1);
});

it("retries a post that failed, without re-posting to channels that got it", async () => {
  await addWatch(env.DB, "g1", "c1", MOD, "1.0.0");
  await addWatch(env.DB, "g1", "c2", MOD, "1.0.0");
  let c2 = 0;
  const { http } = fakeHttp({
    [MOD_API]: () => json(modBody("2.0.0")),
    ...recordPost("c1"),
    [post("c2")]: (c) => {
      if (c2++ === 0) throw new Error("network down");
      (posted.c2 ??= []).push(JSON.parse(c.body));
      return json({});
    },
  });
  await poll(http);
  await runPoll({ db: env.DB, http, token: "t", now: NOW + 1 });
  expect(posted.c1).toHaveLength(1);
  expect(posted.c2).toHaveLength(1);
});

it("gives up on a post after 5 failed attempts", async () => {
  await addWatch(env.DB, "g1", "c1", MOD, "1.0.0");
  let attempts = 0;
  const { http } = fakeHttp({
    [MOD_API]: () => json(modBody("2.0.0")),
    [post("c1")]: () => {
      attempts++;
      return json({}, 500);
    },
  });
  for (let run = 0; run < 8; run++) await runPoll({ db: env.DB, http, token: "t", now: NOW + run });
  expect(attempts).toBe(5);
});

describe("community list refresh", () => {
  const COMMUNITIES = "https://thunderstore.io/api/experimental/community/";
  it("runs once a day", async () => {
    await setMeta(env.DB, "communities_at", String(NOW - 25 * 3600_000));
    const { http } = fakeHttp({
      [COMMUNITIES]: () => json({ pagination: { next_link: null }, results: [{ identifier: "slip-skid", name: "Slip & Skid" }] }),
    });
    await poll(http);
    expect(await searchCommunities(env.DB, "slip")).toHaveLength(1);
    expect(await getMeta(env.DB, "communities_at")).toBe(String(NOW));
  });
  it("stores hundreds of communities within the budget", async () => {
    await setMeta(env.DB, "communities_at", String(NOW - 2 * 86_400_000));
    const results = Array.from({ length: 400 }, (_, i) => ({ identifier: `game-${i}`, name: `Game ${i}` }));
    const { http } = fakeHttp({ [COMMUNITIES]: () => json({ pagination: { next_link: null }, results }) });
    await poll(http);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM communities").first("n");
    expect(n).toBe(400);
  });
  it("waits a day before retrying after a failure", async () => {
    await setMeta(env.DB, "communities_at", String(NOW - 2 * 86_400_000));
    const { http, calls } = fakeHttp({ [COMMUNITIES]: () => json({}, 500) });
    await poll(http);
    await poll(http);
    expect(calls.filter((c) => c.url === COMMUNITIES)).toHaveLength(1);
  });
  it("stops following pages at 10", async () => {
    await setMeta(env.DB, "communities_at", String(NOW - 2 * 86_400_000));
    const { http, calls } = fakeHttp({
      [COMMUNITIES]: () => json({ pagination: { next_link: COMMUNITIES }, results: [{ identifier: "a", name: "A" }] }),
    });
    await poll(http);
    expect(calls.filter((c) => c.url === COMMUNITIES).length).toBeLessThanOrEqual(10);
  });
});
