---
name: Neo-Brutalist
description: High contrast, blocky, no rounding, mono everywhere.
colors:
  bg: "#ffffff"
  text: "#000000"
  surface: "#f0f0f0"
  accent: "#0033ff"
  warning: "#ff3300"
typography:
  display:
    fontFamily: JetBrains Mono
    fontWeight: 700
    letterSpacing: "0em"
  body:
    fontFamily: JetBrains Mono
    fontWeight: 400
    fontSize: 14px
    lineHeight: 1.4
rounded:
  sm: 0px
  md: 0px
  lg: 0px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 32px
  xl: 64px
---

# Neo-Brutalist

Information density without apology. Every pixel is utilitarian.

## Overview

Pure white background, pure black ink, single saturated accent (electric blue).
Mono everywhere — labels, numbers, headers. No anti-aliased curves anywhere
visible to the user; no rounded corners; no shadows except a single 4px
hard-edged offset when separation is genuinely needed.

## Colors

- `bg` and `text` are pure (#ffffff / #000000) — no off-tones.
- `accent` is electric blue — use freely as fills, dividers, highlights.
- `warning` is reserved for genuinely urgent state (alerts, errors).

## Typography

JetBrains Mono everywhere. Body 14px, display starts at 32px and scales by
factors of 2 (32 → 64 → 128). Use `font-weight: 700` for headers and large
numerals, `400` for body.

## Layout

- Hard 4px or 8px gridlines.
- Stack information densely; let the user scan rather than meditate.
- Borders are 2px solid black where used.

## Don't

- Don't soften any edge.
- Don't blur, fade, or gradient anything.
- Don't centre body content; left-align everything.
