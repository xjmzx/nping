# Changelog

## v0.1.0-beta.1

First release. A small Nostr relay connectivity tester for the ndisc suite.

- Editable relay list, prepopulated with `relay.fizx.uk`, `relay.damus.io`,
  `nos.lol`; persisted locally.
- Per-relay, per-stage diagnostics with the suite dot status vocabulary and
  verbatim error strings:
  - **Connect** — WebSocket open (TCP + TLS + HTTP upgrade), timed.
  - **Subscribe** — `REQ` → `EOSE` round-trip, timed; event count; surfaces
    `NOTICE` / `CLOSED`.
  - **Info (NIP-11)** — relay-information document (software, version,
    supported NIPs, payment/auth limitations), fetched in Rust to dodge the
    browser CORS wall.
- "Ping all" probes every relay concurrently; footer ok/warn/fail summary.

Probe runs in Rust (`tungstenite`/rustls + `ureq`) on a blocking thread.
Tauri 2 + React + Vite + Tailwind.
