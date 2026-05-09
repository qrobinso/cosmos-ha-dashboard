---
name: Soft Ambient
description: Low contrast, mood-video-friendly. Designed to overlay translucent video.
colors:
  bg: "transparent"
  surface: "rgba(255,255,255,0.08)"
  accent: "#e7c2c8"
  text: "#f6f1ee"
  muted: "rgba(246,241,238,0.6)"
typography:
  display:
    fontFamily: Inter
    fontWeight: 300
    letterSpacing: "-0.01em"
  body:
    fontFamily: Inter
    fontWeight: 300
    fontSize: 18px
    lineHeight: 1.5
rounded:
  sm: 12px
  md: 24px
  lg: 32px
spacing:
  xs: 12px
  sm: 24px
  md: 48px
  lg: 80px
  xl: 128px
---

# Soft Ambient

Designed to live on top of the Mood Engine's video layer. Should feel like a
gentle annotation, not a UI.

## Overview

Translucent surfaces, low-weight Inter, near-pastel accent. The text should
read clearly over a video without fighting it. Frosted-glass cards (the `surface`
token plus a backdrop-blur if available) replace solid panels.

## Colors

- `bg` is transparent so the mood video shows through.
- `surface` is a translucent white film — use sparingly for cards.
- `accent` is a muted blush — apply to small typographic accents, never fills.
- `text` is a warm cream that reads against most video backgrounds.

## Typography

Inter at weight 300. Display sizes stay modest (max ~5rem); the goal isn't to
shout, it's to whisper. Letter-spacing slightly negative on display.

## Layout

- One element per scene, generously padded.
- Anchor near the bottom or off-center; leave the upper third for the video to
  breathe.
- Rounded corners are heavy here (24px+) — they reinforce the pillowy feel.

## Don't

- Don't use solid opaque backgrounds — break the mood-video illusion.
- Don't use bold weights (≥ 600) — feels harsh on top of moving footage.
- Don't fill regions with accent colour — restrict to typographic detail.
