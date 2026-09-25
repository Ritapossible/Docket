import type {ScoreBreakdown} from "../../../indexer/src/types.ts";
import {ppm} from "../lib/format.ts";
import type {PublishedState} from "../lib/published.ts";
import {Panel} from "./Sections.tsx";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

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
  published,
}: {
  score: ScoreBreakdown | null;
  inputHash: string | null;
  scoredAtBlock: bigint | null;
  coversFullHistory: boolean;
  syncedFrom: bigint;
  mandate: string;
  fromBlock: bigint;
  published: PublishedState;
}) {
  const latest = published.entries[0] ?? null;

  // Verify whichever number is on screen. If the panel is showing a published score, a command
  // that checked some other height would not be a verification of anything.
  const showingPublished = score === null || !coversFullHistory;
  const atBlock = showingPublished ? (latest?.atBlock ?? scoredAtBlock) : scoredAtBlock;
  const verify = showingPublished ? latest?.score : score?.score;

  const command = `docket score ${mandate} --from ${fromBlock.toString()}${
    atBlock ? ` --at ${atBlock.toString()}` : ""
  }${verify !== undefined ? ` --verify ${verify}` : ""}`;

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
            {/*
             * When the browser cannot compute the score, the registry can still supply one.
             * This is the ERC-8004 read path doing the job it exists for: three calls, no
             * history walk, and the number stays checkable because it is pinned to a block
             * and the recompute command is right underneath it.
             */}
            {latest ? (
              <div className="score-row">
                <div className="score-figure">
                  {latest.score}
                  <small> / 1000</small>
                </div>
                <div style={{color: "var(--panel-ink)", fontSize: "0.85rem", lineHeight: 1.6}}>
                  <div>
                    Published to ERC-8004, not computed in this browser. Pinned to block{" "}
                    {latest.atBlock.toString()}.
                  </div>
                  <div style={{marginTop: "0.4rem"}}>
                    Posted by <code>{short(latest.publisher)}</code>, which owns nothing. The
                    registry refuses feedback from the agent's own owner, so this number could
                    not have been self-awarded.
                  </div>
                  {published.entries.length > 1 ? (
                    <div style={{marginTop: "0.4rem"}}>
                      {published.entries.length} entries from{" "}
                      {new Set(published.entries.map((e) => e.publisher)).size} publisher(s).
                      They should agree; a disagreement means one indexer has a bug.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : (
              <p style={{marginTop: 0, color: "var(--panel-ink)"}}>
                Not computed here. The stream above is a live window from block{" "}
                {syncedFrom.toString()}, and DCS-1 counts every act since deployment - a score
                from a partial history would be confidently wrong rather than roughly right.
              </p>
            )}
            <div className="terminal score-command">
              <span className="prompt">$</span>
              <div>
                {command}
                <div className="caption">
                  {latest
                    ? "do not take the published number on trust · this recomputes it from the mandate's own logs"
                    : "one cold walk of the full history"}{" "}
                  · reload with <code>&amp;full=1</code> to compute it in the browser
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
