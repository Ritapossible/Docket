import threats from "../generated/threats.json";
import {Eyebrow} from "../components/Sections.tsx";

type Threat = {id: string; attack: string; defense: string; status: string};

function statusClass(status: string): string {
  if (status.startsWith("covered")) return "tstatus covered";
  if (status.startsWith("partial")) return "tstatus partial";
  return "tstatus open";
}

function plain(text: string): string {
  return text.replace(/`/g, "");
}

/**
 * Generated from spec/THREAT-MODEL.md at build time by console/scripts/gen-threats.mjs. A
 * transcription drifts: someone downgrades a row in the spec, the page keeps claiming
 * coverage, and the honest disclosure quietly becomes a lie.
 */
export function ThreatModel() {
  const rows = threats as Threat[];
  const covered = rows.filter((r) => r.status.startsWith("covered"));
  const open = rows.filter((r) => !r.status.startsWith("covered"));

  return (
    <>
      <section className="shell">
        <Eyebrow>Honest limits</Eyebrow>
        <h1>
          What this mandate <span className="accent">does not</span> protect you from.
        </h1>
        <p className="lede">
          Generated from the threat model in the repository, so it cannot drift from what the
          tests prove. A row may not be marked covered until a test names its ID, and the check
          that enforces that has already caught one claim that was not true.
        </p>
        <div className="stats" style={{marginTop: 30}}>
          <div className="stat light">
            <div className="k">rows</div>
            <div className="v">{rows.length}</div>
          </div>
          <div className="stat light">
            <div className="k">covered by a test</div>
            <div className="v">{covered.length}</div>
          </div>
          <div className="stat light">
            <div className="k">partial or open</div>
            <div className="v">{open.length}</div>
          </div>
        </div>
      </section>

      <section className="shell" style={{paddingTop: 0}}>
        <Eyebrow muted>Not fully covered</Eyebrow>
        <div style={{marginTop: 14}}>
          {open.map((row) => (
            <div className="threat gap" key={row.id}>
              <span className="tid">{row.id}</span>
              <div>
                <div className="tattack">{plain(row.attack)}</div>
                <div className="tdefense">{plain(row.defense)}</div>
              </div>
              <span className={statusClass(row.status)}>{row.status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="shell" style={{paddingTop: 0}}>
        <Eyebrow muted>Covered, with a test that names the row</Eyebrow>
        <div style={{marginTop: 14}}>
          {covered.map((row) => (
            <div className="threat" key={row.id}>
              <span className="tid">{row.id}</span>
              <div>
                <div className="tattack">{plain(row.attack)}</div>
                <div className="tdefense">{plain(row.defense)}</div>
              </div>
              <span className={statusClass(row.status)}>{row.status}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="band">
        <div className="shell centered">
          <Eyebrow>Scope</Eyebrow>
          <h2>
            It bounds money, <span className="accent">not harm</span>.
          </h2>
          <p className="lede">
            A perfectly mandated agent can still make a bad trade, sign something worthless, or
            say something ruinous. The claim is scoped to funds, and a counterparty should read
            the balance and the business terms separately. Sybil resistance here is economic
            rather than cryptographic: a fresh mandate genuinely starts clean, and what is
            expensive to fabricate is an aged, funded record.
          </p>
        </div>
      </section>
    </>
  );
}
