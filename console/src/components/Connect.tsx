import {useState, type FormEvent} from "react";

import type {Connection} from "../lib/chain.ts";
import {Panel} from "./Sections.tsx";

export function Connect({
  onConnect,
  liveHref,
}: {
  onConnect: (connection: Connection) => void;
  liveHref?: string;
}) {
  const [rpc, setRpc] = useState("http://127.0.0.1:8545");
  const [mandate, setMandate] = useState("");
  const [from, setFrom] = useState("0");

  function submit(event: FormEvent) {
    event.preventDefault();
    onConnect({rpc, mandate: mandate.trim(), fromBlock: BigInt(from || "0")});
  }

  return (
    <Panel label="Connect" action={<span>read-only</span>}>
      <div className="panel-body">
        {liveHref ? (
          <p style={{marginTop: 0, marginBottom: 20}}>
            <a className="button" href={liveHref}>
              Watch the live testnet mandate
            </a>
          </p>
        ) : null}

        <div className="terminal" style={{marginBottom: 20}}>
          <span className="prompt">$</span>
          <div>
            ./demo/run.sh
            <div className="caption">
              or run a local chain and a mandate, and paste the address it prints
            </div>
          </div>
        </div>

        <form onSubmit={submit} style={{display: "grid", gap: 10}}>
          <div className="field">
            <input
              value={mandate}
              onChange={(event) => setMandate(event.target.value)}
              placeholder="mandate address - 0x…"
              spellCheck={false}
              aria-label="Mandate address"
            />
          </div>
          <div className="field">
            <input
              value={rpc}
              onChange={(event) => setRpc(event.target.value)}
              placeholder="rpc url"
              spellCheck={false}
              aria-label="RPC URL"
            />
            <input
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              placeholder="from block"
              spellCheck={false}
              style={{flex: "0 1 160px"}}
              aria-label="From block"
            />
            <button className="button" type="submit">
              Watch mandate
            </button>
          </div>
        </form>

        <p style={{color: "var(--panel-muted)", fontSize: 13, marginTop: 18, marginBottom: 0}}>
          The console never holds a key and never signs. It reads public events, which is all a
          verifier ever needs - the from-block is required because public RPCs cap log queries by
          range.
        </p>
      </div>
    </Panel>
  );
}
