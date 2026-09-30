import { cn } from "../lib/cn";
import {
  active,
  agoText,
  costText,
  hostStatuses,
  renewalDays,
  renewalStatus,
  renewalText,
  shownName,
  specsLine,
  type HostRow,
  type StoredResult,
} from "../lib/hosts";
import { StatusDot, type Status } from "./StatusDot";
import type { Column } from "./DataTable";
import { DASH } from "./DataTable";

export type HostSortKey = "status" | "name" | "checked" | "renewal" | "cost";

export interface HostItem {
  row: HostRow;
  result?: StoredResult;
  checking: boolean;
  status: Status;
}

const STATUS_RANK: Record<string, number> = { fail: 0, warn: 1, ok: 2 };

/** The value a row sorts by; null (no data) always sorts last. */
export function hostSortValue(key: HostSortKey, it: HostItem, now: number): string | number | null {
  switch (key) {
    case "status":
      return STATUS_RANK[it.status] ?? null;
    case "name":
      return (it.row.name || it.row.host).toLowerCase() || null;
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

const CHECK_LABELS: [keyof ReturnType<typeof active>, string][] = [
  ["icmp", "Ping"],
  ["ports", "Ports"],
  ["tls", "TLS"],
  ["http", "HTTP"],
  ["relay", "Relay"],
  ["lnd", "LND"],
];

function checkStatus(it: HostItem, k: (typeof CHECK_LABELS)[number][0]): Status {
  if (it.checking) return "checking";
  if (!it.result) return "idle";
  const st = hostStatuses(it.result.probe, it.result.relay, it.row);
  if (k === "ports") return st.tcp.includes("fail") ? "fail" : st.tcp.length ? "ok" : "idle";
  return st[k];
}

/** The host list's columns: one line per host, every enabled check as a
 *  coloured pip, the specs, and when it was checked, renews and costs. The
 *  list needs `now` for the relative times, so the columns are built per
 *  render. */
export function hostColumns(now: number): Column<HostItem, HostSortKey>[] {
  return [
    {
      id: "status",
      sort: "status",
      className: "w-9 text-center",
      cell: (it) => <StatusDot status={it.status} size={10} />,
    },
    {
      // Name and address in one column: the name when there is one, then the
      // address in grey — or the address alone.
      id: "host",
      label: "Host",
      sort: "name",
      className: "w-56 text-left",
      title: (it) => [it.row.name, it.row.host].filter(Boolean).join("\n"),
      cell: ({ row }) => {
        const name = shownName(row);
        return row.host || name ? (
          <>
            {name && <span className="text-fg mr-2">{name}</span>}
            <span className={cn("font-mono text-[13px]", name ? "text-muted" : "text-fg")}>{row.host}</span>
          </>
        ) : (
          <span className="text-muted/50">(empty)</span>
        );
      },
    },
    {
      id: "checks",
      label: "Checks",
      className: "text-left",
      title: (it) =>
        CHECK_LABELS.filter(([k]) => active(it.row)[k])
          .map(([k, label]) => `${label}: ${checkStatus(it, k)}`)
          .join("\n"),
      cell: (it) => {
        const on = active(it.row);
        const dnsFailed =
          !it.checking && it.result && hostStatuses(it.result.probe, it.result.relay, it.row).dns === "fail";
        return (
          <div className="flex items-center gap-2 overflow-hidden">
            {dnsFailed && <Pip status="fail" label="DNS" />}
            {CHECK_LABELS.filter(([k]) => on[k]).map(([k, label]) => (
              <Pip key={k} status={checkStatus(it, k)} label={label} />
            ))}
          </div>
        );
      },
    },
    {
      id: "specs",
      label: "Specs",
      className: "text-left",
      secondary: true,
      title: (it) => specsLine(it.row.notes) || undefined,
      cell: (it) => <span className="text-xs text-muted">{specsLine(it.row.notes) || DASH}</span>,
    },
    {
      id: "checked",
      label: "Checked",
      sort: "checked",
      className: "w-24 text-right",
      secondary: true,
      title: (it) => (it.result ? new Date(it.result.at).toLocaleString() : undefined),
      cell: (it) => (
        <span className="text-xs text-muted tabular-nums">
          {it.checking ? "…" : it.result ? agoText(it.result.at, now) : DASH}
        </span>
      ),
    },
    {
      id: "renewal",
      label: "Renewal",
      sort: "renewal",
      className: "w-24 text-right",
      title: (it) => (it.row.notes.renewal.trim() ? `renews ${it.row.notes.renewal.trim()}` : undefined),
      cell: ({ row }) => {
        const days = renewalDays(row.notes.renewal, now);
        const rs = renewalStatus(days);
        return (
          <span
            className={cn(
              "text-xs tabular-nums",
              rs === "fail" ? "text-alert" : rs === "warn" ? "text-warn" : "text-muted",
            )}
          >
            {days != null ? renewalText(days) : row.notes.renewal.trim() || DASH}
          </span>
        );
      },
    },
    {
      id: "cost",
      label: "Cost / yr",
      sort: "cost",
      className: "w-24 text-right",
      secondary: true,
      cell: ({ row }) => {
        const cost = costText(row.notes);
        return <span className="text-xs text-muted tabular-nums">{cost ? cost.replace(" / yr", "") : DASH}</span>;
      },
    },
  ];
}

function Pip({ status, label }: { status: Status; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs",
        status === "fail" ? "text-alert" : status === "warn" ? "text-warn" : "text-muted",
      )}
    >
      <StatusDot status={status} size={6} />
      {label}
    </span>
  );
}
