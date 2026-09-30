// Host-list helpers: the stored row shape, turning a row into a probe spec,
// import/export JSON, and per-check status.
//
// No hosts ship with the app — this repo is public, and server addresses
// don't belong in it. The list lives in localStorage and moves between
// machines as an exported JSON file.

import type { Status } from "../components/StatusDot";
import type { CertInfo, HostProbe, HostSpec, HttpResult, RelayProbe, TcpResult } from "./tauri";

/** One machine to check. Port fields hold what was typed ("!22, 443"), so a
 *  half-edited value isn't thrown away; they're parsed when a check runs.
 *  A port written `!22` is expected to be CLOSED — it passes when the
 *  connection is refused or times out, and fails if it's ever open. */
/** Your own notes on a machine — what it is and what it costs. Free text,
 *  never probed or sent anywhere; travels with the hosts JSON export. */
export interface HostNotes {
  os: string;
  /** Country code, e.g. "DE". */
  location: string;
  memoryMb: string;
  cores: string;
  storageGb: string;
  /** Monthly transfer allowance. */
  trafficGb: string;
  /** Currency code, e.g. "EUR". */
  currency: string;
  /** Per year. */
  cost: string;
  /** YYYY-MM-DD. */
  renewal: string;
}

export const EMPTY_NOTES: HostNotes = {
  os: "",
  location: "",
  memoryMb: "",
  cores: "",
  storageGb: "",
  trafficGb: "",
  currency: "",
  cost: "",
  renewal: "",
};

export interface HostRow {
  id: string;
  name: string;
  host: string;
  notes: HostNotes;
  // Which checks run. Switching one off keeps its settings, hides its row and
  // leaves it out of the host's status — for a service not set up yet.
  icmp: boolean;
  portsOn: boolean;
  tlsOn: boolean;
  httpOn: boolean;
  relayOn: boolean;
  lndOn: boolean;
  ports: string;
  tls: string;
  /** Blank = check the certificate against the host itself. */
  tlsName: string;
  relay: string;
  /** A page to GET; blank to skip. */
  http: string;
  /** Text the page must contain; blank for any. */
  httpExpect: string;
  lndP2p: string;
  lndRest: string;
  /** Onion address or full getinfo URI; checked through local Tor. */
  lndOnion: string;
}

export type HostFields = Omit<HostRow, "id">;

export const NEW_HOST: HostFields = {
  name: "",
  host: "",
  icmp: true,
  portsOn: true,
  tlsOn: true,
  httpOn: false,
  relayOn: false,
  lndOn: false,
  // Only what's listed is checked; a new host starts with SSH alone rather
  // than guessing at a web server.
  ports: "22",
  tls: "443",
  tlsName: "",
  relay: "",
  http: "",
  httpExpect: "",
  lndP2p: "",
  lndRest: "",
  lndOnion: "",
  notes: EMPTY_NOTES,
};

/** A certificate this close to expiry turns its check amber. */
export const CERT_WARN_DAYS = 14;

export function parsePort(s: string): number | null {
  const n = Number(s.trim());
  return Number.isInteger(n) && n > 0 && n < 65536 ? n : null;
}

export interface PortRule {
  port: number;
  /** Written `!port`: should be closed. */
  closed: boolean;
}

export function parsePortRules(s: string): PortRule[] {
  const out: PortRule[] = [];
  for (const part of s.split(/[\s,]+/)) {
    const closed = part.startsWith("!");
    const p = parsePort(closed ? part.slice(1) : part);
    if (p != null && !out.some((r) => r.port === p)) out.push({ port: p, closed });
  }
  return out;
}

export function formatPortRules(rules: PortRule[]): string {
  return rules.map((r) => `${r.closed ? "!" : ""}${r.port}`).join(", ");
}

export function parsePorts(s: string): number[] {
  return parsePortRules(s).map((r) => r.port);
}

/** Whether a port result meets its rule: open when expected open, and
 *  refused or silent (timeout) when expected closed. Any other connect error
 *  (no address, unreachable) proves nothing either way, so it fails. */
export function portPasses(t: TcpResult, rule: PortRule | undefined): boolean {
  if (!rule?.closed) return t.ok;
  return t.state === "refused" || t.state === "timeout";
}

