import { ChevronDown, ChevronUp, Coins, Copy, Lock, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "../lib/cn";
import { shortError, type SortDir, type SortKey } from "../lib/relays";
import type { RelayProbe } from "../lib/tauri";
import { RelayCard, prettySoftware } from "./RelayCard";
import { StatusDot, type Status } from "./StatusDot";

export interface TableItem {
  id: string;
  url: string;
  probe?: RelayProbe;
  checking: boolean;
  status: Status;
  dup: boolean;
}

interface Props {
  items: TableItem[];
  sortKey: SortKey | null;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  expandedId: string | null;
  onToggle: (id: string) => void;
  onChange: (id: string, url: string) => void;
  onPing: (id: string) => void;
  onRemove: (id: string) => void;
  /** At lg and up; must agree with WIDE so the expanded row spans exactly the
   *  visible columns (a colSpan over hidden ones adds phantom columns). */
  wide: boolean;
}

// Below lg the secondary columns drop out so the relay url keeps its room at
// the default 720px window; the expanded card still shows everything.
const WIDE = "hidden lg:table-cell";

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: "status", label: "", className: "w-9" },
  { key: "url", label: "Relay", className: "text-left" },
  { key: "connect", label: "Connect", className: "w-24 text-right" },
  { key: "eose", label: "EOSE", className: `w-24 text-right ${WIDE}` },
  { key: "events", label: "Events", className: `w-20 text-right ${WIDE}` },
  { key: "software", label: "Software", className: "w-40 lg:w-64 text-left" },
  { key: "nips", label: "NIPs", className: `w-16 text-right ${WIDE}` },
];

/** Compact one-line-per-relay view: sortable columns; a row click expands the
 *  full card underneath (which is also where the url is edited). */
export function RelayTable({
  items,
  sortKey,
  sortDir,
  onSort,
  expandedId,
  onToggle,
  onChange,
  onPing,
  onRemove,
  wide,
}: Props) {
  const span = wide ? COLUMNS.length + 2 : COLUMNS.length - 1;
  return (
    <table className="w-full table-fixed text-sm border-separate border-spacing-0">
      <thead className="sticky top-0 z-10 bg-bg">
        <tr className="text-xs text-muted">
          {COLUMNS.map((c) => (
            <th key={c.key} className={cn("font-normal py-2 px-2 border-b border-surface/60", c.className)}>
              <button
                onClick={() => onSort(c.key)}
                title={c.key === "status" ? "Sort by status" : `Sort by ${c.label.toLowerCase()}`}
                className={cn(
                  "inline-flex items-center gap-0.5 hover:text-fg transition-colors",
                  sortKey === c.key && "text-fg",
                )}
              >
                {c.key === "status" ? <StatusDot status="idle" size={8} /> : c.label}
                {sortKey === c.key &&
                  (sortDir === "asc" ? <ChevronUp size={13} /> : <ChevronDown size={13} />)}
              </button>
            </th>
          ))}
          <th className="w-16 lg:w-24 py-2 px-2 border-b border-surface/60 font-normal text-left">Flags</th>
          <th className="w-20 py-2 px-2 border-b border-surface/60" />
        </tr>
      </thead>
      <tbody>
        {items.map((it) => {
          const open = expandedId === it.id;
          return (
            <Row
              key={it.id}
              it={it}
              open={open}
              span={span}
              onToggle={() => onToggle(it.id)}
              onChange={(url) => onChange(it.id, url)}
              onPing={() => onPing(it.id)}
              onRemove={() => onRemove(it.id)}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function Row({
  it,
  open,
  span,
  onToggle,
  onChange,
  onPing,
  onRemove,
}: {
  it: TableItem;
  open: boolean;
  span: number;
  onToggle: () => void;
  onChange: (url: string) => void;
  onPing: () => void;
  onRemove: () => void;
}) {
  const p = it.probe;
  const pending = it.checking && !p;
  const cell = "py-1.5 px-2 border-b border-surface/40 truncate";
  const dash = <span className="text-muted/50">—</span>;

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn("cursor-pointer hover:bg-fg/[0.03]", open && "bg-fg/[0.03]")}
      >
        <td className={cn(cell, "text-center")}>
          <StatusDot status={it.status} size={10} />
        </td>
        <td className={cn(cell, "font-mono text-[13px] text-fg")} title={it.url}>
          {it.url || <span className="text-muted/50">(empty)</span>}
        </td>
        <td className={cn(cell, "text-right font-mono text-xs tabular-nums")}>
          {pending ? (
            "…"
          ) : p?.connectOk ? (
            `${p.connectMs} ms`
          ) : p?.connectError ? (
            <span className="text-alert" title={p.connectError}>
              {shortError(p.connectError)}
            </span>
          ) : (
            dash
          )}
        </td>
        <td className={cn(cell, WIDE, "text-right font-mono text-xs tabular-nums")}>
          {pending ? (
            "…"
          ) : p?.reqEose ? (
            `${p.reqMs} ms`
          ) : p?.reqError ? (
            <span className="text-warn" title={p.reqError}>
              {shortError(p.reqError)}
            </span>
          ) : (
            dash
          )}
        </td>
        <td className={cn(cell, WIDE, "text-right font-mono text-xs tabular-nums text-muted")}>
          {p?.reqEose ? p.reqEvents : dash}
        </td>
        <td className={cn(cell, "font-mono text-xs")}>
          {p?.info?.software ? (
            <span title={p.info.description ?? undefined}>
              {prettySoftware(p.info.software)}
              {p.info.version && <span className="text-muted"> {p.info.version}</span>}
            </span>
          ) : p?.info?.name ? (
            <span>{p.info.name}</span>
          ) : p?.infoError ? (
            <span className="text-muted" title={p.infoError}>
              {shortError(p.infoError)}
            </span>
          ) : (
            dash
          )}
        </td>
        <td
          className={cn(cell, WIDE, "text-right font-mono text-xs tabular-nums text-muted")}
          title={p?.info?.supportedNips.join(", ")}
        >
          {p?.info ? p.info.supportedNips.length : dash}
        </td>
        <td className={cell}>
          <div className="flex items-center gap-1.5">
            {p?.info?.paymentRequired && (
              <span title="payment required" className="text-warn">
                <Coins size={13} />
              </span>
            )}
            {p?.info?.authRequired && (
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
        </td>
        <td className={cn(cell, "text-right")} onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onPing}
            disabled={it.checking || it.url.trim() === ""}
            title="Ping this relay"
            className="p-1 rounded-md text-muted hover:text-accent hover:bg-fg/5 disabled:opacity-40 transition-colors"
          >
            <RefreshCw size={14} className={it.checking ? "animate-spin" : ""} />
          </button>
          <button
            onClick={onRemove}
            title="Remove relay"
            className="p-1 rounded-md text-muted hover:text-alert hover:bg-fg/5 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={span} className="p-2 pb-3 border-b border-surface/40">
            <RelayCard
              url={it.url}
              probe={it.probe}
              checking={it.checking}
              onChange={onChange}
              onPing={onPing}
              onRemove={onRemove}
            />
          </td>
        </tr>
      )}
    </>
  );
}
