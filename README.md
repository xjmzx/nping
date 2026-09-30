# nping

A small Nostr relay connectivity tester — part of the **ndisc** suite.

Edit a list of relay URLs (prepopulated with `relay.fizx.uk`, `relay.damus.io`,
`nos.lol`) and ping them. Each relay reports three checks with per-stage
indicators and verbatim errors for working out connectivity issues:

1. **Connect** — open the WebSocket (TCP + TLS + HTTP upgrade), timed.
2. **Subscribe** — send a tiny `REQ` and wait for `EOSE`, timed; counts the
   events that arrived first, and surfaces `NOTICE` / `CLOSED`.
3. **Info (NIP-11)** — fetch the relay-information document (software, version,
   supported NIPs, payment/auth limitations). Fetched in Rust so the browser
   CORS wall most relays trip doesn't hide the answer.

The relay list is persisted locally.

## Hosts

The **Hosts** view (server icon, top left) checks whole machines rather than
relays. Per host, each check is optional:

- **DNS** — A/AAAA lookup, timed (skipped for an IP address).
- **Ping** — ICMP via the system `ping` (it carries the raw-socket capability;
  Ubuntu keeps unprivileged ICMP sockets closed). No replies is amber, not red —
  plenty of servers filter ICMP.
- **Ports** — TCP connect per port: open / refused / timeout, with the error.
  Write `!22` for a port that should be **closed**: it passes when refused or
  silent and fails if it's ever open — a small firewall audit.
- **TLS** — handshake + chain verification, and the certificate's expiry, issuer,
  names and SHA-256 fingerprint. A certificate that fails verification is still
  read, so an expired one says how long ago. Amber under 14 days. For a host
  entered as an IP, set **TLS name** to check the certificate by domain.
- **HTTP(S)** — GET a page, following redirects: status, time, where it landed,
  and optionally whether the body contains some text. 4xx amber, 5xx or
  missing text red — catches a web server down while the box is up.
- **Relay** — the relay check above, against a `wss://` url on that host.
- **LND** — the p2p port (TCP reachability) and REST `GET /v1/state`, the one
  endpoint LND serves without a macaroon: `SERVER_ACTIVE`, `LOCKED`, … plus its
  self-signed certificate's fingerprint. LND binds REST to localhost unless
  `restlisten` says otherwise.
  **LND onion** dials the node's onion address (paste the URI from
  `lncli getinfo`) through the local Tor SOCKS proxy at `127.0.0.1:9050` —
  the only outside view of a node whose clearnet ports are firewalled.

The last result of each host is remembered across restarts, with the time it
was taken ("checked 14:02 · 3 min ago"), so an old result reads as old.
Changing what a host probes drops its result; renaming it, or turning `22`
into `!22`, doesn't.

**Hosting notes** — two sections in each host's settings, for your own
records: *Specs* (OS, location, memory, cores, storage, monthly traffic) and
*Hosting* (currency, annual cost, renewal date). The card shows them as two
summary lines; the renewal counts down, amber within 30 days and red once
lapsed. Notes never affect the host's status and are never sent anywhere —
they travel only in the hosts JSON export.

No hosts ship with the app. The list is stored locally and moves between
machines by JSON export/import.

## What's stored, and where

Everything lives in the webview's localStorage, under
`~/.local/share/uk.fizx.nping/localstorage/` on Linux — one file for the
installed app and a separate one for `make dev` builds, so the two never share
lists. Keys: `nping.relays`, `nping.hosts`, `nping.hostResults`, `nping.view`,
`nping.mode`.

Import and export go through native file dialogs and remember nothing: no last
path, no default file, no auto-load. Import **merges** (entries already listed
are skipped); export writes the list only, never results.

## Stack

Tauri 2 + React + Vite + Tailwind (the suite stack). The probe lives in Rust
(`src-tauri/src/lib.rs`): blocking `tungstenite` (rustls) for the WebSocket and
`ureq` for the NIP-11 HTTP fetch, each bounded by explicit timeouts and run on
a blocking thread so relays probe concurrently.

## Develop

```sh
make deps     # npm install + cargo fetch
make dev      # tauri dev (hot reload)
make icons    # regenerate the bundle icon set from icon.svg
make build    # release binary
make install  # install binary + .desktop under ~/.local
make check    # typecheck + cargo check
```
