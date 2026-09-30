// View state both sections share: the card grid's column count, the ticking
// clock behind "3 min ago", the remembered cards/list choice, the footer
// toast and the three-state column sort.

import { useCallback, useEffect, useState } from "react";
import type { SortDir } from "./relays";

// The card grid's breakpoints (lg → 2 columns, xl → 3). CardGrid's classes
// must use the same two; the list view drops its secondary columns below lg.
const MQ_2COL = "(min-width: 1024px)";
const MQ_3COL = "(min-width: 1280px)";

function useMediaQuery(q: string): boolean {
  const [on, setOn] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const update = () => setOn(m.matches);
    m.addEventListener("change", update);
    return () => m.removeEventListener("change", update);
  }, [q]);
  return on;
}

export function useColumns(): number {
  const two = useMediaQuery(MQ_2COL);
  const three = useMediaQuery(MQ_3COL);
  return three ? 3 : two ? 2 : 1;
}

/** The current time, re-read every 30 s — enough for "checked 3 min ago". */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export type View = "cards" | "list";

export function useStoredView(key: string): [View, (v: View) => void] {
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(key) === "list" ? "list" : "cards";
    } catch {
      return "cards";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, view);
    } catch {
      /* the view is a convenience; fine to lose */
    }
  }, [key, view]);
  return [view, setView];
}

export type Toast = { text: string; tone: "ok" | "alert" } | null;

/** A footer message that clears itself after 6 s. */
export function useToast(): [Toast, (t: Toast) => void] {
  const [toast, setToast] = useState<Toast>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  return [toast, setToast];
}

/** First click sorts ascending (status: failures first); second flips; third
 *  returns to the stored order. */
export function useSort<K extends string>() {
  const [sortKey, setSortKey] = useState<K | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const onSort = useCallback(
    (key: K) => {
      if (sortKey !== key) {
        setSortKey(key);
        setSortDir("asc");
      } else if (sortDir === "asc") setSortDir("desc");
      else setSortKey(null);
    },
    [sortKey, sortDir],
  );
  return { sortKey, sortDir, onSort };
}
