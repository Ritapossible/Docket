import {Eyebrow, Panel, Row} from "../components/Sections.tsx";

const EXPERIENCE = [
  ["0", "0"],
  ["1", "50,000"],
  ["10", "200,000"],
  ["100", "400,000"],
  ["1,000", "600,000"],
  ["10,000", "800,000"],
  ["100,000", "950,000"],
  ["1,000,000+", "1,000,000"],
];

/**
 * The scoring spec as a page. Values here mirror `spec/DCS-1.md`; the spec is the authority
 * and the tests are hand-computed from it, not from this.
 */
export function Dcs1() {
  return (
    <>
      <section className="shell">
        <Eyebrow>The score</Eyebrow>
        <h1>
          A number anyone can <span className="accent">recompute</span>.
        </h1>
        <p className="lede">
          DCS-1 is a pure function of a mandate's event log up to a stated block height. Given
          the same events it returns the same integer, in any language, forever. Change anything
          in the spec and you get DCS-2; you never get a different DCS-1.
        </p>
      </section>

      <section className="shell" style={{paddingTop: 0}}>
        <div className="split">
          <div className="card">
            <h3>What it scores</h3>
            <p>
              Conduct. Did this mandate stay inside its bounds, across how much activity, for how
              long, under how much authority.
            </p>
          </div>
          <div className="card">
            <h3>What it does not</h3>
            <p>
              Solvency, competence, or the operator. A balance is a public fact you can read
              directly, and folding it in would need a price oracle - which would destroy the one
              property that makes the number worth anything.
            </p>
          </div>
        </div>
      </section>

      <section className="shell">
        <Eyebrow>Determinism</Eyebrow>
        <h2>
          No floating point. <span className="accent">Anywhere</span>.
        </h2>
        <p className="lede">
          Every quantity is a non-negative integer in parts per million, every division is floor
          division, and every table is interpolated in integer arithmetic. This is not fussiness:
          a third party has to reproduce the number byte-identically, and{" "}
          <code>0.5 ** (days / 30)</code> does not reproduce across languages. So the logarithm
          became a lookup table and the decay became a stepwise halving.
        </p>
      </section>

      <section className="band">
        <div className="shell">
          <Eyebrow>The four terms</Eyebrow>
          <h2>What moves the number.</h2>
          <div className="rows" style={{marginTop: 32}}>
            <Row
              index="E"
              label="Experience"
              sub="Allowed acts, interpolated between log-spaced breakpoints. Acts cost 47k gas each, so this cannot be manufactured cheaply."
              meta="weight 0.35"
            />
            <Row
              index="A"
              label="Age"
              sub="Days since the first act, saturating at 180. The term that cannot be accelerated at any price."
              meta="weight 0.25"
            />
            <Row
              index="U"
              label="Authority"
              sub="Time-weighted native spend cap carried over the mandate's life. Granted authority, not funds held."
              meta="weight 0.20"
            />
            <Row
              index="D"
              label="Breach"
              sub="Every refusal, halving every 30 days. Hard breaches weigh 340,000 ppm; soft ones 50,000."
              meta="multiplier"
            />
          </div>

          <div className="split" style={{marginTop: 28}}>
            <div className="card">
              <h3>Hard breach</h3>
              <p>
                An attempt to exceed the mandate's authority: paying someone not on the list,
                moving more than a cap allows, touching an untracked asset. Three recent ones
                take the score to zero, whatever else is true. Conduct is a veto, not a
                contribution.
              </p>
            </div>
            <div className="card">
              <h3>Soft breach</h3>
              <p>
                An attempt that was merely mistimed: too fast, too late, or while paused. These
                accumulate slowly and fade.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="shell">
        <Eyebrow>Experience table</Eyebrow>
        <h2>Interpolated, not computed.</h2>
        <div style={{overflowX: "auto", marginTop: 24}}>
          <table className="spec-table">
            <thead>
              <tr>
                <th>Allowed acts</th>
                <th>E (ppm)</th>
              </tr>
            </thead>
            <tbody>
              {EXPERIENCE.map(([acts, ppm]) => (
                <tr key={acts}>
                  <td>{acts}</td>
                  <td>{ppm}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="lede" style={{marginTop: 20, fontSize: 15}}>
          Between breakpoints:{" "}
          <code>E = y0 + (n - x0) * (y1 - y0) / (x1 - x0)</code>, floor division.
        </p>
      </section>

      <section className="shell" style={{paddingTop: 0}}>
        <Panel label="Verification" action={<span>anyone, from chain events only</span>}>
          <div className="panel-body">
            <p style={{marginTop: 0, color: "var(--panel-ink)"}}>
              Every published score ships <code>(score, specVersion, asOf, inputHash)</code>. The
              hash commits to the exact ordered event set consumed, so a reader re-derives the
              number rather than trusting whoever published it.
            </p>
            <div className="terminal score-command">
              <span className="prompt">$</span>
              <div>
                docket score &lt;mandate&gt; --from &lt;deployBlock&gt; --verify &lt;score&gt;
                <div className="caption">
                  a cold sync that reproduces the number, or fails loudly
                </div>
              </div>
            </div>
            <p style={{color: "var(--panel-muted)", fontSize: 13.5, marginBottom: 0}}>
              A DCS-1 value that cannot be reproduced is not a low score. It is a broken
              publisher, and should be treated as one.
            </p>
          </div>
        </Panel>
      </section>

      <section className="shell">
        <Eyebrow>Known limits</Eyebrow>
        <h2>
          Stated here, not <span className="accent">discovered</span> by a reader.
        </h2>
        <div className="rows" style={{marginTop: 28}}>
          <Row
            index="01"
            label="Authority is gameable in isolation"
            sub="A large cap over an empty mandate costs nothing. It is the lowest-weighted positive term for that reason, and consumers are told to check the balance themselves."
          />
          <Row
            index="02"
            label="A compromised key can damage its own score"
            sub="An attacker holding the agent key can attempt breaches deliberately. The record is per-mandate and rotating the key does not launder it - correct for honesty, unhelpful here."
          />
          <Row
            index="03"
            label="A fresh mandate starts clean"
            sub="This is the design, not a gap. What is expensive is an aged clean record, and the age term is where that lives."
          />
          <Row
            index="04"
            label="No cross-mandate identity"
            sub="One owner running ten mandates has ten independent scores. Aggregating them would need an identity claim DCS-1 deliberately does not make."
          />
        </div>
      </section>
    </>
  );
}
