import { describe, expect, it } from "vitest";
import { editOriginal, modUpdateMessage, newModsMessage, postMessage, verifyDiscordRequest } from "../src/discord";
import { fakeHttp, json } from "./helpers";

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function signer() {
  const keys = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const publicKey = hex((await crypto.subtle.exportKey("raw", keys.publicKey)) as ArrayBuffer);
  const sign = async (msg: string) => hex(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(msg)));
  return { publicKey, sign };
}

describe("verifyDiscordRequest", () => {
  it("accepts a valid signature", async () => {
    const { publicKey, sign } = await signer();
    expect(await verifyDiscordRequest('{"type":1}', await sign('123{"type":1}'), "123", publicKey)).toBe(true);
  });
  it("rejects a tampered body", async () => {
    const { publicKey, sign } = await signer();
    expect(await verifyDiscordRequest('{"type":2}', await sign('123{"type":1}'), "123", publicKey)).toBe(false);
  });
  it("rejects missing headers and junk hex", async () => {
    const { publicKey } = await signer();
    expect(await verifyDiscordRequest("{}", null, "123", publicKey)).toBe(false);
    expect(await verifyDiscordRequest("{}", "zz", "123", publicKey)).toBe(false);
  });
});

describe("postMessage", () => {
  const URL = "POST https://discord.com/api/v10/channels/123/messages";
  it("posts with the bot token", async () => {
    const { http, calls } = fakeHttp({ [URL]: () => json({ id: "1" }) });
    expect(await postMessage(http, "t", "123", { content: "hi" })).toBe("ok");
    expect(calls[0].headers.get("authorization")).toBe("Bot t");
    expect(JSON.parse(calls[0].body)).toMatchObject({ content: "hi" });
  });
  it("reports gone on 403/404 and error otherwise", async () => {
    for (const [status, want] of [[403, "gone"], [404, "gone"], [500, "error"]] as const) {
      const { http } = fakeHttp({ [URL]: () => json({}, status) });
      expect(await postMessage(http, "t", "123", {})).toBe(want);
    }
  });
});

it("editOriginal patches the interaction response", async () => {
  const { http, calls } = fakeHttp({ "PATCH https://discord.com/api/v10/webhooks/app/tok/messages/@original": () => json({}) });
  await editOriginal(http, "app", "tok", "done");
  expect(JSON.parse(calls[0].body)).toEqual({ content: "done" });
});

describe("messages", () => {
  const mod = { namespace: "A", name: "B", version: "1.2.3", description: "d", iconUrl: "i", url: "https://thunderstore.io/package/A/B/" };
  const listed = { namespace: "A", name: "B", description: "d", iconUrl: "i", createdAt: "x" };
  it("mod update message has a text line and the changelog", () => {
    const m = modUpdateMessage(mod, "* fixed");
    expect(m.content).toBe("**B** has been updated to v1.2.3");
    expect(modUpdateMessage({ ...mod, community: "slip-skid" }, null).content).toBe("**slip-skid/B** has been updated to v1.2.3");
    expect(m.embeds[0]).toMatchObject({ title: "B v1.2.3", url: mod.url, author: { name: "A" }, description: "* fixed", thumbnail: { url: "i" } });
  });
  it("falls back to the mod description without a changelog", () => {
    expect(modUpdateMessage(mod, null).embeds[0].description).toBe("d");
  });
  it("trims long changelogs and links the full one", () => {
    const desc = modUpdateMessage(mod, "x".repeat(5000)).embeds[0].description;
    expect(desc.length).toBeLessThan(2000);
    expect(desc.endsWith("[Full changelog on Thunderstore](https://thunderstore.io/package/A/B/)")).toBe(true);
  });
  it("community message has a text line and one embed per mod", () => {
    const m = newModsMessage([listed, { ...listed, name: "C" }], "slip-skid");
    expect(m.content).toBe("New mods found for slip-skid:");
    expect(m.embeds.map((e) => e.title)).toEqual(["B", "C"]);
    expect(m.embeds[0]).toMatchObject({ url: "https://thunderstore.io/c/slip-skid/p/A/B/", author: { name: "A" } });
  });
});

it("never lets a post ping anyone", async () => {
  const { http, calls } = fakeHttp({ "POST https://discord.com/api/v10/channels/1/messages": () => json({}) });
  await postMessage(http, "t", "1", { content: "@everyone" });
  expect(JSON.parse(calls[0].body).allowed_mentions).toEqual({ parse: [] });
});
