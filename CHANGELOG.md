# Changelog

## v0.4.3

### Fixed

- **The Relays header fits the default window on Linux.** GNOME's text
  scaling (1.25x here) leaves the 720px window 576 CSS px wide, and the
  toolbar ran off the right edge. Below 768 CSS px the search box is now its
  icon (it opens over the brand while focused or holding a query; `/` still
  focuses it) and Add / Check all drop their labels. The minimum window width
  is 600 (was 480), the narrowest the Relays header fits.
- **Both headers are the same height.** No header control wraps its label any
  more (Check all went to two lines at some widths), and the search box is the
  32px of the controls beside it, so the brand no longer jumps when you switch
  sections.
- **Check labels sit on their results' baseline.** They rode ~4px high: the
  label took its baseline from its icon's bottom edge.

## v0.4.2

The first release with the 2026-09-29 icon export (v0.4.1 shipped the old
icon).

### Changed

- **The Relay row names the relay it checked.** A host card's Relay row now
  leads with the relay's hostname ("relay.example.com · EOSE · 80 ms ·
  40 ms"), and shows it under an error too; the full url is on hover. A
  healthy result alone couldn't tell you whose relay answered, so a url
  copied from another host looked fine.
- **Cards follow the list view's sort.** Sort by renewal (or anything else)
  in the list, switch to cards, and they come in that order. With no sort
  chosen they keep the stored order, as before.
- **One layout for both sections.** Relays and Hosts are now built from the
  same pieces — header and toolbar, card grid, card (header, check rows,
  detail, "checked … ago"), list table and footer — so they line up and
  behave alike, and a layout change reaches both.
  - Three cards across from 1280px (was 1536px) in both, with the same
    gutters and widths; four were considered and left out, as the TLS and
    LND lines wrap at ~360px.
  - Cards size to their content: the relay card's fixed-height slots and
    equal-height rows are gone, and its limits (payment / auth) sit in the
    same run of chips as its NIPs.
  - One verb: **Check all** / "Check this relay" (was "Ping all"), and
    "checked" (was "pinged") on relay cards.
  - Check labels are one word (Connect · REQ · Info; the full name on
    hover), which narrows the label column and gives the results the width.
  - The relay card no longer repeats its connect time in the header.
- **Host cards:** the header shows the name, then the address in grey — or
  just the address when there's no name, or the name only repeats it. Name
  and address are edited in the editor with the checks; a new host opens
  there. The TLS protocol moved to the hover text (every host reports the
  same one), and the Relay row leads with the relay's host.
- **Lists:** a column shows only when some row has something for it (Flags),
  and columns too wide for the window are left out rather than hidden. The
  relay column carries the relay's own description after its url; hosts
  have one Host column (name, then address) instead of Name and Host.

## v0.4.1

### Added

- **Hosts list view.** The Hosts header gets the same card / list toggle as
  Relays. One line per host: status, name, host, every enabled check as a
  coloured pip, specs, when it was last checked, the renewal countdown and
  the annual cost. Sortable — renewal sorts soonest first, "checked" stalest
  first. A row click expands the full card. Below 1024px the specs, checked
  and cost columns drop out.
- **Money in the footer:** total annual cost per currency and the next
  renewal due (amber within 30 days, red once lapsed).
