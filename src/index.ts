import { handleInteraction } from "./commands";
import { verifyDiscordRequest } from "./discord";
import { legalPage } from "./legal";
import { runPoll } from "./poll";

export interface Env {
  DB: D1Database;
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APP_ID: string;
}

export default {
  async fetch(request, env, ctx) {
    // HEAD too: link checkers (including Discord's portal) use it to see if the page exists.
    if (request.method === "GET" || request.method === "HEAD") return legalPage(new URL(request.url).pathname) ?? new Response("Not found", { status: 404 });
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

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runPoll({ db: env.DB, http: (input, init) => fetch(input, init), token: env.DISCORD_TOKEN, now: Date.now() }),
    );
  },
} satisfies ExportedHandler<Env>;
