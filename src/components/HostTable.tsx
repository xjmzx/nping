import { ChevronDown, ChevronUp, RefreshCw, Trash2 } from "lucide-react";
import { cn } from "../lib/cn";
import {
  active,
  agoText,
  costText,
  hostStatuses,
  renewalDays,
  renewalStatus,
  renewalText,
  specsLine,
  type HostRow,
  type StoredResult,
} from "../lib/hosts";
import type { SortDir } from "../lib/relays";
import type { Status } from "./StatusDot";
import { StatusDot } from "./StatusDot";

export type HostSortKey = "status" | "name" | "host" | "checked" | "renewal" | "cost";

export interface HostItem {
  row: HostRow;
  result?: StoredResult;
  checking: boolean;
  status: Status;
}

const STATUS_RANK: Record<string, number> = { fail: 0, warn: 1, ok: 2 };

/** The value a row sorts by; null (no data) always sorts last. */
export function hostSortValue(
  key: HostSortKey,
  it: HostItem,
  now: number,
): string | number | null {
  switch (key) {
    case "status":
      return STATUS_RANK[it.status] ?? null;
    case "name":
      return (it.row.name || it.row.host).toLowerCase() || null;
    case "host":
      return it.row.host.toLowerCase() || null;
    case "checked":
      // Ascending = stalest first: the host most in need of a re-check.
      return it.result?.at ?? null;
    case "renewal":
      return renewalDays(it.row.notes.renewal, now);
    case "cost": {
      const n = Number(it.row.notes.cost);
      return it.row.notes.cost.trim() && Number.isFinite(n) ? n : null;
    }
  }
}

// Below lg the secondary columns drop out so name, host, checks and renewal
// keep their room at the default 720px window; the expanded card shows all.
const WIDE = "hidden lg:table-cell";

const COLUMNS: { key: HostSortKey | null; label: string; className: string }[] = [
  { key: "status", label: "", className: "w-9" },
  { key: "name", label: "Name", className: "w-24 text-left" },
  { key: "host", label: "Host", className: "w-36 text-left" },
  { key: null, label: "Checks", className: "text-left" },
  { key: null, label: "Specs", className: `text-left ${WIDE}` },
  { key: "checked", label: "Checked", className: `w-24 text-right ${WIDE}` },
  { key: "renewal", label: "Renewal", className: "w-24 text-right" },
  { key: "cost", label: "Cost / yr", className: `w-24 text-right ${WIDE}` },
];

const CHECK_LABELS: [keyof ReturnType<typeof active>, string][] = [
  ["icmp", "Ping"],
  ["ports", "Ports"],
  ["tls", "TLS"],
  ["http", "HTTP"],
  ["relay", "Relay"],
  ["lnd", "LND"],
];

/** One line per host: every enabled check as a coloured pip, the specs line,
 *  when it was last checked, and the renewal countdown. A row click expands
 *  the full card underneath, which is also where the host is edited. */
export function HostTable({
  items,
  sortKey,
  sortDir,
  onSort,
  expandedId,
  onToggle,
  onCheck,
  onRemove,
  renderCard,
  now,
  wide,
}: {
  items: HostItem[];
  sortKey: HostSortKey | null;
  sortDir: SortDir;
  onSort: (key: HostSortKey) => void;
  expandedId: string | null;
  onToggle: (id: string) => void;
  onCheck: (id: string) => void;
  onRemove: (id: string) => void;
  renderCard: (id: string) => React.ReactNode;
  now: number;
  /** At lg and up; must agree with WIDE so the expanded row spans exactly the
   *  visible columns. */
  wide: boolean;
}) {
  // Visible columns + the actions column; below lg the three WIDE ones hide.
  const span = wide ? COLUMNS.length + 1 : COLUMNS.length - 3 + 1;
  return (
    <table className="w-full table-fixed text-sm border-separate border-spacing-0">
      {/* bg on the cells too: with border-separate the thead's own
          background doesn't paint behind them, and rows show through. */}
      <thead className="sticky top-0 z-10 bg-bg [&_th]:bg-bg">
        <tr className="text-xs text-muted">
          {COLUMNS.map((c) => (
            <th
              key={c.label || "status"}
              className={cn("font-normal py-2 px-2 border-b border-surface/60", c.className)}
            >
              {c.key ? (
                <button
                  onClick={() => onSort(c.key!)}
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
              ) : (
                c.label
              )}
            </th>
          ))}
          <th className="w-20 py-2 px-2 border-b border-surface/60" />
        </tr>
      </thead>
      <tbody>
        {items.map((it) => (
          <Row
            key={it.row.id}
            it={it}
            open={expandedId === it.row.id}
            span={span}
            now={now}
            onToggle={() => onToggle(it.row.id)}
            onCheck={() => onCheck(it.row.id)}
            onRemove={() => onRemove(it.row.id)}
            card={expandedId === it.row.id ? renderCard(it.row.id) : null}
          />
        ))}
      </tbody>
    </table>
  );
}

