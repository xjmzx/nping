# nping — notes for Claude

Nostr relay connectivity tester — the suite's diagnostic tool. Tauri 2 · React.
See [`nping-introduction.md`](nping-introduction.md).

## Read SUITE.md first

[`../ndisc/SUITE.md`](https://github.com/xjmzx/ndisc/blob/main/SUITE.md) is
authoritative for anything shared across the suite. Read it **before making a
platform-sensitive choice** — it records constraints invisible on the machine
you are working on. `nchat`, which was scaffolded from this repo, shipped Web
Audio tones that worked on macOS and were silent on Linux; SUITE.md had already
documented that Web Audio output is broken on WebKit2GTK.

## Build and verify

```
make dev      # hot reload
make check    # npm run build (tsc + vite) + cargo check
make build    # release
```

Release path is `tauri build`, which runs Vite. **Never `cargo build --release`**.

## Traps specific to this repo

- **This is the scaffold.** `nchat` was forked from this shell, so a fix to the
  Makefile, icon pipeline or release workflow here is often worth carrying
  across — and a comment copied from here may name the wrong app on the other
  side. One such typo survived into `nchat`'s workflow ("unlike nchat, nchat").
- **No keys and no database**, and it should stay that way. It speaks the
  protocol only to test it: raw websocket connect, a `REQ`/`EOSE` exchange, and
  the NIP-11 info document.
- **Checks run in Rust** (`tungstenite-rustls` + `ureq`), which is what dodges
  browser CORS. Moving a check into the webview to simplify it will break
  against relays that send no CORS headers.
- It validates the relay layer every other app depends on — including `ndisc`'s
  requirement that its relay set be a **superset** of the website's read set.

## Not here

Machine-local paths, server addresses, credentials and per-box ops belong in a
machine-local `CLAUDE.md`, never in this file. **This repo is public.**
