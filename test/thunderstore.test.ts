import { describe, expect, it } from "vitest";
import {
  changelogSection,
  fetchChangelog,
  fetchCommunities,
  fetchMod,
  fetchNewestMods,
  isNewerVersion,
  modUrl,
  parseCommunity,
  parseModRef,
} from "../src/thunderstore";
import { fakeHttp, json } from "./helpers";

describe("parseModRef", () => {
  it("parses community package URLs", () => {
    expect(parseModRef("https://thunderstore.io/c/slip-skid/p/SlipSkid_Modding/BepInExPack_SlipSkid/")).toEqual({
      namespace: "SlipSkid_Modding",
      name: "BepInExPack_SlipSkid",
    });
  });
  it("ignores trailing path and query", () => {
    expect(parseModRef("https://thunderstore.io/c/slip-skid/p/A/B/changelog/?x=1")).toEqual({ namespace: "A", name: "B" });
  });
  it("parses /package/ URLs", () => {
    expect(parseModRef("https://thunderstore.io/package/A/B/")).toEqual({ namespace: "A", name: "B" });
  });
  it("parses Author-Mod with or without version", () => {
    expect(parseModRef("A-B")).toEqual({ namespace: "A", name: "B" });
    expect(parseModRef("A-B-1.2.3")).toEqual({ namespace: "A", name: "B" });
    expect(parseModRef("  A-B  ")).toEqual({ namespace: "A", name: "B" });
  });
  it("rejects anything else", () => {
    expect(parseModRef("nonsense")).toBeNull();
    expect(parseModRef("https://example.com/package/A/B/")).toBeNull();
    expect(parseModRef("https://thunderstore.io/c/slip-skid/")).toBeNull();
  });
});

describe("isNewerVersion", () => {
  it("compares dotted parts numerically", () => {
    expect(isNewerVersion("1.0.10", "1.0.9")).toBe(true);
    expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "1.2.0")).toBe(false);
  });
});

it("modUrl builds the package page", () => {
  expect(modUrl({ namespace: "A", name: "B" })).toBe("https://thunderstore.io/package/A/B/");
});

const MOD_URL = "https://thunderstore.io/api/experimental/package/A/B/";
const modBody = {
  namespace: "A",
  name: "B",
  package_url: "https://thunderstore.io/package/A/B/",
  latest: { version_number: "1.2.3", description: "desc", icon: "https://cdn/icon.png" },
};

describe("fetchMod", () => {
  it("maps the latest version", async () => {
    const { http } = fakeHttp({ [MOD_URL]: () => json(modBody) });
    expect(await fetchMod(http, { namespace: "A", name: "B" })).toEqual({
      namespace: "A",
      name: "B",
      version: "1.2.3",
      description: "desc",
      iconUrl: "https://cdn/icon.png",
      url: "https://thunderstore.io/package/A/B/",
    });
  });
  it("returns null on 404", async () => {
    const { http } = fakeHttp({ [MOD_URL]: () => json({ detail: "Not found." }, 404) });
    expect(await fetchMod(http, { namespace: "A", name: "B" })).toBeNull();
  });
  it("throws on server errors", async () => {
    const { http } = fakeHttp({ [MOD_URL]: () => json({}, 500) });
    await expect(fetchMod(http, { namespace: "A", name: "B" })).rejects.toThrow();
  });
});

const LISTING_URL = "https://thunderstore.io/api/cyberstorm/listing/slip-skid/?ordering=newest";
const listed = (name: string, created: string, pinned = false) => ({
  namespace: "A",
  name,
  description: `${name} desc`,
  icon_url: `https://cdn/${name}.png`,
  datetime_created: created,
  is_pinned: pinned,
});

describe("fetchNewestMods", () => {
  it("drops pinned mods and keeps newest-first order", async () => {
    const { http } = fakeHttp({
      [LISTING_URL]: () =>
        json({
          results: [
            listed("Pinned", "2026-01-01T00:00:00Z", true),
            listed("New", "2026-10-12T00:00:00Z"),
            listed("Old", "2026-10-01T00:00:00Z"),
          ],
        }),
    });
    expect(await fetchNewestMods(http, "slip-skid")).toEqual([
      { namespace: "A", name: "New", description: "New desc", iconUrl: "https://cdn/New.png", createdAt: "2026-10-12T00:00:00Z" },
      { namespace: "A", name: "Old", description: "Old desc", iconUrl: "https://cdn/Old.png", createdAt: "2026-10-01T00:00:00Z" },
    ]);
  });
  it("returns null on 404", async () => {
    const { http } = fakeHttp({ [LISTING_URL]: () => json({ detail: "Not found." }, 404) });
    expect(await fetchNewestMods(http, "slip-skid")).toBeNull();
  });
  it("throws on server errors", async () => {
    const { http } = fakeHttp({ [LISTING_URL]: () => json({}, 502) });
    await expect(fetchNewestMods(http, "slip-skid")).rejects.toThrow();
  });
});

