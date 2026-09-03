# Changelog

## v0.1.0-beta.3

### Windows builds

- The release workflow now builds a **Windows x86_64 NSIS installer**
  (`nping_<version>_x64-setup.exe`) alongside the Linux `.deb`/`.AppImage` and
  the macOS `.dmg`. The job is ndisc's, unchanged; like the macOS one it runs
  after the Linux job and only appends its asset, so the Linux job stays the
  single owner of the release name and notes.
- Unsigned, like the rest of the suite. SmartScreen will warn on first run of a
  new version until the download earns reputation; "More info" then "Run
  anyway" is the way past it.
- **This installer is untested.** nping compiles clean on Windows — verified
  with `cargo check` against a real Windows toolchain — but no build of this
  app has been installed or launched there. Known to build; not known to run.

### Repository

- Added `.gitattributes` (`* text=auto eol=lf`), which the rest of the suite
  already carried. Without it, line endings are decided per clone: a Windows
  checkout reports unchanged files as modified, and a CRLF blob can reach a
  file the Linux and macOS boxes hold as LF.

## v0.1.0-beta.2

### macOS builds

- The release workflow now builds a **macOS arm64 `.dmg`** alongside the Linux
  `.deb`/`.AppImage`. The macOS job runs after the Linux one and only
  appends its asset, so the Linux job stays the single owner of the release
  name and notes.
- Unsigned and un-notarised, like the rest of the suite. Gatekeeper blocks the
  first launch until the app is opened from the context menu, or cleared with
  `xattr -dr com.apple.quarantine /Applications/nping.app`.
- **This dmg is untested.** It is known to build; it is not known to run. No
  macOS build of this app has been launched.

### Fixed

- `workflow_dispatch` checked out the default branch while publishing to the
  tag it was handed, so a manual run uploaded main-built artifacts to an older
  tag's release. Checkout now pins `ref` to the tag being released. Tag pushes
  were never affected.

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
