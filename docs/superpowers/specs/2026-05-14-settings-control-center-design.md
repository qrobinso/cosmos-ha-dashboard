# Settings Control Center Design

## Goal

Refresh the admin settings page now that it contains display behavior, Home Assistant connection, AI agent, canvas fetch, and MCP configuration. The page should feel like a settings control center: quick to scan, calm under load, and safer around credentials and network access.

## Scope

In scope:

- Redesign `display/src/routes/admin/settings/+page.svelte`.
- Preserve all current API calls, state variables, save flows, copy-to-clipboard flows, and confirmation prompts.
- Reorganize the page into categories: Status, Display, Home Assistant, AI agent, Canvas access, and MCP.
- Improve responsive behavior for desktop and mobile.
- Add clearer visual status and warning treatments for connection, credentials, fetch policy, and MCP token state.

Out of scope:

- New backend endpoints.
- Changes to settings persistence.
- Changes to the admin topbar or other admin pages.
- Adding or removing settings fields.
- Changing security behavior for agent keys, Home Assistant tokens, canvas fetch, or MCP.

## Information Architecture

The page uses a two-column control-center layout on desktop:

- A sticky left category rail with compact navigation links.
- A main column with a status summary and focused setting panels.

On mobile, the category rail becomes a horizontal tab strip above the content. The content remains a single column with panels in the same order.

Categories:

- Status: summary tiles only.
- Display: safe-area padding and transition speed.
- Home Assistant: connection source, URL, token, precedence warnings.
- AI agent: OpenRouter key and model.
- Canvas access: `cosmos.fetch` mode and allowlist.
- MCP: local agent-to-agent server toggle, endpoint, token, and config snippet.

## Visual Design

The redesign stays within the existing Cosmos admin theme: dark navy surfaces, warm action accent, cool secondary accent, and 8px-or-less practical control radii where possible. It should look denser and more operational than a marketing surface.

The status summary appears near the top as four compact tiles:

- Home Assistant: Connected or Not connected, with source.
- AI agent: Key set or Missing key, with model when available.
- Canvas access: Off, Allowlist, or Any host.
- MCP: Enabled or Off.

Panels use consistent headers:

- Title.
- Short supporting copy.
- Optional status badge or warning.
- Fields.
- Local action row.

Security-sensitive states use stronger but restrained visual treatment:

- Canvas `any` mode shows a danger-tinted warning.
- MCP token regeneration keeps its confirmation and places token actions in a clearly bounded credential area.
- Home Assistant environment precedence remains visible when environment variables override saved settings.

## Behavior

All existing behavior is preserved:

- Settings load concurrently on mount.
- Each panel saves independently.
- Saved indicators remain local to the panel.
- Home Assistant token and OpenRouter key remain write-only.
- MCP token and Claude config snippet can be copied.
- MCP enablement can generate a token.
- Regenerating MCP token still warns that connected agents must reconnect.

The category rail should use anchor links, not hide content behind tabs. This keeps browser find, scrolling, and deep links useful.

## Component Plan

Keep implementation scoped to the Svelte page unless a tiny local helper component becomes clearly worthwhile.

Likely local page helpers:

- `statusItems` reactive array for the summary tiles.
- `sections` array for category rail labels and anchor targets.
- Small helper functions for labels and status variants.

CSS should define page-local primitives:

- `.settings-shell`
- `.settings-rail`
- `.settings-content`
- `.status-grid`
- `.status-tile`
- `.settings-panel`
- `.panel-head`
- `.panel-actions`
- `.credential-box`
- `.warning-box`

No new dependencies are needed.

## Error Handling

Keep current alert-based error handling for failed saves and failed MCP toggle/regeneration. The redesign should not introduce a larger notification system.

If an optional settings fetch fails during mount, preserve current fallback behavior so the page still renders.

## Accessibility

- Category navigation uses real anchors with readable link text.
- Status tiles use text, not color alone.
- Form labels remain associated through the existing `Field` component.
- Warning text remains visible and specific.
- Buttons keep disabled states.
- Copy actions keep success text after activation.
- Mobile layout avoids horizontal overflow in token and snippet areas.

## Testing

Verification should cover:

- `npm run build -w display`.
- Settings page renders after loading.
- Mobile and desktop layout.
- Safe-area save.
- Transition speed save and presets.
- Home Assistant save and clear-token path.
- Agent save and clear-key path.
- Canvas fetch mode switching, including allowlist textarea and any-host warning.
- MCP enable/disable display, token copy, snippet copy, and regenerate confirmation path.

## Approval

Approved direction: organized control center with sticky category rail, top status summary, grouped panels, stronger security affordances, and unchanged API/data behavior.
