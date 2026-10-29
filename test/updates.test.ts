import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { addWatch, dueTargets, modTargetId, setMeta, updatesTargetId } from "../src/db";
import { runPoll } from "../src/poll";
import { fetchRecentlyUpdated } from "../src/thunderstore";
import { fakeHttp, json, type Call } from "./helpers";

const NOW = 1_000_000;
const TARGET = updatesTargetId("slip-skid");
const LISTING = "https://thunderstore.io/api/cyberstorm/listing/slip-skid/?ordering=last-updated";
const pkg = (name: string) => `https://thunderstore.io/api/experimental/package/A/${name}/`;
const changelog = (name: string, v: string) => `https://thunderstore.io/api/experimental/package/A/${name}/${v}/changelog/`;
const POST = "POST https://discord.com/api/v10/channels/c1/messages";

const row = (name: string, updated: string, created = "2026-01-01T00:00:00Z", pinned = false) => ({
  namespace: "A",
  name,
  description: "d",
  icon_url: "i",
  datetime_created: created,
  last_updated: updated,
  is_pinned: pinned,
});
const modBody = (name: string, version: string) => ({
  namespace: "A",
  name,
  package_url: `https://thunderstore.io/package/A/${name}/`,
  latest: { version_number: version, description: "d", icon: "i" },
  community_listings: [{ community: "slip-skid" }],
});

let posted: any[] = [];
const recordPost = { [POST]: (c: Call) => (posted.push(JSON.parse(c.body)), json({})) };
const poll = (http: typeof fetch, now = NOW) => runPoll({ db: env.DB, http, token: "t", now });
const state = async () => (await dueTargets(env.DB, 50)).find((t) => t.id === TARGET)?.state;

beforeEach(async () => {
  posted = [];
  await setMeta(env.DB, "communities_at", String(NOW));
});

