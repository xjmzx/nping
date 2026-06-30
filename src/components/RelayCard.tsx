import { Plug, Radio, Info, RefreshCw, Trash2, Lock, Coins } from "lucide-react";
import { cn } from "../lib/cn";
import { StatusDot, type Status } from "./StatusDot";
import type { RelayProbe } from "../lib/tauri";

interface Props {
  url: string;
  probe?: RelayProbe;
  checking: boolean;
  onChange: (url: string) => void;
  onPing: () => void;
  onRemove: () => void;
}

function overallStatus(probe: RelayProbe | undefined, checking: boolean): Status {
  if (checking) return "checking";
  if (!probe) return "idle";
  if (!probe.connectOk) return "fail";
  if (!probe.reqEose) return "warn";
  return "ok";
}

function StageRow({
  icon,
  label,
  status,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  status: Status;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2.5">
      <StatusDot status={status} size={8} className="translate-y-[1px]" />
      <span className="flex items-center gap-1.5 w-24 shrink-0 text-muted">
        <span className="text-muted/70">{icon}</span>
        {label}
      </span>
      <div className="flex-1 min-w-0 text-fg/80">{children}</div>
    </div>
  );
}

export function RelayCard({ url, probe, checking, onChange, onPing, onRemove }: Props) {
  const overall = overallStatus(probe, checking);

  const connectStatus: Status = checking
    ? "checking"
    : !probe
      ? "idle"
      : probe.connectOk
        ? "ok"
        : "fail";

  const reqStatus: Status = checking
    ? "checking"
    : !probe
      ? "idle"
      : !probe.connectOk
        ? "idle"
        : probe.reqEose
          ? "ok"
          : "warn";

  const infoStatus: Status = checking
    ? "checking"
    : !probe
      ? "idle"
      : probe.info
        ? "ok"
        : probe.infoError
          ? "warn"
          : "idle";

  const expanded = checking || !!probe;

  return (
    <div className="rounded-xl bg-panel border border-surface/60 shadow-md p-3.5 flex flex-col gap-3">
      {/* header: status + editable url + actions */}
      <div className="flex items-center gap-2.5">
        <StatusDot status={overall} size={12} />
        <input
          value={url}
          spellCheck={false}
          placeholder="wss://relay.example.com"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onPing();
          }}
          className={cn(
            "flex-1 min-w-0 bg-transparent font-mono text-sm text-fg",
            "border-b border-transparent focus:border-accent/50 focus:outline-none",
            "placeholder:text-muted/50 py-0.5",
          )}
        />
        {probe && probe.connectMs != null && !checking && (
          <span className="font-mono text-xs text-muted tabular-nums shrink-0">
            {probe.connectMs} ms
          </span>
        )}
        <button
          onClick={onPing}
          disabled={checking || url.trim() === ""}
          title="Ping this relay"
          className="p-1.5 rounded-md text-muted hover:text-accent hover:bg-fg/5 disabled:opacity-40 transition-colors"
        >
          <RefreshCw size={15} className={checking ? "animate-spin" : ""} />
        </button>
        <button
          onClick={onRemove}
          title="Remove relay"
          className="p-1.5 rounded-md text-muted hover:text-alert hover:bg-fg/5 transition-colors"
        >
          <Trash2 size={15} />
        </button>
      </div>

      {/* diagnostics */}
      {expanded && (
        <div className="flex flex-col gap-2 text-sm pl-0.5">
          <StageRow icon={<Plug size={13} />} label="Connect" status={connectStatus}>
            {checking && !probe ? (
              <span className="text-muted">Connecting…</span>
            ) : probe?.connectOk ? (
              <span>
                Open
                {probe.connectMs != null && (
                  <span className="text-muted">
                    {" "}
                    · {probe.connectMs} ms
                  </span>
                )}
              </span>
            ) : probe?.connectError ? (
              <span className="text-alert font-mono text-xs break-all">
                {probe.connectError}
              </span>
            ) : (
              <span className="text-muted">—</span>
            )}
          </StageRow>

          <StageRow icon={<Radio size={13} />} label="Subscribe" status={reqStatus}>
            {checking && !probe ? (
              <span className="text-muted">Waiting for EOSE…</span>
            ) : !probe?.connectOk ? (
              <span className="text-muted">—</span>
            ) : probe.reqEose ? (
              <span>
                EOSE
                <span className="text-muted">
                  {" "}
                  · {probe.reqMs} ms · {probe.reqEvents}{" "}
                  {probe.reqEvents === 1 ? "event" : "events"}
                </span>
              </span>
            ) : probe.reqError ? (
              <span className="text-warn font-mono text-xs break-all">
                {probe.reqError}
              </span>
            ) : (
              <span className="text-muted">—</span>
            )}
          </StageRow>

          <StageRow icon={<Info size={13} />} label="Info (NIP-11)" status={infoStatus}>
            {checking && !probe ? (
              <span className="text-muted">Fetching…</span>
            ) : probe?.info ? (
              <span>
                {probe.info.software ? (
                  <span className="font-mono text-xs">
                    {prettySoftware(probe.info.software)}
                    {probe.info.version ? ` ${probe.info.version}` : ""}
                  </span>
                ) : probe.info.name ? (
                  <span>{probe.info.name}</span>
                ) : (
                  <span className="text-muted">document available</span>
                )}
              </span>
            ) : probe?.infoError ? (
              <span className="text-muted font-mono text-xs break-all">
                {probe.infoError}
              </span>
            ) : (
              <span className="text-muted">—</span>
            )}
          </StageRow>

          {/* NIP-11 detail: supported NIPs + limitation badges */}
          {probe?.info && (
            <div className="pl-[34px] flex flex-col gap-2">
              {probe.info.description && (
                <p className="text-xs text-muted leading-snug">
                  {probe.info.description}
                </p>
              )}
              {(probe.info.paymentRequired || probe.info.authRequired) && (
                <div className="flex flex-wrap gap-1.5">
                  {probe.info.paymentRequired && (
                    <Badge tone="warn" icon={<Coins size={11} />}>
                      payment required
                    </Badge>
                  )}
                  {probe.info.authRequired && (
                    <Badge tone="mauve" icon={<Lock size={11} />}>
                      auth required
                    </Badge>
                  )}
                </div>
              )}
              {probe.info.supportedNips.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {probe.info.supportedNips.map((n) => (
                    <span
                      key={n}
                      title={`NIP-${pad2(n)}`}
                      className="font-mono text-[10px] leading-none px-1.5 py-1 rounded bg-surface text-muted"
                    >
                      {pad2(n)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* a NOTICE the relay sent during the subscription */}
          {probe?.notice && (
            <div className="pl-[34px] text-xs text-warn/90 break-words">
              NOTICE: {probe.notice}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Badge({
  tone,
  icon,
  children,
}: {
  tone: "warn" | "mauve";
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border",
        tone === "warn"
          ? "border-warn/40 text-warn"
          : "border-mauve/40 text-mauve",
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// Relay software is often reported as a repo URL — show just the tail.
function prettySoftware(s: string): string {
  const cleaned = s.replace(/^https?:\/\//, "").replace(/\.git$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}