- **Save / export feedback**, in both views. Edits were always saved as you
  typed; now the footer says so ("✓ saved"). It also says whether the last
  export still matches the list ("in sync with export · 14:02" / "changed
  since last export"), and the export button carries a dot while it doesn't.
  Only what an export writes counts — check results never make it stale.
  Importing into an empty list counts as in sync.
- **Dialogs remember where you were.** Export starts in the folder, and under
  the name, of the last export; import opens in that folder too.

### Changed

- The Linux release ships the `.deb` only. The AppImage bundled its own
  webkit2gtk (~80 MB against the `.deb`'s ~6 MB); other distros can build from
  source.

## v0.4.0

### Added

- **Hosts view** (server icon, top left) — service checks for whole machines,
  alongside the relay tester. Per host, each check can be switched on or off
  (off keeps its settings and leaves it out of the host's status):
  - **DNS** — A/AAAA lookup, timed; skipped for an IP address.
  - **Ping** — ICMP via the system `ping`. No replies is amber, not red.
  - **Ports** — TCP connect per listed port. `!22` means *should be closed*:
    it passes when refused or silent and fails if ever open. Chips in the
    editor flip a port between open/closed or remove it.
  - **TLS** — handshake, chain verification against the name (or a separate
    **TLS name**, for a host entered as an IP), and the certificate's expiry,
    issuer, names and fingerprint. A failing certificate is still read, and
    errors are plain English ("certificate is for example.com, not …"). Amber
    under 14 days.
  - **HTTP(S)** — GET a page following redirects: status, time, final url,
    server, and optionally whether the body contains some text.
  - **Relay** — the relay check against a url on that host.
  - **LND** — clearnet p2p port, REST `GET /v1/state` (the one endpoint LND
    serves without a macaroon — nping still holds no keys), and the **onion**
    address dialled through the local Tor SOCKS proxy (`127.0.0.1:9050`;
    paste the URI from `lncli getinfo`). Reachable over either path is green;
    a miss the other path covers is shown in grey.
- **Results survive a restart**, for hosts and relays, with the time they were
  taken ("checked 14:02 · 3 min ago" / "pinged …"). Editing what a host checks
  drops its result; renaming, removing a port or flipping `22` → `!22` don't.
- **Hosting notes** per host: Specs (OS, location, memory, cores, storage,
  traffic) and Hosting (currency, annual cost, renewal date), shown as two
  summary lines on the card. The renewal counts down — amber within 30 days,
  red once lapsed. Local only; exported with the host list.
- Host list JSON import/export (`nping-hosts.json`); no hosts ship with the app.
- Header tagline on wide windows: "relay pings · service checks for VPS hosts".

### Fixed

- The list view's sticky column header let rows show through above it.

## v0.3.0

### Added

- **List view.** The header toggle switches between cards and a one-line-per-
  relay table: status, url, connect, EOSE, events, software, NIP count and
  flags. Click a column header to sort (again to reverse, a third time for your
  own order). Unprobed relays always sort last; sorting by status puts failures
  first. Clicking a row expands its full card, which is where the url is edited.
  nping remembers which view you used.
- **Search** (`/` to focus, Esc to clear) filters both views by url, software,
  name or description. `nip:42` finds relays that list a NIP, and
  `is:ok|warn|fail|dup` filters by status. Terms combine.
- **Duplicate flag.** A relay listed twice (ignoring case and a trailing slash)
  is marked `dup`.
- **JSON import / export.** Export writes `nping-relays.json`
  (`{ "app": "nping", "version": 1, "relays": [...] }`, urls only). Import
  adds to the list and skips urls already in it. It accepts nping's own
  export, a plain array of urls, or a NIP-65 relay-list event (or just its
  `r` tags). The native file dialogs run in Rust, so the webview never gets a
  general file-read/write command.

### Changed

- **Paged card grid.** At the default 720px window the cards stay a single
  scrolling column. From 1024px they form two columns and from 1536px three,
  and wide windows page two rows at a time (six relays at three columns). Flip
  pages with the footer pager or PageUp/PageDown.
- **Cards line up.** Every card on a page matches the tallest. The description
  is a fixed two-line slot and the badge row is always reserved. Stage errors
  are one line with the full text on hover. So "payment required" and the NIP
  chips sit at the same height across the grid.
- The list shortens relay errors to `HTTP 503` or the NIP-01 reason prefix
  (`auth-required`, `restricted`, …).

## v0.1.0-beta.4

### Fixed

- **The app icon had lost its transparency, and its artwork with it.** All 15
  PNGs under `src-tauri/icons` were 100% opaque with a completely flat alpha
  channel, and 13% of `icon.png` was pure white — the white `ping` wordmark had
  collapsed into solid dark shapes, so the icon was not merely un-transparent
  but wrong. The corner pixel read `(0,225,255,255)` where the master reads
  `(0,216,255,13)`. Regenerated with `tauri icon` from that master; the set now
  carries 52-67% partial alpha and no pure white, and stays legible at 32x32.
  The master was never damaged, and no other app in the suite was affected —
  each still matches its own `-sq` master's corner alpha.

### Windows builds

- **The Windows installer has now actually been run.** It installs silently
  with `/S` to `%LOCALAPPDATA%
ping`, launches, and the UI renders. This
  corrects v0.1.0-beta.3's note, which said the installer was known to build
  but not known to run — true when written, and now settled.
- Note that shortcuts arrive with `IconLocation` unset, so they inherit the
  icon from the `.exe`. That is worth knowing alongside the icon fix above.

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