describe("fetchRecentlyUpdated", () => {
  it("keeps pinned mods and maps both timestamps", async () => {
    const { http } = fakeHttp({
      [LISTING]: () => json({ results: [row("Pinned", "2026-10-01T00:00:00Z", "2026-01-01T00:00:00Z", true), row("B", "2026-10-02T00:00:00Z")] }),
    });
    expect(await fetchRecentlyUpdated(http, "slip-skid")).toEqual([
      { namespace: "A", name: "Pinned", description: "d", iconUrl: "i", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" },
      { namespace: "A", name: "B", description: "d", iconUrl: "i", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-10-02T00:00:00Z" },
    ]);
  });
  it("returns null on 404", async () => {
    const { http } = fakeHttp({ [LISTING]: () => json({}, 404) });
    expect(await fetchRecentlyUpdated(http, "slip-skid")).toBeNull();
  });
});

describe("updates watches", () => {
  it("labels a mod listed in several communities with the watched one", async () => {
    await addWatch(env.DB, "g1", "c1", TARGET, "2026-10-01T00:00:00Z");
    const { http } = fakeHttp({
      [LISTING]: () => json({ results: [row("Multi", "2026-10-02T00:00:00Z")] }),
      [pkg("Multi")]: () =>
        json({ ...modBody("Multi", "1.0.0"), community_listings: [{ community: "timberborn" }, { community: "slip-skid" }] }),
      [changelog("Multi", "1.0.0")]: () => json({ markdown: null }),
      ...recordPost,
    });
    await poll(http);
    expect(posted.map((p) => [p.content, p.embeds[0].url])).toEqual([
      ["**slip-skid/Multi** has been updated to v1.0.0", "https://thunderstore.io/c/slip-skid/p/A/Multi/"],
    ]);
  });
  it("posts each updated mod separately with its changelog, oldest first", async () => {
    await addWatch(env.DB, "g1", "c1", TARGET, "2026-10-01T00:00:00Z");
    const { http } = fakeHttp({
      [LISTING]: () =>
        json({
          results: [
            row("Pinned", "2026-09-01T00:00:00Z", "2026-01-01T00:00:00Z", true),
            row("Second", "2026-10-03T00:00:00Z"),
            row("First", "2026-10-02T00:00:00Z"),
            row("Old", "2026-09-30T00:00:00Z"),
          ],
        }),
      [pkg("First")]: () => json(modBody("First", "1.1.0")),
      [pkg("Second")]: () => json(modBody("Second", "2.0.0")),
      [changelog("First", "1.1.0")]: () => json({ markdown: "## 1.1.0\n* first fix" }),
      [changelog("Second", "2.0.0")]: () => json({ markdown: null }),
      ...recordPost,
    });
    await poll(http);
    expect(posted.map((p) => p.content)).toEqual([
      "**slip-skid/First** has been updated to v1.1.0",
      "**slip-skid/Second** has been updated to v2.0.0",
    ]);
    expect(posted[0].embeds[0].description).toBe("* first fix");
    expect(await state()).toBe("2026-10-03T00:00:00Z");
  });

  it("includes pinned mods when they update", async () => {
    await addWatch(env.DB, "g1", "c1", TARGET, "2026-10-01T00:00:00Z");
    const { http } = fakeHttp({
      [LISTING]: () => json({ results: [row("Pinned", "2026-10-05T00:00:00Z", "2026-01-01T00:00:00Z", true)] }),
      [pkg("Pinned")]: () => json(modBody("Pinned", "6.0.0")),
      [changelog("Pinned", "6.0.0")]: () => json({}, 404),
      ...recordPost,
    });
    await poll(http);
    expect(posted.map((p) => p.content)).toEqual(["**slip-skid/Pinned** has been updated to v6.0.0"]);
  });

  it("skips brand-new mods but moves past them", async () => {
    await addWatch(env.DB, "g1", "c1", TARGET, "2026-10-01T00:00:00Z");
    const { http, calls } = fakeHttp({
      [LISTING]: () => json({ results: [row("Brand", "2026-10-02T00:00:30Z", "2026-10-02T00:00:00Z")] }),
      ...recordPost,
    });
    await poll(http);
    expect(posted).toEqual([]);
    expect(calls.map((c) => c.url)).toEqual([LISTING]);
    expect(await state()).toBe("2026-10-02T00:00:30Z");
  });

  it("handles at most 5 mods per check and picks up the rest next time", async () => {
    await addWatch(env.DB, "g1", "c1", TARGET, "2026-10-01T00:00:00Z");
    const names = Array.from({ length: 7 }, (_, i) => `M${i}`);
    const routes: Record<string, (c: Call) => Response> = {
      // newest first, as Thunderstore returns it
      [LISTING]: () => json({ results: names.map((n, i) => row(n, `2026-10-0${2 + i}T00:00:00Z`)).reverse() }),
      ...recordPost,
    };
    for (const n of names) {
      routes[pkg(n)] = () => json(modBody(n, "1.0.1"));
      routes[changelog(n, "1.0.1")] = () => json({}, 404);
    }
    const { http } = fakeHttp(routes);
    await poll(http);
    expect(posted.map((p) => p.embeds[0].title)).toEqual(["M0 v1.0.1", "M1 v1.0.1", "M2 v1.0.1", "M3 v1.0.1", "M4 v1.0.1"]);
    expect(await state()).toBe("2026-10-06T00:00:00Z");
    await poll(http, NOW + 1);
    expect(posted.map((p) => p.embeds[0].title).slice(5)).toEqual(["M5 v1.0.1", "M6 v1.0.1"]);
  });

  it("posts nothing when nothing is newer", async () => {
    await addWatch(env.DB, "g1", "c1", TARGET, "2026-10-05T00:00:00Z");
    const { http } = fakeHttp({ [LISTING]: () => json({ results: [row("A1", "2026-10-05T00:00:00Z")] }), ...recordPost });
    await poll(http);
    expect(posted).toEqual([]);
  });

  it("retries the whole batch next time if a mod lookup fails", async () => {
    await addWatch(env.DB, "g1", "c1", TARGET, "2026-10-01T00:00:00Z");
    const { http } = fakeHttp({
      [LISTING]: () => json({ results: [row("B", "2026-10-02T00:00:00Z")] }),
      [pkg("B")]: () => json({}, 500),
      ...recordPost,
    });
    await poll(http);
    expect(posted).toEqual([]);
    expect(await state()).toBe("2026-10-01T00:00:00Z");
  });

  it("posts once in a channel that also watches the updated mod", async () => {
    await addWatch(env.DB, "g1", "c1", TARGET, "2026-10-01T00:00:00Z");
    await addWatch(env.DB, "g1", "c1", modTargetId({ namespace: "A", name: "B" }), "1.0.0");
    await addWatch(env.DB, "g1", "c2", TARGET, "2026-10-01T00:00:00Z");
    const channels: string[] = [];
    const { http } = fakeHttp({
      [LISTING]: () => json({ results: [row("B", "2026-10-02T00:00:00Z")] }),
      [pkg("B")]: () => json(modBody("B", "1.1.0")),
      [changelog("B", "1.1.0")]: () => json({}, 404),
      [POST]: () => (channels.push("c1"), json({})),
      [POST.replace("c1", "c2")]: () => (channels.push("c2"), json({})),
    });
    await poll(http);
    expect(channels.sort()).toEqual(["c1", "c2"]);
  });
});
