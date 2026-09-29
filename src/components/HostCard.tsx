import {
  Globe,
  Activity,
  Network,
  ShieldCheck,
  Radio,
  Zap,
  RefreshCw,
  Trash2,
  SlidersHorizontal,
  FileText,
} from "lucide-react";
import { cn } from "../lib/cn";
import { StatusDot, type Status } from "./StatusDot";
import { StageRow } from "./RelayCard";
import { shortError } from "../lib/relays";
import {
  agoText,
  certStatus,
  clockText,
  dateText,
  daysText,
  hostStatuses,
  active,
  CHECKS,
  parsePortRules,
  formatPortRules,
  portPasses,
  shortIssuer,
  type HostFields,
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
  const shown = checking || !!probe;

  return (
    <div className="h-full rounded-xl bg-panel border border-surface/60 shadow-md p-3.5 flex flex-col gap-3">
      {/* header: status + name / host + actions */}
      <div className="flex items-center gap-2.5">
        <StatusDot status={overall} size={12} />
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <input
            value={row.name}
            spellCheck={false}
            placeholder="name"
            onChange={(e) => onChange({ name: e.target.value })}
            className={cn(
              "w-28 shrink-0 bg-transparent text-sm font-medium text-fg",
              "border-b border-transparent focus:border-accent/50 focus:outline-none",
              "placeholder:text-muted/50 py-0.5",
            )}
          />
          <input
            value={row.host}
            spellCheck={false}
            placeholder="host.example.com or IP"
            onChange={(e) => onChange({ host: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Enter") onCheck();
            }}
            className={cn(
              "flex-1 min-w-0 bg-transparent font-mono text-sm text-fg/80",
              "border-b border-transparent focus:border-accent/50 focus:outline-none",
              "placeholder:text-muted/50 py-0.5",
            )}
          />
        </div>
        <button
          onClick={onEdit}
          title="Checks for this host"
          className={cn(
            "p-1.5 rounded-md hover:bg-fg/5 transition-colors",
            editing ? "text-accent" : "text-muted hover:text-fg",
          )}
        >
          <SlidersHorizontal size={15} />
        </button>
        <button
          onClick={onCheck}
          disabled={checking || row.host.trim() === ""}
          title="Check this host"
          className="p-1.5 rounded-md text-muted hover:text-accent hover:bg-fg/5 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={15} className={checking ? "animate-spin" : ""} />
        </button>
        <button
          onClick={onRemove}
          title="Remove host"
          className="p-1.5 rounded-md text-muted hover:text-alert hover:bg-fg/5 transition-colors"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {editing && <Editor row={row} onChange={onChange} />}

      {probe?.error && !checking && (
        <div className="text-xs font-mono text-alert pl-0.5">{probe.error}</div>
      )}

      {shown && !probe?.error && (
        <div className="flex flex-col gap-2 text-sm pl-0.5">
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
                    extra={[probe.tls.protocol, probe.tls.name !== probe.host ? probe.tls.name : null]
                      .filter(Boolean)
                      .join(" · ")}
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
                <ErrorText text={relay.connectError} tone="alert" short />
              ) : relay.reqEose ? (
                <span>
                  EOSE
                  <span className="text-muted">
                    {" "}
                    · connect {relay.connectMs} ms · REQ {relay.reqMs} ms
                  </span>
                </span>
              ) : (
                <ErrorText text={relay.reqError ?? relay.notice} tone="warn" short />
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

          {!checking && checkedAt != null && (
            <div
              title={new Date(checkedAt).toLocaleString()}
              className="pl-[34px] text-[11px] text-muted/70"
            >
              checked {clockText(checkedAt)} · {agoText(checkedAt, now)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function worstOf(xs: Status[] | undefined): Status {
  if (!xs || xs.length === 0) return "idle";
  return xs.includes("fail") ? "fail" : xs.includes("warn") ? "warn" : "ok";
}

function ErrorText({
  text,
  tone,
  short,
}: {
  text: string | null | undefined;
  tone: "alert" | "warn";
  short?: boolean;
}) {
  if (!text) return <span className="text-muted">—</span>;
  // Wrapped, not truncated: the error is the point of the row.
  return (
    <span
      title={text}
      className={cn(
        "block break-words font-mono text-xs leading-snug",
        tone === "alert" ? "text-alert" : "text-warn",
      )}
    >
      {short ? shortError(text) : text}
    </span>
  );
}

function CertLine({
  cert,
  extra,
  selfSigned,
}: {
  cert: CertInfo;
  extra?: string | null;
  selfSigned?: boolean;
}) {
  const status = certStatus(cert);
  const tip = [
    `subject  ${cert.subject}`,
    `issuer   ${cert.issuer}`,
    `valid    ${dateText(cert.notBefore)} → ${dateText(cert.notAfter)}`,
    cert.sans.length ? `names    ${cert.sans.join(", ")}` : "",
    `sha256   ${cert.sha256}`,
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
}: {
  row: HostFields;
  onChange: (patch: Partial<HostFields>) => void;
}) {
  const field = (
    label: string,
    key:
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
        className={cn(
          "px-2 py-1 rounded bg-surface font-mono text-xs text-fg",
          "placeholder:text-muted/50 focus:outline-none focus:ring-1 focus:ring-accent/50",
        )}
      />
    </label>
  );
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-bg/40 p-2.5">
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
