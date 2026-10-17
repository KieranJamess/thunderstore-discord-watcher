import { modUrl, type Http, type ListedMod, type ModInfo } from "./thunderstore";

const API = "https://discord.com/api/v10";
const COLOR = 0x23a5e2;
const TIMEOUT_MS = 8000;

function fromHex(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  return new Uint8Array(hex.match(/../g)!.map((b) => parseInt(b, 16)));
}

/** Discord signs `timestamp + body` with the application's Ed25519 key. */
export async function verifyDiscordRequest(
  body: string,
  signatureHex: string | null,
  timestamp: string | null,
  publicKeyHex: string,
): Promise<boolean> {
  const sig = signatureHex && fromHex(signatureHex);
  const key = fromHex(publicKeyHex);
  if (!sig || !key || !timestamp) return false;
  try {
    const pub = await crypto.subtle.importKey("raw", key, "Ed25519", false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", pub, sig, new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

/** "gone" means the channel is unusable for us (deleted, or bot lost access). */
export async function postMessage(http: Http, token: string, channelId: string, body: object): Promise<"ok" | "gone" | "error"> {
  const res = await http(`${API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.ok) return "ok";
  return res.status === 403 || res.status === 404 ? "gone" : "error";
}

export async function editOriginal(http: Http, appId: string, interactionToken: string, content: string): Promise<void> {
  await http(`${API}/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export const modUpdateEmbed = (m: ModInfo) => ({
  title: `${m.name} updated to v${m.version}`,
  url: m.url,
  author: { name: m.namespace },
  description: m.description,
  thumbnail: { url: m.iconUrl },
  color: COLOR,
});

export const newModEmbed = (m: ListedMod, community: string) => ({
  title: `New mod in ${community}: ${m.name}`,
  url: modUrl(m),
  author: { name: m.namespace },
  description: m.description,
  thumbnail: { url: m.iconUrl },
  color: COLOR,
});
