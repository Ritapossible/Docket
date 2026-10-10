/**
 * The two-minute pitch: mostly cards, with two windows onto the live console.
 *
 * Shares everything with record.mjs - the same injected overlay, the same clock, the same
 * "the picture is cut to the voice" rule. It differs in what it shows: a pitch has to carry
 * the problem and who it is for, which is argument rather than product, so the card is up for
 * most of it and drops twice to prove the thing being argued about is actually deployed.
 *
 *   SCRIPT=pitch node video/build-audio.mjs && node video/pitch-record.mjs
 */
import {chromium} from "playwright";
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const URL_ = process.env.TARGET ?? "https://docket-beryl.vercel.app/";
const OUT = path.join(DIR, "out-pitch");
const tl = JSON.parse(fs.readFileSync(path.join(DIR, "pitch.timeline.json"), "utf8"));
const at = Object.fromEntries(tl.segments.map((s) => [s.id, s.start]));
const TOTAL = tl.total;

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH}
    : {}),
  args: ["--force-device-scale-factor=1", "--hide-scrollbars", "--mute-audio"],
});
const context = await browser.newContext({
  viewport: {width: 1920, height: 1080},
  deviceScaleFactor: 1,
  recordVideo: {dir: OUT, size: {width: 1920, height: 1080}},
});
await context.addInitScript({path: path.join(DIR, "overlay.js")});

const page = await context.newPage();
const tCreate = Date.now();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 120)));
await page.goto(URL_, {waitUntil: "domcontentloaded"});

const PREROLL = Math.max(1500, Date.now() - tCreate + 250);
const t0 = tCreate + PREROLL;
const until = async (s) => {
  const wait = t0 + s * 1000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  else if (wait < -700) console.log(`  late ${(-wait / 1000).toFixed(1)}s at ${s}s`);
};
const V = (fn, ...a) => page.evaluate(fn, ...a).catch((e) => console.log("  step failed:", String(e).slice(0, 90)));
const cue = async (t, label, fn) => { await until(t); console.log(`${t.toFixed(1)}s ${label}`); await fn(); };
console.log(`preroll ${PREROLL}ms · total ${TOTAL}s`);

// -------------------------------------------------------------------- title
await V(() => window.__vid.setCard({
  eyebrow: "MONAD METROPOLIS &nbsp;·&nbsp; TRUST, IDENTITY &amp; AI INFRASTRUCTURE",
  h1: 'Docket',
  sub: "An AI agent's reputation, computed from what a contract actually let it do.",
  cta: "Built by Rita",
}, 0));

await cue(at.p2, "problem", () => V(() => window.__vid.setCard({
  eyebrow: "THE PROBLEM",
  h1: 'Give an AI agent money and you have <span class="hl">three problems.</span>',
})));
await cue(at.p3, "the three parts", () => V(() => window.__vid.setCard({
  eyebrow: "THE PROBLEM",
  h1: 'Give an AI agent money and you have <span class="hl">three problems.</span>',
  list: ["It can be prompt-injected.", "Its key can leak.", "And its judgement is not yours."],
  fade: false,
})));
await cue(at.p4, "so today", () => V(() => window.__vid.setCard({
  eyebrow: "TODAY",
  h1: 'You either don\'t give agents money,<br>or you <span class="hl">hand one a key and hope.</span>',
})));

// ---------------------------------------------------------------------- alt
await cue(at.p5, "what everyone else trusts", () => V(() => window.__vid.setCard({
  eyebrow: "THE ALTERNATIVES",
  h1: 'Every answer buys safety with<br><span class="hl">something you must trust.</span>',
  rows: [["An attested enclave", "trust the hardware"], ["A ZK circuit", "30–75 s of proving"],
         ["A signed mandate + trace", "catches you afterwards"], ["All of them", "stop the bad action"]],
})));
await cue(at.p6, "none leave a record", () => V(() => window.__vid.setCard({
  eyebrow: "THE GAP",
  h1: 'None of them leave a record<br>that it was <span class="hl">attempted.</span>',
})));

// ----------------------------------------------------------------- the live console
await cue(at.p7 - 0.5, "reveal the live console", async () => {
  const acts = await page.locator(".act").count();
  console.log(`  synced: ${acts} acts`);
  await V(() => window.__vid.hideCard(600));
  await V(async () => {
    const v = window.__vid;
    await v.cursorTo(900, 420, 900);
  });
});
await cue(at.p8, "one function, one key", () => V(async () => {
  const v = window.__vid;
  await v.focus(".stats", 1.22, 1700);
}));

