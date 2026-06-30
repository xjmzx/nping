import { cn } from "../lib/cn";

export type Status = "idle" | "checking" | "ok" | "warn" | "fail";

const TINT: Record<Status, string> = {
  idle: "bg-muted/40",
  checking: "bg-digital animate-pulse",
  ok: "bg-ok",
  warn: "bg-warn",
  fail: "bg-alert",
};

const GLOW: Record<Status, string> = {
  idle: "",
  checking: "shadow-[0_0_8px_2px] shadow-digital/40",
  ok: "shadow-[0_0_8px_2px] shadow-ok/40",
  warn: "shadow-[0_0_8px_2px] shadow-warn/40",
  fail: "shadow-[0_0_8px_2px] shadow-alert/40",
};

/** A small status pip in the suite's dot vocabulary — varying hue, soft glow
 *  when active. `size` is the diameter in px. */
export function StatusDot({
  status,
  size = 10,
  className,
}: {
  status: Status;
  size?: number;
  className?: string;
}) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cn(
        "inline-block rounded-full shrink-0",
        TINT[status],
        GLOW[status],
        className,
      )}
    />
  );
}
