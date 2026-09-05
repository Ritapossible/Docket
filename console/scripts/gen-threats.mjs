#!/usr/bin/env node
/**
 * Generates the console's threat data from spec/THREAT-MODEL.md.
 *
 * ARCHITECTURE.md §5 requires the "what this mandate does not protect you from" panel to be
 * rendered from the threat model rather than transcribed into the UI. A transcription drifts:
 * someone downgrades a row in the spec, the console keeps claiming coverage, and the honest
 * disclosure quietly becomes a lie. Generating it makes that impossible.
 */
import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(here, "../../spec/THREAT-MODEL.md");
const outPath = resolve(here, "../src/generated/threats.json");

const rows = [];
for (const line of readFileSync(specPath, "utf8").split("\n")) {
  const match = line.match(/^\|\s*(T\d+)\s*\|(.+)\|(.+)\|(.+)\|\s*$/);
  if (!match) continue;
  const [, id, attack, defense, status] = match;
  rows.push({
    id,
    attack: attack.trim(),
    defense: defense.trim(),
    status: status.trim(),
  });
}

if (rows.length === 0) {
  console.error(`No threat rows parsed from ${specPath} — refusing to emit an empty panel.`);
  process.exit(1);
}

mkdirSync(dirname(outPath), {recursive: true});
writeFileSync(outPath, JSON.stringify(rows, null, 2) + "\n");
console.log(`gen-threats: ${rows.length} rows -> src/generated/threats.json`);