// -------------------------------------------------------------------- record
await cue(at.p9, "never reverts", async () => {
  await V(async () => { await window.__vid.unzoom(350); });
  await V(() => window.__vid.setCard({
    eyebrow: "THE INVARIANT",
    h1: 'A policy violation <span class="hl">never reverts.</span>',
    sub: "It emits Denied and returns false.",
  }, 0));
  await V(() => window.__vid.showCard(550));
});
await cue(at.p10, "the artifact", () => V(() => window.__vid.setCard({
  eyebrow: "THE INVARIANT",
  h1: 'A policy violation <span class="hl">never reverts.</span>',
  sub: "A revert would roll back its own logs, and the refused attempt — the artifact the whole system rests on — would simply vanish.",
})));

// --------------------------------------------------------------------- score
await cue(at.p11 - 0.6, "the score, live", async () => {
  await V(() => window.__vid.hideCard(550));
  await V(async () => {
    const v = window.__vid;
    await v.focus(".score-figure", 1.3, 1600);
  });
});

// --------------------------------------------------------------------- users
await cue(at.p12 - 0.4, "who it is for", async () => {
  await V(async () => { await window.__vid.unzoom(350); });
  await V(() => window.__vid.setCard({
    eyebrow: "WHO IT IS FOR",
    h1: 'Anyone who has to <span class="hl">trust an agent with money.</span>',
    rows: [["Teams shipping agents", "treasury, trading, payments"]],
  }, 0));
  await V(() => window.__vid.showCard(550));
});
await cue(at.p13, "a bound they can prove", () => V(() => window.__vid.setCard({
  eyebrow: "WHO IT IS FOR",
  h1: 'Anyone who has to <span class="hl">trust an agent with money.</span>',
  rows: [["Teams shipping agents", "a bound they can prove"]],
  fade: false,
})));
await cue(at.p14, "the counterparties", () => V(() => window.__vid.setCard({
  eyebrow: "WHO IT IS FOR",
  h1: 'Anyone who has to <span class="hl">trust an agent with money.</span>',
  rows: [["Teams shipping agents", "a bound they can prove"],
         ["Protocols & counterparties", "careful agent, or reckless?"]],
  fade: false,
})));
await cue(at.p15, "the registries", () => V(() => window.__vid.setCard({
  eyebrow: "WHO IT IS FOR",
  h1: 'Anyone who has to <span class="hl">trust an agent with money.</span>',
  rows: [["Teams shipping agents", "a bound they can prove"],
         ["Protocols & counterparties", "careful agent, or reckless?"],
         ["ERC-8004 registries", "reputation earned, not claimed"]],
  fade: false,
})));

// --------------------------------------------------------------------- speed
await cue(at.p16, "latency is the product", () => V(() => window.__vid.setCard({
  eyebrow: "WHY MONAD",
  h1: 'The check sits inside the action loop,<br>so <span class="hl">latency is the product.</span>',
})));
await cue(at.p17, "568 ms", () => V(() => window.__vid.setCard({
  eyebrow: "MEASURED, NOT CLAIMED",
  h1: '<span class="hl">568 ms</span> act to finality.',
  rows: [["Docket on Monad testnet", "568 ms"], ["Fastest sample", "308 ms"],
         ["p99", "1.36 s"], ["A ZK gate, for scale", "30–75 s"]],
})));

// --------------------------------------------------------------------- close
await cue(at.p18, "live since September", () => V(() => window.__vid.setCard({
  eyebrow: "DOCKET &nbsp;·&nbsp; MONAD TESTNET",
  h1: 'Not a prototype.<br><span class="hl">A deployed contract.</span>',
  rows: [["Live console", "docket-beryl.vercel.app"], ["Repository", "github.com/Ritapossible/Docket"],
         ["Network", "Monad testnet · 10143"], ["Live since", "September 2026"],
         ["ERC-8004 identity", "agentId 1930"], ["Conduct score", "DCS-1, published"]],
})));
await cue(at.p19, "verify it yourself", () => V(() => window.__vid.setCard({
  eyebrow: "DOCKET &nbsp;·&nbsp; MONAD TESTNET",
  h1: 'Not a prototype.<br><span class="hl">A deployed contract.</span>',
  rows: [["Live console", "docket-beryl.vercel.app"], ["Repository", "github.com/Ritapossible/Docket"],
         ["Network", "Monad testnet · 10143"], ["Live since", "September 2026"],
         ["ERC-8004 identity", "agentId 1930"], ["Conduct score", "DCS-1, published"]],
  cta: "npm run test:published",
  fade: false,
})));

await until(TOTAL);
console.log("done, closing");
await context.close();
await browser.close();
const file = fs.readdirSync(OUT).filter((f) => f.endsWith(".webm")).map((f) => `${OUT}/${f}`);
fs.writeFileSync(path.join(DIR, "pitch.preroll.json"),
  JSON.stringify({preroll: PREROLL / 1000, file: file[0]}));
console.log("video:", file[0], "preroll", PREROLL / 1000);
