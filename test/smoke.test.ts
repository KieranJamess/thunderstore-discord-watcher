import { env } from "cloudflare:test";
import { expect, it } from "vitest";

it("has a migrated D1 database", async () => {
  await env.DB.prepare("INSERT INTO meta VALUES ('k', 'v')").run();
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = 'k'").first<{ value: string }>();
  expect(row!.value).toBe("v");
});
