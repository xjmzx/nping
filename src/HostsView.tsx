import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus, Zap, FileInput, FileOutput, Server } from "lucide-react";
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
} from "./lib/hosts";
import { HostCard, hostOverall } from "./components/HostCard";

const STORAGE_KEY = "nping.hosts";
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
      const path = await exportRelays(exportJson(rowsRef.current), "nping-hosts.json");
      if (path) setToast({ text: `Exported to ${path}`, tone: "ok" });
    } catch (e) {
      setToast({ text: `Export failed: ${String(e)}`, tone: "alert" });
    }
  }, []);

  // Import merges: hosts already listed (by hostname) are skipped.
  const doImport = useCallback(async () => {
    try {
      const text = await importRelays();
      if (text == null) return;
      const incoming = parseImport(text);
      const have = new Set(rowsRef.current.map(hostKey));
      const fresh: HostRow[] = [];
      for (const h of incoming) {
        const k = hostKey(h);
        if (have.has(k)) continue;
        have.add(k);
        fresh.push({ ...h, id: newId() });
      }
      setRows((rs) => [...rs, ...fresh]);
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

  const summary = useMemo(() => {
    const n = { ok: 0, warn: 0, fail: 0 };
    for (const r of rows) {
      const res = results[r.id];
      const s = hostOverall(res?.probe, res?.relay, !!checking[r.id], r);
      if (s === "ok" || s === "warn" || s === "fail") n[s]++;
    }
    return n;
  }, [rows, results, checking]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-surface/60">
        {brand}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void doImport()}
            title="Import hosts from JSON (merges; skips ones already listed)"
            className="p-2 rounded-md text-muted hover:text-fg hover:bg-fg/5 transition-colors"
          >
            <FileInput size={16} />
          </button>
          <button
            onClick={() => void doExport()}
            disabled={rows.length === 0}
            title="Export hosts to JSON"
            className="p-2 rounded-md text-muted hover:text-fg hover:bg-fg/5 disabled:opacity-40 transition-colors"
          >
            <FileOutput size={16} />
          </button>
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

      <main className="flex-1 overflow-y-auto px-5 py-4">
        {rows.length === 0 ? (
          <div className="text-center text-muted text-sm py-16 flex flex-col items-center gap-3">
            <Server size={28} className="text-muted/50" />
            <span>
              No hosts. Click <span className="text-fg">Add</span> or import a JSON list.
            </span>
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
        <span>
          {rows.length} host{rows.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-3 font-mono tabular-nums">
          {summary.ok > 0 && <span className="text-ok">{summary.ok} ok</span>}
          {summary.warn > 0 && <span className="text-warn">{summary.warn} warn</span>}
          {summary.fail > 0 && <span className="text-alert">{summary.fail} fail</span>}
        </div>
        {toast && (
          <span
            className={cn("truncate", toast.tone === "alert" ? "text-alert" : "text-fg/80")}
            title={toast.text}
          >
            {toast.text}
          </span>
        )}
        <span className="ml-auto opacity-60">ndisc suite</span>
      </footer>
    </div>
  );
}
