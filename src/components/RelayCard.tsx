import { Plug, Radio, Info, Lock, Coins } from "lucide-react";
import { cn } from "../lib/cn";
import type { Status } from "./StatusDot";
import type { RelayProbe } from "../lib/tauri";
import { Card, CardHeader, CheckedAt, Checks, Detail, ErrorText, RowActions, StageRow } from "./Card";

interface Props {
  url: string;
  probe?: RelayProbe;
  checking: boolean;
  /** When `probe` was taken (epoch ms). */
  checkedAt?: number;
  now: number;
  onChange: (url: string) => void;
  onCheck: () => void;
  onRemove: () => void;
}

export function overallStatus(probe: RelayProbe | undefined, checking: boolean): Status {
  if (checking) return "checking";
  if (!probe) return "idle";
  if (!probe.connectOk) return "fail";
  if (!probe.reqEose) return "warn";
  return "ok";
}

export function RelayCard({ url, probe, checking, checkedAt, now, onChange, onCheck, onRemove }: Props) {
  const pending = checking && !probe;
  const step = (s: Status): Status => (checking ? "checking" : !probe ? "idle" : s);
  const connectStatus = step(probe?.connectOk ? "ok" : "fail");
  const reqStatus = step(!probe?.connectOk ? "idle" : probe.reqEose ? "ok" : "warn");
  const infoStatus = step(probe?.info ? "ok" : probe?.infoError ? "warn" : "idle");
  const info = probe?.info;

  return (
    <Card>
      <CardHeader
        status={overallStatus(probe, checking)}
        actions={
          <RowActions
            checking={checking}
            disabled={url.trim() === ""}
            what="relay"
            onCheck={onCheck}
            onRemove={onRemove}
          />
        }
      >
        <input
          value={url}
          spellCheck={false}
          placeholder="wss://relay.example.com"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCheck();
          }}
          className={cn(
            "flex-1 min-w-0 bg-transparent font-mono text-sm text-fg",
            "border-b border-transparent focus:border-accent/50 focus:outline-none",
            "placeholder:text-muted/50 py-0.5",
          )}
        />
      </CardHeader>

      {(checking || probe) && (
        <Checks>
          <StageRow icon={<Plug size={13} />} label="Connect" status={connectStatus}>
            {pending ? (
              <span className="text-muted">Connecting…</span>
            ) : probe?.connectOk ? (
              <span>
                Open<span className="text-muted"> · {probe.connectMs} ms</span>
              </span>
            ) : (
              <ErrorText text={probe?.connectError} tone="alert" />
            )}
          </StageRow>

          <StageRow icon={<Radio size={13} />} label="REQ" title="Subscribe (REQ) until EOSE" status={reqStatus}>
            {pending ? (
              <span className="text-muted">Waiting for EOSE…</span>
            ) : !probe?.connectOk ? (
              <span className="text-muted">—</span>
            ) : probe.reqEose ? (
              <span>
                EOSE
                <span className="text-muted">
                  {" "}
                  · {probe.reqMs} ms · {probe.reqEvents} {probe.reqEvents === 1 ? "event" : "events"}
                </span>
              </span>
            ) : (
              <ErrorText text={probe.reqError ?? probe.notice} tone="warn" />
            )}
          </StageRow>

          <StageRow icon={<Info size={13} />} label="Info" title="Relay information document (NIP-11)" status={infoStatus}>
            {pending ? (
              <span className="text-muted">Fetching…</span>
            ) : info ? (
              info.software ? (
                <span className="font-mono text-xs">
                  {prettySoftware(info.software)}
                  {info.version && <span className="text-muted"> {info.version}</span>}
                </span>
              ) : (
                <span>{info.name ?? <span className="text-muted">document available</span>}</span>
              )
            ) : (
              <ErrorText text={probe?.infoError} tone="muted" />
            )}
          </StageRow>

          {/* What the relay says about itself: its description, then any
              limits and the NIPs it supports, as one run of chips. */}
          {info && (info.description || info.supportedNips.length > 0 || info.paymentRequired || info.authRequired) && (
            <Detail className="flex flex-col gap-2">
              {info.description && (
                <p title={info.description} className="text-xs text-muted leading-snug line-clamp-2">
                  {info.description}
                </p>
              )}
              <div className="flex flex-wrap gap-1">
                {info.paymentRequired && (
                  <Badge tone="warn" icon={<Coins size={11} />}>
                    payment required
                  </Badge>
                )}
                {info.authRequired && (
                  <Badge tone="mauve" icon={<Lock size={11} />}>
                    auth required
                  </Badge>
                )}
                {info.supportedNips.map((n) => (
                  <span
                    key={n}
                    title={`NIP-${pad2(n)}`}
                    className="font-mono text-[10px] leading-none px-1.5 py-1 rounded bg-surface text-muted"
                  >
                    {pad2(n)}
                  </span>
                ))}
              </div>
            </Detail>
          )}

          {/* a NOTICE the relay sent during a subscription that otherwise worked */}
          {probe?.notice && probe.reqEose && (
            <Detail className="text-xs text-warn/90 truncate">
              <span title={probe.notice}>NOTICE: {probe.notice}</span>
            </Detail>
          )}

          {!checking && checkedAt != null && <CheckedAt at={checkedAt} now={now} />}
        </Checks>
      )}
    </Card>
  );
}

function Badge({ tone, icon, children }: { tone: "warn" | "mauve"; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[10px] leading-none px-1.5 py-0.5 rounded border",
        tone === "warn" ? "border-warn/40 text-warn" : "border-mauve/40 text-mauve",
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
export function prettySoftware(s: string): string {
  const cleaned = s.replace(/^https?:\/\//, "").replace(/\.git$/, "");
  const parts = cleaned.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : s;
}
