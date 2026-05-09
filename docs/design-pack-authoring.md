# Authoring a Cosmos design pack

A **design pack** is a single markdown file conforming to the [DESIGN.md
spec](https://github.com/google-labs-code/design.md) (Google Labs).
Cosmos's in-product agent and any external MCP agent appends the
selected pack to its system prompt — the pack supplies *taste* (palette,
typography, density, voice) on top of the API contracts that always go
in.

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
