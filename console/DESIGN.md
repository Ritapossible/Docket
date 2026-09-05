# Console — design system

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
| `--panel` | `#161413` | dark cards — terminal, stream, hero panel |
| `--panel-raised` | `#221F1C` | rows inside a dark card |
| `--panel-ink` | `#F3EFE8` | text on dark |
| `--panel-muted` | `#7C746A` | labels on dark |
| `--red` | `#E1332A` | accent: eyebrows, highlighted phrases, denials, the `$` prompt |
| `--blue` | `#2AA0E0` | the one primary action per screen |
| `--green` | `#2F8F5B` | allowed acts only — the reference has no green, this is ours |

The reference is committed to a single light look with dark inset panels. No dark-mode variant:
inventing one would mean inventing half the palette, and a design that commits reads better than
one that hedges.

## Type

- **Display** — Space Grotesk 700, tight tracking (`-0.03em`), large. Headlines carry one
  red-highlighted phrase and no more: *"One court, **every layer**."*
- **Body** — Inter, 400/500, generous line height.
- **Eyebrow** — JetBrains Mono, uppercase, `0.18em` tracking, small, usually red. Sits above a
  display heading and names the section: `THE STACK`, `THE GOAL`.
- **Metadata** — JetBrains Mono, muted, right-aligned in rows. Addresses, rules, gas, block
  numbers all read as data rather than prose.

## Structural signatures

Five things make the reference recognisable. The console uses all five, and nothing else needs
to be borrowed:

1. **Mono eyebrow above a display heading**, red, letterspaced.
2. **Numbered rows** — a red-outlined rounded square holding `01`, the label centre-left, and
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
