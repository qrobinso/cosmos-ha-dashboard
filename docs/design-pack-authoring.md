# Authoring a Cosmos design pack

A **design pack** is a single markdown file conforming to the [DESIGN.md
spec](https://github.com/google-labs-code/design.md) (Google Labs).
Cosmos's in-product agent and any external MCP agent appends the
selected pack to its system prompt — the pack supplies *taste* (palette,
typography, density, voice) on top of the API contracts that always go
in.

Whatever taste a pack encodes renders on a wall, viewed from across a
room — see [`wall-display-principles.md`](./wall-display-principles.md). A
pack supplies palette / typography / density / voice; it must not fight
the wall-display principles. Over-dense or motion-heavy packs make bad
walls regardless of how good they'd look on a laptop. When you write the
"Don't" section, treat the principles as the floor a pack can't dip below.

## Shape

```md
---
name: My Pack
description: One-liner shown in the picker.
colors:
  bg: "#0d0c0a"
  text: "#f3ecd8"
  accent: "#c8b896"
typography:
  display:
    fontFamily: Fraunces
    fontWeight: 500
  body:
    fontFamily: Inter
    fontWeight: 400
    fontSize: 18px
rounded:
  sm: 4px
  md: 8px
spacing:
  xs: 8px
  sm: 16px
  md: 32px
---

# My Pack

## Overview
...

## Colors
...

## Typography
...

## Layout
...

## Don't
...
```

The frontmatter is parsed as YAML. The body is freeform markdown in the
canonical section order (Overview, Colors, Typography, Layout, Elevation,
Shapes, Components, Do's and Don'ts). Cosmos doesn't enforce that order
beyond what the design.md linter does; the agent is most reliable when
the standard sections are present.

## How tokens reach a scene

When the agent emits `background.color` for a scene or inline `style="..."`
for a canvas, it resolves token references like `{colors.accent}` to the
literal value from the pack's frontmatter. Tokens you don't use are
ignored — define what's useful, omit the rest.

## Authoring options

- **Via MCP** (recommended for agents): call `create_design({slug, name,
  content})`. The slug must match `^[a-z0-9][a-z0-9-]+[a-z0-9]$`. To
  iterate on an existing user pack, call `update_design({slug, content})`.
- **Via REST**: `POST /api/designs` with `{slug, name, content}`. Same
  validation. Built-ins are read-only — `PATCH` and `DELETE` against a
  built-in slug return 403.

## What "good" looks like

A pack is doing its job when two scenes the agent generates with that
pack selected look like they belong in the same family — even if the
prompts were unrelated. If you swap the pack and ask the same question,
the result should look meaningfully different.

Aim for:

- 4-6 colors in `colors`. More than that and the agent will pick at
  random.
- Two type roles (`display` and `body`) at minimum. Adding a `mono` role
  is fine if you intend canvases to use mono numerals.
- 150-300 words of body prose. Less and the agent doesn't have enough
  taste signal; more and you're paying for tokens that won't change the
  output.
- An explicit "Don't" section. The agent over-indexes on positive
  guidance — telling it what to avoid is high leverage.

## Reuse vs. create — the agent workflow

This kicks in whenever the user's request carries design intent: an
explicit aesthetic description, named colors or fonts, a "make it feel
like X" comparison, or a reference asset (image, mockup). Don't jump
straight to authoring a pack — reconcile first.

**Step 1 — survey.** List the existing packs (`list_designs` /
`GET /api/designs`). Read the 1–2 closest with `get_design` /
`GET /api/designs/:slug` so you're comparing body prose, not just preview
colors.

**Step 2 — match.** If an existing pack captures the *mood + palette
family + typographic feel* the user described, propose it and let them
choose ("that's basically the Quiet Luxury system — use that, or build
one tuned to your description?"). The bar is "would two scenes built with
this pack look like what the user described" — not "shares one color".
Don't propose a loose overlap.

**Step 3 — no match → create and inform.** Author a DESIGN.md pack
(frontmatter `colors` with 4–6 entries + `typography.display` /
`typography.body` + `spacing` / `rounded`; a ~150–300 word body in the
canonical section order with an explicit "Don't" section). `create_design`
it with an evocative kebab-case slug derived from the description
("warm 70s earthy" → `terracotta-seventies`). Use that visual language
for the scene you're building this turn, and tell the user plainly that
you made a new design system. Don't create near-duplicates of built-ins
or existing user packs.

**Step 4 — cleanup.** If the user rejects the auto-created pack,
`delete_design` removes it (confirmation-gated; built-ins refuse
deletion with a 403).

A generated pack supplies palette / typography / voice *on top of*
[`wall-display-principles.md`](./wall-display-principles.md) — never
density or motion that fights glanceability; the principles are the
floor.

**In-product agent specifically:** it can't change the design dropdown
from a tool call, so it applies the pack it just authored directly to the
scene and points the user at the dropdown for future turns. If
`designPackSlug` is already set on the request, that's the user's current
pick — don't auto-create a competitor unless they explicitly ask for a
different look.
