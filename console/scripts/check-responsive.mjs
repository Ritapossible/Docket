#!/usr/bin/env node
/**
 * Fails if the console overflows horizontally at any supported width.
 *
 * Horizontal overflow is the one layout bug that is invisible on a desktop and ruins the page
 * on a phone, and it is caused by ordinary-looking values - a nowrap label, a flex-basis, a
 * grid minimum - that are simply wider than a small viewport. Asserting it is cheaper than
 * catching it in a screenshot.
 *
 *   node console/scripts/check-responsive.mjs <mandate> [widths...]
 */
import {chromium} from "playwright";

const mandate = process.argv[2];
const widths = process.argv.slice(3).map(Number).filter(Boolean);
const sizes = widths.length > 0 ? widths : [320, 360, 390, 430, 768, 1024, 1280];

const rpc = process.env.RPC_URL ?? "http://127.0.0.1:8545";
const base = process.env.CONSOLE_URL ?? "http://127.0.0.1:4180";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

if (!mandate) {
  console.error("usage: check-responsive.mjs <mandate-address> [widths...]");
  process.exit(1);
}

const browser = await chromium.launch(executablePath ? {executablePath} : {});
let failures = 0;

for (const width of sizes) {
  const page = await browser.newPage({
    viewport: {width, height: 820},
    deviceScaleFactor: 2,
    isMobile: width < 700,
  });
  await page.goto(`${base}/?mandate=${mandate}&rpc=${encodeURIComponent(rpc)}&from=0`, {
    waitUntil: "networkidle",
  });
  await page.waitForTimeout(2000);

  const report = await page.evaluate(() => {
    const offenders = [];
    for (const el of document.querySelectorAll("*")) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "auto") {
        offenders.push(
          `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0] || "-"} ${el.scrollWidth}>${el.clientWidth}`,
        );
      }
    }
    return {doc: document.documentElement.scrollWidth, view: window.innerWidth, offenders};
  });

  const ok = report.doc <= report.view + 1 && report.offenders.length === 0;
  if (!ok) failures += 1;
  console.log(
    `${String(width).padStart(5)}px  ${ok ? "ok" : `OVERFLOW  ${report.doc}>${report.view}  ${report.offenders.slice(0, 3).join(", ")}`}`,
  );
  await page.close();
}

await browser.close();
if (failures > 0) {
  console.error(`\nFAILED: horizontal overflow at ${failures} width(s).`);
  process.exit(1);
}
console.log("\nOK: no horizontal overflow at any supported width.");
