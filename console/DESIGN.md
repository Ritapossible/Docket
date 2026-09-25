# Console - design system

Derived from the Internet Court reference the owner supplied. Recorded here so the styling is
a system rather than a pile of one-off values, and so a second person can extend it without
guessing.

## Palette

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#F7F3EC` | page ground, warm off-white |
| `--bg-sunk` | `#EFE8DC` | section bands, card fills on cream |
| `--bg-card` | `#EDE6D9` | numbered rows, logo chips |
| `--ink` | `#141210` | primary text on cream |
| `--ink-muted` | `#8A8175` | secondary text, right-aligned metadata |
| `--panel` | `#161413` | dark cards - terminal, stream, hero panel |
| `--panel-raised` | `#221F1C` | rows inside a dark card |
| `--panel-ink` | `#F3EFE8` | text on dark |
| `--panel-muted` | `#7C746A` | labels on dark |
| `--purple` | `#4A0061` | brand accent on light surfaces: eyebrows, highlighted phrases, badges, the highlighted row |
| `--purple-lift` | `#C368DF` | the same hue on dark panels: denials, the `$` prompt, the breach bar, buttons |
| `--purple-wash` | `rgba(74,0,97,.06)` | tinted row backgrounds |
| `--green` | `#2F8F5B` | allowed acts only - the reference has no green, this is ours |

The reference is committed to a single light look with dark inset panels. No dark-mode variant:
inventing one would mean inventing half the palette, and a design that commits reads better than
one that hedges.

### Why the accent is two colours

Monad is a purple ecosystem, so the reference's red became `#4A0061`, sampled from the Arkive
page the owner supplied. One token would not have worked. That purple scores **12.97:1** on the
cream ground and **1.28:1** on the dark panels - and the dark panels are where the denial rows,
the `$` prompt and the breach bar live. A straight find-and-replace would have made the most
important thing in the interface invisible.

So `--purple-lift` is the same hue (286°) lightened until it clears **5.54:1** on `--panel`.
Light surfaces get the brand tone, dark surfaces get the lift, and both read as one colour
because they are one hue.

The blue CTA went with the red. It belonged to a red-accented palette; beside purple it reads as
an accident rather than a decision. Every button in the console sits on a dark panel, so buttons
now use `--purple-lift` with near-black text - on-brand, and higher contrast than the blue was.

**One thing this costs.** Red carried "alert" for free, and purple does not. Denials now rely on
the word DENIED, the lifted purple, and the named rule beneath. Green/purple/amber remain
distinct in hue for the three act states, including under the common colour-vision deficiencies,
but if the alert reading matters more than palette purity, Monad Berry (`#A0055D`) is the
in-family colour to reintroduce for denial states alone.

## Type

- **Display** - Space Grotesk 700, tight tracking (`-0.03em`), large. Headlines carry one
  red-highlighted phrase and no more: *"One court, **every layer**."*
- **Body** - Inter, 400/500, generous line height.
- **Eyebrow** - JetBrains Mono, uppercase, `0.18em` tracking, small, usually red. Sits above a
  display heading and names the section: `THE STACK`, `THE GOAL`.
- **Metadata** - JetBrains Mono, muted, right-aligned in rows. Addresses, rules, gas, block
  numbers all read as data rather than prose.

## Structural signatures

Five things make the reference recognisable. The console uses all five, and nothing else needs
to be borrowed:

1. **Mono eyebrow above a display heading**, red, letterspaced.
2. **Numbered rows** - a red-outlined rounded square holding `01`, the label centre-left, and
   mono metadata pushed right.
3. **Large radii** (24px on cards, 14px on rows) with no borders on cream; separation comes
   from fill, not outline.
4. **Dark inset panels** with a header strip: label on the left, action on the right, hairline
   rule beneath, content below.
5. **Terminal lines** prefixed with a red `$`.

## What the reference does not supply

It is a marketing page; this is an operating console. Two additions, both deliberate:

- **A state colour for allowed acts.** The reference has one accent. A live stream that shows
  refusals in red needs a counterpart, so `--green` is added and used for nothing else.
- **Density.** Marketing sections breathe; a live event stream cannot. Stream rows use tighter
  spacing and the mono scale, while the narrative sections keep the reference's rhythm.

## The mark

A dot held inside a pair of brackets: something contained by bounds it cannot leave. It lives in
`console/src/components/Logo.tsx` and the favicon in `index.html` is the same geometry inline, so
the two cannot drift.

Two earlier attempts were discarded for the same reason, which is worth recording because it is
the trap in icon design. An arrow descending onto a bar was meant to read as "stopped"; it reads
as the download glyph, everywhere, whatever it was meant to say. Three stacked bars would have
read as a hamburger menu sitting directly above a nav. **A mark competes with every glyph the
viewer already knows, and it loses.** Brackets are unusual enough not to collide, and they
happen to mean the right thing.

## Typefaces

Vendored, not CDN-loaded. `console/scripts/vendor-fonts.mjs` downloads the latin subsets into
`src/fonts/` and emits `src/fonts.css`; re-run it to update them. All three families are SIL
Open Font License 1.1.

They are variable fonts, so every weight of a family resolves to a byte-identical file. The
script deduplicates by content hash and emits a weight *range* per face, which took the payload
from eight files at 277 kB to three at 100 kB.

The reason for vendoring at all is operational rather than aesthetic: a font CDN that is
unreachable from a conference network silently replaces the typography with system fallbacks in
front of the judges, and there is no way to notice in advance.

## Responsive

Supported from 320px up. `console/scripts/check-responsive.mjs` asserts there is no horizontal
overflow at 320, 360, 390, 430, 768, 1024 and 1280, and runs in CI.

Horizontal overflow is worth a test of its own because it is invisible on a desktop and ruins
the page on a phone, and because the causes look innocuous. All three found here were ordinary
values that simply exceed a small viewport: a `white-space: nowrap` metadata column, a
`flex-basis: 340px` input, and a `min-width: 260px` set inline on the score bars. The fix for
the last one was to move the layout out of an inline style and into CSS, where a breakpoint can
reach it.

**House rule: never use the `padding` shorthand on an element that also carries `.shell`.** Both
are single classes, so the later rule wins outright and the shorthand silently resets the inline
padding `.shell` exists to provide. This bug shipped twice - once in the base `.masthead` rule
and once in the mobile override - and both times it was invisible on desktop, because the
`max-width` centering supplies an inset that hides the missing padding. On a phone there is
nothing else providing it and the content sits flush against the edge. Use `padding-block`.

Below 560px the masthead stacks - wordmark on its own line, nav wrapping beneath it. Four
letterspaced mono links do not fit beside a wordmark at that width, and shrinking them until
they do makes them unreadable.

## Pages

Four in-app routes plus one external link, on a hash router (`#/architecture`). Hash rather
than paths because the build is static with a relative base, so it runs from a domain root, a
sub-directory or a local file with no rewrite rule anywhere - and a path router would need one
on every host and would break the relative asset URLs.

| Route | Holds |
| --- | --- |
| `#/` | The live mandate, the act stream, the score, and what the project is |
| `#/architecture` | The six invariants, the measured latency, the enforcement ladder, governance |
| `#/dcs-1` | The scoring spec: terms, tables, verification, known limits |
| `#/threat-model` | Every row, generated from the spec, uncovered ones first |

The current page is marked by weight and a rule as well as colour, because colour alone is not
a state. `console/scripts/check-routes.mjs` asserts each route renders real content, that the
title changes, and that no nav link points off-site except the one that should - a router is
exactly where a page can compile, mount and show an empty shell.
