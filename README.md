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
