import { handleInteraction } from "./commands";
import { verifyDiscordRequest } from "./discord";

export interface Env {
  DB: D1Database;
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APP_ID: string;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== "POST") return new Response("Not found", { status: 404 });
    const body = await request.text();
    const ok = await verifyDiscordRequest(
      body,
      request.headers.get("x-signature-ed25519"),
      request.headers.get("x-signature-timestamp"),
      env.DISCORD_PUBLIC_KEY,
    );
    if (!ok) return new Response("Bad signature", { status: 401 });
    const response = await handleInteraction(JSON.parse(body), {
      db: env.DB,
      http: (input, init) => fetch(input, init),
      appId: env.DISCORD_APP_ID,
      waitUntil: (p) => ctx.waitUntil(p),
    });
    return Response.json(response);
  },
} satisfies ExportedHandler<Env>;
