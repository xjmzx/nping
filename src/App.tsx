import { useEffect, useState } from "react";
import { Radio, Server } from "lucide-react";
import { cn } from "./lib/cn";
import RelaysView from "./RelaysView";
import HostsView from "./HostsView";

// nping has two views: Relays (the Nostr relay tester it started as) and
// Hosts (DNS / ping / ports / TLS / LND for whole machines). Each owns its
// header controls and footer; the brand + view switch here is shared.

type Mode = "relays" | "hosts";
const MODE_KEY = "nping.mode";

function loadMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "hosts" ? "hosts" : "relays";
  } catch {
    return "relays";
  }
}

export default function App() {
  const [mode, setMode] = useState<Mode>(loadMode);
  const [upleb, setUpleb] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* the view is a convenience; fine to lose */
    }
  }, [mode]);

  // The view switch doubles as the header icon: Radio for relays, Server
  // for hosts — icons rather than labels so the relay header still fits the
  // default 720px window.
  const brand = (
    <>
      <div className="flex rounded-md bg-surface p-0.5 shrink-0">
        {(
          [
            ["relays", Radio, "Relays — Nostr relay checks"],
            ["hosts", Server, "Hosts — DNS, ping, ports, TLS, LND"],
          ] as const
        ).map(([m, Icon, label]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            title={label}
            className={cn(
              "p-1.5 rounded transition-colors",
              mode === m ? "bg-bg text-accent" : "text-muted hover:text-fg",
            )}
          >
            <Icon size={18} />
          </button>
        ))}
      </div>
      <button
        onClick={() => setUpleb((v) => !v)}
        title="Toggle theme"
        className="text-2xl font-bold tracking-tight select-none shrink-0"
      >
        <span className="text-accent">n</span>
        <span className="text-mauve">ping</span>
      </button>
      {/* Hidden below lg, and the first thing to give way above it: the
          relay header's controls need the width. */}
      <span className="text-xs text-muted hidden lg:inline min-w-0 truncate">
        relay pings · service checks for VPS hosts
      </span>
    </>
  );

  return (
    <div className={cn("h-full flex flex-col", upleb && "theme-upleb")}>
      {mode === "relays" ? <RelaysView brand={brand} /> : <HostsView brand={brand} />}
    </div>
  );
}
