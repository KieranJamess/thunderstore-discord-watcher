// Registers the global slash commands. Run with: npm run register
import { readFileSync } from "node:fs";

const { DISCORD_APP_ID, DISCORD_TOKEN } = process.env;
if (!DISCORD_APP_ID || !DISCORD_TOKEN) {
  console.error("Set DISCORD_APP_ID and DISCORD_TOKEN (in .dev.vars or the environment).");
  process.exit(1);
}

const commands = JSON.parse(readFileSync(new URL("../src/command-definitions.json", import.meta.url), "utf8"));
const res = await fetch(`https://discord.com/api/v10/applications/${DISCORD_APP_ID}/commands`, {
  method: "PUT",
  headers: { authorization: `Bot ${DISCORD_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify(commands),
});
if (!res.ok) {
  console.error(`Discord said ${res.status}: ${await res.text()}`);
  process.exit(1);
}
console.log(`Registered ${(await res.json()).length} commands.`);
