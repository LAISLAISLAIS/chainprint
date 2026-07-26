# Chainprint — brand type guide

Studio tool energy: dark, precise, a little weird — **not** SaaS-corporate.

## Fonts (three roles only)

| Role | Family | Token | Use |
|------|--------|-------|-----|
| **Brand** | Syne | `--font-brand` | Logo wordmark, panel titles (`Design`, `Why`), marketing heroes |
| **UI** | DM Sans | `--font-ui` | Almost everything else — body, card titles, labels, lists, buttons |
| **Mono** | JetBrains Mono | `--font-mono` / `--font-readout` | Measured values, meters, console, plugin dials |

### Hard rules

1. **Don’t stack fonts in one card.** One reading face (DM Sans). Syne only at the panel chrome level.
2. **Mono is never decorative.** No mono step numbers, badges, or “cool” counters. UI font + `tabular-nums` is enough.
3. **Weights:** 400 / 500 / 600 / 700 only (`--weight-*`). No 450 / 550 / 650 / 750 / 800.
4. **Stay on the scale** — use `--text-*` tokens; don’t invent `0.68rem` one-offs.

## Size scale

| Token | Size | Typical use |
|-------|------|-------------|
| `--text-xs` | 12px | Section labels, kickers |
| `--text-sm` | 13px | Ledes, secondary meta |
| `--text-base` | 14px | Default card / list body |
| `--text-md` | 15px | Primary reading (findings, blurbs) |
| `--text-lg` | 17px | Layer / move titles |
| `--text-xl` | 20px | In-panel hero line (still DM Sans) |
| `--text-display` | 22px | Panel titles (Syne) |

## Spacing & radius

| Token | Value | Use |
|-------|-------|-----|
| `--space-1`…`--space-6` | 4 / 8 / 12 / 16 / 24 / 32 | Gaps & padding rhythm |
| `--radius-xs` | 8px | Dense cards, chips |
| `--radius-sm` | 10px | Cards, steps |
| `--radius-btn` | 12px | Buttons |
| `--radius` | 14px | Panels / large cards |

Content panels share **16px** section gaps (`--space-4`). Dense meter grids use **8px** (`--space-2`).

## Tracking & leading

- Display / titles: `--tracking-display` / `--tracking-title`, leading `--leading-tight`–`--leading-snug`
- Body: `--tracking-body`, `--leading-body`
- Labels: `--tracking-label` (**0.05em**) — don’t go wider

## Hierarchy pattern (Design / Why / similar)

```
Panel title     Syne · text-display · bold
Panel sub       DM Sans · text-sm · regular · silkscreen
Section label   DM Sans · text-xs · semibold · uppercase · silkscreen
Section lede    DM Sans · text-sm · regular · muted
Card title      DM Sans · text-lg · semibold
Card body       DM Sans · text-base or text-md · regular
```

## Color feel (analyzing screen is the north star)

- Void black backgrounds, bright white primary, soft grey secondary (`--silkscreen`)
- Quieter copy: `--muted` / `--lamp-dim`
- **Teal** (`--teal`) is the live accent — analyzing chain hue-fade, success ticks, sparse live lamps. Not decorative underlines or every card wash.
- Warm **metal/gold is retired** from product chrome (`--metal*` aliases to teal for legacy rules)
- Quiet chrome: hairline rules (`--panel-edge` / `--studio-rule` / `--surface-border`), shared card fill `--surface`
- Pack content to the top (`align-content: start`) — never stretch short blocks into empty viewport voids
- Motion: analyzing mark hue-cycles through teal; elsewhere short fades; hover is border/background only (no bounce)

### Exception — DAW plugin skins

Ableton / Logic / Pro Tools face skins in `css/app.css` may keep host-faithful accent colors. Product UI (studio, auth, find, share, settings) uses teal only for live/success accents.

## Anti-patterns

- Syne on every `h3` inside a scroll panel
- Mixing three fonts inside one list item
- Tiny uppercase labels with wide tracking (reads as noise)
- Corporate “Inter + soft purple” vibes
- Gold / champagne accents in product chrome
- Teal neon everywhere (keep it sparse — analyzing + confirmation)
- Short column beside a tall list (creates dead black bands)
- Page-level `--brand` / `--accent` overrides that drift from chassis
