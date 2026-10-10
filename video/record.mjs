import {chromium} from "playwright";
import fs from "node:fs";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);

const URL_ = process.env.TARGET ?? "https://docket-beryl.vercel.app/";
const OUT = path.join(DIR, "out");
const tl = JSON.parse(fs.readFileSync(path.join(DIR, "timeline.json"), "utf8"));
const at = Object.fromEntries(tl.segments.map((s) => [s.id, s.start]));
const TOTAL = tl.total;

const browser = await chromium.launch({
  ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
    ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH}
    : {}),
  args: ["--force-device-scale-factor=1", "--hide-scrollbars", "--mute-audio",
         "--disable-features=CalculateNativeWinOcclusion"],
});
const context = await browser.newContext({
  viewport: {width: 1920, height: 1080},
  deviceScaleFactor: 1,
  recordVideo: {dir: OUT, size: {width: 1920, height: 1080}},
  reducedMotion: "no-preference",
});
await context.addInitScript({path: path.join(DIR, "overlay.js")});

const page = await context.newPage();
const tCreate = Date.now();
page.on("pageerror", (e) => console.log("PAGEERROR", String(e).slice(0, 120)));

await page.goto(URL_, {waitUntil: "domcontentloaded"});
const tReady = Date.now();

// One clock for everything. The audio was built first, so the picture follows it.
const PREROLL = Math.max(1500, tReady - tCreate + 250);
const t0 = tCreate + PREROLL;
const until = async (s) => {
  const wait = t0 + s * 1000 - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  else if (wait < -700) console.log(`  late ${(-wait / 1000).toFixed(1)}s at ${s}s`);
};
const V = (fn, ...a) => page.evaluate(fn, ...a).catch((e) => console.log("  step failed:", String(e).slice(0, 90)));
const cue = async (t, label, fn) => { await until(t); console.log(`${t.toFixed(1)}s ${label}`); await fn(); };

console.log(`preroll ${PREROLL}ms · total ${TOTAL}s`);

// ---------------------------------------------------------------- intro
await V(() => window.__vid.intro(0));
await cue(at.i2 - 0.1, "intro: the three parts", async () => {
  await V(() => window.__vid.intro(1));
});
await cue(at.i2 + 1.5, "intro: key + judgement", async () => {
  await V(() => window.__vid.intro(2));
});
await cue(at.i3, "intro: what you must trust", () => V(() => window.__vid.intro(3)));
await cue(at.i4, "intro: the pivot", () => V(() => window.__vid.intro(4)));
await cue(at.i5, "intro: live on Monad", () => V(() => window.__vid.intro(5)));

// The console has been syncing behind the card for ~24s; it needs about twelve.
await until(at.i5 + 4.2);
const acts = await page.locator(".act").count();
console.log(`  synced: ${acts} acts on screen`);
await V(() => window.__vid.hideCard(850));

// ---------------------------------------------------------------- hero
await cue(at.h1, "hero: the live console", async () => {
  await V(() => window.__vid.cursorTo(1480, 120, 1100));
});
await cue(at.h2, "hero: mandate holds funds", async () => {
  await V(() => window.__vid.cursorTo(560, 430, 1000));
});
await cue(at.h3, "hero: one function", async () => {
  await V(() => window.__vid.focus(".lede", 1.28, 1700));
});

// ---------------------------------------------------------------- stats
await cue(at.s1, "stats: the mandate panel", async () => {
  await V(() => window.__vid.focus(".stats", 1.3, 1700));
});
await cue(at.s2, "stats: acts recorded = nonce", async () => {
  await V(async () => {
    const v = window.__vid;
    await v.unzoom(340);
    const cards = [...document.querySelectorAll(".stat")];
    const el = cards.find((c) => /acts recorded/i.test(c.innerText)) ?? cards[3];
    await v.focus(el, 1.5, 1500);
  });
});

// ---------------------------------------------------------------- act stream
await cue(at.a1, "stream: every attempt", async () => {
  await V(async () => {
    const v = window.__vid;
    await v.unzoom(360);
    await v.focus(".stream", 1.0, 1300, -60);
  });
});
await cue(at.a2, "stream: manifest, not 42k requests", async () => {
  await V(async () => {
    const v = window.__vid;
    const rows = [...document.querySelectorAll(".act")].slice(0, 5);
    for (const r of rows) {
      const b = v.rectOf(r);
      if (b) await v.cursorTo(760, b.vy, 560);
    }
  });
});
await cue(at.a3, "stream: proved against nonce", async () => {
  await V(async () => {
    const v = window.__vid;
    const row = document.querySelector(".act");
    if (row) await v.focus(row, 1.28, 1500);
  });
});

// ---------------------------------------------------------------- score
await cue(at.d1, "score: 424", async () => {
  await V(async () => {
    const v = window.__vid;
    await v.unzoom(360);
    await v.focus(".score-figure", 1.32, 1500);
  });
});
await cue(at.d2, "score: computed in your browser", async () => {
  await V(async () => {
    const v = window.__vid;
    const cap = [...document.querySelectorAll(".caption")].find((c) => /reproduce/i.test(c.innerText));
    if (cap) { const r = v.rectOf(cap); if (r) await v.cursorTo(r.vx, r.vy, 900); }
  });
});
await cue(at.d3, "score: matches ERC-8004", async () => {
  await V(async () => {
    const v = window.__vid;
    await v.unzoom(380);
    await v.focus(".score-row", 1.26, 1600);
  });
});
await cue(at.d4, "score: owns nothing", async () => {
  await V(async () => {
    const v = window.__vid;
    const bars = document.querySelector(".bars") ?? document.querySelector(".score-row");
    if (bars) await v.focus(bars, 1.3, 1600);
  });
});

