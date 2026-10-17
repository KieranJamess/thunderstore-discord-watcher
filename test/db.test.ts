import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  addWatch,
  communityTargetId,
  finishPosts,
  dueTargets,
  getMeta,
  listWatches,
  modTargetId,
  pendingPosts,
  queueAnnouncement,
  removeWatch,
  replaceCommunities,
  saveTarget,
  searchCommunities,
  setMeta,
} from "../src/db";

const db = () => env.DB;
const T = modTargetId({ namespace: "A", name: "B" });
const targetState = async (id: string) =>
  (await db().prepare("SELECT state FROM targets WHERE id = ?").bind(id).first<{ state: string }>())?.state;

it("builds target ids", () => {
  expect(T).toBe("mod:A-B");
  expect(communityTargetId("slip-skid")).toBe("community:slip-skid");
});

describe("addWatch", () => {
  it("adds once per channel and keeps the first baseline", async () => {
    expect(await addWatch(db(), "g1", "c1", T, "1.0.0")).toBe("added");
    expect(await addWatch(db(), "g1", "c1", T, "1.0.0")).toBe("exists");
    expect(await addWatch(db(), "g1", "c2", T, "9.9.9")).toBe("added");
    expect(await targetState(T)).toBe("1.0.0");
    expect((await listWatches(db(), "g1")).map((w) => w.channelId)).toEqual(["c1", "c2"]);
  });
});

describe("removeWatch", () => {
  it("refuses a watch from another server", async () => {
    await addWatch(db(), "g1", "c1", T, "1.0.0");
    const [w] = await listWatches(db(), "g1");
    expect(await removeWatch(db(), "g2", w.id)).toBe(false);
    expect(await listWatches(db(), "g1")).toHaveLength(1);
  });
  it("drops the target with its last watch only", async () => {
    await addWatch(db(), "g1", "c1", T, "1.0.0");
    await addWatch(db(), "g2", "c9", T, "1.0.0");
    const [w1] = await listWatches(db(), "g1");
    expect(await removeWatch(db(), "g1", w1.id)).toBe(true);
    expect(await targetState(T)).toBe("1.0.0");
    const [w2] = await listWatches(db(), "g2");
    expect(await removeWatch(db(), "g2", w2.id)).toBe(true);
    expect(await targetState(T)).toBeUndefined();
  });
});

it("dueTargets returns the least recently checked first", async () => {
  const other = communityTargetId("slip-skid");
  await addWatch(db(), "g1", "c1", T, "1.0.0");
  await addWatch(db(), "g1", "c1", other, "");
  await saveTarget(db(), T, "1.0.0", 200);
  await saveTarget(db(), other, "", 100);
  expect(await dueTargets(db(), 1)).toEqual([{ id: other, state: "", checkedAt: 100 }]);
});

it("finishPosts removes a gone channel's watches, its queued posts and orphaned targets", async () => {
  const other = communityTargetId("slip-skid");
  await addWatch(db(), "g1", "c1", T, "1.0.0");
  await addWatch(db(), "g1", "c1", other, "");
  await addWatch(db(), "g1", "c2", T, "1.0.0");
  await queueAnnouncement(db(), T, "2.0.0", 1, { content: "x" });
  await finishPosts(db(), [], [], ["c1"]);
  expect((await listWatches(db(), "g1")).map((w) => w.channelId)).toEqual(["c2"]);
  expect((await pendingPosts(db(), 10)).map((p) => p.channelId)).toEqual(["c2"]);
  expect(await targetState(other)).toBeUndefined();
  expect(await targetState(T)).toBe("2.0.0");
});

describe("communities", () => {
  it("searches identifier or name, case-insensitively, max 25", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ identifier: `game-${i}`, name: `Game ${i}` }));
    await replaceCommunities(db(), [{ identifier: "slip-skid", name: "Slip & Skid" }, ...many]);
    expect(await searchCommunities(db(), "SLIP")).toEqual([{ identifier: "slip-skid", name: "Slip & Skid" }]);
    expect(await searchCommunities(db(), "skid")).toHaveLength(1);
    expect(await searchCommunities(db(), "game")).toHaveLength(25);
  });
  it("replace drops old rows", async () => {
    await replaceCommunities(db(), [{ identifier: "old", name: "Old" }]);
    await replaceCommunities(db(), [{ identifier: "new", name: "New" }]);
    expect(await searchCommunities(db(), "")).toEqual([{ identifier: "new", name: "New" }]);
  });
});

it("meta round-trips", async () => {
  expect(await getMeta(db(), "k")).toBeNull();
  await setMeta(db(), "k", "1");
  await setMeta(db(), "k", "2");
  expect(await getMeta(db(), "k")).toBe("2");
});
