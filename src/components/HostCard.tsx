import {
  Globe,
  Activity,
  Network,
  ShieldCheck,
  Radio,
  Zap,
  SlidersHorizontal,
  FileText,
  Cpu,
  CalendarClock,
} from "lucide-react";
import { cn } from "../lib/cn";
import type { Status } from "./StatusDot";
import { Card, CardHeader, CheckedAt, Checks, ErrorText, IconButton, RowActions, StageRow } from "./Card";
import { shortError } from "../lib/relays";
import {
  certStatus,
  dateText,
  daysText,
  hostStatuses,
  active,
  CHECKS,
  parsePortRules,
  formatPortRules,
  portPasses,
  shortIssuer,
  hasNotes,
  shownName,
  specsLine,
  costText,
  renewalDays,
  renewalStatus,
  renewalText,
  type HostFields,
  type HostNotes,
} from "../lib/hosts";
import type { CertInfo, HostProbe, RelayProbe } from "../lib/tauri";

interface Props {
  row: HostFields;
  probe?: HostProbe;
  relay?: RelayProbe;
  checking: boolean;
  /** When `probe` was taken (epoch ms), and the clock to show its age by. */
  checkedAt?: number;
  now: number;
  editing: boolean;
  onChange: (patch: Partial<HostFields>) => void;
  onCheck: () => void;
  onEdit: () => void;
  onRemove: () => void;
}

export function hostOverall(
  probe: HostProbe | undefined,
  relay: RelayProbe | undefined,
  checking: boolean,
  row: HostFields,
): Status {
  if (checking) return "checking";
  if (!probe) return "idle";
  return hostStatuses(probe, relay, row).overall;
}

