export type Http = typeof fetch;

export type ModRef = { namespace: string; name: string };

export type ModInfo = {
  namespace: string;
  name: string;
  version: string;
  description: string;
  iconUrl: string;
  url: string;
  community?: string;
};

export type ListedMod = {
  namespace: string;
  name: string;
  description: string;
  iconUrl: string;
  createdAt: string;
  updatedAt?: string;
};

const BASE = "https://thunderstore.io";
const PART = /^[A-Za-z0-9_]+$/;
const TIMEOUT_MS = 8000;
const MAX_COMMUNITY_PAGES = 10;

/** Accepts a Thunderstore package URL or `Author-ModName[-version]`. */
export function parseModRef(input: string): ModRef | null {
  const text = input.trim();
  let parts: string[];
  if (/^https?:\/\//i.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    if (url.hostname !== "thunderstore.io") return null;
    const path = url.pathname.split("/").filter(Boolean);
    const m = path[0] === "c" && path[2] === "p" ? path.slice(3) : path[0] === "package" ? path.slice(1) : [];
    parts = m.slice(0, 2);
  } else {
    // Thunderstore namespaces and names can't contain '-', so it only separates fields.
    const fields = text.split("-");
    if (fields.length < 2 || fields.length > 3) return null;
    parts = fields.slice(0, 2);
  }
  if (parts.length !== 2 || !parts.every((p) => PART.test(p))) return null;
  return { namespace: parts[0], name: parts[1] };
}

/** Accepts a community identifier or any thunderstore.io/c/<community>/... URL. */
export function parseCommunity(input: string): string | null {
  const text = input.trim().toLowerCase();
  if (/^https?:\/\//.test(text)) {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      return null;
    }
    const [c, community] = url.pathname.split("/").filter(Boolean);
    return url.hostname === "thunderstore.io" && c === "c" && community && /^[a-z0-9-]+$/.test(community) ? community : null;
  }
  return /^[a-z0-9-]+$/.test(text) ? text : null;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

// The community-less /package/ URL redirects to Risk of Rain 2, so scope links whenever we know the community.
export const modUrl = (ref: ModRef, community?: string) =>
  community ? `${BASE}/c/${community}/p/${ref.namespace}/${ref.name}/` : `${BASE}/package/${ref.namespace}/${ref.name}/`;

/** GET JSON; null on 404, throws on any other failure. */
async function getJson<T>(http: Http, url: string): Promise<T | null> {
  const res = await http(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Thunderstore ${res.status} for ${url}`);
  return res.json<T>();
}

/** The body under the heading for `version` (e.g. "## [1.2.0](...)" or "# v1.2.0"), up to the next heading of the same or higher level. */
export function changelogSection(markdown: string, version: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const wanted = new RegExp(`(^|[^0-9.])v?${version.replace(/\./g, "\\.")}(?![0-9])`);
  const start = lines.findIndex((l) => /^#{1,6}\s/.test(l) && wanted.test(l));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)![0].length;
  const end = lines.findIndex((l, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(l));
  const body = lines.slice(start + 1, end < 0 ? undefined : end).join("\n").trim();
  return body || null;
}

/** The changelog section for one version; null if missing or Thunderstore fails, since it's optional. */
export async function fetchChangelog(http: Http, ref: ModRef, version: string): Promise<string | null> {
  try {
    const d = await getJson<{ markdown: string | null }>(
      http,
      `${BASE}/api/experimental/package/${ref.namespace}/${ref.name}/${version}/changelog/`,
    );
    return d?.markdown ? changelogSection(d.markdown, version) : null;
  } catch {
    return null;
  }
}

export async function fetchMod(http: Http, ref: ModRef): Promise<ModInfo | null> {
  const d = await getJson<{
    namespace: string;
    name: string;
    package_url: string;
    latest: { version_number: string; description: string; icon: string };
    community_listings?: { community: string }[];
  }>(http, `${BASE}/api/experimental/package/${ref.namespace}/${ref.name}/`);
  if (!d) return null;
  // ponytail: first listing only; a mod in several communities shows one of them.
  const community = d.community_listings?.[0]?.community;
  return {
    namespace: d.namespace,
    name: d.name,
    version: d.latest.version_number,
    description: d.latest.description,
    iconUrl: d.latest.icon,
    url: community ? modUrl(d, community) : d.package_url,
    community,
  };
}

/** Page 1 of the community listing (undocumented endpoint the website uses). Pinned packages always come first. */
async function fetchListing(
  http: Http,
  community: string,
  ordering: "newest" | "last-updated",
): Promise<(ListedMod & { pinned: boolean })[] | null> {
  const d = await getJson<{
    results: {
      namespace: string;
      name: string;
      description: string;
      icon_url: string;
      datetime_created: string;
      last_updated: string;
      is_pinned: boolean;
    }[];
  }>(http, `${BASE}/api/cyberstorm/listing/${encodeURIComponent(community)}/?ordering=${ordering}`);
  if (!d) return null;
  return d.results.map((r) => ({
    namespace: r.namespace,
    name: r.name,
    description: r.description,
    iconUrl: r.icon_url,
    createdAt: r.datetime_created,
    updatedAt: r.last_updated,
    pinned: r.is_pinned,
  }));
}

const strip = ({ pinned: _, ...mod }: ListedMod & { pinned: boolean }): ListedMod => mod;

/** Newest first, pinned packages removed. */
export async function fetchNewestMods(http: Http, community: string): Promise<ListedMod[] | null> {
  const mods = await fetchListing(http, community, "newest");
  return mods && mods.filter((m) => !m.pinned).map(strip);
}

/** Most recently updated first (after pinned), pinned packages kept. */
export async function fetchRecentlyUpdated(http: Http, community: string): Promise<ListedMod[] | null> {
  const mods = await fetchListing(http, community, "last-updated");
  return mods && mods.map(strip);
}

export async function fetchCommunities(http: Http): Promise<{ identifier: string; name: string }[]> {
  const out: { identifier: string; name: string }[] = [];
  let url: string | null = `${BASE}/api/experimental/community/`;
  for (let page = 0; url && page < MAX_COMMUNITY_PAGES; page++) {
    const d: {
      pagination: { next_link: string | null };
      results: { identifier: string; name: string }[];
    } | null = await getJson(http, url);
    if (!d) throw new Error("Thunderstore community list missing");
    out.push(...d.results.map(({ identifier, name }) => ({ identifier, name })));
    url = d.pagination.next_link;
    if (url && new URL(url).origin !== BASE) throw new Error(`Unexpected pagination link ${url}`);
  }
  return out;
}
