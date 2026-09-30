// The list view, for relays and hosts alike: sortable columns, one line per
// item, and a row click that opens the item's full card underneath (which is
// also where it's edited). Each section only describes its columns.

import { Fragment, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../lib/cn";
import type { SortDir } from "../lib/relays";
import { StatusDot } from "./StatusDot";

export interface Column<T, K extends string> {
  id: string;
  /** Header text; the status column passes none and gets a dot. */
  label?: string;
  /** Sortable by this key. */
  sort?: K;
  /** Width and alignment, for the header and the cells. No width = shares
   *  what's left with the other unsized columns. */
  className: string;
  /** Dropped below lg, where the window is too narrow for it. */
  secondary?: boolean;
  /** Shown only when some row has something for it. */
  present?: (items: T[]) => boolean;
  /** Tooltip for the cell. */
  title?: (it: T) => string | undefined;
  cell: (it: T) => ReactNode;
}

export function DataTable<T, K extends string>({
  columns,
  items,
  id,
  sortKey,
  sortDir,
  onSort,
  expandedId,
  onToggle,
  wide,
  actions,
  expanded,
}: {
  columns: Column<T, K>[];
  items: T[];
  id: (it: T) => string;
  sortKey: K | null;
  sortDir: SortDir;
  onSort: (key: K) => void;
  expandedId: string | null;
  onToggle: (id: string) => void;
  /** lg and up. */
  wide: boolean;
  /** The last cell: per-row buttons. */
  actions: (it: T) => ReactNode;
  /** The full card, under an opened row. */
  expanded: (it: T) => ReactNode;
}) {
  // Columns are left out, not hidden, so the opened card's colSpan always
  // matches what's on screen.
  const cols = columns.filter((c) => (wide || !c.secondary) && (c.present?.(items) ?? true));
  const cell = "py-1.5 px-2 border-b border-surface/40 truncate";
  return (
    <table className="w-full table-fixed text-sm border-separate border-spacing-0">
      {/* bg on the cells too: with border-separate the thead's own
          background doesn't paint behind them, and rows show through. */}
      <thead className="sticky top-0 z-10 bg-bg [&_th]:bg-bg">
        <tr className="text-xs text-muted">
          {cols.map((c) => (
            <th key={c.id} className={cn("font-normal py-2 px-2 border-b border-surface/60", c.className)}>
              {c.sort ? (
                <button
                  onClick={() => onSort(c.sort!)}
                  title={c.label ? `Sort by ${c.label.toLowerCase()}` : "Sort by status"}
                  className={cn(
                    "inline-flex items-center gap-0.5 hover:text-fg transition-colors",
                    sortKey === c.sort && "text-fg",
                  )}
                >
                  {c.label ?? <StatusDot status="idle" size={8} />}
                  {sortKey === c.sort &&
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
        {items.map((it) => {
          const key = id(it);
          const open = expandedId === key;
          return (
            <Fragment key={key}>
              <tr
                onClick={() => onToggle(key)}
                className={cn("cursor-pointer hover:bg-fg/[0.03]", open && "bg-fg/[0.03]")}
              >
                {cols.map((c) => (
                  <td key={c.id} className={cn(cell, c.className)} title={c.title?.(it)}>
                    {c.cell(it)}
                  </td>
                ))}
                <td className={cell} onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-0.5">{actions(it)}</div>
                </td>
              </tr>
              {open && (
                <tr>
                  <td colSpan={cols.length + 1} className="p-2 pb-3 border-b border-surface/40">
                    {expanded(it)}
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </tbody>
    </table>
  );
}

/** An empty cell. */
export const DASH = <span className="text-muted/50">—</span>;
