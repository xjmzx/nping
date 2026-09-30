import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { RotateCcw, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cn } from "./lib/cn";
import { exportRelays, importRelays, probeRelay, type RelayProbe } from "./lib/tauri";
import {
  compareValues,
  exportJson,
  matchesSearch,
  parseImport,
  relayKey,
  sortValue,
  type SortKey,
} from "./lib/relays";
import { useColumns, useNow, useSort, useStoredView, useToast } from "./lib/ui";
import { RelayCard, overallStatus } from "./components/RelayCard";
import { RELAY_COLUMNS, type RelayItem } from "./components/RelayTable";
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
  ToolButton,
  ViewToggle,
  tally,
} from "./components/Section";
import { ExportButton, SyncStatus } from "./components/SyncStatus";
import { useExportSync } from "./lib/sync";

const DEFAULT_RELAYS = [
  "wss://relay.fizx.uk",
  "wss://relay.damus.io",
  "wss://nos.lol",
];

const STORAGE_KEY = "nping.relays";
const VIEW_KEY = "nping.view";
// Last result per relay url, so a restart doesn't blank the list. Keyed by
// url (not row id — ids are per session), kept apart from the list itself.
const RESULTS_KEY = "nping.relayResults";

interface StoredRelayResult {
  at: number;
  probe: RelayProbe;
}

