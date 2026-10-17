export type Http = typeof fetch;

export type ModRef = { namespace: string; name: string };

export type ModInfo = {
  namespace: string;
  name: string;
  version: string;
  description: string;
  iconUrl: string;
  url: string;
};

export type ListedMod = {
  namespace: string;
  name: string;
  description: string;
  iconUrl: string;
  createdAt: string;
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

export const modUrl = (ref: ModRef) => `${BASE}/package/${ref.namespace}/${ref.name}/`;

/** GET JSON; null on 404, throws on any other failure. */
async function getJson<T>(http: Http, url: string): Promise<T | null> {
  const res = await http(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Thunderstore ${res.status} for ${url}`);
  return res.json<T>();
}

export async function fetchMod(http: Http, ref: ModRef): Promise<ModInfo | null> {
  const d = await getJson<{
    namespace: string;
    name: string;
    package_url: string;
    latest: { version_number: string; description: string; icon: string };
  }>(http, `${BASE}/api/experimental/package/${ref.namespace}/${ref.name}/`);
  if (!d) return null;
  return {
    namespace: d.namespace,
    name: d.name,
    version: d.latest.version_number,
    description: d.latest.description,
    iconUrl: d.latest.icon,
    url: d.package_url,
  };
}

/** Page 1 of the community listing, newest first, pinned packages removed. Undocumented endpoint. */
export async function fetchNewestMods(http: Http, community: string): Promise<ListedMod[] | null> {
  const d = await getJson<{
    results: {
      namespace: string;
      name: string;
      description: string;
      icon_url: string;
      datetime_created: string;
      is_pinned: boolean;
    }[];
  }>(http, `${BASE}/api/cyberstorm/listing/${encodeURIComponent(community)}/?ordering=newest`);
  if (!d) return null;
  return d.results
    .filter((r) => !r.is_pinned)
    .map((r) => ({
      namespace: r.namespace,
      name: r.name,
      description: r.description,
      iconUrl: r.icon_url,
      createdAt: r.datetime_created,
    }));
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
  }
  return out;
}