// ---------------------------------------------------------------- DCS-1
await cue(at.c1, "dcs-1: open the spec tab", async () => {
  await V(async () => {
    const v = window.__vid;
    await v.unzoom(450);
    await v.scrollToY(0, 700);
    const link = document.querySelector('nav a[href="/#/dcs-1"]');
    const r = v.rectOf(link);
    if (r) { await v.cursorTo(r.vx, r.vy, 850); await v.click(); link.click(); }
    await new Promise((x) => setTimeout(x, 500));
    window.scrollTo(0, 0);
  });
});
await cue(at.c2, "dcs-1: no floating point", async () => {
  await V(async () => {
    const v = window.__vid;
    const h = [...document.querySelectorAll("h2,h3")].find((e) => /floating point/i.test(e.innerText));
    if (h) await v.focus(h, 1.22, 1700, 150);
  });
});
await cue(at.c3, "dcs-1: the four terms", async () => {
  await V(async () => {
    const v = window.__vid;
    await v.unzoom(340);
    const h = [...document.querySelectorAll("h2,h3")].find((e) => /moves the number/i.test(e.innerText));
    if (h) await v.focus(h, 1.0, 1200, 330);
    const rows = [...document.querySelectorAll(".row")].slice(0, 4);
    for (const r of rows) { const b = v.rectOf(r); if (b) await v.cursorTo(620, b.vy, 480); }
  });
});
await cue(at.c4, "dcs-1: breach halves", async () => {
  await V(async () => {
    const v = window.__vid;
    const row = [...document.querySelectorAll(".row")].find((e) => /breach/i.test(e.innerText));
    if (row) await v.focus(row, 1.45, 1500);
  });
});

// ---------------------------------------------------------------- architecture
await cue(at.r1, "arch: open architecture", async () => {
  await V(async () => {
    const v = window.__vid;
    await v.unzoom(420);
    await v.scrollToY(0, 600);
    const link = document.querySelector('nav a[href="/#/architecture"]');
    const r = v.rectOf(link);
    if (r) { await v.cursorTo(r.vx, r.vy, 700); await v.click(); link.click(); }
    await new Promise((x) => setTimeout(x, 450));
    window.scrollTo(0, 0);
  });
});
await cue(at.r2, "arch: six invariants", async () => {
  await V(async () => {
    const v = window.__vid;
    const h = [...document.querySelectorAll("h1,h2")].find((e) => /always true/i.test(e.innerText));
    if (h) await v.focus(h, 1.0, 1400, 300);
  });
});
await cue(at.r3, "arch: a violation never reverts", async () => {
  await V(async () => {
    const v = window.__vid;
    const row = [...document.querySelectorAll(".row")].find((e) => /never reverts/i.test(e.innerText));
    if (row) await v.focus(row, 1.5, 1700);
  });
});

// ---------------------------------------------------------------- benchmark
await cue(at.r4, "bench: 568 ms", async () => {
  await V(async () => {
    const v = window.__vid;
    await v.unzoom(360);
    const st = [...document.querySelectorAll(".stat")].find((e) => /568/.test(e.innerText));
    if (st) await v.focus(st, 1.55, 1600);
  });
});
await cue(at.r5, "bench: vs a ZK gate", async () => {
  await V(async () => {
    const v = window.__vid;
    await v.unzoom(360);
    const zk = [...document.querySelectorAll(".stat")].find((e) => /30-75|30–75/.test(e.innerText));
    if (zk) await v.focus(zk, 1.55, 1600);
  });
});

// ---------------------------------------------------------------- threat model
await cue(at.t1, "threat: open threat model", async () => {
  await V(async () => {
    const v = window.__vid;
    await v.unzoom(420);
    await v.scrollToY(0, 600);
    const link = document.querySelector('nav a[href="/#/threat-model"]');
    const r = v.rectOf(link);
    if (r) { await v.cursorTo(r.vx, r.vy, 700); await v.click(); link.click(); }
    await new Promise((x) => setTimeout(x, 450));
    window.scrollTo(0, 0);
  });
});
await cue(at.t2, "threat: fourteen rows", async () => {
  await V(async () => {
    const v = window.__vid;
    const rows = [...document.querySelectorAll(".threat")];
    if (rows.length) {
      await v.focus(rows[0], 1.0, 1100, 240);
      for (const r of [rows[2], rows[6], rows[9], rows[12]].filter(Boolean)) {
        const b = v.rectOf(r);
        if (b) { await v.scrollToY(window.scrollY + b.vy - 560, 620); await v.cursorTo(480, 540, 420); }
      }
    }
  });
});

// ---------------------------------------------------------------- outro
await cue(at.o1 - 0.7, "outro card", async () => {
  await V(async () => {
    const v = window.__vid;
    await v.unzoom(420);
    await v.cursorTo(960, 1300, 700);
    v.outro(
      [["Live console", "docket-beryl.vercel.app"],
       ["Repository", "github.com/Ritapossible/Docket"],
       ["Network", "Monad testnet · 10143"],
       ["Mandate", "0x2EC1…6Ae9"],
       ["ERC-8004 identity", "agentId 1930"],
       ["Conduct score", "DCS-1 424 / 1000"]],
      "npm run test:published",
    );
    await v.showCard(800);
  });
});

await until(TOTAL);
console.log("done, closing");
await context.close();
await browser.close();
const file = fs.readdirSync(OUT).filter((f) => f.endsWith(".webm")).map((f) => `${OUT}/${f}`);
fs.writeFileSync(path.join(DIR, "preroll.json"), JSON.stringify({preroll: PREROLL / 1000, file: file[0]}));
console.log("video:", file[0], "preroll", PREROLL / 1000);
