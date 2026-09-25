import {useMemo, useState} from "react";

import {Masthead} from "./components/Masthead.tsx";
import {Architecture} from "./pages/Architecture.tsx";
import {Dcs1} from "./pages/Dcs1.tsx";
import {Overview} from "./pages/Overview.tsx";
import {ThreatModel} from "./pages/ThreatModel.tsx";
import {connectionFromUrl, useMandate, type Connection} from "./lib/chain.ts";
import {href, useRoute} from "./router.ts";

export function App() {
  const route = useRoute();
  const initial = useMemo(() => connectionFromUrl(), []);
  const [connection, setConnection] = useState<Connection | null>(initial);

  // The chain subscription lives in the shell, not in the Overview page, so navigating to the
  // spec pages and back does not tear down the sync and start the window over.
  const state = useMandate(connection);
  const view = state.status === "ready" ? state.view : null;

  const status =
    state.status === "error"
      ? {kind: "error" as const, message: state.message}
      : state.status === "loading"
        ? {kind: "loading" as const, message: state.detail}
        : {kind: state.status === "ready" ? ("ready" as const) : ("idle" as const)};

  return (
    <>
      <a className="skiplink" href="#main">
        Skip to content
      </a>
      <Masthead route={route} />

      <main id="main">
        {route === "" ? (
          <Overview
            connection={connection}
            view={view}
            status={status}
            onConnect={setConnection}
            onDisconnect={() => setConnection(null)}
          />
        ) : route === "architecture" ? (
          <Architecture />
        ) : route === "dcs-1" ? (
          <Dcs1 />
        ) : (
          <ThreatModel />
        )}
      </main>

      <footer className="shell">
        <span>Docket · built on Monad for Metropolis</span>
        <span>
          <a href={href("threat-model")}>Read-only. The console never holds a key.</a>
        </span>
      </footer>
    </>
  );
}
