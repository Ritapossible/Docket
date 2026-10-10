/* Injected at document_start into the live console. Everything the camera does lives here:
   a synthetic cursor, a zoom that re-rasterises real DOM (so text stays sharp), smooth
   scrolling, and the intro/outro cards that cover the page while it syncs. */
(() => {
  const P = {bg:"#f7f3ec", ink:"#141210", muted:"#8a8175", purple:"#4a0061",
             lift:"#c368df", panel:"#161413", panelInk:"#f3efe8", green:"#2f8f5b"};
  const ease = (t) => (t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function animate(ms, fn) {
    return new Promise((done) => {
      if (ms <= 0) { fn(1); return done(); }
      const t0 = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - t0) / ms);
        fn(ease(p));
        p < 1 ? requestAnimationFrame(step) : done();
      };
      requestAnimationFrame(step);
    });
  }

  const style = document.createElement("style");
  style.textContent = `
    html{scrollbar-width:none!important}
    html::-webkit-scrollbar,body::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}
    body{transition:transform 0ms linear}
    #vidcur{position:fixed;left:0;top:0;width:34px;height:34px;z-index:2147483647;
      pointer-events:none;will-change:transform;transform:translate(-100px,-100px);
      filter:drop-shadow(0 4px 10px rgba(0,0,0,.35))}
    #vidring{position:fixed;left:0;top:0;width:66px;height:66px;margin:-33px 0 0 -33px;
      border-radius:50%;z-index:2147483646;pointer-events:none;opacity:0;
      border:2.5px solid ${P.purple};will-change:transform,opacity}
    #vidcard{position:fixed;inset:0;z-index:2147483645;background:${P.bg};
      display:flex;align-items:center;justify-content:center;opacity:1;
      font-family:'Space Grotesk',Inter,system-ui,sans-serif;color:${P.ink}}
    #vidcard .wrap{width:1180px;max-width:88vw}
    .vfade{opacity:0;transform:translateY(16px);transition:opacity .66s cubic-bezier(.4,0,.2,1),transform .66s cubic-bezier(.4,0,.2,1)}
    .vfade.on{opacity:1;transform:none}
    #vidcard .eyebrow{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:15px;
      letter-spacing:.22em;color:${P.purple};margin-bottom:26px}
    #vidcard h1{font-size:76px;line-height:1.04;margin:0;letter-spacing:-.025em;font-weight:700}
    #vidcard h1 .hl{color:${P.purple}}
    #vidcard .sub{font-family:Inter,system-ui,sans-serif;font-size:25px;line-height:1.55;
      color:#4a443c;margin-top:30px;max-width:830px}
    #vidcard ul{list-style:none;padding:0;margin:40px 0 0;font-family:Inter,system-ui,sans-serif}
    #vidcard li{font-size:26px;padding:15px 0 15px 42px;position:relative;color:#38322b}
    #vidcard li::before{content:"";position:absolute;left:4px;top:25px;width:17px;height:3px;background:${P.purple};border-radius:2px}
    #vidcard .mark{width:70px;height:70px;margin-bottom:30px;display:block}
    #vidcard .rows{margin-top:44px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px 46px;
      font-family:'JetBrains Mono',ui-monospace,monospace;font-size:19px}
    #vidcard .rows div{display:flex;justify-content:space-between;gap:26px;
      border-bottom:1px solid rgba(20,18,16,.12);padding-bottom:13px}
    #vidcard .rows span:first-child{color:${P.muted};letter-spacing:.07em;font-size:15px;text-transform:uppercase}
    #vidcard .rows span:last-child{color:${P.ink}}
    #vidcard .cta{margin-top:50px;font-family:'JetBrains Mono',ui-monospace,monospace;
      font-size:27px;color:${P.purple};letter-spacing:.01em}
  `;
  let built = false;
  let cx = 960, cy = 980;
  const place = () => { cur.style.transform = `translate(${cx}px,${cy}px)`; };

  const cur = document.createElement("div");
  cur.id = "vidcur";
  cur.innerHTML = `<svg viewBox="0 0 24 24" width="34" height="34">
    <path d="M4 2 L4 20 L9 15.4 L12.2 22 L15.6 20.4 L12.4 14 L19 14 Z"
      fill="#fff" stroke="${P.ink}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
  const ring = document.createElement("div");
  ring.id = "vidring";

  const card = document.createElement("div");
  card.id = "vidcard";
  card.innerHTML = `<div class="wrap">
    <div class="mark vfade" id="v-mark"><svg viewBox="0 0 32 32" width="70" height="70" fill="none"><rect width="32" height="32" rx="8" fill="#4a0061"/><path d="M13 8.5H9.4v15H13M19 8.5h3.6v15H19" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="16" r="2.9" fill="#fff"/></svg></div>
    <div class="eyebrow vfade" id="v-eye">DOCKET &nbsp;·&nbsp; MONAD METROPOLIS</div>
    <h1 class="vfade" id="v-h1">An AI agent's reputation,<br>computed from <span class="hl">what a contract actually let it do.</span></h1>
    <ul id="v-list">
      <li class="vfade" id="v-l1">It can be prompt-injected.</li>
      <li class="vfade" id="v-l2">Its key can leak.</li>
      <li class="vfade" id="v-l3">And its judgement is not yours.</li>
    </ul>
    <div class="sub vfade" id="v-sub"></div>
    <div class="rows vfade" id="v-rows" style="display:none"></div>
    <div class="cta vfade" id="v-cta" style="display:none"></div>
  </div>`;

  /* The init script runs before the parser has produced <html>, so document.documentElement
     and document.head are both null at this point. Appending then throws, the whole layer
     never exists, and every later call is a silent no-op against undefined. Build lazily and
     idempotently instead, and have every public method call ready() first. */
  function build() {
    if (built || !document.documentElement) return built;
    const root = document.documentElement;
    (document.head || root).appendChild(style);
    root.appendChild(cur); root.appendChild(ring); root.appendChild(card);
    cur.style.opacity = "0";
    cur.style.transition = "opacity .45s ease";
    place();
    built = true;
    return true;
  }
  const ready = () => build();
  if (!build()) {
    const obs = new MutationObserver(() => { if (build()) obs.disconnect(); });
    obs.observe(document, {childList: true, subtree: true});
    document.addEventListener("DOMContentLoaded", build);
  }


  const show = (id, on = true) => {
    const e = document.getElementById(id);
    if (e) e.classList.toggle("on", on);
  };

  window.__vid = {
    P,
    async cursorTo(x, y, ms = 900) { ready();
      const sx = cx, sy = cy;
      await animate(ms, (p) => { cx = sx + (x - sx) * p; cy = sy + (y - sy) * p; place(); });
    },
    async click() { ready();
      ring.style.transition = "none";
      ring.style.transform = `translate(${cx}px,${cy}px) scale(.3)`;
      ring.style.opacity = "0.95";
      await sleep(16);
      ring.style.transition = "transform .5s cubic-bezier(.2,.7,.3,1),opacity .5s ease-out";
      ring.style.transform = `translate(${cx}px,${cy}px) scale(1)`;
      ring.style.opacity = "0";
      await sleep(260);
    },
    async scrollToY(y, ms = 1100) { ready();
      const s = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const t = Math.max(0, Math.min(y, max));
      await animate(ms, (p) => window.scrollTo(0, s + (t - s) * p));
    },
    /* Real zoom: a CSS transform on <body>, which Chrome re-rasterises, so type stays sharp
       instead of being upscaled pixels. The cursor lives on <html> so it is never scaled. */
    async zoomTo(scale, ox, oy, ms = 850) { ready();
      document.body.style.transformOrigin = `${ox}px ${oy}px`;
      document.body.style.transition = `transform ${ms}ms cubic-bezier(.4,0,.2,1)`;
      document.body.style.transform = `scale(${scale})`;
      await sleep(ms + 40);
    },
    async unzoom(ms = 700) { ready();
      document.body.style.transition = `transform ${ms}ms cubic-bezier(.4,0,.2,1)`;
      document.body.style.transform = "scale(1)";
      await sleep(ms + 40);
      document.body.style.transformOrigin = "";
    },
    rectOf(sel) { ready();
      const el = typeof sel === "string" ? document.querySelector(sel) : sel;
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const b = document.body.getBoundingClientRect();
      return {vx: r.left + r.width / 2, vy: r.top + r.height / 2,
              bx: r.left + r.width / 2 - b.left, by: r.top + r.height / 2 - b.top,
              pageY: r.top + window.scrollY, h: r.height, w: r.width, left: r.left, top: r.top};
    },
    /* Centre an element, then zoom about it so it grows in place. */
    async focus(sel, scale = 1.45, ms = 1400, yBias = 0) { ready();
      await this.unzoom(170);
      const r0 = this.rectOf(sel);
      if (!r0) return false;
      const target = r0.pageY + r0.h / 2 - window.innerHeight / 2 + yBias;
      await this.scrollToY(target, ms * 0.46);
      const r1 = this.rectOf(sel);
      if (!r1) return false;

      // Never zoom past what keeps the subject inside the frame with page still around it.
      // Scaling about an element's own centre pushes everything to its right off screen, and
      // on a full-width dark panel that filled the shot with a black slab - cream background
      // gone, text running off the edge, nothing like the page the link actually opens.
      const PAD = 110;
      const fit = Math.min(
        (window.innerWidth - PAD * 2) / Math.max(1, r1.w),
        (window.innerHeight - PAD * 2) / Math.max(1, r1.h),
      );
      const s = Math.max(1, Math.min(scale, fit, 1.55));

      // Together, not in sequence. Run end to end these took longer than the line they
      // illustrate, so every shot landed just as the narrator finished saying it.
      await Promise.all([
        this.cursorTo(Math.min(1860, r1.vx + r1.w * 0.22), r1.vy, ms * 0.44),
        s > 1.001 ? this.zoomTo(s, r1.bx, r1.by, ms * 0.48) : Promise.resolve(),
      ]);
      return true;
    },
    async hideCard(ms = 700) { ready();
      card.style.transition = `opacity ${ms}ms ease-in-out`;
      card.style.opacity = "0";
      await sleep(ms + 30);
      card.style.pointerEvents = "none";
      card.style.display = "none";
      cur.style.opacity = "1";
    },
    async showCard(ms = 700) { ready();
      cur.style.opacity = "0";
      card.style.display = "flex";
      card.style.transition = `opacity ${ms}ms ease-in-out`;
      await sleep(20);
      card.style.opacity = "1";
      await sleep(ms + 30);
    },
    /**
     * Set the card's whole contents at once, with a short fade between slides.
     *
     * `intro` and `outro` below are the demo walkthrough's two fixed cards. The pitch is
     * mostly cards, so it drives this instead: pass what the slide should hold and anything
     * omitted is hidden rather than left over from the slide before.
     */
    async setCard(c, ms = 360) { ready();
      const wrap = card.querySelector(".wrap");
      wrap.style.transition = `opacity ${ms}ms ease, transform ${ms}ms ease`;
      if (c.fade !== false) {
        wrap.style.opacity = "0";
        wrap.style.transform = "translateY(12px)";
        await sleep(ms + 20);
      }
      const put = (id, html) => {
        const e = document.getElementById(id);
        if (!e) return;
        if (html === undefined || html === null) { e.style.display = "none"; return; }
        e.style.display = id === "v-rows" ? "grid" : id === "v-list" ? "block" : "";
        if (html !== true) e.innerHTML = html;
        e.classList.add("on");
      };
      put("v-mark", true);
      put("v-eye", c.eyebrow);
      put("v-h1", c.h1);
      put("v-sub", c.sub);
      put("v-list", c.list ? c.list.map((t) => `<li class="vfade on">${t}</li>`).join("") : undefined);
      put("v-rows", c.rows ? c.rows.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join("") : undefined);
      put("v-cta", c.cta);
      wrap.style.opacity = "1";
      wrap.style.transform = "none";
      await sleep(ms + 20);
    },
    intro(step) { ready();
      if (step === 0) { show("v-mark"); show("v-eye"); setTimeout(() => show("v-h1"), 260); }
      if (step === 1) { show("v-l1"); }
      if (step === 2) { show("v-l2"); show("v-l3"); }
      if (step === 3) {
        ["v-l1","v-l2","v-l3"].forEach((i) => show(i, false));
        const sub = document.getElementById("v-sub");
        sub.textContent = "Every existing answer buys safety with something you must trust.";
        show("v-sub");
      }
      if (step === 4) {
        document.getElementById("v-sub").textContent =
          "Docket stops asking whether the agent is trustworthy.";
      }
      if (step === 5) {
        show("v-h1", false);
        document.getElementById("v-h1").innerHTML =
          "It records <span class=\"hl\">what a contract actually let it do.</span>";
        setTimeout(() => show("v-h1"), 60);
        document.getElementById("v-sub").textContent = "Live, on Monad testnet.";
      }
    },
    outro(rows, cta) { ready();
      document.getElementById("v-list").style.display = "none";
      document.getElementById("v-h1").innerHTML =
        "An AI agent's reputation,<br>computed from <span class=\"hl\">what a contract actually let it do.</span>";
      show("v-h1"); show("v-mark"); show("v-eye");
      const sub = document.getElementById("v-sub");
      sub.textContent = ""; sub.style.display = "none";
      const r = document.getElementById("v-rows");
      r.style.display = "grid";
      r.innerHTML = rows.map(([k, v]) => `<div><span>${k}</span><span>${v}</span></div>`).join("");
      show("v-rows");
      const c = document.getElementById("v-cta");
      c.style.display = "block"; c.textContent = cta;
      setTimeout(() => show("v-cta"), 420);
    },
  };
})();