describe("fetchCommunities", () => {
  it("follows pagination", async () => {
    const first = "https://thunderstore.io/api/experimental/community/";
    const second = "https://thunderstore.io/api/experimental/community/?cursor=abc";
    const { http, calls } = fakeHttp({
      [first]: () =>
        json({
          pagination: { next_link: second },
          results: [
            { identifier: "a", name: "A" },
            { identifier: "b", name: "B" },
          ],
        }),
      [second]: () => json({ pagination: { next_link: null }, results: [{ identifier: "slip-skid", name: "Slip & Skid" }] }),
    });
    expect(await fetchCommunities(http)).toEqual([
      { identifier: "a", name: "A" },
      { identifier: "b", name: "B" },
      { identifier: "slip-skid", name: "Slip & Skid" },
    ]);
    expect(calls.map((c) => c.url)).toEqual([first, second]);
  });
});

it("puts a timeout on Thunderstore requests", async () => {
  let signal: AbortSignal | null | undefined;
  const http = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    signal = init?.signal;
    return json({}, 404);
  }) as typeof fetch;
  await fetchMod(http, { namespace: "A", name: "B" });
  expect(signal).toBeInstanceOf(AbortSignal);
});

describe("parseCommunity", () => {
  it("accepts an identifier", () => {
    expect(parseCommunity(" Slip-Skid ")).toBe("slip-skid");
  });
  it("accepts community URLs, including ones pointing at a mod", () => {
    expect(parseCommunity("https://thunderstore.io/c/slip-skid/")).toBe("slip-skid");
    expect(parseCommunity("https://thunderstore.io/c/slip-skid/p/A/B/?x=1")).toBe("slip-skid");
  });
  it("rejects anything else", () => {
    expect(parseCommunity("https://thunderstore.io/package/A/B/")).toBeNull();
    expect(parseCommunity("https://example.com/c/slip-skid/")).toBeNull();
    expect(parseCommunity("slip skid")).toBeNull();
  });
});

const CHANGELOG = `# Changelog

## [0.4.0](https://github.com/x/compare/a...b) (2026-10-17)

### Features

* new cards

## [0.3.5](https://github.com/x/compare/c...d) (2026-10-13)

### Bug Fixes

* old fix
`;

describe("changelogSection", () => {
  it("returns just the section for that version", () => {
    expect(changelogSection(CHANGELOG, "0.4.0")).toBe("### Features\n\n* new cards");
    expect(changelogSection(CHANGELOG, "0.3.5")).toBe("### Bug Fixes\n\n* old fix");
  });
  it("matches plain and v-prefixed headings", () => {
    expect(changelogSection("## v1.2.0\n- a\n## 1.1.0\n- b", "1.2.0")).toBe("- a");
    expect(changelogSection("# 1.2.0\n- a", "1.2.0")).toBe("- a");
  });
  it("doesn't confuse 1.2.0 with 1.2.01", () => {
    expect(changelogSection("## 1.2.01\n- a", "1.2.0")).toBeNull();
  });
  it("returns null when the version isn't there", () => {
    expect(changelogSection(CHANGELOG, "9.9.9")).toBeNull();
  });
});

describe("fetchChangelog", () => {
  const URL = "https://thunderstore.io/api/experimental/package/A/B/0.4.0/changelog/";
  it("returns the new version's section", async () => {
    const { http } = fakeHttp({ [URL]: () => json({ markdown: CHANGELOG }) });
    expect(await fetchChangelog(http, { namespace: "A", name: "B" }, "0.4.0")).toBe("### Features\n\n* new cards");
  });
  it("returns null when there's no changelog", async () => {
    const { http } = fakeHttp({ [URL]: () => json({ markdown: null }) });
    expect(await fetchChangelog(http, { namespace: "A", name: "B" }, "0.4.0")).toBeNull();
  });
  it("returns null instead of throwing on errors", async () => {
    const { http } = fakeHttp({ [URL]: () => json({}, 500) });
    expect(await fetchChangelog(http, { namespace: "A", name: "B" }, "0.4.0")).toBeNull();
  });
});

it("fetchCommunities won't follow pagination links off thunderstore.io", async () => {
  const first = "https://thunderstore.io/api/experimental/community/";
  const { http, calls } = fakeHttp({
    [first]: () => json({ pagination: { next_link: "https://evil.example/steal" }, results: [{ identifier: "a", name: "A" }] }),
  });
  await expect(fetchCommunities(http)).rejects.toThrow();
  expect(calls.map((c) => c.url)).toEqual([first]);
});
