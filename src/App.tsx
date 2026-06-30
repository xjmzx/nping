import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Radio, Plus, Zap, RotateCcw } from "lucide-react";
import { cn } from "./lib/cn";
import { probeRelay, type RelayProbe } from "./lib/tauri";
import { RelayCard } from "./components/RelayCard";

const DEFAULT_RELAYS = [
  "wss://relay.fizx.uk",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

const STORAGE_KEY = "nping.relays";

interface Row {
  id: string;
  url: string;
}

function newId(): string {
  // crypto.randomUUID is available in the WebKit webview.
  return crypto.randomUUID();
}

function loadRows(): Row[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const urls = JSON.parse(raw) as string[];
      if (Array.isArray(urls) && urls.length) {
        return urls.map((url) => ({ id: newId(), url }));
      }
    }
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_RELAYS.map((url) => ({ id: newId(), url }));
}

export default function App() {
  const [rows, setRows] = useState<Row[]>(loadRows);
  const [probes, setProbes] = useState<Record<string, RelayProbe>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [upleb, setUpleb] = useState(false);

  // Persist the relay list (urls only) whenever it changes.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.map((r) => r.url)));
  }, [rows]);

  // Keep a live ref to rows so pingAll always sees the latest urls.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const pingOne = useCallback(async (id: string) => {
    const row = rowsRef.current.find((r) => r.id === id);
    if (!row || row.url.trim() === "") return;
    setChecking((c) => ({ ...c, [id]: true }));
    try {
      const result = await probeRelay(row.url.trim());
      setProbes((p) => ({ ...p, [id]: result }));
    } catch (e) {
      // The command shouldn't reject for ordinary failures, but guard anyway.
      setProbes((p) => ({
        ...p,
        [id]: {
          url: row.url,
          ok: false,
          connectOk: false,
          connectMs: null,
          connectError: String(e),
          reqOk: false,
          reqMs: null,
          reqEvents: 0,
          reqEose: false,
          reqError: null,
          notice: null,
          info: null,
          infoError: null,
        },
      }));
    } finally {
      setChecking((c) => ({ ...c, [id]: false }));
    }
  }, []);

  const pingAll = useCallback(() => {
    rowsRef.current
      .filter((r) => r.url.trim() !== "")
      .forEach((r) => void pingOne(r.id));
  }, [pingOne]);

  const updateUrl = useCallback((id: string, url: string) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, url } : r)));
    // The stored probe is for the old url — drop it so the card resets.
    setProbes((p) => {
      if (!(id in p)) return p;
      const next = { ...p };
      delete next[id];
      return next;
    });
  }, []);

  const addRow = useCallback(() => {
    setRows((rs) => [...rs, { id: newId(), url: "" }]);
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((rs) => rs.filter((r) => r.id !== id));
    setProbes((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
  }, []);

  const resetDefaults = useCallback(() => {
    setRows(DEFAULT_RELAYS.map((url) => ({ id: newId(), url })));
    setProbes({});
    setChecking({});
  }, []);

  const anyChecking = Object.values(checking).some(Boolean);

  // Summary counts across probed relays.
  const summary = useMemo(() => {
    let ok = 0;
    let warn = 0;
    let fail = 0;
    for (const r of rows) {
      const p = probes[r.id];
      if (!p || checking[r.id]) continue;
      if (!p.connectOk) fail++;
      else if (!p.reqEose) warn++;
      else ok++;
    }
    return { ok, warn, fail };
  }, [rows, probes, checking]);

  const probedCount = summary.ok + summary.warn + summary.fail;

  return (
    <div className={cn("min-h-full flex flex-col", upleb && "theme-upleb")}>
      {/* header */}
      <header className="flex items-center gap-3 px-5 py-4 border-b border-surface/60">
        <Radio size={22} className="text-accent shrink-0" />
        <button
          onClick={() => setUpleb((v) => !v)}
          title="Toggle theme"
          className="text-2xl font-bold tracking-tight select-none"
        >
          <span className="text-accent">n</span>
          <span className="text-mauve">ping</span>
        </button>
        <span className="text-xs text-muted hidden sm:inline">
          Nostr relay connectivity
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={resetDefaults}
            title="Restore default relays"
            className="p-2 rounded-md text-muted hover:text-fg hover:bg-fg/5 transition-colors"
          >
            <RotateCcw size={16} />
          </button>
          <button
            onClick={addRow}
            title="Add a relay"
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm text-fg bg-surface hover:bg-surfaceHover transition-colors"
          >
            <Plus size={16} />
            Add
          </button>
          <button
            onClick={pingAll}
            disabled={anyChecking || rows.every((r) => r.url.trim() === "")}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-bg bg-accent hover:bg-accent/90 disabled:opacity-40 transition-colors"
          >
            <Zap size={16} className={anyChecking ? "animate-pulse" : ""} />
            Ping all
          </button>
        </div>
      </header>

      {/* relay list */}
      <main className="flex-1 overflow-y-auto px-5 py-4">
        <div className="flex flex-col gap-3 max-w-[680px] mx-auto">
          {rows.length === 0 ? (
            <div className="text-center text-muted text-sm py-16">
              No relays. Click <span className="text-fg">Add</span> to start.
            </div>
          ) : (
            rows.map((row) => (
              <RelayCard
                key={row.id}
                url={row.url}
                probe={probes[row.id]}
                checking={!!checking[row.id]}
                onChange={(url) => updateUrl(row.id, url)}
                onPing={() => void pingOne(row.id)}
                onRemove={() => removeRow(row.id)}
              />
            ))
          )}
        </div>
      </main>

      {/* footer summary */}
      <footer className="px-5 py-2.5 border-t border-surface/60 text-xs text-muted flex items-center gap-4">
        <span>
          {rows.length} relay{rows.length === 1 ? "" : "s"}
        </span>
        {probedCount > 0 && (
          <div className="flex items-center gap-3 font-mono tabular-nums">
            {summary.ok > 0 && <span className="text-ok">{summary.ok} ok</span>}
            {summary.warn > 0 && (
              <span className="text-warn">{summary.warn} warn</span>
            )}
            {summary.fail > 0 && (
              <span className="text-alert">{summary.fail} fail</span>
            )}
          </div>
        )}
        <span className="ml-auto opacity-60">ndisc suite</span>
      </footer>
    </div>
  );
}
