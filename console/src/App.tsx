import {useMemo, useState} from "react";

import {ActStream} from "./components/ActStream.tsx";
import {Connect} from "./components/Connect.tsx";
import {Governance} from "./components/Governance.tsx";
import {Logo} from "./components/Logo.tsx";
import {Ladder} from "./components/Ladder.tsx";
import {ScorePanel} from "./components/ScorePanel.tsx";
import {Eyebrow, Panel, Stat} from "./components/Sections.tsx";
import {ThreatPanel} from "./components/ThreatPanel.tsx";
import {connectionFromUrl, useMandate, type Connection} from "./lib/chain.ts";
import {formatEth, shortAddress} from "./lib/format.ts";

const REPO = "https://github.com/Ritapossible/Docket";

export function App() {
  const initial = useMemo(() => connectionFromUrl(), []);
  const [connection, setConnection] = useState<Connection | null>(initial);
  const state = useMandate(connection);
  const view = state.status === "ready" ? state.view : null;

  return (
    <>
      <header className="shell masthead">
        <a className="wordmark" href="/">
          <Logo />
          <span>
            Docket<em>&nbsp;console</em>
          </span>
        </a>
        <nav>
          <a className="navlink" href={`${REPO}/blob/main/ARCHITECTURE.md`}>
            Architecture
          </a>
          <a className="navlink" href={`${REPO}/blob/main/spec/DCS-1.md`}>
            DCS-1
          </a>
          <a className="navlink" href={`${REPO}/blob/main/spec/THREAT-MODEL.md`}>
            Threat model
          </a>
          <a className="navlink" href={REPO}>
            GitHub
          </a>
        </nav>
      </header>

      <section className="shell">
        <Eyebrow>Docket · Monad</Eyebrow>
        <h1>
          An AI agent's reputation, computed from{" "}
          <span className="accent">what a contract actually let it do</span>.
        </h1>
        <p className="lede" style={{marginTop: 22}}>
          A mandate holds the funds and the policy. The agent holds neither: it is granted
          permission to call one function, and stealing that permission gets an attacker nothing
          the agent could not already do. Every attempt - allowed or refused - is a permanent
          public record, and the refusals are what the score is built from.
        </p>

        <div style={{marginTop: 34}}>
          {view ? (
            <Panel
              label={`Mandate ${shortAddress(connection!.mandate)}`}
              action={
                <button
                  className="action"
                  style={{background: "none", border: 0, cursor: "pointer", font: "inherit"}}
                  onClick={() => setConnection(null)}
                >
                  disconnect
                </button>
              }
            >
              <div className="panel-body">
                <div className="stats">
                  <Stat label="Balance" value={`${formatEth(view.balance)} MON`} />
                  <Stat label="DCS-1" value={view.score.score} />
                  <Stat
                    label="Mode"
                    value={view.paused ? "PAUSED" : view.mode === 1 ? "ENFORCE" : "OBSERVE"}
                  />
                  <Stat label="Acts recorded" value={view.acts.length} />
                  <Stat label="Agent key" value={shortAddress(view.agent)} mono />
                  <Stat label="Owner" value={shortAddress(view.owner)} mono />
                </div>
              </div>
            </Panel>
          ) : (
            <Connect onConnect={setConnection} />
          )}
        </div>

        {state.status === "error" ? (
          <p className="lede" style={{color: "var(--red)", marginTop: 18}}>
            {state.message}
          </p>
        ) : null}
        {state.status === "loading" ? (
          <p className="lede" style={{marginTop: 18}}>
            Reading the chain…
          </p>
        ) : null}
      </section>

      {view && connection ? (
        <section className="shell" style={{paddingTop: 14}}>
          <div style={{display: "grid", gap: 14}}>
            <ActStream acts={view.acts} live />
            <ScorePanel
              score={view.score}
              inputHash={view.inputHash}
              asOfBlock={view.asOfBlock}
              mandate={connection.mandate}
              fromBlock={connection.fromBlock}
            />
          </div>
        </section>
      ) : null}

      <Ladder />
      <Governance loosenDelay={view?.loosenDelay ?? 3600n} />
      <ThreatPanel />

      <footer className="shell">
        <span>Docket · built on Monad for Metropolis</span>
        <span>Read-only. The console never holds a key.</span>
      </footer>
    </>
  );
}
