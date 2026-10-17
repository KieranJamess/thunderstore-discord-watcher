import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { handleInteraction } from "../src/commands";
import { addWatch, communityTargetId, listWatches, replaceCommunities } from "../src/db";
import worker from "../src/index";
import { fakeHttp, json, type Call } from "./helpers";

const EDIT = "PATCH https://discord.com/api/v10/webhooks/app/tok/messages/@original";
const MOD_API = "https://thunderstore.io/api/experimental/package/A/B/";
const LISTING = "https://thunderstore.io/api/cyberstorm/listing/slip-skid/?ordering=newest";
const modBody = {
  namespace: "A",
  name: "B",
  package_url: "https://thunderstore.io/package/A/B/",
  latest: { version_number: "1.0.0", description: "d", icon: "i" },
};

/** Runs an interaction; returns the immediate response and the deferred edit's content, if any. */
async function run(interaction: object, routes: Record<string, (c: Call) => Response> = {}) {
  let edited: string | undefined;
  const { http } = fakeHttp({
    ...routes,
    [EDIT]: (c) => {
      edited = JSON.parse(c.body).content;
      return json({});
    },
  });
  const pending: Promise<unknown>[] = [];
  const response: any = await handleInteraction(interaction, {
    db: env.DB,
    http,
    appId: "app",
    waitUntil: (p) => pending.push(p),
  });
  await Promise.all(pending);
  return { response, edited };
}

const command = (name: string, options: object[] = []) => ({
  type: 2,
  token: "tok",
  guild_id: "g1" as string | undefined,
  channel_id: "c1",
  data: { name, options },
});
const watchMod = (mod: string) => command("watch", [{ type: 1, name: "mod", options: [{ name: "mod", value: mod }] }]);
const watchCommunity = (c: string) =>
  command("watch", [{ type: 1, name: "community", options: [{ name: "community", value: c }] }]);
const reply = (content: string) => ({ type: 4, data: { content, flags: 64 } });

it("answers pings", async () => {
  expect((await run({ type: 1 })).response).toEqual({ type: 1 });
});

it("refuses DMs", async () => {
  expect((await run({ ...command("watches"), guild_id: undefined })).response).toEqual(reply("Use this in a server."));
});

describe("/watch mod", () => {
  it("defers, then saves the watch", async () => {
    const { response, edited } = await run(watchMod("https://thunderstore.io/c/slip-skid/p/A/B/"), {
      [MOD_API]: () => json(modBody),
    });
    expect(response).toEqual({ type: 5, data: { flags: 64 } });
    expect(edited).toBe("Watching B (currently v1.0.0) in this channel.");
    expect(await listWatches(env.DB, "g1")).toMatchObject([{ channelId: "c1", targetId: "mod:A-B" }]);
  });
  it("says when already watching", async () => {
    await run(watchMod("A-B"), { [MOD_API]: () => json(modBody) });
    expect((await run(watchMod("A-B"), { [MOD_API]: () => json(modBody) })).edited).toBe("Already watching B here.");
  });
  it("reports unknown mods", async () => {
    expect((await run(watchMod("A-B"), { [MOD_API]: () => json({}, 404) })).edited).toBe("Mod not found on Thunderstore.");
  });
  it("reports unreadable input", async () => {
    expect((await run(watchMod("nope"))).edited).toBe("Couldn't read that. Paste a Thunderstore link or use Author-ModName.");
  });
  it("reports Thunderstore outages", async () => {
    expect((await run(watchMod("A-B"), { [MOD_API]: () => json({}, 500) })).edited).toBe(
      "Couldn't reach Thunderstore. Try again in a minute.",
    );
  });
});

