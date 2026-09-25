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

  await page.goto(`${base}/${route.hash}`, {waitUntil: "networkidle"});
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
await page.goto(base, {waitUntil: "networkidle"});
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
await browser.close();

if (failures > 0) {
  console.error(`\nFAILED: ${failures} route check(s).`);
  process.exit(1);
}
console.log("\nOK: every route renders and the nav stays in the app.");
