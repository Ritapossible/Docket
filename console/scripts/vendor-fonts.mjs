#!/usr/bin/env node
/**
 * Downloads the latin subsets of the console's typefaces into public/fonts and emits
 * src/fonts.css.
 *
 * The console is a demo surface. Loading webfonts from a third party at runtime means a
 * restrictive network — conference wifi, a corporate proxy, an offline judge — silently
 * replaces the typography with system fallbacks mid-presentation. Vendoring removes that
 * failure mode entirely, and the licences (OFL) permit it.
 *
 * Output lands in src/ rather than public/ so Vite fingerprints the files and rewrites their
 * URLs against the configured base — a public/ asset needs a root-absolute path, which breaks
 * the moment the console is served from a sub-directory.
 *
 *   node console/scripts/vendor-fonts.mjs
 */
import {createHash} from "node:crypto";
import {mkdirSync, writeFileSync} from "node:fs";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fontDir = resolve(here, "../src/fonts");
const cssOut = resolve(here, "../src/fonts.css");

const SOURCE =
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;700&display=swap";

// A browser UA is required or Google serves the legacy ttf stylesheet.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const css = await (await fetch(SOURCE, {headers: {"User-Agent": UA}})).text();

const blocks = css.split("@font-face").slice(1);
mkdirSync(fontDir, {recursive: true});

/** family -> {file, weights:Set, style, range} — these are variable fonts, so every weight of
 *  a family resolves to the identical woff2. Writing one file per requested weight tripled the
 *  payload for byte-identical data; deduping by content hash and emitting a weight RANGE lets
 *  the browser interpolate from a single file. */
const families = new Map();

for (const block of blocks) {
  const range = block.match(/unicode-range:\s*([^;]+);/)?.[1] ?? "";
  // Keep only the plain latin subset: it covers everything this UI renders, and pulling
  // cyrillic and vietnamese would quadruple the payload for nothing.
  if (!range.includes("U+0000-00FF")) continue;

  const family = block.match(/font-family:\s*'([^']+)'/)?.[1];
  const weight = block.match(/font-weight:\s*([^;]+);/)?.[1]?.trim();
  const style = block.match(/font-style:\s*([^;]+);/)?.[1]?.trim() ?? "normal";
  const url = block.match(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/)?.[1];
  if (!family || !url || !weight) continue;

  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  const slug = family.toLowerCase().replace(/\s+/g, "-");
  const key = `${slug}:${style}:${hash}`;

  const existing = families.get(key);
  if (existing) {
    existing.weights.add(Number(weight));
    continue;
  }

  const file = `${slug}-${hash}.woff2`;
  writeFileSync(resolve(fontDir, file), bytes);
  families.set(key, {
    family,
    style,
    file,
    range: range.trim(),
    weights: new Set([Number(weight)]),
    kb: bytes.length / 1024,
  });
}

if (families.size === 0) {
  console.error("No latin font faces parsed — refusing to emit an empty stylesheet.");
  process.exit(1);
}

const out = [
  "/* Vendored by console/scripts/vendor-fonts.mjs — do not edit by hand.",
  " * Self-hosted so the console's typography cannot be removed by a hostile network.",
  " * Space Grotesk, Inter and JetBrains Mono are all SIL Open Font License 1.1. */",
  "",
];

for (const face of families.values()) {
  const weights = [...face.weights].sort((a, b) => a - b);
  const range = weights.length > 1 ? `${weights[0]} ${weights[weights.length - 1]}` : `${weights[0]}`;
  out.push(
    "@font-face {",
    `  font-family: "${face.family}";`,
    `  font-style: ${face.style};`,
    `  font-weight: ${range};`,
    "  font-display: swap;",
    `  src: url("./fonts/${face.file}") format("woff2");`,
    `  unicode-range: ${face.range};`,
    "}",
    "",
  );
  console.log(`  ${face.file}  ${face.kb.toFixed(1)} kB  weights ${range}`);
}

writeFileSync(cssOut, out.join("\n"));
console.log(`vendor-fonts: ${families.size} file(s) -> src/fonts, src/fonts.css`);