describe("/watch community", () => {
  it("baselines on the newest mod", async () => {
    const { edited } = await run(watchCommunity("slip-skid"), {
      [LISTING]: () =>
        json({ results: [{ namespace: "A", name: "B", is_pinned: false, datetime_created: "2026-10-12T00:00:00Z" }] }),
    });
    expect(edited).toBe("Watching slip-skid for new mods in this channel.");
    const state = await env.DB.prepare("SELECT state FROM targets WHERE id = 'community:slip-skid'").first("state");
    expect(state).toBe("2026-10-12T00:00:00Z");
  });
  it("accepts a community link", async () => {
    const { edited } = await run(watchCommunity("https://thunderstore.io/c/slip-skid/"), {
      [LISTING]: () => json({ results: [] }),
    });
    expect(edited).toBe("Watching slip-skid for new mods in this channel.");
  });
  it("reports unknown communities", async () => {
    expect((await run(watchCommunity("slip-skid"), { [LISTING]: () => json({}, 404) })).edited).toBe(
      "Community not found.",
    );
  });
});

describe("/unwatch", () => {
  it("removes this server's watch", async () => {
    await addWatch(env.DB, "g1", "c1", communityTargetId("slip-skid"), "");
    const [w] = await listWatches(env.DB, "g1");
    expect((await run(command("unwatch", [{ name: "watch", value: String(w.id) }]))).response).toEqual(
      reply("Stopped watching."),
    );
    expect(await listWatches(env.DB, "g1")).toEqual([]);
  });
  it("won't touch another server's watch", async () => {
    await addWatch(env.DB, "g2", "c9", communityTargetId("slip-skid"), "");
    const [w] = await listWatches(env.DB, "g2");
    expect((await run(command("unwatch", [{ name: "watch", value: String(w.id) }]))).response).toEqual(
      reply("Watch not found."),
    );
    expect(await listWatches(env.DB, "g2")).toHaveLength(1);
  });
});

describe("/watches", () => {
  it("says when empty", async () => {
    expect((await run(command("watches"))).response).toEqual(reply("No watches in this server."));
  });
  it("lists watches with channel mentions", async () => {
    await addWatch(env.DB, "g1", "c1", communityTargetId("slip-skid"), "");
    expect((await run(command("watches"))).response).toEqual(reply("<#c1> — community:slip-skid"));
  });
});

describe("autocomplete", () => {
  const focused = (name: string, sub: string | null, value: string) => ({
    type: 4,
    guild_id: "g1",
    data: {
      name,
      options: sub
        ? [{ type: 1, name: sub, options: [{ name: sub, value, focused: true }] }]
        : [{ name: "watch", value, focused: true }],
    },
  });
  it("suggests communities", async () => {
    await replaceCommunities(env.DB, [{ identifier: "slip-skid", name: "Slip & Skid" }]);
    expect((await run(focused("watch", "community", "slip"))).response).toEqual({
      type: 8,
      data: { choices: [{ name: "Slip & Skid (slip-skid)", value: "slip-skid" }] },
    });
  });
  it("suggests only this server's watches", async () => {
    await addWatch(env.DB, "g1", "c1", communityTargetId("slip-skid"), "");
    await addWatch(env.DB, "g2", "c9", communityTargetId("other"), "");
    const { response } = await run(focused("unwatch", null, ""));
    expect(response.data.choices.map((c: { name: string }) => c.name)).toEqual(["community:slip-skid in #c1"]);
  });
});

it("fetch handler rejects unsigned requests", async () => {
  const ctx = createExecutionContext();
  const res = await worker.fetch(
    new Request("https://w/", { method: "POST", body: "{}" }),
    { ...env, DISCORD_PUBLIC_KEY: "00".repeat(32) },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  expect(res.status).toBe(401);
});

it("caps each server at 25 watches", async () => {
  for (let i = 0; i < 25; i++) await addWatch(env.DB, "g1", `c${i}`, communityTargetId("slip-skid"), "");
  const { edited } = await run(watchMod("A-B"), { [MOD_API]: () => json(modBody) });
  expect(edited).toBe("This server already has 25 watches. Remove one with /unwatch first.");
  expect(await listWatches(env.DB, "g1")).toHaveLength(25);
});
