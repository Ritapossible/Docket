import type {ActRecord} from "../../../indexer/src/types.ts";
import {formatEth, ruleSentence, shortAddress} from "../lib/format.ts";
import {Panel} from "./Sections.tsx";

const VERDICT: Record<ActRecord["kind"], {word: string; className: string}> = {
  Allowed: {word: "ALLOWED", className: "verdict allowed"},
  Denied: {word: "DENIED", className: "verdict denied"},
  WouldDeny: {word: "WOULD DENY", className: "verdict would"},
  Failed: {word: "FAILED", className: "verdict failed"},
};

export function ActStream({
  acts,
  live,
  total,
  syncing,
}: {
  acts: ActRecord[];
  live: boolean;
  /** `nonce` from the chain. The stream can hold fewer; saying so is cheaper than implying it. */
  total?: bigint;
  /** The history walk is still running. Empty then means "not yet", not "none". */
  syncing?: boolean;
}) {
  const newestFirst = [...acts].reverse();
  // `nonce` increments on every act() call, refusals included - it is what verifyManifest
  // proves the manifest complete against - so the comparison is against every act held here,
  // not the allowed ones.
  const missing =
    total === undefined || syncing ? 0n : total - BigInt(acts.length);

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
            {syncing
              ? "Reading the published act manifest, then the head of the chain."
              : "No acts yet. Every attempt this mandate makes - allowed or refused - appears here."}
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
                      refused: <span className="act-rule">{act.rule}</span> - {ruleSentence(act.rule)}
                    </span>
                  ) : null}
                </div>
                <span className="act-block">#{act.blockNumber.toString()}</span>
              </div>
            );
          })
        )}
      </div>
      {missing > 0n ? (
        <div className="caption" style={{padding: "0 1.1rem 0.9rem"}}>
          The chain counts {total!.toString()} acts. This stream shows the {acts.length} the
          published manifest and the live window reach; the rest fall in the gap between them.
          Reload with <code>&amp;full=1</code> to walk every block.
        </div>
      ) : null}
    </Panel>
  );
}
