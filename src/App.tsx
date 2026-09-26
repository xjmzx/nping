import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Radio,
  Plus,
  Zap,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  Search,
  X,
  FileInput,
  FileOutput,
} from "lucide-react";
import { cn } from "./lib/cn";
import { exportRelays, importRelays, probeRelay, type RelayProbe } from "./lib/tauri";
import {
  compareValues,
  exportJson,
  matchesSearch,
  parseImport,
  relayKey,
  sortValue,
  type SortDir,
  type SortKey,
} from "./lib/relays";
import { RelayCard, overallStatus } from "./components/RelayCard";
import { RelayTable, type TableItem } from "./components/RelayTable";

const DEFAULT_RELAYS = [
  "wss://relay.fizx.uk",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

const STORAGE_KEY = "nping.relays";
const VIEW_KEY = "nping.view";

type View = "cards" | "list";

function loadView(): View {
  try {
    return localStorage.getItem(VIEW_KEY) === "list" ? "list" : "cards";
  } catch {
    return "cards";
  }
}

interface Row {
  id: string;
  url: string;
}

// Grid columns track the Tailwind breakpoints used on the relay grid
// (lg = 1024px → 2, 2xl = 1536px → 3). Keep the two in step.
const MQ_2COL = "(min-width: 1024px)";
const MQ_3COL = "(min-width: 1536px)";

function currentColumns(): number {
  if (window.matchMedia(MQ_3COL).matches) return 3;
  if (window.matchMedia(MQ_2COL).matches) return 2;
  return 1;
}

function useColumns(): number {
  const [cols, setCols] = useState(currentColumns);
  useEffect(() => {
    const update = () => setCols(currentColumns());
    const mqs = [MQ_2COL, MQ_3COL].map((q) => window.matchMedia(q));
    mqs.forEach((m) => m.addEventListener("change", update));
    return () => mqs.forEach((m) => m.removeEventListener("change", update));
  }, []);
  return cols;
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
  const [page, setPage] = useState(0);
  const [view, setView] = useState<View>(loadView);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: "ok" | "alert" } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* view is a convenience; fine to lose */
    }
  }, [view]);

  // A status message in the footer that clears itself.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // Every row with its derived status, duplicate flag and search verdict.
  // An empty (just-added) row always shows, so a search can't hide it.
  const items: TableItem[] = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      if (r.url.trim()) seen.set(relayKey(r.url), (seen.get(relayKey(r.url)) ?? 0) + 1);
    }
    return rows
      .map((r) => {
        const probe = probes[r.id];
        const isChecking = !!checking[r.id];
        return {
          id: r.id,
          url: r.url,
          probe,
          checking: isChecking,
          status: overallStatus(probe, isChecking),
          dup: (seen.get(relayKey(r.url)) ?? 0) > 1,
        };
      })
      .filter(
        (it) =>
          it.url.trim() === "" || matchesSearch(it.url, it.probe, it.status, it.dup, query),
      );
  }, [rows, probes, checking, query]);

  // The list view sorts; the cards keep the stored order.
  const sortedItems = useMemo(() => {
    if (!sortKey) return items;
    return [...items].sort((a, b) =>
      compareValues(
        sortValue(sortKey, a.url, a.probe, a.status),
        sortValue(sortKey, b.url, b.probe, b.status),
        sortDir,
      ),
    );
  }, [items, sortKey, sortDir]);

  const onSort = useCallback(
    (key: SortKey) => {
      // First click sorts ascending (status: failures first); second flips;
      // third returns to the stored order.
      if (sortKey !== key) {
        setSortKey(key);
        setSortDir("asc");
      } else if (sortDir === "asc") setSortDir("desc");
      else setSortKey(null);
    },
    [sortKey, sortDir],
  );

  // Wide windows page two rows of cards at a time (6 at 3 columns); the
  // single-column default window just scrolls.
  const cols = useColumns();
  const pageSize = cols > 1 ? cols * 2 : Infinity;
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const visibleItems =
    pageSize === Infinity
      ? items
      : items.slice(safePage * pageSize, (safePage + 1) * pageSize);

  // A new search starts from the first page.
  useEffect(() => setPage(0), [query]);

  useEffect(() => {
    if (page !== safePage) setPage(safePage);
  }, [page, safePage]);

  // "/" jumps to search; PageUp / PageDown flip card pages. None of these
  // fire while typing in an input.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "/") searchRef.current?.focus();
      else if (view !== "cards") return;
      else if (e.key === "PageDown") setPage((p) => Math.min(p + 1, pageCount - 1));
      else if (e.key === "PageUp") setPage((p) => Math.max(p - 1, 0));
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pageCount, view]);

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
    const id = newId();
    setRows((rs) => [...rs, { id, url: "" }]);
    // Jump to the page the new card lands on (clamped once rows update), and
    // in the list view open its card so the url can be typed.
    setPage(Number.MAX_SAFE_INTEGER);
    setExpandedId(id);
  }, []);

  const doExport = useCallback(async () => {
    try {
      const path = await exportRelays(exportJson(rowsRef.current.map((r) => r.url)));
      if (path) setToast({ text: `Exported to ${path}`, tone: "ok" });
    } catch (e) {
      setToast({ text: `Export failed: ${String(e)}`, tone: "alert" });
    }
  }, []);

  // Import merges: new urls are appended, ones already in the list (or
  // repeated within the file) are skipped.
  const doImport = useCallback(async () => {
    try {
      const text = await importRelays();
      if (text == null) return;
      const urls = parseImport(text);
      const have = new Set(rowsRef.current.map((r) => relayKey(r.url)));
      const fresh: Row[] = [];
      for (const url of urls) {
        const k = relayKey(url);
        if (have.has(k)) continue;
        have.add(k);
        fresh.push({ id: newId(), url });
      }
      setRows((rs) => [...rs, ...fresh]);
      const skipped = urls.length - fresh.length;
      setToast({
        text:
          `Imported ${fresh.length} relay${fresh.length === 1 ? "" : "s"}` +
          (skipped ? ` · ${skipped} already in the list` : ""),
        tone: "ok",
      });
    } catch (e) {
      setToast({ text: `Import failed: ${e instanceof Error ? e.message : String(e)}`, tone: "alert" });
    }
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
    setPage(0);
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
        <span className="text-xs text-muted hidden xl:inline">
          Nostr relay connectivity
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
            <input
              ref={searchRef}
              value={query}
              spellCheck={false}
              placeholder="Search  (/)"
              title={"Filter relays by url, software or description.\nnip:42 — relays that list NIP-42\nis:ok · is:warn · is:fail · is:dup"}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  e.currentTarget.blur();
                }
              }}
              className={cn(
                "w-40 lg:w-64 pl-8 pr-7 py-2 rounded-md bg-surface text-sm text-fg",
                "placeholder:text-muted/60 focus:outline-none focus:ring-1 focus:ring-accent/50",
              )}
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                title="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted hover:text-fg"
              >
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex rounded-md bg-surface p-0.5">
            {(
              [
                ["cards", LayoutGrid, "Card view"],
                ["list", List, "List view"],
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
            title="Import relays from JSON (merges; skips ones already listed)"
            className="p-2 rounded-md text-muted hover:text-fg hover:bg-fg/5 transition-colors"
          >
            <FileInput size={16} />
          </button>
          <button
            onClick={() => void doExport()}
            disabled={rows.length === 0}
            title="Export relays to JSON"
            className="p-2 rounded-md text-muted hover:text-fg hover:bg-fg/5 disabled:opacity-40 transition-colors"
          >
            <FileOutput size={16} />
          </button>
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
        {rows.length === 0 ? (
          <div className="text-center text-muted text-sm py-16">
            No relays. Click <span className="text-fg">Add</span> or import a JSON list.
          </div>
        ) : items.length === 0 ? (
          <div className="text-center text-muted text-sm py-16">
            No relays match <span className="text-fg font-mono">{query}</span>.
          </div>
        ) : view === "list" ? (
          <div className="max-w-[1400px] mx-auto">
            <RelayTable
              items={sortedItems}
              sortKey={sortKey}
              sortDir={sortDir}
              onSort={onSort}
              expandedId={expandedId}
              onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
              onChange={updateUrl}
              onPing={(id) => void pingOne(id)}
              onRemove={removeRow}
              wide={cols > 1}
            />
          </div>
        ) : (
          // one column at the default window size; flows into a grid when the
          // window is widened, so six relays fit on a maximised screen.
          // auto-rows-fr: every card on a page matches the tallest one.
          <div className="grid gap-3 mx-auto auto-rows-fr grid-cols-1 max-w-[680px] lg:grid-cols-2 lg:max-w-[1400px] 2xl:grid-cols-3 2xl:max-w-[1880px]">
            {visibleItems.map((it) => (
              <RelayCard
                key={it.id}
                url={it.url}
                probe={it.probe}
                checking={it.checking}
                onChange={(url) => updateUrl(it.id, url)}
                onPing={() => void pingOne(it.id)}
                onRemove={() => removeRow(it.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* footer summary */}
      <footer className="px-5 py-2.5 border-t border-surface/60 text-xs text-muted flex items-center gap-4">
        <span>
          {rows.length} relay{rows.length === 1 ? "" : "s"}
          {items.length !== rows.length && (
            <span className="text-fg"> · {items.length} shown</span>
          )}
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
        {toast && (
          <span
            className={cn("truncate", toast.tone === "alert" ? "text-alert" : "text-fg/80")}
            title={toast.text}
          >
            {toast.text}
          </span>
        )}
        {view === "cards" && pageCount > 1 && (
          <div className="ml-auto flex items-center gap-1 font-mono tabular-nums">
            <button
              onClick={() => setPage(safePage - 1)}
              disabled={safePage === 0}
              title="Previous page (PageUp)"
              className="p-1 rounded-md hover:text-fg hover:bg-fg/5 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              {safePage + 1} / {pageCount}
            </span>
            <button
              onClick={() => setPage(safePage + 1)}
              disabled={safePage === pageCount - 1}
              title="Next page (PageDown)"
              className="p-1 rounded-md hover:text-fg hover:bg-fg/5 disabled:opacity-30 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}
        <span className="ml-auto opacity-60">ndisc suite</span>
      </footer>
    </div>
  );
}
