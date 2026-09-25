import {ActStream} from "../components/ActStream.tsx";
import {Connect} from "../components/Connect.tsx";
import {ScorePanel} from "../components/ScorePanel.tsx";
import {Eyebrow, Panel, Stat} from "../components/Sections.tsx";
import {href} from "../router.ts";
import type {Connection, MandateView} from "../lib/chain.ts";
import {formatEth, shortAddress} from "../lib/format.ts";
import {usePublishedScore} from "../lib/published.ts";

const TESTNET = {
  showcase: "0x2EC195646731F274c0e500f3B671C04189446Ae9",
  deployBlock: "65577709",
  /** ERC-8004 identity for the showcase mandate. Its DCS-1 scores are read from the registry. */
  agentId: 1930n,
  rpc: "https://testnet-rpc.monad.xyz",
  explorer: "https://testnet.monadexplorer.com/address/0x2EC195646731F274c0e500f3B671C04189446Ae9",
};

export function Overview({
  connection,
  view,
  status,
  onConnect,
  onDisconnect,
}: {
  connection: Connection | null;
  view: MandateView | null;
  status: {kind: "idle" | "loading" | "error" | "ready"; message?: string};
  onConnect: (c: Connection) => void;
  onDisconnect: () => void;
}) {
  // Read the published score whatever the local sync is doing. When the browser can compute
  // the score itself the two should agree, and when it cannot this is the only number on offer.
  const published = usePublishedScore(
    connection?.rpc ?? TESTNET.rpc,
    connection?.mandate.toLowerCase() === TESTNET.showcase.toLowerCase() ? TESTNET.agentId : null,
  );

  const liveHref = `${window.location.pathname}?mandate=${TESTNET.showcase}&rpc=${encodeURIComponent(TESTNET.rpc)}&from=${TESTNET.deployBlock}`;

  return (
    <>
      <section className="shell">
        <Eyebrow>Docket · Monad testnet</Eyebrow>
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
          {view && connection ? (
            <Panel
              label={`Mandate ${shortAddress(connection.mandate)}`}
              action={
                <button className="linkbutton" onClick={onDisconnect}>
                  disconnect
                </button>
              }
            >
              <div className="panel-body">
                <div className="stats">
                  <Stat label="Balance" value={`${formatEth(view.balance)} MON`} />
                  <Stat label="DCS-1" value={view.score ? view.score.score : "windowed"} />
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
            <Connect onConnect={onConnect} liveHref={liveHref} />
          )}
        </div>

        {status.kind === "error" ? (
          <p className="lede" style={{color: "var(--purple)", marginTop: 18}}>
            {status.message}
          </p>
        ) : null}
        {status.kind === "loading" ? (
          <p className="lede" style={{marginTop: 18}}>
            {status.message}
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
              scoredAtBlock={view.scoredAtBlock}
              coversFullHistory={view.coversFullHistory}
              syncedFrom={view.syncedFrom}
              mandate={connection.mandate}
              fromBlock={connection.fromBlock}
              published={published}
            />
          </div>
        </section>
      ) : null}

      <section className="band">
        <div className="shell">
          <Eyebrow>Live on Monad testnet</Eyebrow>
          <h2>
            Not a local demo. <span className="accent">A deployed contract</span>.
          </h2>
          <div className="stats" style={{marginTop: 28}}>
            <div className="stat light">
              <div className="k">showcase mandate</div>
              <div className="v mono">
                <a href={TESTNET.explorer} target="_blank" rel="noreferrer">
                  {shortAddress(TESTNET.showcase)} ↗
                </a>
              </div>
            </div>
            <div className="stat light">
              <div className="k">deploy block</div>
              <div className="v mono">{TESTNET.deployBlock}</div>
            </div>
            <div className="stat light">
              <div className="k">chain</div>
              <div className="v mono">monad testnet · 10143</div>
            </div>
          </div>
          <p className="lede" style={{marginTop: 22, fontSize: 15.5}}>
            Act-to-finality measured at <strong>568 ms</strong> median over twenty refused acts.{" "}
            <a href={href("architecture")}>The architecture page</a> has the numbers and the
            enforcement ladder they belong to, <a href={href("dcs-1")}>DCS-1</a> is the scoring
            spec, and <a href={href("threat-model")}>the threat model</a> lists what this does
            not protect you from.
          </p>
        </div>
      </section>
    </>
  );
}
