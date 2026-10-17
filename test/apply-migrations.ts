import { applyD1Migrations, env } from "cloudflare:test";
import { beforeEach } from "vitest";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);

// Storage isn't isolated between tests, so start each one empty.
beforeEach(async () => {
  await env.DB.batch(["watches", "targets", "communities", "meta"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});
