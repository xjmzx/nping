// Save / export feedback shared by both views.
//
// Every edit is already saved as it's typed (localStorage, inside the
// webview's own data dir) — what was missing was any sign of it. This hook
// gives a view two things to show:
//
//   savedAt — when the list last changed, so the footer can say "saved"
//   stale   — the list differs from what was last exported (or imported), so
//             an export file on disk no longer matches
//
// "The list" is the exact export JSON, so only what an export would write
// counts: check results and timestamps never make the export stale.

import { useCallback, useEffect, useRef, useState } from "react";

export interface SyncRecord {
  /** The export JSON as of the last export or import. */
  json: string;
  /** Epoch ms. */
  at: number;
  /** The file, so the next dialog can start there. */
  path: string;
  kind: "export" | "import";
}

function load(key: string): SyncRecord | null {
  try {
    const raw = localStorage.getItem(key);
    const v = raw ? (JSON.parse(raw) as SyncRecord) : null;
    return v && typeof v.json === "string" ? v : null;
  } catch {
    return null;
  }
}

/** How long the footer says "saved" after an edit. */
const SAVED_FLASH_MS = 3000;

export function useExportSync(storageKey: string, currentJson: string, empty: boolean) {
  const [record, setRecord] = useState<SyncRecord | null>(() => load(storageKey));
  const [savedFlash, setSavedFlash] = useState(false);
  const prev = useRef(currentJson);

  // A change to the list is an edit that was just saved. Compared against the
  // previous value rather than skipping the first run, so loading the list
  // (or React re-running effects in dev) never reads as an edit.
  useEffect(() => {
    if (prev.current === currentJson) return;
    prev.current = currentJson;
    setSavedFlash(true);
    const t = setTimeout(() => setSavedFlash(false), SAVED_FLASH_MS);
    return () => clearTimeout(t);
  }, [currentJson]);

  const markSynced = useCallback(
    (json: string, path: string, kind: SyncRecord["kind"]) => {
      const rec: SyncRecord = { json, at: Date.now(), path, kind };
      setRecord(rec);
      try {
        localStorage.setItem(storageKey, JSON.stringify(rec));
      } catch {
        /* the indicator is a convenience */
      }
    },
    [storageKey],
  );

  /** Keep the file's folder for the next dialog without claiming the list
   *  matches it — for an import merged into a list that already had entries. */
  const rememberPath = useCallback(
    (path: string) => {
      setRecord((cur) => {
        const rec: SyncRecord = cur ? { ...cur, path } : { json: "", at: 0, path, kind: "import" };
        try {
          localStorage.setItem(storageKey, JSON.stringify(rec));
        } catch {
          /* the indicator is a convenience */
        }
        return rec;
      });
    },
    [storageKey],
  );

  // Never exported counts as stale — unless there's nothing to export.
  const stale = empty ? false : record == null || record.json !== currentJson;
  return { record, stale, savedFlash, markSynced, rememberPath };
}
