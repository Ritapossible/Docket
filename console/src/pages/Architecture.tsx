import {Governance} from "../components/Governance.tsx";
import {Ladder} from "../components/Ladder.tsx";
import {Eyebrow, Row} from "../components/Sections.tsx";

const INVARIANTS = [
  {
    index: "I1",
    label: "The agent moves funds only through act()",
    sub: "It holds neither the funds nor the policy. Without this there is no guarantee, only a suggestion.",
  },
  {
    index: "I2",
    label: "A policy violation never reverts",
    sub: "It emits Denied and returns false. A revert rolls back its own logs, so the refused attempt - the artifact the whole system rests on - would vanish.",
  },
  {
    index: "I3",
    label: "Tightening is immediate, loosening is timelocked",
    sub: "There is no admin key. Compromising the owner's console does not let anyone raise a limit and drain.",
  },
  {
    index: "I4",
    label: "No global mutable state on the hot path",
    sub: "State is partitioned per mandate. A shared counter would serialize every agent in the system under optimistic parallel execution.",
  },
  {
    index: "I5",
    label: "Every published number is recomputable",
    sub: "From chain events alone, by a third party. A reputation you have to trust the publisher for is not a reputation.",
  },
  {
    index: "I6",
    label: "The model never decides",
    sub: "It may translate prose into a policy struct a human approves. It may not evaluate a policy at decision time.",
  },
];

export function Architecture() {
  return (
    <>
      <section className="shell">
        <Eyebrow>Architecture</Eyebrow>
        <h1>
          Six things that are <span className="accent">always true</span>.
        </h1>
        <p className="lede">
          These define the project. Everything else is implementation and may change freely.
          Where a task appears to require breaking one, the task is wrong.
        </p>
        <div className="rows" style={{marginTop: 34}}>
          {INVARIANTS.map((inv) => (
            <Row key={inv.index} index={inv.index} label={inv.label} sub={inv.sub} />
          ))}
        </div>
      </section>

      <section className="band">
        <div className="shell centered">
          <Eyebrow>Why Monad</Eyebrow>
          <h2>
            Measured, not <span className="accent">claimed</span>.
          </h2>
          <p className="lede">
            The design says a policy check can sit inside an agent's action loop. That is a
            latency claim, so it is measured on testnet rather than argued. The alternatives in
            the ladder below buy their guarantee with a trusted enclave or tens of seconds of
            proving; this one is a pause.
          </p>
        </div>

        <div className="shell">
          <div className="stats" style={{marginTop: 32}}>
            <div className="stat light">
              <div className="k">act to finality, p50</div>
              <div className="v">568 ms</div>
            </div>
            <div className="stat light">
              <div className="k">fastest sample</div>
              <div className="v">308 ms</div>
            </div>
            <div className="stat light">
              <div className="k">p95</div>
              <div className="v">1.36 s</div>
            </div>
            <div className="stat light">
              <div className="k">gas per refusal</div>
              <div className="v">76,588</div>
            </div>
            <div className="stat light">
              <div className="k">observed block time</div>
              <div className="v">307 ms</div>
            </div>
            <div className="stat light">
              <div className="k">a ZK gate, for scale</div>
              <div className="v">30-75 s</div>
            </div>
          </div>
          <p className="lede" style={{marginTop: 22, fontSize: 15}}>
            Twenty refused acts against a live mandate on Monad testnet. The tail is more than
            twice the median, so an agent on a hard deadline budgets for 1.36 s and not for
            568 ms - reported rather than smoothed.
          </p>
        </div>
      </section>

      <Ladder />
      <Governance loosenDelay={3600n} />
    </>
  );
}