function Row({
  it,
  open,
  span,
  now,
  onToggle,
  onCheck,
  onRemove,
  card,
}: {
  it: HostItem;
  open: boolean;
  span: number;
  now: number;
  onToggle: () => void;
  onCheck: () => void;
  onRemove: () => void;
  card: React.ReactNode;
}) {
  const { row, result } = it;
  const cell = "py-1.5 px-2 border-b border-surface/40 truncate";
  const dash = <span className="text-muted/50">—</span>;
  const on = active(row);
  const st = result && !it.checking ? hostStatuses(result.probe, result.relay, row) : null;
  const specs = specsLine(row.notes);
  const cost = costText(row.notes);
  const days = renewalDays(row.notes.renewal, now);
  const rs = renewalStatus(days);

  const checkStatus = (k: (typeof CHECK_LABELS)[number][0]): Status => {
    if (it.checking) return "checking";
    if (!st) return "idle";
    if (k === "ports") return st.tcp.includes("fail") ? "fail" : st.tcp.length ? "ok" : "idle";
    return st[k];
  };

  return (
    <>
      <tr
        onClick={onToggle}
        className={cn("cursor-pointer hover:bg-fg/[0.03]", open && "bg-fg/[0.03]")}
      >
        <td className={cn(cell, "text-center")}>
          <StatusDot status={it.status} size={10} />
        </td>
        <td className={cn(cell, "text-fg")} title={row.name}>
          {row.name || dash}
        </td>
        <td className={cn(cell, "font-mono text-[13px] text-fg/80")} title={row.host}>
          {row.host || <span className="text-muted/50">(empty)</span>}
        </td>
        <td
          className={cell}
          title={CHECK_LABELS.filter(([k]) => on[k])
            .map(([k, label]) => `${label}: ${checkStatus(k)}`)
            .join("\n")}
        >
          <div className="flex items-center gap-2 overflow-hidden">
            {st?.dns === "fail" && (
              <span className="inline-flex items-center gap-1 text-xs text-alert">
                <StatusDot status="fail" size={6} />
                DNS
              </span>
            )}
            {CHECK_LABELS.filter(([k]) => on[k]).map(([k, label]) => {
              const s = checkStatus(k);
              return (
                <span
                  key={k}
                  className={cn(
                    "inline-flex items-center gap-1 text-xs",
                    s === "fail" ? "text-alert" : s === "warn" ? "text-warn" : "text-muted",
                  )}
                >
                  <StatusDot status={s} size={6} />
                  {label}
                </span>
              );
            })}
          </div>
        </td>
        <td className={cn(cell, WIDE, "text-xs text-muted")} title={specs}>
          {specs || dash}
        </td>
        <td
          className={cn(cell, WIDE, "text-right text-xs text-muted tabular-nums")}
          title={result ? new Date(result.at).toLocaleString() : undefined}
        >
          {it.checking ? "…" : result ? agoText(result.at, now) : dash}
        </td>
        <td
          className={cn(
            cell,
            "text-right text-xs tabular-nums",
            rs === "fail" ? "text-alert" : rs === "warn" ? "text-warn" : "text-muted",
          )}
          title={row.notes.renewal.trim() ? `renews ${row.notes.renewal.trim()}` : undefined}
        >
          {days != null ? renewalText(days) : row.notes.renewal.trim() || dash}
        </td>
        <td className={cn(cell, WIDE, "text-right text-xs text-muted tabular-nums")}>
          {cost ? cost.replace(" / yr", "") : dash}
        </td>
        <td className={cell} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-end gap-0.5">
            <button
              onClick={onCheck}
              disabled={it.checking || row.host.trim() === ""}
              title="Check this host"
              className="p-1 rounded-md text-muted hover:text-accent hover:bg-fg/5 disabled:opacity-40 transition-colors"
            >
              <RefreshCw size={14} className={it.checking ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onRemove}
              title="Remove host"
              className="p-1 rounded-md text-muted hover:text-alert hover:bg-fg/5 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={span} className="p-2 pb-3 border-b border-surface/40">
            {card}
          </td>
        </tr>
      )}
    </>
  );
}
