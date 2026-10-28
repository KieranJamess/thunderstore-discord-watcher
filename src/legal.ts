// Linked from the Discord Developer Portal for App Directory listing. Keep these in step with what the bot stores and does.

const UPDATED = "28 October 2026";
const ISSUES = "https://github.com/KieranJamess/thunderstore-discord-watcher/issues";

const page = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Thunderstore Watcher</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 42rem; margin: 2rem auto; padding: 0 1rem; }
  h1 { line-height: 1.2; }
</style>
</head>
<body>
<h1>${title}</h1>
<p><em>Thunderstore Watcher for Discord. Last updated ${UPDATED}.</em></p>
${body}
<p><a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Service</a></p>
</body>
</html>`;

const PRIVACY = page(
  "Privacy Policy",
  `<p>Thunderstore Watcher is a Discord bot that posts in your server when mods on <a href="https://thunderstore.io">Thunderstore</a> are updated or released.</p>
<h2>What we store</h2>
<ul>
  <li>For each watch you set up: the Discord server ID, the channel ID, and what is being watched (a mod or a Thunderstore community).</li>
  <li>The latest version or release time seen for each watched mod or community, so the bot only posts changes.</li>
  <li>Announcements waiting to be posted, which contain public mod information from Thunderstore. They are deleted once posted.</li>
</ul>
<h2>What we don't store</h2>
<p>The bot does not store user IDs, usernames, message content or any other personal information. It cannot read messages in your server. When you use a command, Discord sends the bot your user details as part of the request, but the bot uses only the command and its options and keeps nothing else.</p>
<h2>How it's used</h2>
<p>The stored data is used only to post announcements in the channels you choose. It is never sold or shared, except with the services that run the bot: Cloudflare hosts the bot and its database, and Discord delivers commands and messages.</p>
<h2>Removing your data</h2>
<ul>
  <li>Use <code>/unwatch</code> to remove a watch and any announcements still waiting to be posted for it.</li>
  <li>If the bot loses access to a channel, or the channel is deleted, that channel's watches are removed the next time it tries to post there.</li>
  <li>To have all data for your server removed, <a href="${ISSUES}">open an issue</a> with your server ID.</li>
</ul>
<h2>Changes</h2>
<p>If this policy changes, this page is updated and the date above changes with it.</p>
<h2>Contact</h2>
<p><a href="${ISSUES}">Open an issue on GitHub</a>.</p>`,
);

const TERMS = page(
  "Terms of Service",
  `<p>By adding Thunderstore Watcher to a Discord server or using its commands, you agree to these terms.</p>
<h2>The service</h2>
<p>The bot posts announcements about mods on Thunderstore in the channels you choose. It is free, provided as is, and has no guarantee of availability or accuracy. Posts can be delayed or missed, for example when Thunderstore or Discord is unavailable or changes how it works.</p>
<h2>Your responsibilities</h2>
<ul>
  <li>Follow <a href="https://discord.com/terms">Discord's Terms of Service</a> and <a href="https://discord.com/guidelines">Community Guidelines</a> when using the bot.</li>
  <li>Don't use the bot to spam, to disrupt the service, or to try to get around its limits.</li>
</ul>
<h2>Third-party content</h2>
<p>Mod names, descriptions, icons and changelogs come from Thunderstore and their authors. We don't write or review them and aren't responsible for them. The bot is not affiliated with Thunderstore or Discord.</p>
<h2>Ending use</h2>
<p>You can stop using the bot at any time by removing it from your server. We may limit or stop the service, or block servers that misuse it, at any time.</p>
<h2>Liability</h2>
<p>To the extent the law allows, we are not liable for any loss or damage from using the bot.</p>
<h2>Changes</h2>
<p>If these terms change, this page is updated and the date above changes with it. Continuing to use the bot means you accept the new terms.</p>
<h2>Contact</h2>
<p><a href="${ISSUES}">Open an issue on GitHub</a>.</p>`,
);

const PAGES: Record<string, string> = { "/privacy": PRIVACY, "/terms": TERMS };

/** The Privacy Policy or Terms of Service page for a GET, or null for any other path. */
export function legalPage(pathname: string): Response | null {
  const html = PAGES[pathname.replace(/\/$/, "")];
  return html ? new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }) : null;
}
