import { Coins, Copy, Lock } from "lucide-react";
import { shortError, type SortKey } from "../lib/relays";
import type { RelayProbe } from "../lib/tauri";
import { prettySoftware } from "./RelayCard";
import { StatusDot, type Status } from "./StatusDot";
import type { Column } from "./DataTable";
import { DASH } from "./DataTable";

export interface RelayItem {
  id: string;
  url: string;
  probe?: RelayProbe;
  checking: boolean;
  status: Status;
  dup: boolean;
  /** When `probe` was taken (epoch ms). */
  checkedAt?: number;
}

const ms = (n: number | null) => <span className="font-mono text-xs tabular-nums">{n} ms</span>;

/** The relay list's columns. The relay column is the wide one: the url, then
 *  the relay's own description in the space after it. */
export const RELAY_COLUMNS: Column<RelayItem, SortKey>[] = [
  {
    id: "status",
    sort: "status",
    className: "w-9 text-center",
    cell: (it) => <StatusDot status={it.status} size={10} />,
  },
  {
    id: "url",
    label: "Relay",
    sort: "url",
    className: "text-left",
    title: (it) => [it.url, it.probe?.info?.description].filter(Boolean).join("\n"),
    cell: (it) =>
      it.url ? (
        <>
          <span className="font-mono text-[13px] text-fg">{it.url}</span>
          {it.probe?.info?.description && (
            <span className="ml-3 text-xs text-muted">{it.probe.info.description}</span>
          )}
        </>
      ) : (
        <span className="text-muted/50">(empty)</span>
      ),
  },
  {
    id: "connect",
    label: "Connect",
    sort: "connect",
    className: "w-24 text-right",
    cell: ({ checking, probe: p }) =>
      checking && !p ? "…" : p?.connectOk ? ms(p.connectMs) : p?.connectError ? (
        <span className="text-alert text-xs" title={p.connectError}>
          {shortError(p.connectError)}
        </span>
      ) : (
        DASH
      ),
  },
  {
    id: "eose",
    label: "REQ",
    sort: "eose",
    className: "w-24 text-right",
    secondary: true,
    cell: ({ checking, probe: p }) =>
      checking && !p ? "…" : p?.reqEose ? ms(p.reqMs) : p?.reqError ? (
        <span className="text-warn text-xs" title={p.reqError}>
          {shortError(p.reqError)}
        </span>
      ) : (
        DASH
      ),
  },
  {
    id: "events",
    label: "Events",
    sort: "events",
    className: "w-20 text-right",
    secondary: true,
    cell: ({ probe: p }) =>
      p?.reqEose ? <span className="font-mono text-xs tabular-nums text-muted">{p.reqEvents}</span> : DASH,
  },
  {
    id: "software",
    label: "Software",
    sort: "software",
    className: "w-40 lg:w-56 text-left",
    cell: ({ probe: p }) =>
      p?.info?.software ? (
        <span className="font-mono text-xs">
          {prettySoftware(p.info.software)}
          {p.info.version && <span className="text-muted"> {p.info.version}</span>}
        </span>
      ) : p?.info?.name ? (
        <span className="text-xs">{p.info.name}</span>
      ) : p?.infoError ? (
        <span className="text-muted text-xs" title={p.infoError}>
          {shortError(p.infoError)}
        </span>
      ) : (
        DASH
      ),
  },
  {
    id: "nips",
    label: "NIPs",
    sort: "nips",
    className: "w-16 text-right",
    secondary: true,
    title: (it) => it.probe?.info?.supportedNips.join(", "),
    cell: ({ probe: p }) =>
      p?.info ? (
        <span className="font-mono text-xs tabular-nums text-muted">{p.info.supportedNips.length}</span>
      ) : (
        DASH
      ),
  },
  {
    id: "flags",
    label: "Flags",
    className: "w-20 text-left",
    present: (items) => items.some(hasFlags),
    cell: (it) => (
      <div className="flex items-center gap-1.5">
        {it.probe?.info?.paymentRequired && (
          <span title="payment required" className="text-warn">
            <Coins size={13} />
          </span>
        )}
        {it.probe?.info?.authRequired && (
          <span title="auth required" className="text-mauve">
            <Lock size={13} />
          </span>
        )}
        {it.dup && (
          <span
            title="Duplicate: this relay is in the list more than once"
            className="inline-flex items-center gap-0.5 text-[10px] text-warn"
          >
            <Copy size={11} />
            dup
          </span>
        )}
      </div>
    ),
  },
];

function hasFlags(it: RelayItem): boolean {
  return !!(it.probe?.info?.paymentRequired || it.probe?.info?.authRequired || it.dup);
}
