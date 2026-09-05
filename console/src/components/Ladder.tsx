import {Eyebrow, Row} from "./Sections.tsx";

/**
 * The enforcement ladder from ARCHITECTURE.md — the pitch, in the reference's numbered-row
 * form. Docket occupies the last rung and is the only one highlighted, because a list where
 * everything is emphasised says nothing.
 */
const RUNGS = [
  {
    index: "01",
    label: "Client-side caps",
    sub: "The agent's own process enforces its limits.",
    meta: "answers accidents, not adversaries",
  },
  {
    index: "02",
    label: "Intent-hash binding",
    sub: "One signature binds one exact operation.",
    meta: "per-operation only",
  },
  {
    index: "03",
    label: "Signed mandate + published trace",
    sub: "Bounded spend, decisions auditable after the fact.",
    meta: "operator can still misbehave",
  },
  {
    index: "04",
    label: "Attested enclave gate",
    sub: "The policy is unreachable inside hardware you must trust.",
    meta: "denials are invisible",
  },
  {
    index: "05",
    label: "ZK circuit gate",
    sub: "A violating spend cannot produce a valid proof.",
    meta: "30–75s proving · no trace at all",
  },
  {
    index: "06",
    label: "In-loop on-chain gate",
    sub: "A contract refuses inside the agent's action loop, and the refusal is public.",
    meta: "needs sub-second finality",
    highlight: true,
  },
] as const;

export function Ladder() {
  return (
    <section className="shell">
      <div className="centered">
        <Eyebrow>The ladder</Eyebrow>
        <h2>
          Every other rung <span className="accent">hides the refusal</span>.
        </h2>
        <p className="lede">
          Bounded agent authority has been solved five ways. Each buys safety with a trusted
          component, and the two strongest both make a refusal invisible — an enclave denies
          silently, a ZK gate leaves no trace by construction. Docket makes being stopped into
          evidence, which is what makes a reputation possible at all.
        </p>
      </div>
      <div className="rows" style={{marginTop: 36}}>
        {RUNGS.map((rung) => (
          <Row
            key={rung.index}
            index={rung.index}
            label={rung.label}
            sub={rung.sub}
            meta={rung.meta}
            variant={"highlight" in rung && rung.highlight ? "highlight" : undefined}
          />
        ))}
      </div>
    </section>
  );
}
