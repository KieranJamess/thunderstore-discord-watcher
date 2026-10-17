import { describe, expect, it } from "vitest";
import { editOriginal, modUpdateEmbed, newModEmbed, postMessage, verifyDiscordRequest } from "../src/discord";
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
    expect(JSON.parse(calls[0].body)).toEqual({ content: "hi" });
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

it("builds embeds", () => {
  const mod = { namespace: "A", name: "B", version: "1.2.3", description: "d", iconUrl: "i", url: "u" };
  expect(modUpdateEmbed(mod)).toMatchObject({ title: "B updated to v1.2.3", url: "u", author: { name: "A" }, thumbnail: { url: "i" } });
  const listed = { namespace: "A", name: "B", description: "d", iconUrl: "i", createdAt: "x" };
  expect(newModEmbed(listed, "slip-skid")).toMatchObject({
    title: "New mod in slip-skid: B",
    url: "https://thunderstore.io/package/A/B/",
    author: { name: "A" },
  });
});
