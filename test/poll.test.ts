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
    const { http } = fakeHttp({ [MOD_API]: () => json(modBody("1.0.1")), ...recordPost("c1") });
    await poll(http);
    expect(posted.c1).toHaveLength(1);
    expect(posted.c1[0].embeds[0].title).toBe("B updated to v1.0.1");
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
    expect(posted.c1[0].embeds.map((e: any) => e.title)).toEqual([
      "New mod in slip-skid: New",
      "New mod in slip-skid: Newer",
    ]);
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
    expect(titles[9]).toBe("New mod in slip-skid: M11");
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

it("stops when the budget runs out, leaving the rest for next run", async () => {
  await addWatch(env.DB, "g1", "c1", MOD, "1.0.0");
  await addWatch(env.DB, "g1", "c1", COMMUNITY, "");
  const { http, calls } = fakeHttp({
    [MOD_API]: () => json(modBody("1.0.0")),
    [LISTING]: () => json({ results: [] }),
  });
  await poll(http, 2);
  expect(calls).toHaveLength(1);
  const untouched = (await dueTargets(env.DB, 50)).find((t) => t.checkedAt === 0);
  expect(untouched).toBeDefined();
});

it("refreshes the community list once a day", async () => {
  await setMeta(env.DB, "communities_at", String(NOW - 25 * 3600_000));
  const { http } = fakeHttp({
    "https://thunderstore.io/api/experimental/community/": () =>
      json({ pagination: { next_link: null }, results: [{ identifier: "slip-skid", name: "Slip & Skid" }] }),
  });
  await poll(http);
  expect(await searchCommunities(env.DB, "slip")).toHaveLength(1);
  expect(await getMeta(env.DB, "communities_at")).toBe(String(NOW));
});