/** "https://relay.x/" or "relay.x:443" typed as a host → "relay.x". */
export function cleanHost(s: string): string {
  let h = s.trim().replace(/^[a-z]+:\/\//i, "").replace(/\/.*$/, "");
  // Strip a :port, but leave a bare IPv6 address (several colons) alone.
  if ((h.match(/:/g) ?? []).length === 1) h = h.replace(/:\d+$/, "");
  return h.replace(/^\[|\]$/g, "");
}

/** The name to show beside the address: none when it just repeats it. */
export function shownName(r: { name: string; host: string }): string {
  const name = r.name.trim();
  return name && name.toLowerCase() !== cleanHost(r.host).toLowerCase() ? name : "";
}

/** The check switches, in the order the editor shows them. */
export const CHECKS = [
  ["icmp", "Ping"],
  ["portsOn", "Ports"],
  ["tlsOn", "TLS"],
  ["httpOn", "HTTP"],
  ["relayOn", "Relay"],
  ["lndOn", "LND"],
] as const;
export type CheckKey = (typeof CHECKS)[number][0];

/** Whether each check will actually run: switched on AND configured. */
export function active(r: HostFields) {
  return {
    icmp: r.icmp,
    ports: r.portsOn && parsePorts(r.ports).length > 0,
    tls: r.tlsOn && parsePort(r.tls) != null,
    http: r.httpOn && r.http.trim() !== "",
    relay: r.relayOn && r.relay.trim() !== "",
    lnd:
      r.lndOn &&
      (parsePort(r.lndP2p) != null || parsePort(r.lndRest) != null || r.lndOnion.trim() !== ""),
  };
}

/** Fills fields a stored or imported row predates. A switch that's missing
 *  is on when its check has settings — so rows saved before the switches
 *  existed behave as they did. */
export function withDefaults(o: Partial<HostRow>): HostFields {
  const r = { ...NEW_HOST, ...o };
  r.notes = { ...EMPTY_NOTES, ...(o.notes ?? {}) };
  const has = (k: keyof HostRow) => typeof o[k] === "boolean";
  if (!has("portsOn")) r.portsOn = r.ports.trim() !== "";
  if (!has("tlsOn")) r.tlsOn = r.tls.trim() !== "";
  if (!has("httpOn")) r.httpOn = r.http.trim() !== "";
  if (!has("relayOn")) r.relayOn = r.relay.trim() !== "";
  if (!has("lndOn")) r.lndOn = (r.lndP2p + r.lndRest + r.lndOnion).trim() !== "";
  return r;
}

export function toSpec(r: HostFields): HostSpec {
  const on = active(r);
  return {
    host: cleanHost(r.host),
    icmp: on.icmp,
    tcpPorts: on.ports ? parsePorts(r.ports) : [],
    tlsPort: on.tls ? parsePort(r.tls) : null,
    tlsName: cleanHost(r.tlsName) || null,
    lndP2pPort: on.lnd ? parsePort(r.lndP2p) : null,
    lndRestPort: on.lnd ? parsePort(r.lndRest) : null,
    lndOnion: on.lnd ? r.lndOnion.trim() || null : null,
    httpUrl: on.http ? r.http.trim() : null,
    httpExpect: r.httpExpect.trim() || null,
  };
}

// ── export / import ──────────────────────────────────────────────────────

export function exportJson(rows: HostRow[]): string {
  const hosts = rows.map(({ id: _id, ...fields }) => fields);
  return JSON.stringify({ app: "nping", kind: "hosts", version: 1, hosts }, null, 2) + "\n";
}

/** Accepts nping's own export, or a bare array of rows or hostnames. Missing
 *  fields take the new-host defaults. */
export function parseImport(text: string): HostFields[] {
  const data: unknown = JSON.parse(text);
  const list = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as { hosts?: unknown }).hosts)
      ? (data as { hosts: unknown[] }).hosts
      : null;
  if (!list) throw new Error('expected { "hosts": [ … ] } or an array');
  const str = (v: unknown, d: string) =>
    typeof v === "string" ? v : typeof v === "number" ? String(v) : d;
  const out: HostFields[] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      out.push({ ...NEW_HOST, host: item.trim() });
      continue;
    }
    const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const host = str(o.host, "").trim();
    if (!host) continue;
    const row: Partial<HostRow> = {
      name: str(o.name, ""),
      host,
      icmp: bool(o.icmp),
      portsOn: bool(o.portsOn),
      tlsOn: bool(o.tlsOn),
      httpOn: bool(o.httpOn),
      relayOn: bool(o.relayOn),
      lndOn: bool(o.lndOn),
      ports: Array.isArray(o.ports) ? o.ports.join(", ") : str(o.ports, NEW_HOST.ports),
      tls: str(o.tls, NEW_HOST.tls),
      tlsName: str(o.tlsName, ""),
      relay: str(o.relay, ""),
      http: str(o.http, ""),
      httpExpect: str(o.httpExpect, ""),
      lndP2p: str(o.lndP2p, ""),
      lndRest: str(o.lndRest, ""),
      lndOnion: str(o.lndOnion, ""),
      notes: parseNotes(o.notes),
    };
    // Drop the unset switches so withDefaults can infer them.
    for (const k of Object.keys(row) as (keyof HostRow)[]) if (row[k] === undefined) delete row[k];
    out.push(withDefaults(row));
  }
  if (out.length === 0) throw new Error("no hosts found");
  return out;
}

