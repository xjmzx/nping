// The frame both sections sit in: header (brand, then controls), the
// scrolling main area, and the footer — plus the header controls they share.

import type { ReactNode } from "react";
import { FileInput, LayoutGrid, List, Plus, Zap } from "lucide-react";
import { cn } from "../lib/cn";
import type { Toast, View } from "../lib/ui";

export function Section({
  brand,
  controls,
  flushTop,
  footer,
  children,
}: {
  brand: ReactNode;
  controls: ReactNode;
  /** The list view: its sticky header must sit flush with the top of the
   *  scroller, so the top padding goes inside the list instead (padding on
   *  main sits above the sticky header, and rows show through the gap). */
  flushTop: boolean;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* One row, never wrapped: a button that wraps its label makes this
          section's header taller than the other's, and the brand jumps when
          you switch. Linux's text scaling (GNOME 1.25x) leaves the default
          720px window only 576 CSS px, so the controls shrink to icons below
          md instead of wrapping or scrolling sideways. */}
      <header className="flex items-center gap-3 px-4 md:px-5 py-4 border-b border-surface/60 whitespace-nowrap">
        {brand}
        <div className="ml-auto flex items-center gap-1.5 md:gap-2 shrink-0">{controls}</div>
      </header>
      <main className={cn("flex-1 overflow-y-auto px-5 pb-4", !flushTop && "pt-4")}>
        {flushTop ? <div className="max-w-[1880px] mx-auto pt-4">{children}</div> : children}
      </main>
      <footer className="px-5 py-2.5 border-t border-surface/60 text-xs text-muted flex items-center gap-4">
        {footer}
        <span className="ml-auto opacity-60 whitespace-nowrap hidden lg:inline">ndisc suite</span>
      </footer>
    </div>
  );
}

export function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  return (
    <div className="flex rounded-md bg-surface p-0.5">
      {(
        [
          ["cards", LayoutGrid, "Card view"],
          ["list", List, "List view — one line each"],
        ] as const
      ).map(([v, Icon, label]) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          title={label}
          className={cn(
            "p-1.5 rounded transition-colors",
            view === v ? "bg-bg text-accent" : "text-muted hover:text-fg",
          )}
        >
          <Icon size={16} />
        </button>
      ))}
    </div>
  );
}

export function ToolButton({
  onClick,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="p-2 rounded-md text-muted hover:text-fg hover:bg-fg/5 disabled:opacity-40 transition-colors"
    >
      {children}
    </button>
  );
}

export function ImportButton({ what, onClick }: { what: string; onClick: () => void }) {
  return (
    <ToolButton onClick={onClick} title={`Import ${what} from JSON (merges; skips ones already listed)`}>
      <FileInput size={16} />
    </ToolButton>
  );
}

export function AddButton({ what, onClick }: { what: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={`Add a ${what}`}
      className="flex items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-md text-sm text-fg bg-surface hover:bg-surfaceHover transition-colors"
    >
      <Plus size={16} />
      <span className="hidden md:inline">Add</span>
    </button>
  );
}

export function CheckAllButton({
  busy,
  disabled,
  onClick,
}: {
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy || disabled}
      title="Check all"
      className="flex items-center gap-1.5 px-2.5 md:px-3 py-2 rounded-md text-sm font-medium text-bg bg-accent hover:bg-accent/90 disabled:opacity-40 transition-colors"
    >
      <Zap size={16} className={busy ? "animate-pulse" : ""} />
      <span className="hidden md:inline">Check all</span>
    </button>
  );
}

/** "5 hosts · 2 shown   4 ok 1 fail" — the footer's opening. */
export function Counts({
  total,
  shown,
  noun,
  ok,
  warn,
  fail,
}: {
  total: number;
  shown?: number;
  noun: string;
  ok: number;
  warn: number;
  fail: number;
}) {
  return (
    <>
      <span className="whitespace-nowrap">
        {total} {noun}
        {total === 1 ? "" : "s"}
        {shown != null && shown !== total && <span className="text-fg"> · {shown} shown</span>}
      </span>
      <div className="flex items-center gap-3 font-mono tabular-nums whitespace-nowrap">
        {ok > 0 && <span className="text-ok">{ok} ok</span>}
        {warn > 0 && <span className="text-warn">{warn} warn</span>}
        {fail > 0 && <span className="text-alert">{fail} fail</span>}
      </div>
    </>
  );
}

export function ToastText({ toast }: { toast: Toast }) {
  if (!toast) return null;
  return (
    <span className={cn("truncate", toast.tone === "alert" ? "text-alert" : "text-fg/80")} title={toast.text}>
      {toast.text}
    </span>
  );
}

/** Counts of each status, for the footer. */
export function tally(statuses: string[]) {
  const n = { ok: 0, warn: 0, fail: 0 };
  for (const s of statuses) if (s === "ok" || s === "warn" || s === "fail") n[s]++;
  return n;
}

/** An empty list, or a search with no matches. */
export function Empty({ children }: { children: ReactNode }) {
  return <div className="text-center text-muted text-sm py-16 flex flex-col items-center gap-3">{children}</div>;
}
