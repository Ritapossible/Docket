import {Eyebrow} from "./Sections.tsx";

/**
 * Asymmetric governance, stated as the product's own claim rather than buried in a settings
 * page. It is the shortest true sentence about this system, so it gets a section.
 */
export function Governance({loosenDelay}: {loosenDelay: bigint}) {
  const minutes = Number(loosenDelay) / 60;
  return (
    <section className="band">
      <div className="shell">
        <div className="centered">
          <Eyebrow>Governance</Eyebrow>
          <h2>
            Limits fall in <span className="accent">600 milliseconds</span> and rise in an hour.
          </h2>
          <p className="lede">
            There is no admin key. Tightening a policy takes effect in the next block; loosening
            one is queued in public and executable only after a delay. Compromising the owner's
            console does not let anyone raise a limit and drain - the only fast direction is the
            safe one.
          </p>
        </div>

        <div className="split" style={{marginTop: 36}}>
          <div className="card instant">
            <span className="timing now">effective next block</span>
            <h3 style={{marginTop: 16}}>Tightening</h3>
            <p>
              Lower a cap, shorten the expiry, remove a target from the allowlist, add an asset to
              the balance assertion, pause. Anything that can only reduce what the agent may do.
            </p>
            <div className="row-meta" style={{textAlign: "left"}}>
              owner · guardian may pause
            </div>
          </div>

          <div className="card delayed">
            <span className="timing queued">
              queued · {minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`} delay
            </span>
            <h3 style={{marginTop: 16}}>Loosening</h3>
            <p>
              Raise a cap, extend the expiry, allowlist a new target, untrack an asset, unpause.
              Queued as a public event with the full diff, so a compromise is visible before it
              can take effect.
            </p>
            <div className="row-meta" style={{textAlign: "left"}}>
              owner · cancellable instantly
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
