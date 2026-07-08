# nping — Nostr relay connectivity tester

> Part of the **n-suite**. Shared conventions, the Nostr wire contract, the
> design language, and the roadmap live in the hub doc:
> **[ndisc/SUITE.md](https://github.com/xjmzx/ndisc/blob/main/SUITE.md)**
> (locally: `../ndisc/SUITE.md`). This file covers **nping** specifically.

`nping` is the suite's **diagnostic** tool: a small utility for checking that
the relays the other apps depend on are reachable and healthy. It publishes
nothing and holds no keys.

## What it does
- Keeps an **editable, persisted relay list** (defaults like fiatjaf / damus /
  nos.lol).
- Runs, per relay, a **timed connect**, a **REQ → EOSE** round-trip, and a
  **NIP-11** relay-information document check.
- Surfaces reachability/latency so you can sanity-check a relay set before
  trusting it for publishing or reading (e.g. verifying `ndisc`'s superset
  requirement).

## Tech stack & build
Tauri 2 · React + Vite + TypeScript · Rust backend. Checks run in Rust
(`tungstenite-rustls` for websockets + `ureq` for NIP-11), which dodges browser
CORS. No keyring, no database. `make dev` / `make install`.

## Suite integration
- **Supports** the whole suite indirectly: it validates the **relay layer** the
  publishers (`ndisc`, `ntree`, `nsmpl`) and readers (`nplay`, `nview`) rely on.
- Doesn't touch the wire contract itself — it operates below it, at the
  transport level.

## Nostr surface
**No publishing, no keys.** Speaks the protocol only to *test* it: raw websocket
connect, a `REQ`/`EOSE` exchange, and the NIP-11 info document.

## Styling notes
Shared design language (fizx palette, squared boxes). Smaller surface than the
library apps — a single relay-list panel with per-relay status.

## Backlog & direction
- Richer diagnostics (write-probe, auth/NIP-42, per-relay history).
- Could become the place to *manage* the shared relay set the publishers read
  from. See
  **[SUITE.md](https://github.com/xjmzx/ndisc/blob/main/SUITE.md)** for the
  suite context.