function loadResults(): Record<string, StoredRelayResult> {
  try {
    const raw = localStorage.getItem(RESULTS_KEY);
    const v = raw ? (JSON.parse(raw) as Record<string, StoredRelayResult>) : null;
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** The stored list with each row's remembered result attached. */
function loadInitial() {
  const rows = loadRows();
  const stored = loadResults();
  const probes: Record<string, RelayProbe> = {};
  const at: Record<string, number> = {};
  for (const r of rows) {
    const s = stored[relayKey(r.url)];
    if (s) {
      probes[r.id] = s.probe;
      at[r.id] = s.at;
    }
  }
  return { rows, probes, at };
}

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

/** The relay tester: nping's original view. `brand` is the shared left side of
 *  the header (logo + view switch), owned by App. */
export default function RelaysView({ brand }: { brand: ReactNode }) {
  const [initial] = useState(loadInitial);
  const [rows, setRows] = useState<Row[]>(initial.rows);
  const [probes, setProbes] = useState<Record<string, RelayProbe>>(initial.probes);
  // When each row's probe was taken (epoch ms); read only alongside `probes`.
  const [checkedAt, setCheckedAt] = useState<Record<string, number>>(initial.at);
  const now = useNow();
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [page, setPage] = useState(0);
  const [view, setView] = useStoredView(VIEW_KEY);
  const [query, setQuery] = useState("");
  const { sortKey, sortDir, onSort } = useSort<SortKey>();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [toast, setToast] = useToast();
  const searchRef = useRef<HTMLInputElement>(null);
  const cols = useColumns();

  // Every row with its derived status, duplicate flag and search verdict,
  // in the chosen sort (cards and list alike). An empty (just-added) row
  // always shows, so a search can't hide it.
  const items: RelayItem[] = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of rows) {
      if (r.url.trim()) seen.set(relayKey(r.url), (seen.get(relayKey(r.url)) ?? 0) + 1);
    }
    const list = rows
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
          checkedAt: probe ? checkedAt[r.id] : undefined,
        };
      })
      .filter(
        (it) =>
          it.url.trim() === "" || matchesSearch(it.url, it.probe, it.status, it.dup, query),
      );
    if (!sortKey) return list;
    return [...list].sort((a, b) =>
      compareValues(
        sortValue(sortKey, a.url, a.probe, a.status),
        sortValue(sortKey, b.url, b.probe, b.status),
        sortDir,
      ),
    );
  }, [rows, probes, checkedAt, checking, query, sortKey, sortDir]);

  // Wide windows page two rows of cards at a time (6 at 3 columns); the
  // single-column default window just scrolls.
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

  useEffect(() => {
    const out: Record<string, StoredRelayResult> = {};
    for (const r of rows) {
      const probe = probes[r.id];
      const at = checkedAt[r.id];
      if (probe && at != null && r.url.trim()) out[relayKey(r.url)] = { at, probe };
    }
    try {
      localStorage.setItem(RESULTS_KEY, JSON.stringify(out));
    } catch {
      /* results are a convenience; the next check rebuilds them */
    }
  }, [rows, probes, checkedAt]);

  // Keep a live ref to rows so checkAll always sees the latest urls.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  const exported = useMemo(() => exportJson(rows.map((r) => r.url)), [rows]);
  const sync = useExportSync(
    "nping.relaysSync",
    exported,
    rows.every((r) => r.url.trim() === ""),
  );
  const syncRef = useRef(sync);
  syncRef.current = sync;

  const checkOne = useCallback(async (id: string) => {
    const row = rowsRef.current.find((r) => r.id === id);
    if (!row || row.url.trim() === "") return;
    setChecking((c) => ({ ...c, [id]: true }));
    try {
      const result = await probeRelay(row.url.trim());
      setProbes((p) => ({ ...p, [id]: result }));
      setCheckedAt((a) => ({ ...a, [id]: Date.now() }));
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

  const checkAll = useCallback(() => {
    rowsRef.current
      .filter((r) => r.url.trim() !== "")
      .forEach((r) => void checkOne(r.id));
  }, [checkOne]);

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
      const json = exportJson(rowsRef.current.map((r) => r.url));
      const path = await exportRelays(json, undefined, syncRef.current.record?.path);
      if (path) {
        syncRef.current.markSynced(json, path, "export");
        setToast({ text: `Exported to ${path}`, tone: "ok" });
      }
    } catch (e) {
      setToast({ text: `Export failed: ${String(e)}`, tone: "alert" });
    }
  }, [setToast]);

  // Import merges: new urls are appended, ones already in the list (or
  // repeated within the file) are skipped.
  const doImport = useCallback(async () => {
    try {
      const file = await importRelays(syncRef.current.record?.path);
      if (file == null) return;
      const urls = parseImport(file.contents);
      const wasEmpty = rowsRef.current.every((r) => r.url.trim() === "");
      const have = new Set(rowsRef.current.map((r) => relayKey(r.url)));
      const fresh: Row[] = [];
      for (const url of urls) {
        const k = relayKey(url);
        if (have.has(k)) continue;
        have.add(k);
        fresh.push({ id: newId(), url });
      }
      setRows((rs) => [...rs, ...fresh]);
      if (wasEmpty) syncRef.current.markSynced(exportJson(fresh.map((r) => r.url)), file.path, "import");
      else syncRef.current.rememberPath(file.path);
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
  }, [setToast]);

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
  const counts = useMemo(
    () => tally(rows.map((r) => overallStatus(probes[r.id], !!checking[r.id]))),
    [rows, probes, checking],
  );

  const card = (it: RelayItem) => (
    <RelayCard
      url={it.url}
      probe={it.probe}
      checking={it.checking}
      checkedAt={it.checkedAt}
      now={now}
      onChange={(url) => updateUrl(it.id, url)}
      onCheck={() => void checkOne(it.id)}
      onRemove={() => removeRow(it.id)}
    />
  );

  const listed = view === "list" && items.length > 0;

  return (
    <Section
      brand={brand}
      flushTop={listed}
      controls={
        <>
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
          <ViewToggle view={view} onChange={setView} />
          <ImportButton what="relays" onClick={() => void doImport()} />
          <ExportButton
            stale={sync.stale}
            disabled={rows.length === 0}
            record={sync.record}
            onClick={() => void doExport()}
          />
          <ToolButton onClick={resetDefaults} title="Restore default relays">
            <RotateCcw size={16} />
          </ToolButton>
          <AddButton what="relay" onClick={addRow} />
          <CheckAllButton
            busy={anyChecking}
            disabled={rows.every((r) => r.url.trim() === "")}
            onClick={checkAll}
          />
        </>
      }
      footer={
        <>
          <Counts total={rows.length} shown={items.length} noun="relay" {...counts} />
          <SyncStatus savedFlash={sync.savedFlash} stale={sync.stale} record={sync.record} />
          <ToastText toast={toast} />
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
        </>
      }
    >
      {rows.length === 0 ? (
        <Empty>
          <span>
            No relays. Click <span className="text-fg">Add</span> or import a JSON list.
          </span>
        </Empty>
      ) : items.length === 0 ? (
        <Empty>
          <span>
            No relays match <span className="text-fg font-mono">{query}</span>.
          </span>
        </Empty>
      ) : view === "list" ? (
        <DataTable
          columns={RELAY_COLUMNS}
          items={items}
          id={(it) => it.id}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={onSort}
          expandedId={expandedId}
          onToggle={(id) => setExpandedId((cur) => (cur === id ? null : id))}
          wide={cols > 1}
          actions={(it) => (
            <RowActions
              small
              checking={it.checking}
              disabled={it.url.trim() === ""}
              what="relay"
              onCheck={() => void checkOne(it.id)}
              onRemove={() => removeRow(it.id)}
            />
          )}
          expanded={card}
        />
      ) : (
        <CardGrid>
          {visibleItems.map((it) => (
            <Fragment key={it.id}>{card(it)}</Fragment>
          ))}
        </CardGrid>
      )}
    </Section>
  );
}
