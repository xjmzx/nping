import { Check, FileOutput } from "lucide-react";
import { cn } from "../lib/cn";
import { clockText } from "../lib/hosts";
import type { SyncRecord } from "../lib/sync";

/** Footer note: a brief "saved" after each edit, otherwise whether the last
 *  export still matches the list. */
export function SyncStatus({
  savedFlash,
  stale,
  record,
}: {
  savedFlash: boolean;
  stale: boolean;
  record: SyncRecord | null;
}) {
  const last = record && record.at > 0 ? record : null;
  if (savedFlash) {
    return (
      <span className="inline-flex items-center gap-1 text-ok/90 shrink-0" title="Saved locally, as you typed">
        <Check size={12} />
        saved
      </span>
    );
  }
  if (stale) {
    return (
      <span
        className="text-warn/90 truncate min-w-0"
        title={last ? `Last ${last.kind}: ${last.path}\n${new Date(last.at).toLocaleString()}` : undefined}
      >
        {last
          ? `changed since last ${last.kind} (${clockText(last.at)})`
          : "not exported yet"}
      </span>
    );
  }
  if (last) {
    return (
      <span className="text-muted/70 truncate min-w-0" title={last.path}>
        in sync with {last.kind} · {clockText(last.at)}
      </span>
    );
  }
  return null;
}

/** The export button, with a dot while the list has unexported changes. */
export function ExportButton({
  stale,
  disabled,
  record,
  onClick,
}: {
  stale: boolean;
  disabled: boolean;
  record: SyncRecord | null;
  onClick: () => void;
}) {
  const where = record?.path ? `\nLast: ${record.path}` : "";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={(stale ? "Export — the list has changed since the last export" : "Export to JSON") + where}
      className="relative p-2 rounded-md text-muted hover:text-fg hover:bg-fg/5 disabled:opacity-40 transition-colors"
    >
      <FileOutput size={16} />
      {stale && !disabled && (
        <span
          className={cn(
            "absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-warn",
            "shadow-[0_0_6px_1px] shadow-warn/50",
          )}
        />
      )}
    </button>
  );
}
