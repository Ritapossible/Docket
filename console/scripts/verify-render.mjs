#!/usr/bin/env node
/**
 * Visual smoke test: boot the built console against a seeded chain and assert the OVERVIEW
 * route rendered real mandate data, then save screenshots.
 *
 * The threat rows moved to their own route and are asserted by check-routes.mjs; this script
 * owns the live-chain surface only.
 *
 * A build that compiles is not a UI that works. This catches the failure mode a typecheck
 * cannot - the page loads, throws in a hook, and renders an empty shell.
 *
 *   anvil & node --experimental-strip-types demo/beat.ts   # seeds a mandate
 *   npm --prefix console run build && npx vite preview --port 4173
 *   node console/scripts/verify-render.mjs <mandate-address>
 */
import {chromium} from "playwright";

const mandate = process.argv[2];
const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const base = process.env.CONSOLE_URL ?? "http://127.0.0.1:4173";
const outDir = process.env.SHOT_DIR ?? "/tmp";

if (!mandate) {
  console.error("usage: verify-render.mjs <mandate-address>");
  process.exit(1);
}

// PLAYWRIGHT_CHROMIUM_PATH lets this run against a preinstalled browser whose build number
// does not match the npm package's expectation, which is the common case in CI images.
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(executablePath ? {executablePath} : {});
const page = await browser.newPage({viewport: {width: 1280, height: 1000}, deviceScaleFactor: 2});

const fatal = [];
const noise = [];
page.on("pageerror", (error) => fatal.push(`uncaught: ${error}`));
page.on("requestfailed", (request) => {
  const url = request.url();
  (url.startsWith(base) ? fatal : noise).push(`request failed: ${url}`);
});
page.on("response", (response) => {
  if (response.status() < 400) return;
  const url = response.url();
  (url.startsWith(base) ? fatal : noise).push(`${response.status()} ${url}`);
});

await page.goto(`${base}/?mandate=${mandate}&rpc=${encodeURIComponent(rpc)}&from=0`, {
  waitUntil: "networkidle",
});
await page.waitForSelector(".act", {timeout: 15_000}).catch(() => null);
await page.waitForTimeout(1500);

await page.screenshot({path: `${outDir}/console-full.png`, fullPage: true});
await page.screenshot({path: `${outDir}/console-top.png`});

const score = (await page.locator(".score-figure").first().textContent().catch(() => "")) ?? "";
const acts = await page.locator(".act").count();
const denied = await page.locator(".verdict.denied").count();

console.log(`score:   ${score.trim().replace(/\s+/g, " ")}`);
console.log(`acts:    ${acts}`);
console.log(`denied:  ${denied}`);
console.log(`fatal:   ${fatal.length === 0 ? "none" : fatal.length}`);
for (const error of fatal.slice(0, 5)) console.log(`  ! ${error}`);
if (noise.length > 0) {
  console.log(`noise:   ${noise.length} third-party resource(s), not fatal`);
  for (const item of noise.slice(0, 3)) console.log(`  - ${item}`);
}

await browser.close();

// The console exists to show refusals. A render with no denial row and no threat rows is not
// a console, whatever it looks like.
const failures = [];
if (fatal.length > 0) failures.push(`${fatal.length} fatal error(s)`);
if (acts === 0) failures.push("no acts rendered");
if (denied === 0) failures.push("no denial rendered");
if (!score.includes("/")) failures.push("score not rendered");

if (failures.length > 0) {
  console.error(`\nFAILED: ${failures.join("; ")}`);
  process.exit(1);
}
console.log("\nOK: the console rendered live mandate state.");
