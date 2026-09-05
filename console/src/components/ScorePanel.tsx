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
  asOfBlock,
  mandate,
  fromBlock,
}: {
  score: ScoreBreakdown;
  inputHash: string;
  asOfBlock: bigint;
  mandate: string;
  fromBlock: bigint;
}) {
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
        <div style={{display: "flex", gap: 40, flexWrap: "wrap", alignItems: "flex-end"}}>
          <div className="score-figure">
            {score.score}
            <small> / 1000</small>
          </div>
          <div className="bars" style={{flex: "1 1 320px", minWidth: 260}}>
            <Bar label="experience" value={score.experiencePpm} />
            <Bar label="age" value={score.agePpm} />
            <Bar label="authority" value={score.authorityPpm} />
            <Bar label="breach" value={score.breachPpm} breach />
          </div>
        </div>

        <div className="terminal" style={{marginTop: 28}}>
          <span className="prompt">$</span>
          <div>
            docket score {mandate} --from {fromBlock.toString()} --at {asOfBlock.toString()}{" "}
            --verify {score.score}
            <div className="caption">
              anyone can reproduce this number · input hash {inputHash.slice(0, 18)}…
            </div>
          </div>
        </div>
      </div>
    </Panel>
  );
}