export function HostCard({
  row,
  probe,
  relay,
  checking,
  checkedAt,
  now,
  editing,
  onChange,
  onCheck,
  onEdit,
  onRemove,
}: Props) {
  const st = probe && !checking ? hostStatuses(probe, relay, row) : null;
  const overall = hostOverall(probe, relay, checking, row);
  const on = active(row);
  const s = (k: Exclude<keyof NonNullable<typeof st>, "tcp" | "overall">): Status =>
    checking ? "checking" : (st?.[k] ?? "idle");

  const rules = parsePortRules(row.ports);
  const name = shownName(row);
  const shown = checking || !!probe;

  return (
    <Card>
      {/* The name, then the address in grey — or the address alone. Both are
          edited in the editor (sliders), with the checks. */}
      <CardHeader
        status={overall}
        actions={
          <>
            <IconButton onClick={onEdit} title="Edit this host and its checks" active={editing}>
              <SlidersHorizontal size={15} />
            </IconButton>
            <RowActions
              checking={checking}
              disabled={row.host.trim() === ""}
              what="host"
              onCheck={onCheck}
              onRemove={onRemove}
            />
          </>
        }
      >
        {name && <span className="shrink-0 text-sm font-medium text-fg">{name}</span>}
        <span
          className={cn("min-w-0 truncate font-mono text-sm", name ? "text-muted" : "text-fg")}
          title={row.host}
        >
          {row.host || <span className="text-muted/50">new host</span>}
        </span>
      </CardHeader>

      {editing && <Editor row={row} onChange={onChange} onCheck={onCheck} />}

      {!editing && hasNotes(row.notes) && <NotesSummary notes={row.notes} now={now} />}

      {probe?.error && !checking && (
        <div className="text-xs font-mono text-alert pl-0.5">{probe.error}</div>
      )}

      {shown && !probe?.error && (
        <Checks>
          <StageRow icon={<Globe size={13} />} label="DNS" status={s("dns")}>
            {checking ? (
              <span className="text-muted">Resolving…</span>
            ) : probe?.dns?.ok ? (
              <span title={probe.dns.addrs.join("\n")} className="block truncate">
                <span className="font-mono text-xs">{probe.dns.addrs.join("  ")}</span>
                <span className="text-muted">
                  {probe.dns.literal ? " · IP address" : probe.dns.ms != null ? ` · ${probe.dns.ms} ms` : ""}
                </span>
              </span>
            ) : (
              <ErrorText text={probe?.dns?.error} tone="alert" />
            )}
          </StageRow>

          {on.icmp && (
            <StageRow icon={<Activity size={13} />} label="Ping" status={s("icmp")}>
              {checking ? (
                <span className="text-muted">Pinging…</span>
              ) : probe?.icmp?.ok ? (
                <span>
                  {probe.icmp.avgMs != null ? `${Math.round(probe.icmp.avgMs)} ms` : "replied"}
                  <span className="text-muted">
                    {" "}
                    · {probe.icmp.received}/{probe.icmp.sent} replies
                  </span>
                </span>
              ) : (
                <ErrorText text={probe?.icmp?.error} tone="warn" />
              )}
            </StageRow>
          )}

          {on.ports && (
            <StageRow icon={<Network size={13} />} label="Ports" status={checking ? "checking" : worstOf(st?.tcp)}>
              {checking ? (
                <span className="text-muted">Connecting…</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {probe?.tcp.map((t) => {
                    const rule = rules.find((r) => r.port === t.port);
                    if (!rule) return null; // removed since this result
                    const pass = portPasses(t, rule);
                    const closedRule = !!rule?.closed;
                    return (
                      <span
                        key={t.port}
                        title={
                          (closedRule ? "expected closed · " : "") +
                          (t.ok
                            ? `${t.addr} · open · ${t.ms} ms`
                            : `${t.addr ?? ""} · ${t.error ?? t.state}`)
                        }
                        className={cn(
                          "inline-flex items-center gap-1 font-mono text-[11px] leading-none px-1.5 py-1 rounded border",
                          pass ? "border-ok/30 text-fg/80" : "border-alert/40 text-alert",
                        )}
                      >
                        {closedRule ? `!${t.port}` : t.port}
                        <span className={pass ? "text-muted" : ""}>
                          {closedRule
                            ? t.ok
                              ? "OPEN"
                              : pass
                                ? "closed"
                                : t.state
                            : t.ok
                              ? `${t.ms}ms`
                              : t.state}
                        </span>
                      </span>
                    );
                  })}
                </div>
              )}
            </StageRow>
          )}

          {on.tls && (
            <StageRow icon={<ShieldCheck size={13} />} label="TLS" status={s("tls")}>
              {checking ? (
                <span className="text-muted">Handshaking…</span>
              ) : probe?.tls?.error ? (
                <ErrorText text={probe.tls.error} tone="alert" />
              ) : probe?.tls?.cert ? (
                <div className="flex flex-col gap-0.5 min-w-0">
                  <CertLine
                    cert={probe.tls.cert}
                    extra={probe.tls.name !== probe.host ? probe.tls.name : null}
                    protocol={probe.tls.protocol}
                  />
                  {probe.tls.verifyError && <ErrorText text={probe.tls.verifyError} tone="alert" />}
                </div>
              ) : (
                <span className="text-muted">—</span>
              )}
            </StageRow>
          )}

          {on.http && (
            <StageRow icon={<FileText size={13} />} label="HTTP" status={s("http")}>
              {checking ? (
                <span className="text-muted">Fetching…</span>
              ) : !probe?.http ? (
                <span className="text-muted">—</span>
              ) : !probe.http.responded ? (
                <ErrorText text={probe.http.error} tone="alert" />
              ) : (
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span
                    className="block truncate"
                    title={[
                      probe.http.url,
                      probe.http.finalUrl ? `→ ${probe.http.finalUrl}` : "",
                      probe.http.server ? `server  ${probe.http.server}` : "",
                      probe.http.contentType ? `type    ${probe.http.contentType}` : "",
                      `bytes   ${probe.http.bytes}`,
                    ]
                      .filter(Boolean)
                      .join("\n")}
                  >
                    <span
                      className={cn(
                        "font-mono text-xs",
                        st?.http === "fail" && probe.http.found !== false && "text-alert",
                        st?.http === "warn" && "text-warn",
                      )}
                    >
                      {probe.http.status}
                    </span>
                    <span className="text-muted">
                      {" "}
                      · {probe.http.ms} ms
                      {probe.http.finalUrl ? ` · → ${probe.http.finalUrl.replace(/^https?:\/\//, "")}` : ""}
                      {probe.http.server ? ` · ${probe.http.server}` : ""}
                    </span>
                  </span>
                  {probe.http.found != null && (
                    <span
                      className={cn(
                        "block break-words text-xs",
                        probe.http.found ? "text-muted" : "text-alert font-mono",
                      )}
                    >
                      {probe.http.found ? "contains" : "missing"} “{probe.http.expect}”
                    </span>
                  )}
                  {probe.http.error && <ErrorText text={probe.http.error} tone="warn" />}
                </div>
              )}
            </StageRow>
          )}

          {on.relay && (
            <StageRow icon={<Radio size={13} />} label="Relay" status={s("relay")}>
              {checking ? (
                <span className="text-muted">Subscribing…</span>
              ) : !relay ? (
                <span className="text-muted">—</span>
              ) : !relay.connectOk ? (
                <div className="flex flex-col gap-0.5 min-w-0">
                  <ErrorText text={relay.connectError} tone="alert" short />
                  <RelayHost url={row.relay} />
                </div>
              ) : relay.reqEose ? (
                // The relay's host first: if the line runs out of room, the
                // timings are what gets cut.
                <span
                  className="block truncate"
                  title={`${row.relay.trim()}\nconnect ${relay.connectMs} ms · REQ ${relay.reqMs} ms`}
                >
                  {relayHost(row.relay)}
                  <span className="text-muted">
                    {" "}
                    · EOSE · {relay.connectMs} ms · {relay.reqMs} ms
                  </span>
                </span>
              ) : (
                <div className="flex flex-col gap-0.5 min-w-0">
                  <ErrorText text={relay.reqError ?? relay.notice} tone="warn" short />
                  <RelayHost url={row.relay} />
                </div>
              )}
            </StageRow>
          )}

          {on.lnd && (
            <StageRow icon={<Zap size={13} />} label="LND" status={s("lnd")}>
              {checking ? (
                <span className="text-muted">Checking… (Tor takes a few seconds)</span>
              ) : probe?.lnd ? (
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="block break-words leading-snug">
                    {probe.lnd.p2p && (
                      <span
                        title={[
                          probe.lnd.p2p.addr,
                          probe.lnd.p2p.error,
                          !probe.lnd.p2p.ok && probe.lnd.onion?.ok
                            ? "Not reachable on clearnet, but open over Tor — peers can still connect."
                            : "",
                        ]
                          .filter(Boolean)
                          .join("\n")}
                        className={
                          probe.lnd.p2p.ok
                            ? ""
                            : probe.lnd.onion?.ok
                              ? "text-muted"
                              : "text-alert"
                        }
                      >
                        clearnet :{probe.lnd.p2p.port} {probe.lnd.p2p.ok ? "open" : probe.lnd.p2p.state}
                      </span>
                    )}
                    {probe.lnd.p2p && probe.lnd.onion && <span className="text-muted"> · </span>}
                    {probe.lnd.onion && (
                      <span
                        title={[probe.lnd.onion.addr, probe.lnd.onion.error].filter(Boolean).join("\n")}
                        className={
                          probe.lnd.onion.ok ? "" : probe.lnd.p2p?.ok ? "text-muted" : "text-alert"
                        }
                      >
                        onion {probe.lnd.onion.ok ? "open" : probe.lnd.onion.state}
                        {probe.lnd.onion.ok && probe.lnd.onion.ms != null && (
                          <span className="text-muted">
                            {" "}
                            · {(probe.lnd.onion.ms / 1000).toFixed(1)} s via Tor
                          </span>
                        )}
                      </span>
                    )}
                    {(probe.lnd.p2p || probe.lnd.onion) && probe.lnd.restPort != null && (
                      <span className="text-muted"> · </span>
                    )}
                    {probe.lnd.restPort != null &&
                      (probe.lnd.restOk ? (
                        <span className={probe.lnd.state === "SERVER_ACTIVE" ? "" : "text-warn"}>
                          <span className="font-mono text-xs">{probe.lnd.state}</span>
                          <span className="text-muted"> · {probe.lnd.restMs} ms</span>
                        </span>
                      ) : (
                        <span title={probe.lnd.restError ?? ""} className="text-alert font-mono text-xs">
                          REST {shortError(probe.lnd.restError ?? "failed")}
                        </span>
                      ))}
                  </span>
                  {probe.lnd.cert && <CertLine cert={probe.lnd.cert} selfSigned />}
                </div>
              ) : (
                <span className="text-muted">—</span>
              )}
            </StageRow>
          )}

          {!checking && checkedAt != null && <CheckedAt at={checkedAt} now={now} />}
        </Checks>
      )}
    </Card>
  );
}

