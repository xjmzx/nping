import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Server } from "lucide-react";
import { cn } from "./lib/cn";
import { exportRelays, importRelays, probeHost, probeRelay, type HostProbe } from "./lib/tauri";
import {
  NEW_HOST,
  exportJson,
  hostKey,
  parseImport,
  toSpec,
  type HostFields,
  type HostRow,
  type StoredResult,
  withDefaults,
  active,
  parsePorts,
  CHECKS,
  renewalDays,
  renewalText,
} from "./lib/hosts";
import { compareValues } from "./lib/relays";
import { useColumns, useNow, useSort, useStoredView, useToast } from "./lib/ui";
import { hostColumns, hostSortValue, type HostItem, type HostSortKey } from "./components/HostTable";
import { HostCard, hostOverall } from "./components/HostCard";
import { CardGrid, RowActions } from "./components/Card";
import { DataTable } from "./components/DataTable";
import {
  AddButton,
  CheckAllButton,
  Counts,
  Empty,
  ImportButton,
  Section,
  ToastText,
  ViewToggle,
  tally,
} from "./components/Section";
import { ExportButton, SyncStatus } from "./components/SyncStatus";
import { useExportSync } from "./lib/sync";

const STORAGE_KEY = "nping.hosts";
const VIEW_KEY = "nping.hostsView";
// Last result per host id — kept apart from the list so an export never
// carries results, and a corrupt entry can't lose the hosts themselves.
const RESULTS_KEY = "nping.hostResults";

function newId(): string {
  return crypto.randomUUID();
}

function loadRows(): HostRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const rows = JSON.parse(raw) as Partial<HostRow>[];
      // Ids are stored so remembered results find their host again.
      if (Array.isArray(rows))
        return rows.map((r) => ({ ...withDefaults(r), id: r.id || newId() }));
    }
  } catch {
    /* start empty */
  }
  return [];
}

