#!/usr/bin/env node
/**
 * Every route must render real content and reach every other route.
 *
 * A router is exactly the kind of change where a page compiles, mounts, and shows an empty
 * shell - or where one nav link silently keeps pointing at the old destination. Neither is
 * visible to a typecheck.
 */
import {chromium} from "playwright";

const base = process.env.CONSOLE_URL ?? "http://127.0.0.1:4180";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

const ROUTES = [
  {hash: "", heading: /reputation, computed from/i, name: "Overview"},
  {hash: "#/architecture", heading: /always true/i, name: "Architecture"},
  {hash: "#/dcs-1", heading: /recompute/i, name: "DCS-1"},
  {hash: "#/threat-model", heading: /does not.*protect you from/i, name: "Threat model", minThreats: 14},
  {hash: "#/nonsense", heading: /does not.*protect you from|reputation, computed/i, name: "Unknown (falls back)"},
];

const browser = await chromium.launch(executablePath ? {executablePath} : {});
let failures = 0;

for (const route of ROUTES) {
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  const fatal = [];
  page.on("pageerror", (e) => fatal.push(String(e)));

  // connect=none: the console now defaults to the live showcase mandate, which polls every
  // two seconds, so a connected page never reaches network-idle. These checks are about
  // routing, not chain state. The bare URL is asserted separately below.
  await page.goto(`${base}/?connect=none${route.hash}`, {waitUntil: "networkidle"});
  await page.waitForTimeout(700);

  const h1 = (await page.locator("h1").first().textContent().catch(() => "")) ?? "";
  const words = ((await page.locator("main").innerText().catch(() => "")) ?? "").split(/\s+/).length;
  const title = await page.title();
  const navCount = await page.locator(".masthead nav a").count();
  const threats = await page.locator(".threat").count();
  const threatsOk = route.minThreats === undefined || threats >= route.minThreats;
  const ok =
    route.heading.test(h1) && words > 120 && fatal.length === 0 && navCount === 5 && threatsOk;

  if (!ok) failures += 1;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${route.name.padEnd(22)} words=${String(words).padStart(4)} nav=${navCount}${route.minThreats ? ` threats=${threats}` : ""} title="${title}"${fatal.length ? " errors=" + fatal[0] : ""}`,
  );
  await page.close();
}

// The nav must actually navigate, not just look like it does.
const page = await browser.newPage({viewport: {width: 1280, height: 900}});
await page.goto(`${base}/?connect=none`, {waitUntil: "networkidle"});
const hrefs = await page.locator(".masthead nav a").evaluateAll((els) =>
  els.map((e) => e.getAttribute("href") ?? ""),
);
const offsite = hrefs.filter((h) => h.startsWith("http") && !h.includes("github.com"));
const internal = hrefs.filter((h) => h.includes("#/"));
console.log(`\nnav hrefs: ${internal.length} in-app, ${hrefs.length - internal.length} external`);
if (internal.length !== 4) {
  console.log("FAIL expected 4 in-app nav links");
  failures += 1;
}
if (offsite.length > 0) {
  console.log(`FAIL nav points off-site: ${offsite.join(", ")}`);
  failures += 1;
}

await page.close();
// What a judge sees when they open the plain link with no query string.
//
// Until 10 October this showed an empty form with an RPC field reading http://127.0.0.1:8545.
// Every link we published carried a query string, so the broken path was the only one nobody
// on the team ever took.
//
// The first version of this check tested for the string "127.0.0.1" in the body text and for
// the showcase address appearing somewhere on the page. Both passed against the broken build:
// the localhost value lives in an input's `value`, which innerText does not see, and the
// address is printed in the "watch the live mandate" band whether or not anything is
// connected. Two assertions, neither capable of failing. These two discriminate instead:
// the connect form's own input, and the disconnect control that only exists once a sync has
// produced a view. domcontentloaded, not networkidle - a connected console polls forever.
{
  const bare = await browser.newPage({viewport: {width: 1280, height: 900}});
  await bare.goto(base, {waitUntil: "domcontentloaded"});

  // Wait for the sync before judging the page. The connect form is on screen until the first
  // view arrives and is then replaced, so asserting its absence immediately races the chain
  // and fails against a build that is working perfectly.
  //
  // `disconnect` renders only when a live view exists, so it proves a real sync completed
  // rather than merely that a connection object was constructed.
  const synced = await bare
    .locator("text=disconnect")
    .first()
    .waitFor({timeout: 45_000})
    .then(() => true)
    .catch(() => false);

  if (synced) {
    console.log("\nok   the bare URL syncs the showcase mandate");
  } else {
    console.log("\nFAIL the bare URL never reached a live view of the showcase mandate");
    failures += 1;
  }

  const form = await bare.locator('input[placeholder^="mandate address"]').count();
  if (form > 0) {
    console.log("FAIL the bare URL still shows the connect form after syncing");
    failures += 1;
  } else {
    console.log("ok   the connect form is gone once the mandate is live");
  }
  await bare.close();
}

// ...and the escape hatch the route checks above rely on must still give the empty form.
{
  const blank = await browser.newPage({viewport: {width: 1280, height: 900}});
  await blank.goto(`${base}/?connect=none`, {waitUntil: "networkidle"});
  const form = await blank.locator('input[placeholder^="mandate address"]').count();
  console.log(
    form === 1
      ? "ok   ?connect=none still offers the connect form"
      : "FAIL ?connect=none did not offer the connect form",
  );
  if (form !== 1) failures += 1;
  await blank.close();
}

await browser.close();

if (failures > 0) {
  console.error(`\nFAILED: ${failures} route check(s).`);
  process.exit(1);
}
console.log("\nOK: every route renders and the nav stays in the app.");
