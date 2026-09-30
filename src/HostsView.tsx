import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus, Zap, FileInput, Server, LayoutGrid, List } from "lucide-react";
import { cn } from "./lib/cn";
import {
  exportRelays,
  importRelays,
  probeHost,
  probeRelay,
  type HostProbe,
} from "./lib/tauri";
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
import { compareValues, type SortDir } from "./lib/relays";
import { HostTable, hostSortValue, type HostItem, type HostSortKey } from "./components/HostTable";
import { HostCard, hostOverall } from "./components/HostCard";
import { ExportButton, SyncStatus } from "./components/SyncStatus";
import { useExportSync } from "./lib/sync";

const STORAGE_KEY = "nping.hosts";
const VIEW_KEY = "nping.hostsView";

type View = "cards" | "list";

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}

// Matches Tailwind's lg breakpoint, where the list's secondary columns show.
const MQ_WIDE = "(min-width: 1024px)";

function useWide(): boolean {
  const [wide, setWide] = useState(() => window.matchMedia(MQ_WIDE).matches);
  useEffect(() => {
    const m = window.matchMedia(MQ_WIDE);
    const update = () => setWide(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, []);
  return wide;
}
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
  const [view, setView] = useState<View>(loadView);
  const [sortKey, setSortKey] = useState<HostSortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const wide = useWide();

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* the view is a convenience */
    }
  }, [view]);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "alert" } | null>(null);
  // Ticks the "checked 3 min ago" lines.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

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

  const addRow = useCallback(() => {
    const id = newId();
    setRows((rs) => [...rs, { ...NEW_HOST, id }]);
    setEditingId(id);
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
  }, []);

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
  }, []);

  const anyChecking = Object.values(checking).some(Boolean);

  // First click sorts ascending (status: failures first; renewal: soonest
  // first); second flips; third returns to your own order.
  const onSort = useCallback(
    (key: HostSortKey) => {
      if (sortKey !== key) {
        setSortKey(key);
        setSortDir("asc");
      } else if (sortDir === "asc") setSortDir("desc");
      else setSortKey(null);
    },
    [sortKey, sortDir],
  );

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

  const summary = useMemo(() => {
    const n = { ok: 0, warn: 0, fail: 0 };
    for (const r of rows) {
      const res = results[r.id];
      const s = hostOverall(res?.probe, res?.relay, !!checking[r.id], r);
      if (s === "ok" || s === "warn" || s === "fail") n[s]++;
    }
    return n;
  }, [rows, results, checking]);

  // The full card for a host — the cards view's tiles, and the list view's
  // expanded row.
  const renderCard = (id: string) => {
    const r = rows.find((x) => x.id === id);
    if (!r) return null;
    return (
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
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-surface/60">
        {brand}
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md bg-surface p-0.5">
            {(
              [
                ["cards", LayoutGrid, "Card view"],
                ["list", List, "List view — one line per host"],
              ] as const
            ).map(([v, Icon, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
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
          <button
            onClick={() => void doImport()}
            title="Import hosts from JSON (merges; skips ones already listed)"
            className="p-2 rounded-md text-muted hover:text-fg hover:bg-fg/5 transition-colors"
          >
            <FileInput size={16} />
          </button>
          <ExportButton
            stale={sync.stale}
            disabled={rows.length === 0}
            record={sync.record}
            onClick={() => void doExport()}
          />
          <button
            onClick={addRow}
            title="Add a host"
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm text-fg bg-surface hover:bg-surfaceHover transition-colors"
          >
            <Plus size={16} />
            Add
          </button>
          <button
            onClick={checkAll}
            disabled={anyChecking || rows.every((r) => r.host.trim() === "")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-bg bg-accent hover:bg-accent/90 disabled:opacity-40 transition-colors"
          >
            <Zap size={16} className={anyChecking ? "animate-pulse" : ""} />
            Check all
          </button>
        </div>
      </header>

      {/* The list view's top padding sits inside the scrolled content, not on
          main — padding on main sits above the sticky header (see Relays). */}
      <main className={cn("flex-1 overflow-y-auto px-5 pb-4", view === "list" && rows.length > 0 ? "" : "pt-4")}>
        {rows.length === 0 ? (
          <div className="text-center text-muted text-sm py-16 flex flex-col items-center gap-3">
            <Server size={28} className="text-muted/50" />
            <span>
              No hosts. Click <span className="text-fg">Add</span> or import a JSON list.
            </span>
          </div>
        ) : view === "list" ? (
          <div className="max-w-[1400px] mx-auto pt-4">
            <HostTable
              items={items}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
              onCheck={(id) => void checkOne(id)}
              onRemove={removeRow}
              renderCard={(id) => renderCard(id)}
              now={now}
              wide={wide}
            />
          </div>
        ) : (
          <div className="grid gap-3 mx-auto grid-cols-1 max-w-[680px] lg:grid-cols-2 lg:max-w-[1400px] 2xl:grid-cols-3 2xl:max-w-[1880px]">
            {rows.map((r) => (
              <HostCard
                key={r.id}
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
            ))}
          </div>
        )}
      </main>

      <footer className="px-5 py-2.5 border-t border-surface/60 text-xs text-muted flex items-center gap-4">
        <span className="whitespace-nowrap">
          {rows.length} host{rows.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-3 font-mono tabular-nums whitespace-nowrap">
          {summary.ok > 0 && <span className="text-ok">{summary.ok} ok</span>}
          {summary.warn > 0 && <span className="text-warn">{summary.warn} warn</span>}
          {summary.fail > 0 && <span className="text-alert">{summary.fail} fail</span>}
        </div>
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
        {toast && (
          <span
            className={cn("truncate", toast.tone === "alert" ? "text-alert" : "text-fg/80")}
            title={toast.text}
          >
            {toast.text}
          </span>
        )}
        <span className="ml-auto opacity-60 whitespace-nowrap hidden lg:inline">ndisc suite</span>
      </footer>
    </div>
  );
}
