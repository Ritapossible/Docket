import threats from "../generated/threats.json";
import {Eyebrow} from "./Sections.tsx";

type Threat = {id: string; attack: string; defense: string; status: string};

function statusClass(status: string): string {
  if (status.startsWith("covered")) return "tstatus covered";
  if (status.startsWith("partial")) return "tstatus partial";
  return "tstatus open";
}

/** Strip the markdown backticks the spec uses; this is prose here, not a code block. */
function plain(text: string): string {
  return text.replace(/`/g, "");
}

/**
 * ARCHITECTURE.md §5 requires the limits to ship in the product, not only in the docs. This
 * panel is generated from spec/THREAT-MODEL.md at build time (console/scripts/gen-threats.mjs),
 * so a row downgraded in the spec cannot keep claiming coverage on screen.
 */
export function ThreatPanel() {
  const rows = threats as Threat[];
  const uncovered = rows.filter((row) => !row.status.startsWith("covered"));

  return (
    <section className="shell">
      <Eyebrow>Honest limits</Eyebrow>
      <h2>
        What this mandate <span className="accent">does not</span> protect you from.
      </h2>
      <p className="lede">
        Generated from the threat model in the repository, so it cannot drift from what the tests
        actually prove. {uncovered.length} of {rows.length} rows are not fully covered, and they
        are listed first.
      </p>

      <div style={{marginTop: 32}}>
        {[...rows]
          .sort((a, b) => Number(a.status.startsWith("covered")) - Number(b.status.startsWith("covered")))
          .map((row) => (
            <div
              className={row.status.startsWith("covered") ? "threat" : "threat gap"}
              key={row.id}
            >
              <span className="tid">{row.id}</span>
              <div>
                <div className="tattack">{plain(row.attack)}</div>
                <div className="tdefense">{plain(row.defense)}</div>
              </div>
              <span className={statusClass(row.status)}>{row.status}</span>
            </div>
          ))}
      </div>

      <p className="lede" style={{marginTop: 28, fontSize: 15}}>
        Docket bounds money, not harm. A perfectly mandated agent can still make a bad trade,
        sign something worthless, or say something ruinous. The claim is scoped to funds, and a
        counterparty should read the balance and the business terms separately.
      </p>
    </section>
  );
}
