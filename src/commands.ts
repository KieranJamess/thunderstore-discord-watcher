import {
  MAX_WATCHES_PER_GUILD,
  addWatch,
  communityTargetId,
  listWatches,
  modTargetId,
  removeWatch,
  searchCommunities,
  updatesTargetId,
} from "./db";
import { editOriginal } from "./discord";
import { fetchMod, fetchNewestMods, fetchRecentlyUpdated, parseCommunity, parseModRef, type Http } from "./thunderstore";

export type Deps = { db: D1Database; http: Http; appId: string; waitUntil: (p: Promise<unknown>) => void };

type Option = { name: string; type?: number; value?: string; focused?: boolean; options?: Option[] };
type Interaction = {
  type: number;
  token?: string;
  guild_id?: string;
  channel_id?: string;
  data?: { name: string; options?: Option[] };
};

const EPHEMERAL = 64;
const FULL = `This server already has ${MAX_WATCHES_PER_GUILD} watches. Remove one with /unwatch first.`;
const HELP = [
  "**Thunderstore Watcher** posts to a channel when something changes on Thunderstore.",
  "",
  "`/watch mod <link or Author-ModName>`: post in this channel when the mod gets a new version, with its changelog",
  "`/watch community <name or link>`: post in this channel when a new mod appears in that community",
  "`/watch updates <name or link>`: post in this channel whenever any mod in that community gets a new version, each with its changelog",
  "`/unwatch <watch>`: stop a watch",
  "`/watches`: list this server's watches",
  "",
  "Checks run every 5 minutes. Adding a watch never posts what already exists, only changes after that.",
  `Each server can have up to ${MAX_WATCHES_PER_GUILD} watches. By default only members with Manage Server can add or remove them; admins can change that in Server Settings > Integrations.`,
].join("\n");
const reply = (content: string) => ({ type: 4, data: { content, flags: EPHEMERAL } });

/** Flattens one level of subcommand: returns [subcommand name | null, leaf options]. */
function unpack(options: Option[] = []): [string | null, Option[]] {
  const sub = options.find((o) => o.type === 1);
  return sub ? [sub.name, sub.options ?? []] : [null, options];
}

export async function handleInteraction(raw: unknown, deps: Deps): Promise<object> {
  const i = raw as Interaction;
  if (i.type === 1) return { type: 1 };
  const guildId = i.guild_id;
  if (!guildId || !i.data) return reply("Use this in a server.");
  const [sub, options] = unpack(i.data.options);

  if (i.type === 4) return { type: 8, data: { choices: await autocomplete(deps.db, guildId, options) } };

  const value = (name: string) => String(options.find((o) => o.name === name)?.value ?? "");
  switch (i.data.name) {
    case "watch": {
      const work =
        sub === "mod"
          ? watchMod(deps.db, deps.http, guildId, i.channel_id!, value("mod"))
          : sub === "updates"
            ? watchUpdates(deps.db, deps.http, guildId, i.channel_id!, value("community"))
            : watchCommunity(deps.db, deps.http, guildId, i.channel_id!, value("community"));
      deps.waitUntil(
        work
          .catch(() => "Couldn't reach Thunderstore. Try again in a minute.")
          .then((msg) => editOriginal(deps.http, deps.appId, i.token!, msg)),
      );
      return { type: 5, data: { flags: EPHEMERAL } };
    }
    case "unwatch":
      return reply((await removeWatch(deps.db, guildId, Number(value("watch")))) ? "Stopped watching." : "Watch not found.");
    case "help":
      return reply(HELP);
    case "watches": {
      const watches = await listWatches(deps.db, guildId);
      if (!watches.length) return reply("No watches in this server.");
      return reply(watches.map((w) => `<#${w.channelId}> — ${w.targetId}`).join("\n"));
    }
  }
  return reply("Unknown command.");
}

async function watchMod(db: D1Database, http: Http, guildId: string, channelId: string, input: string): Promise<string> {
  const ref = parseModRef(input);
  if (!ref) return "Couldn't read that. Paste a Thunderstore link or use Author-ModName.";
  const mod = await fetchMod(http, ref);
  if (!mod) return "Mod not found on Thunderstore.";
  const added = await addWatch(db, guildId, channelId, modTargetId(mod), mod.version);
  if (added !== "added") return added === "full" ? FULL : `Already watching ${mod.name} here.`;
  return `Watching ${mod.name} (currently v${mod.version}) in this channel.`;
}

async function watchCommunity(db: D1Database, http: Http, guildId: string, channelId: string, input: string): Promise<string> {
  const community = parseCommunity(input);
  if (!community) return "Community not found.";
  const mods = await fetchNewestMods(http, community);
  if (!mods) return "Community not found.";
  const added = await addWatch(db, guildId, channelId, communityTargetId(community), mods[0]?.createdAt ?? "");
  if (added !== "added") return added === "full" ? FULL : `Already watching ${community} here.`;
  return `Watching ${community} for new mods in this channel.`;
}

async function watchUpdates(db: D1Database, http: Http, guildId: string, channelId: string, input: string): Promise<string> {
  const community = parseCommunity(input);
  if (!community) return "Community not found.";
  const mods = await fetchRecentlyUpdated(http, community);
  if (!mods) return "Community not found.";
  // Pinned mods are listed first regardless of date, so take the latest across all of them.
  const latest = mods.reduce((max, m) => (!max || Date.parse(m.updatedAt!) > Date.parse(max) ? m.updatedAt! : max), "");
  const added = await addWatch(db, guildId, channelId, updatesTargetId(community), latest);
  if (added !== "added") return added === "full" ? FULL : `Already watching ${community} for updates here.`;
  return `Watching ${community} for mod updates in this channel.`;
}

async function autocomplete(db: D1Database, guildId: string, options: Option[]) {
  const focused = options.find((o) => o.focused);
  const typed = String(focused?.value ?? "").toLowerCase();
  if (focused?.name === "community") {
    return (await searchCommunities(db, typed)).map((c) => ({ name: `${c.name} (${c.identifier})`, value: c.identifier }));
  }
  if (focused?.name === "watch") {
    return (await listWatches(db, guildId))
      .map((w) => ({ name: `${w.targetId} in #${w.channelId}`, value: String(w.id) }))
      .filter((c) => c.name.toLowerCase().includes(typed))
      .slice(0, 25);
  }
  return [];
}
