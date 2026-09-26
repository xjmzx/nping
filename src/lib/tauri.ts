// Typed wrapper around the single Rust command in src-tauri/src/lib.rs.

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
export function exportRelays(contents: string): Promise<string | null> {
  return invoke("export_relays", { contents });
}

/** Read a JSON file the user picks in a native open dialog. Resolves to its
 *  text, or null if the user cancelled. */
export function importRelays(): Promise<string | null> {
  return invoke("import_relays");
}
