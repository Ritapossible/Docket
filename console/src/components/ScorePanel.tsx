import type {ScoreBreakdown} from "../../../indexer/src/types.ts";
import {ppm} from "../lib/format.ts";
import {Panel} from "./Sections.tsx";

function Bar({label, value, breach}: {label: string; value: bigint; breach?: boolean}) {
  const pct = Math.min(100, Number(value) / 10_000);
  return (
    <div>
      <div className="bar-label">
        <span>{label}</span>
        <span>{ppm(value)}</span>
      </div>
      <div className="track">
        <div className={breach ? "fill breach" : "fill"} style={{width: `${pct}%`}} />
      </div>
    </div>
  );
}

export function ScorePanel({
  score,
  inputHash,
  scoredAtBlock,
  coversFullHistory,
  syncedFrom,
  mandate,
  fromBlock,
}: {
  score: ScoreBreakdown | null;
  inputHash: string | null;
  scoredAtBlock: bigint | null;
  coversFullHistory: boolean;
  syncedFrom: bigint;
  mandate: string;
  fromBlock: bigint;
}) {
  const command = `docket score ${mandate} --from ${fromBlock.toString()}${
    scoredAtBlock ? ` --at ${scoredAtBlock.toString()}` : ""
  }${score ? ` --verify ${score.score}` : ""}`;

  return (
    <Panel
      label="DCS-1 · conduct score"
      action={
        <a
          className="action"
          href="https://github.com/Ritapossible/Docket/blob/main/spec/DCS-1.md"
          target="_blank"
          rel="noreferrer"
        >
          read the spec ↗
        </a>
      }
    >
      <div className="panel-body">
        {score === null || !coversFullHistory ? (
          /*
           * A score from a windowed scan is not an approximate score, it is a wrong one:
           * DCS-1 counts every allowed act since deployment, dates the first one, and
           * accumulates every denial. Showing a plausible number computed from the last few
           * thousand blocks would be exactly the failure this project exists to argue against.
           */
          <>
            <p style={{marginTop: 0, color: "var(--panel-ink)"}}>
              Not computed here. The stream above is a live window from block{" "}
              {syncedFrom.toString()}, and DCS-1 counts every act since deployment - a score
              from a partial history would be confidently wrong rather than roughly right.
            </p>
            <div className="terminal score-command">
              <span className="prompt">$</span>
              <div>
                {command}
                <div className="caption">
                  one cold walk of the full history · reload with <code>&amp;full=1</code> to
                  compute it in the browser
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="score-row">
              <div className="score-figure">
                {score.score}
                <small> / 1000</small>
              </div>
              <div className="bars">
                <Bar label="experience" value={score.experiencePpm} />
                <Bar label="age" value={score.agePpm} />
                <Bar label="authority" value={score.authorityPpm} />
                <Bar label="breach" value={score.breachPpm} breach />
              </div>
            </div>

            <div className="terminal score-command">
              <span className="prompt">$</span>
              <div>
                {command}
                <div className="caption">
                  anyone can reproduce this number · as of block {scoredAtBlock?.toString()} ·
                  input hash {inputHash?.slice(0, 18)}…
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
