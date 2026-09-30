// The pieces every card is built from, relay or host: the frame, the header
// (status, title, actions), one row per check, the indented detail block and
// the "checked … ago" line. Both cards are these in the same order, so they
// line up side by side and a change to one reaches the other.

import type { ReactNode } from "react";
import { RefreshCw, Trash2 } from "lucide-react";
import { cn } from "../lib/cn";
import { shortError } from "../lib/relays";
import { agoText, clockText } from "../lib/hosts";
import { StatusDot, type Status } from "./StatusDot";

/** One to three columns (lg / xl — the breakpoints in lib/ui.ts). Cards in a
 *  row share its height; each row is as tall as its tallest card. */
export function CardGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 mx-auto grid-cols-1 max-w-[680px] lg:grid-cols-2 lg:max-w-[1400px] xl:grid-cols-3 xl:max-w-[1880px]">
      {children}
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="h-full rounded-xl bg-panel border border-surface/60 shadow-md p-3.5 flex flex-col gap-3">
      {children}
    </div>
  );
}

export function CardHeader({
  status,
  children,
  actions,
}: {
  status: Status;
  children: ReactNode;
  actions: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <StatusDot status={status} size={12} />
      <div className="flex-1 min-w-0 flex items-baseline gap-2">{children}</div>
      {actions}
    </div>
  );
}

export function IconButton({
  onClick,
  title,
  disabled,
  tone = "accent",
  active,
  small,
  children,
}: {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  /** The hover colour: accent for actions, alert for removing. */
  tone?: "accent" | "alert";
  /** Lit, for a toggle that's on. */
  active?: boolean;
  /** The list view's tighter padding. */
  small?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "rounded-md hover:bg-fg/5 disabled:opacity-40 transition-colors",
        small ? "p-1" : "p-1.5",
        active ? "text-accent" : "text-muted",
        tone === "alert" ? "hover:text-alert" : "hover:text-accent",
      )}
    >
      {children}
    </button>
  );
}

/** Check now + remove: the two actions every card and list row ends with. */
export function RowActions({
  checking,
  disabled,
  what,
  onCheck,
  onRemove,
  small,
}: {
  checking: boolean;
  disabled: boolean;
  /** "relay" / "host", for the tooltips. */
  what: string;
  onCheck: () => void;
  onRemove: () => void;
  small?: boolean;
}) {
  const size = small ? 14 : 15;
  return (
    <>
      <IconButton onClick={onCheck} disabled={checking || disabled} title={`Check this ${what}`} small={small}>
        <RefreshCw size={size} className={checking ? "animate-spin" : ""} />
      </IconButton>
      <IconButton onClick={onRemove} title={`Remove ${what}`} tone="alert" small={small}>
        <Trash2 size={size} />
      </IconButton>
    </>
  );
}

/** One check: its dot, a short label and the result. Labels are one word so
 *  the label column stays narrow and the results get the width. */
export function StageRow({
  icon,
  label,
  title,
  status,
  children,
}: {
  icon: ReactNode;
  label: string;
  /** The label's tooltip, when the word alone doesn't say it. */
  title?: string;
  status: Status;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2.5">
      <StatusDot status={status} size={8} className="translate-y-[1px]" />
      <span title={title} className="flex items-center gap-1.5 w-20 shrink-0 whitespace-nowrap text-muted">
        <span className="text-muted/70">{icon}</span>
        {label}
      </span>
      <div className="flex-1 min-w-0 text-fg/80">{children}</div>
    </div>
  );
}

/** The check rows, then anything that belongs under them. */
export function Checks({ children }: { children: ReactNode }) {
  return <div className="flex-1 flex flex-col gap-2 text-sm pl-0.5">{children}</div>;
}

/** Indented to line up with the results column. */
export function Detail({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("pl-[34px]", className)}>{children}</div>;
}

/** The card's last line, pinned to the bottom so it lines up across a row. */
export function CheckedAt({ at, now }: { at: number; now: number }) {
  return (
    <Detail className="mt-auto text-[11px] text-muted/70">
      <span title={new Date(at).toLocaleString()}>
        checked {clockText(at)} · {agoText(at, now)}
      </span>
    </Detail>
  );
}

/** A check's error, wrapped rather than truncated — the error is the point of
 *  the row. `short` gives the one-word form, with the full text on hover. */
export function ErrorText({
  text,
  tone,
  short,
}: {
  text: string | null | undefined;
  tone: "alert" | "warn" | "muted";
  short?: boolean;
}) {
  if (!text) return <span className="text-muted">—</span>;
  return (
    <span
      title={text}
      className={cn(
        "block break-words font-mono text-xs leading-snug",
        tone === "alert" ? "text-alert" : tone === "warn" ? "text-warn" : "text-muted",
      )}
    >
      {short ? shortError(text) : text}
    </span>
  );
}
