// Relay-list helpers: url identity, import/export JSON, search and sort.

import type { RelayProbe } from "./tauri";

/** Identity for duplicate detection: lower-cased, no trailing slash, so
 *  `wss://Relay.x/` and `wss://relay.x` are the same relay. */
export function relayKey(url: string): string {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

function isRelayUrl(s: unknown): s is string {
  return typeof s === "string" && /^wss?:\/\/\S+$/i.test(s.trim());
}

// ── export ───────────────────────────────────────────────────────────────

export function exportJson(urls: string[]): string {
  const relays = urls.map((u) => u.trim()).filter(Boolean);
  return JSON.stringify({ app: "nping", version: 1, relays }, null, 2) + "\n";
}

// ── import ───────────────────────────────────────────────────────────────

/** Pull relay urls out of any of the shapes worth accepting:
 *  - nping's own export  `{ "relays": ["wss://…", …] }`
 *  - a plain array       `["wss://…", …]` (or `[{ "url": "wss://…" }, …]`)
 *  - a NIP-65 kind-10002 event, or just its tags — `["r", "wss://…", …]`
 *  Anything that isn't a ws(s):// url is ignored. Throws on invalid JSON or
 *  when nothing usable is found. */
export function parseImport(text: string): string[] {
  const data: unknown = JSON.parse(text);
  const out: string[] = [];
  const take = (v: unknown) => {
    if (isRelayUrl(v)) out.push(v.trim());
    else if (Array.isArray(v) && v[0] === "r" && isRelayUrl(v[1])) out.push(v[1].trim());
    else if (v && typeof v === "object" && isRelayUrl((v as { url?: unknown }).url))
      out.push((v as { url: string }).url.trim());
  };
  if (Array.isArray(data)) data.forEach(take);
  else if (data && typeof data === "object") {
    const o = data as { relays?: unknown; tags?: unknown };
    if (Array.isArray(o.relays)) o.relays.forEach(take);
    if (Array.isArray(o.tags)) o.tags.forEach(take);
  }
  if (out.length === 0) throw new Error("no ws:// or wss:// relay urls found");
  return out;
}

// ── search ───────────────────────────────────────────────────────────────

/** Whitespace-separated terms, all of which must match. Plain terms match the
 *  url, software, name and description; `nip:42` needs that NIP in the
 *  relay's NIP-11 list; `is:ok|warn|fail|idle|dup` filters by status. */
export function matchesSearch(
  url: string,
  probe: RelayProbe | undefined,
  status: string,
  dup: boolean,
  query: string,
): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const info = probe?.info;
  const hay = [url, info?.software, info?.version, info?.name, info?.description]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((t) => {
    if (t.startsWith("nip:")) {
      const n = Number(t.slice(4));
      return !!info && Number.isFinite(n) && info.supportedNips.includes(n);
    }
    if (t.startsWith("is:")) {
      const want = t.slice(3);
      return want === "dup" ? dup : status === want;
    }
    return hay.includes(t);
  });
}

// ── sort ─────────────────────────────────────────────────────────────────

export type SortKey = "status" | "url" | "connect" | "eose" | "events" | "software" | "nips";
export type SortDir = "asc" | "desc";

const STATUS_RANK: Record<string, number> = { fail: 0, warn: 1, ok: 2 };

/** The value a row sorts by; null (not probed / no data) always sorts last. */
export function sortValue(
  key: SortKey,
  url: string,
  probe: RelayProbe | undefined,
  status: string,
): string | number | null {
  switch (key) {
    case "status":
      return STATUS_RANK[status] ?? null;
    case "url":
      return relayKey(url).replace(/^wss?:\/\//, "");
    case "connect":
      return probe?.connectOk ? probe.connectMs : null;
    case "eose":
      return probe?.reqEose ? probe.reqMs : null;
    case "events":
      return probe?.reqEose ? probe.reqEvents : null;
    case "software":
      return probe?.info?.software?.toLowerCase() ?? null;
    case "nips":
      return probe?.info ? probe.info.supportedNips.length : null;
  }
}

export function compareValues(
  a: string | number | null,
  b: string | number | null,
  dir: SortDir,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const c = typeof a === "number" && typeof b === "number"
    ? a - b
    : String(a).localeCompare(String(b));
  return dir === "asc" ? c : -c;
}

/** "WSS handshake failed: HTTP error: 503 Service Unavailable" → "HTTP 503";
 *  "auth-required: authenticate with AUTH…" → "auth-required". */
export function shortError(e: string): string {
  // NIP-01 machine-readable prefixes ("auth-required: …", "restricted: …").
  const prefix = e.match(/^(auth-required|restricted|rate-limited|blocked|invalid|pow|duplicate|error):/);
  if (prefix) return prefix[1];
  const http = e.match(/HTTP(?: error)?:? (\d{3})/i);
  if (http) return `HTTP ${http[1]}`;
  if (/timed? ?out/i.test(e)) return "timeout";
  if (/dns|resolve|lookup/i.test(e)) return "DNS";
  if (/refused/i.test(e)) return "refused";
  if (/tls|certificate/i.test(e)) return "TLS";
  return e.length > 28 ? `${e.slice(0, 27)}…` : e;
}