function loadResults(): Record<string, StoredResult> {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    const v = raw ? (JSON.parse(raw) as Record<string, StoredResult>) : null;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** Machine checks: DNS, ping, TCP ports, TLS certificate, a relay on the box
 *  and LND. `brand` is the shared left side of the header, owned by App. */
export default function HostsView({ brand }: { brand: ReactNode }) {
  const [rows, setRows] = useState<HostRow[]>(loadRows);
  const [results, setResults] = useState<Record<string, StoredResult>>(loadResults);
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [view, setView] = useStoredView(VIEW_KEY);
  const { sortKey, sortDir, onSort } = useSort<HostSortKey>();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useToast();
  const now = useNow();
  const wide = useColumns() > 1;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    } catch {
      /* nothing to fall back to */
    }
  }, [rows]);

  useEffect(() => {
    try {
      localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
    } catch {
      /* results are a convenience; the next check rebuilds them */
    }
  }, [results]);

  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const exported = useMemo(() => exportJson(rows), [rows]);
  const sync = useExportSync("nping.hostsSync", exported, rows.length === 0);
  const syncRef = useRef(sync);
  syncRef.current = sync;

  const dropResults = (id: string) =>
    setResults((m) => {
      if (!(id in m)) return m;
      const next = { ...m };
      delete next[id];
      return next;
    });

  const checkOne = useCallback(async (id: string) => {
    const row = rowsRef.current.find((r) => r.id === id);
    if (!row || row.host.trim() === "") return;
    setChecking((c) => ({ ...c, [id]: true }));
    dropResults(id);
    const relayUrl = active(row).relay ? row.relay.trim() : "";
    try {
      // The relay check is its own command; run it alongside the host checks.
      const [host, relay] = await Promise.all([
        probeHost(toSpec(row)),
        relayUrl ? probeRelay(relayUrl) : Promise.resolve(undefined),
      ]);
      setResults((m) => ({ ...m, [id]: { at: Date.now(), probe: host, relay } }));
    } catch (e) {
      const probe: HostProbe = {
        host: row.host,
        error: String(e),
        dns: null,
        icmp: null,
        tcp: [],
        tls: null,
        http: null,
        lnd: null,
      };
      setResults((m) => ({ ...m, [id]: { at: Date.now(), probe } }));
    } finally {
      setChecking((c) => ({ ...c, [id]: false }));
    }
  }, []);

  const checkAll = useCallback(() => {
    rowsRef.current.filter((r) => r.host.trim() !== "").forEach((r) => void checkOne(r.id));
  }, [checkOne]);

  const update = useCallback((id: string, patch: Partial<HostFields>) => {
    const before = rowsRef.current.find((r) => r.id === id);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    // A result for other settings would be misleading next to the new ones.
    // Edits that don't change what gets probed keep it — the name, or turning
    // `22` into `!22`, which only changes how the same result is judged.
    // Switching checks off keeps the result: the rest of it is still true,
    // and the switched-off rows simply stop showing.
    const switchKeys: string[] = CHECKS.map(([k]) => k);
    const onlySwitchingOff = Object.entries(patch).every(
      ([k, v]) => switchKeys.includes(k) && v === false,
    );
    // Removing ports narrows the check; what's left of the result still holds.
    const onlyRemovingPorts =
      Object.keys(patch).every((k) => k === "ports") &&
      patch.ports != null &&
      before != null &&
      parsePorts(patch.ports).every((p) => parsePorts(before.ports).includes(p));
    if (before && !onlySwitchingOff && !onlyRemovingPorts) {
      const specOf = (r: HostFields) =>
        JSON.stringify({ ...toSpec(r), relay: active(r).relay ? r.relay.trim() : "" });
      if (specOf(before) !== specOf({ ...before, ...patch })) dropResults(id);
    }
  }, []);

  // A new host opens in the editor — in the list view, as an opened row.
  const addRow = useCallback(() => {
    const id = newId();
    setRows((rs) => [...rs, { ...NEW_HOST, id }]);
    setEditingId(id);
    setExpandedId(id);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((rs) => rs.filter((r) => r.id !== id));
    dropResults(id);
  }, []);

  const doExport = useCallback(async () => {
    try {
      const json = exportJson(rowsRef.current);
      const path = await exportRelays(json, "nping-hosts.json", syncRef.current.record?.path);
      if (path) {
        syncRef.current.markSynced(json, path, "export");
        setToast({ text: `Exported to ${path}`, tone: "ok" });
      }
    } catch (e) {
      setToast({ text: `Export failed: ${String(e)}`, tone: "alert" });
    }
  }, [setToast]);

  // Import merges: hosts already listed (by hostname) are skipped.
  const doImport = useCallback(async () => {
    try {
      const file = await importRelays(syncRef.current.record?.path);
      if (file == null) return;
      const incoming = parseImport(file.contents);
      const wasEmpty = rowsRef.current.length === 0;
      const have = new Set(rowsRef.current.map(hostKey));
      const fresh: HostRow[] = [];
      for (const h of incoming) {
        const k = hostKey(h);
        if (have.has(k)) continue;
        have.add(k);
        fresh.push({ ...h, id: newId() });
      }
      setRows((rs) => [...rs, ...fresh]);
      // Into an empty list, the list now IS the file; merged into an existing
      // one it isn't, so only the folder is remembered.
      if (wasEmpty) syncRef.current.markSynced(exportJson(fresh), file.path, "import");
      else syncRef.current.rememberPath(file.path);
      const skipped = incoming.length - fresh.length;
      setToast({
        text:
          `Imported ${fresh.length} host${fresh.length === 1 ? "" : "s"}` +
          (skipped ? ` · ${skipped} already in the list` : ""),
        tone: "ok",
      });
    } catch (e) {
      setToast({ text: `Import failed: ${e instanceof Error ? e.message : String(e)}`, tone: "alert" });
    }
  }, [setToast]);

  const anyChecking = Object.values(checking).some(Boolean);

  // In the chosen sort, cards and list alike; with none, your own order.
  const items: HostItem[] = useMemo(() => {
    const list = rows.map((r) => ({
      row: r,
      result: results[r.id],
      checking: !!checking[r.id],
      status: hostOverall(results[r.id]?.probe, results[r.id]?.relay, !!checking[r.id], r),
    }));
    if (!sortKey) return list;
    return [...list].sort((a, b) =>
      compareValues(hostSortValue(sortKey, a, now), hostSortValue(sortKey, b, now), sortDir),
    );
  }, [rows, results, checking, sortKey, sortDir, now]);

  const columns = useMemo(() => hostColumns(now), [now]);

  // Annual cost per currency, and the renewal that comes up next.
  const money = useMemo(() => {
    const totals = new Map<string, number>();
    let next: { name: string; days: number } | null = null;
    for (const r of rows) {
      const cost = Number(r.notes.cost);
      if (r.notes.cost.trim() && Number.isFinite(cost)) {
        const cur = r.notes.currency.trim().toUpperCase() || "?";
        totals.set(cur, (totals.get(cur) ?? 0) + cost);
      }
      const days = renewalDays(r.notes.renewal, now);
      if (days != null && (next == null || days < next.days))
        next = { name: r.name || r.host, days };
    }
    const cost = [...totals]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cur, n]) => `${cur} ${+n.toFixed(2)}`)
      .join(" · ");
    return { cost, next };
  }, [rows, now]);

  const counts = useMemo(() => tally(items.map((it) => it.status)), [items]);

  // The full card: the cards view's tiles, and the list view's opened row.
  const card = ({ row: r }: HostItem) => (
    <HostCard
      row={r}
      probe={results[r.id]?.probe}
      relay={results[r.id]?.relay}
      checkedAt={results[r.id]?.at}
      now={now}
      checking={!!checking[r.id]}
      editing={editingId === r.id}
      onChange={(patch) => update(r.id, patch)}
      onCheck={() => void checkOne(r.id)}
      onEdit={() => setEditingId((cur) => (cur === r.id ? null : r.id))}
      onRemove={() => removeRow(r.id)}
    />
  );

  const listed = view === "list" && rows.length > 0;

  return (
    <Section
      brand={brand}
      flushTop={listed}
      controls={
        <>
          <ViewToggle view={view} onChange={setView} />
          <ImportButton what="hosts" onClick={() => void doImport()} />
          <ExportButton
            stale={sync.stale}
            disabled={rows.length === 0}
            record={sync.record}
            onClick={() => void doExport()}
          />
          <AddButton what="host" onClick={addRow} />
          <CheckAllButton
            busy={anyChecking}
            disabled={rows.every((r) => r.host.trim() === "")}
            onClick={checkAll}
          />
        </>
      }
      footer={
        <>
          <Counts total={rows.length} noun="host" {...counts} />
          {money.cost && (
            <span className="tabular-nums whitespace-nowrap hidden lg:inline" title="Total annual cost, per currency">
              {money.cost} / yr
            </span>
          )}
          {money.next && (
            <span
              className={cn(
                "tabular-nums truncate min-w-0",
                money.next.days < 0 ? "text-alert" : money.next.days <= 30 ? "text-warn" : "",
              )}
              title={`Next hosting renewal: ${money.next.name}`}
            >
              <span className="hidden lg:inline">next renewal: </span>
              {money.next.name} {renewalText(money.next.days)}
            </span>
          )}
          <SyncStatus savedFlash={sync.savedFlash} stale={sync.stale} record={sync.record} />
          <ToastText toast={toast} />
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty>
          <Server size={28} className="text-muted/50" />
          <span>
            No hosts. Click <span className="text-fg">Add</span> or import a JSON list.
          </span>
        </Empty>
      ) : view === "list" ? (
        <DataTable
          columns={columns}
          items={items}
          id={(it) => it.row.id}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          expandedId={expandedId}
          onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          wide={wide}
          actions={(it) => (
            <RowActions
              small
              checking={it.checking}
              disabled={it.row.host.trim() === ""}
              what="host"
              onCheck={() => void checkOne(it.row.id)}
              onRemove={() => removeRow(it.row.id)}
            />
          )}
          expanded={card}
        />
      ) : (
        <CardGrid>
          {items.map((it) => (
            <Fragment key={it.row.id}>{card(it)}</Fragment>
          ))}
        </CardGrid>
      )}
    </Section>
  );
}
