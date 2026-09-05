import type {ActRecord} from "../../../indexer/src/types.ts";
import {formatEth, ruleSentence, shortAddress} from "../lib/format.ts";
import {Panel} from "./Sections.tsx";

const VERDICT: Record<ActRecord["kind"], {word: string; className: string}> = {
  Allowed: {word: "ALLOWED", className: "verdict allowed"},
  Denied: {word: "DENIED", className: "verdict denied"},
  WouldDeny: {word: "WOULD DENY", className: "verdict would"},
  Failed: {word: "FAILED", className: "verdict failed"},
};

export function ActStream({acts, live}: {acts: ActRecord[]; live: boolean}) {
  const newestFirst = [...acts].reverse();

  return (
    <Panel
      label="Act stream"
      action={
        <span className={live ? "pill live" : "pill off"}>
          <span className="dot" />
          {live ? "live" : "idle"}
        </span>
      }
    >
      <div className="stream">
        {newestFirst.length === 0 ? (
          <div className="empty">
            No acts yet. Every attempt this mandate makes — allowed or refused — appears here.
          </div>
        ) : (
          newestFirst.map((act) => {
            const verdict = VERDICT[act.kind];
            return (
              <div className="act" key={`${act.txHash}-${act.id}`}>
                <span className={verdict.className}>{verdict.word}</span>
                <div className="act-main">
                  {act.value > 0n ? `${formatEth(act.value)} MON → ` : ""}
                  {shortAddress(act.target)}
                  {act.selector !== "0x00000000" ? ` · ${act.selector}` : ""}
                  {act.rule ? (
                    <span className="act-note">
                      refused: <span className="act-rule">{act.rule}</span> — {ruleSentence(act.rule)}
                    </span>
                  ) : null}
                </div>
                <span className="act-block">#{act.blockNumber.toString()}</span>
              </div>
            );
          })
        )}
      </div>
    </Panel>
  );
}