export function hostKey(r: HostFields): string {
  return cleanHost(r.host).toLowerCase();
}

// ── status ───────────────────────────────────────────────────────────────

const RANK: Record<Status, number> = { idle: 0, ok: 1, checking: 2, warn: 3, fail: 4 };

export function worst(statuses: Status[]): Status {
  return statuses.reduce<Status>((a, b) => (RANK[b] > RANK[a] ? b : a), "idle");
}

export function certStatus(c: CertInfo | null | undefined): Status {
  if (!c) return "idle";
  if (c.daysLeft < 0) return "fail";
  if (c.daysLeft < CERT_WARN_DAYS) return "warn";
  return "ok";
}

export interface HostStatuses {
  dns: Status;
  icmp: Status;
  tcp: Status[];
  tls: Status;
  http: Status;
  relay: Status;
  lnd: Status;
  overall: Status;
}

/** Per-check status for a finished probe. Ping going unanswered is amber,
 *  not red: plenty of servers filter ICMP and are otherwise fine. */
/** 2xx/3xx is green, 4xx amber (the server is up, the page isn't), 5xx red;
 *  a missing expected string is red whatever the status. */
export function httpStatus(h: HttpResult | null | undefined): Status {
  if (!h) return "idle";
  if (!h.responded || h.status == null) return "fail";
  if (h.found === false || h.status >= 500) return "fail";
  if (h.status >= 400) return "warn";
  return "ok";
}

/** Checks switched off (or not configured) are "idle" and don't count. */
export function hostStatuses(
  p: HostProbe,
  relay: RelayProbe | undefined,
  row: HostFields,
): HostStatuses {
  const on = active(row);
  const rules = parsePortRules(row.ports);
  const dns: Status = !p.dns ? "idle" : p.dns.ok ? "ok" : "fail";
  const icmp: Status = !p.icmp
    ? "idle"
    : p.icmp.ok && p.icmp.received >= Math.min(p.icmp.sent, 3)
      ? "ok"
      : "warn";
  // A port since removed from the list may still be in an older result.
  const listed = p.tcp.filter((t) => rules.some((r) => r.port === t.port));
  const tcp: Status[] = listed.map((t) =>
    portPasses(t, rules.find((r) => r.port === t.port)) ? "ok" : "fail",
  );
  const http = httpStatus(p.http);
  const tls: Status = !p.tls
    ? "idle"
    : p.tls.error || p.tls.verifyError
      ? "fail"
      : certStatus(p.tls.cert);
  const relayS: Status = !relay ? "idle" : !relay.connectOk ? "fail" : !relay.reqEose ? "warn" : "ok";
  let lnd: Status = "idle";
  if (p.lnd) {
    const parts: Status[] = [];
    // Peers can reach the node if EITHER path is open: a node that's only
    // up over Tor (clearnet 9735 firewalled) is reachable, so it's green.
    const paths = [p.lnd.p2p, p.lnd.onion].filter((x) => x != null);
    if (paths.length) parts.push(paths.some((x) => x.ok) ? "ok" : "fail");
    if (p.lnd.restPort != null) {
      parts.push(
        !p.lnd.restOk ? "fail" : p.lnd.state === "SERVER_ACTIVE" ? "ok" : "warn",
      );
    }
    lnd = worst(parts);
  }
  const gate = (ok: boolean, st: Status): Status => (ok ? st : "idle");
  const r = {
    dns,
    icmp: gate(on.icmp, icmp),
    tcp: on.ports ? tcp : [],
    tls: gate(on.tls, tls),
    http: gate(on.http, http),
    relay: gate(on.relay, relayS),
    lnd: gate(on.lnd, lnd),
  };
  const overall: Status = p.error
    ? "fail"
    : worst([r.dns, r.icmp, ...r.tcp, r.tls, r.http, r.relay, r.lnd]);
  return { ...r, overall };
}