function worstOf(xs: Status[] | undefined): Status {
  if (!xs || xs.length === 0) return "idle";
  return xs.includes("fail") ? "fail" : xs.includes("warn") ? "warn" : "ok";
}

/** The relay's host (and port, if any), so a url pointing at the wrong box is
 *  visible on the row: a healthy result alone can't tell you whose relay
 *  answered. */
function relayHost(url: string): string {
  const u = url.trim();
  try {
    return new URL(u).host || u;
  } catch {
    return u.replace(/^wss?:\/\//, "").replace(/\/.*$/, "");
  }
}

function RelayHost({ url }: { url: string }) {
  return (
    <span className="block truncate text-xs text-muted" title={url.trim()}>
      {relayHost(url)}
    </span>
  );
}

function CertLine({
  cert,
  extra,
  protocol,
  selfSigned,
}: {
  cert: CertInfo;
  extra?: string | null;
  /** On hover only: every host reports the same one, so on the line it only
   *  costs width. */
  protocol?: string | null;
  selfSigned?: boolean;
}) {
  const status = certStatus(cert);
  const tip = [
    `subject  ${cert.subject}`,
    `issuer   ${cert.issuer}`,
    `valid    ${dateText(cert.notBefore)} → ${dateText(cert.notAfter)}`,
    cert.sans.length ? `names    ${cert.sans.join(", ")}` : "",
    `sha256   ${cert.sha256}`,
    protocol ? `protocol ${protocol}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span title={tip} className="block break-words leading-snug">
      <span className={status === "fail" ? "text-alert" : status === "warn" ? "text-warn" : ""}>
        {daysText(cert.daysLeft)}
      </span>
      <span className="text-muted">
        {" "}
        · {dateText(cert.notAfter)} · {selfSigned ? "self-signed" : shortIssuer(cert.issuer)}
        {extra ? ` · ${extra}` : ""}
      </span>
    </span>
  );
}

function Editor({
  row,
  onChange,
  onCheck,
}: {
  row: HostFields;
  onChange: (patch: Partial<HostFields>) => void;
  onCheck: () => void;
}) {
  const field = (
    label: string,
    key:
      | "name"
      | "host"
      | "ports"
      | "tls"
      | "tlsName"
      | "relay"
      | "http"
      | "httpExpect"
      | "lndP2p"
      | "lndRest"
      | "lndOnion",
    placeholder: string,
    hint: string,
    wide?: boolean,
  ) => (
    <label className={cn("flex flex-col gap-1", wide && "col-span-2")} title={hint}>
      <span className="text-[11px] text-muted">{label}</span>
      <input
        value={row[key]}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange({ [key]: e.target.value })}
        onKeyDown={key === "host" ? (e) => e.key === "Enter" && onCheck() : undefined}
        autoFocus={key === "host" && row.host === ""}
        className={cn(
          "px-2 py-1 rounded bg-surface font-mono text-xs text-fg",
          "placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent/50",
        )}
      />
    </label>
  );
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-bg/40 p-2.5">
      {field("Name", "name", "optional", "A short name for the card and the list")}
      {field("Host", "host", "host.example.com or IP", "Hostname or IP address — Enter checks it")}
      {/* Check switches: off keeps the settings but skips the check and
          hides its row — for a service that isn't set up yet. */}
      <div className="col-span-2 flex flex-wrap gap-1.5 pb-1">
        {CHECKS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => onChange({ [key]: !row[key] })}
            title={row[key] ? `${label}: on — click to skip this check` : `${label}: off`}
            className={cn(
              "text-[11px] px-2 py-0.5 rounded-full border transition-colors",
              row[key]
                ? "border-accent/50 text-accent bg-accent/10"
                : "border-surface text-muted/70 hover:text-muted",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      {row.portsOn &&
        field(
          "TCP ports  ·  only these are checked  ·  !port = should be closed",
          "ports",
          "2121, 443, !22",
          "Comma-separated ports to connect to. Prefix with ! for a port that should be closed (refused or silent) — it fails if it's ever open.",
          true,
        )}
      {row.portsOn && <PortChips ports={row.ports} onChange={(ports) => onChange({ ports })} />}
      {row.tlsOn && field("TLS port", "tls", "443", "Handshake + certificate check")}
      {row.tlsOn &&
        field(
          "TLS name",
          "tlsName",
          "same as host",
          "Check the certificate against this domain — for a host entered as an IP",
        )}
      {row.httpOn &&
        field("HTTP(S) page", "http", "https://example.com/", "GET this url, following redirects", true)}
      {row.httpOn &&
        field("Page must contain", "httpExpect", "any text", "Fail unless the body contains this text (blank for any)", true)}
      {row.relayOn &&
        field("Nostr relay", "relay", "wss://relay.example.com", "Runs the relay check against this url", true)}
      {row.lndOn && field("LND p2p port", "lndP2p", "9735", "Lightning peer port — TCP reachability only")}
      {row.lndOn &&
        field(
          "LND REST port",
          "lndRest",
          "8080",
          "GET /v1/state — no macaroon needed. LND binds REST to localhost unless restlisten says otherwise.",
        )}
      {row.lndOn &&
        field(
          "LND onion (via local Tor)",
          "lndOnion",
          "pubkey@xyz.onion:9735",
          "Onion address, or paste the full URI from `lncli getinfo`. Dialled through Tor at 127.0.0.1:9050 — the outside view of a node whose clearnet ports are firewalled. Takes a few seconds.",
          true,
        )}
      <NotesEditor
        notes={row.notes}
        onChange={(patch) => onChange({ notes: { ...row.notes, ...patch } })}
      />
    </div>
  );
}

/** The parsed port list as chips: click the number to flip between "should
 *  be open" and "should be closed" (!), × to stop checking it. Writes back to
 *  the text field, which stays the source of truth. */
function PortChips({ ports, onChange }: { ports: string; onChange: (ports: string) => void }) {
  const rules = parsePortRules(ports);
  if (rules.length === 0) return null;
  const set = (next: typeof rules) => onChange(formatPortRules(next));
  return (
    <div className="col-span-2 -mt-1 flex flex-wrap gap-1.5">
      {rules.map((r, i) => (
        <span
          key={r.port}
          className={cn(
            "inline-flex items-center rounded border font-mono text-[11px] leading-none",
            r.closed ? "border-muted/40 text-muted" : "border-accent/40 text-fg/80",
          )}
        >
          <button
            onClick={() => set(rules.map((x, j) => (j === i ? { ...x, closed: !x.closed } : x)))}
            title={r.closed ? "Expected closed — click to expect open" : "Expected open — click to expect closed"}
            className="px-1.5 py-1 hover:text-fg"
          >
            {r.closed ? `!${r.port} closed` : `${r.port} open`}
          </button>
          <button
            onClick={() => set(rules.filter((_, j) => j !== i))}
            title={`Stop checking port ${r.port}`}
            className="pr-1.5 py-1 text-muted hover:text-alert"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/** The two notes lines on the card: specs, then cost + renewal countdown. */
function NotesSummary({ notes, now }: { notes: HostNotes; now: number }) {
  const specs = specsLine(notes);
  const cost = costText(notes);
  const days = renewalDays(notes.renewal, now);
  const rs = renewalStatus(days);
  return (
    <div className="flex flex-col gap-1 text-xs text-muted pl-0.5 border-t border-surface/60 pt-2.5">
      {specs && (
        <div className="flex items-baseline gap-2">
          <Cpu size={12} className="shrink-0 translate-y-[1px] text-muted/70" />
          <span className="break-words">{specs}</span>
        </div>
      )}
      {(cost || notes.renewal.trim()) && (
        <div className="flex items-baseline gap-2">
          <CalendarClock size={12} className="shrink-0 translate-y-[1px] text-muted/70" />
          <span className="break-words">
            {cost}
            {cost && notes.renewal.trim() && " · "}
            {notes.renewal.trim() &&
              (days == null ? (
                <span title="Use YYYY-MM-DD">renews {notes.renewal.trim()}</span>
              ) : (
                <>
                  renews {notes.renewal.trim()}{" "}
                  <span
                    className={cn(
                      rs === "fail" && "text-alert",
                      rs === "warn" && "text-warn",
                      rs === "ok" && "text-fg/70",
                    )}
                  >
                    ({renewalText(days)})
                  </span>
                </>
              ))}
          </span>
        </div>
      )}
    </div>
  );
}

function NotesEditor({
  notes,
  onChange,
}: {
  notes: HostNotes;
  onChange: (patch: Partial<HostNotes>) => void;
}) {
  const f = (label: string, key: keyof HostNotes, placeholder: string, wide?: boolean) => (
    <label className={cn("flex flex-col gap-1", wide && "col-span-2")}>
      <span className="text-[11px] text-muted">{label}</span>
      <input
        value={notes[key]}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => onChange({ [key]: e.target.value })}
        className={cn(
          "px-2 py-1 rounded bg-surface font-mono text-xs text-fg",
          "placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent/50",
        )}
      />
    </label>
  );
  const heading = (text: string) => (
    <div className="col-span-2 pt-2 mt-1 border-t border-surface/60 text-[11px] font-medium text-fg/70">
      {text}
    </div>
  );
  return (
    <>
      {heading("Specs")}
      {f("OS / version", "os", "Debian 12")}
      {f("Location", "location", "DE")}
      {f("Memory (MB)", "memoryMb", "2048")}
      {f("Cores", "cores", "2")}
      {f("Storage (GB)", "storageGb", "72")}
      {f("Traffic (GB / month)", "trafficGb", "4096")}
      {heading("Hosting")}
      {f("Currency", "currency", "EUR")}
      {f("Annual cost", "cost", "48")}
      {f("Renewal date", "renewal", "YYYY-MM-DD", true)}
    </>
  );
}
