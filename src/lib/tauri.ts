// Typed wrappers around the Rust commands in src-tauri/src/lib.rs (relays)
// and src-tauri/src/host.rs (hosts).

import { invoke } from "@tauri-apps/api/core";

export interface Nip11 {
  name: string | null;
  description: string | null;
  software: string | null;
  version: string | null;
  pubkey: string | null;
  contact: string | null;
  supportedNips: number[];
  paymentRequired: boolean;
  authRequired: boolean;
}

export interface RelayProbe {
  url: string;
  /** Overall health: connected AND the subscription reached EOSE. */
  ok: boolean;
  // connect stage
  connectOk: boolean;
  connectMs: number | null;
  connectError: string | null;
  // subscribe (REQ → EOSE) stage
  reqOk: boolean;
  reqMs: number | null;
  reqEvents: number;
  reqEose: boolean;
  reqError: string | null;
  notice: string | null;
  // NIP-11 relay information document
  info: Nip11 | null;
  infoError: string | null;
}

/** Run all three connectivity checks against one relay URL. Never rejects for
 *  ordinary connectivity failures — those come back in the report fields. */
export function probeRelay(url: string): Promise<RelayProbe> {
  return invoke("probe_relay", { url });
}

/** Save the relay-list JSON via a native save dialog. Resolves to the path
 *  written, or null if the user cancelled. */
export function exportRelays(contents: string, fileName?: string): Promise<string | null> {
  return invoke("export_relays", { contents, fileName });
}

/** Read a JSON file the user picks in a native open dialog. Resolves to its
 *  text, or null if the user cancelled. */
export function importRelays(): Promise<string | null> {
  return invoke("import_relays");
}

// ── hosts ────────────────────────────────────────────────────────────────

export interface HostSpec {
  host: string;
  icmp: boolean;
  tcpPorts: number[];
  tlsPort: number | null;
  /** Verify the certificate against this name instead of the host. */
  tlsName: string | null;
  lndP2pPort: number | null;
  lndRestPort: number | null;
  /** "abc.onion[:port]" (a "pubkey@" prefix is fine), dialled via local Tor. */
  lndOnion: string | null;
  httpUrl: string | null;
  httpExpect: string | null;
}

export interface DnsResult {
  ok: boolean;
  /** The host was an IP address, so no lookup happened. */
  literal: boolean;
  ms: number | null;
  addrs: string[];
  error: string | null;
}

export interface IcmpResult {
  ok: boolean;
  sent: number;
  received: number;
  lossPct: number | null;
  avgMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  error: string | null;
}

export interface TcpResult {
  port: number;
  addr: string | null;
  ok: boolean;
  ms: number | null;
  state: "open" | "refused" | "timeout" | "error";
  error: string | null;
}

export interface CertInfo {
  subject: string;
  issuer: string;
  sans: string[];
  /** Unix seconds. */
  notBefore: number;
  notAfter: number;
  /** Negative once expired. */
  daysLeft: number;
  sha256: string;
}

export interface TlsResult {
  port: number;
  /** The name the certificate was checked against. */
  name: string;
  /** Handshake completed and the chain verified for this name. */
  ok: boolean;
  ms: number | null;
  verifyError: string | null;
  error: string | null;
  protocol: string | null;
  cert: CertInfo | null;
}

export interface HttpResult {
  url: string;
  /** Got an HTTP response at all (any status). */
  responded: boolean;
  status: number | null;
  ms: number | null;
  /** Where redirects ended up, when that differs from `url`. */
  finalUrl: string | null;
  server: string | null;
  contentType: string | null;
  bytes: number;
  expect: string | null;
  /** Whether `expect` was in the body; null when there's no expect. */
  found: boolean | null;
  error: string | null;
}

export interface LndResult {
  p2p: TcpResult | null;
  /** p2p over Tor to the onion address. */
  onion: TcpResult | null;
  restPort: number | null;
  restOk: boolean;
  restMs: number | null;
  /** WalletState from GET /v1/state, e.g. SERVER_ACTIVE or LOCKED. */
  state: string | null;
  restError: string | null;
  cert: CertInfo | null;
}

export interface HostProbe {
  host: string;
  error: string | null;
  dns: DnsResult | null;
  icmp: IcmpResult | null;
  tcp: TcpResult[];
  tls: TlsResult | null;
  http: HttpResult | null;
  lnd: LndResult | null;
}

/** DNS, ping, TCP ports, TLS certificate and LND state for one machine. Never
 *  rejects for ordinary failures — those come back in the report fields. */
export function probeHost(spec: HostSpec): Promise<HostProbe> {
  return invoke("probe_host", { spec });
}