export function daysText(days: number): string {
  if (days < 0) return `expired ${-days} d ago`;
  if (days === 0) return "expires today";
  return `${days} d left`;
}

export function dateText(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 10);
}

/** "C=US, O=Let's Encrypt, CN=YE1" → "Let's Encrypt YE1". */
export function shortIssuer(dn: string): string {
  const get = (k: string) => dn.match(new RegExp(`(?:^|,\\s*)${k}=([^,]+)`))?.[1]?.trim();
  const o = get("O");
  const cn = get("CN");
  if (o && cn && !cn.startsWith(o)) return `${o} ${cn}`;
  return cn ?? o ?? dn;
}

// ── remembered results ───────────────────────────────────────────────────

/** A finished check, kept across restarts so the list isn't blank on launch.
 *  `at` is epoch ms; the card shows it so an old result reads as old. */
export interface StoredResult {
  at: number;
  probe: HostProbe;
  relay?: RelayProbe;
}

export function agoText(at: number, now: number): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function clockText(at: number): string {
  const d = new Date(at);
  const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const today = new Date().toDateString() === d.toDateString();
  return today ? hm : `${d.toLocaleDateString([], { day: "numeric", month: "short" })} ${hm}`;
}

// ── hosting notes ────────────────────────────────────────────────────────

function parseNotes(v: unknown): HostNotes {
  const out = { ...EMPTY_NOTES };
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    for (const k of Object.keys(out) as (keyof HostNotes)[]) {
      const x = o[k];
      if (typeof x === "string") out[k] = x;
      else if (typeof x === "number") out[k] = String(x);
    }
  }
  return out;
}

export function hasNotes(n: HostNotes): boolean {
  return Object.values(n).some((v) => v.trim() !== "");
}

/** "2048" MB → "2 GB"; "512" → "512 MB". Non-numbers pass through. */
function mb(v: string): string {
  const n = Number(v);
  if (!v.trim() || !Number.isFinite(n)) return v.trim();
  return n >= 1024 ? `${+(n / 1024).toFixed(1)} GB` : `${n} MB`;
}

/** "4096" GB → "4 TB"; "72" → "72 GB". */
function gb(v: string): string {
  const n = Number(v);
  if (!v.trim() || !Number.isFinite(n)) return v.trim();
  return n >= 1024 ? `${+(n / 1024).toFixed(1)} TB` : `${n} GB`;
}

/** "Debian 12 · DE · 2 GB RAM · 2 cores · 72 GB disk · 4 TB/mo" */
export function specsLine(n: HostNotes): string {
  const cores = n.cores.trim();
  return [
    n.os.trim(),
    n.location.trim().toUpperCase(),
    n.memoryMb.trim() && `${mb(n.memoryMb)} RAM`,
    cores && `${cores} ${cores === "1" ? "core" : "cores"}`,
    n.storageGb.trim() && `${gb(n.storageGb)} disk`,
    n.trafficGb.trim() && `${gb(n.trafficGb)}/mo`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "EUR 48 / yr" */
export function costText(n: HostNotes): string {
  const cost = n.cost.trim();
  if (!cost) return "";
  return `${n.currency.trim().toUpperCase()} ${cost}`.trim() + " / yr";
}

/** A renewal inside this many days turns amber. */
export const RENEWAL_WARN_DAYS = 30;

/** Days from today to the renewal date (negative once past), or null when
 *  the date isn't a valid YYYY-MM-DD. */
export function renewalDays(renewal: string, now: number): number | null {
  const m = renewal.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const due = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  if (Number.isNaN(due)) return null;
  const d = new Date(now);
  const today = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((due - today) / 86_400_000);
}

export function renewalStatus(days: number | null): Status {
  if (days == null) return "idle";
  if (days < 0) return "fail";
  if (days <= RENEWAL_WARN_DAYS) return "warn";
  return "ok";
}

export function renewalText(days: number): string {
  if (days < 0) return `lapsed ${-days} d ago`;
  if (days === 0) return "renews today";
  return `in ${days} d`;
}
