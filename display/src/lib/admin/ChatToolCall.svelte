<script lang="ts">
  import type { ToolInvocation } from '@ai-sdk/ui-utils';

  /** The current invocation. May be `partial-call`, `call`, or `result`. */
  export let invocation: ToolInvocation;
  /** Names of tools that need user confirmation before any side effect runs. */
  export let confirmRequiredTools: string[];
  /** Hook from useChat — append a tool result so the conversation can continue. */
  export let addToolResult: (args: { toolCallId: string; result: unknown }) => void;

  $: isConfirmRequired = confirmRequiredTools.includes(invocation.toolName);
  $: hasResult = invocation.state === 'result';
  $: resultValue = invocation.state === 'result' ? (invocation as { result?: unknown }).result : undefined;

  // Tools that mutate a scene and return the (created or updated) scene as
  // their result. After they finish we surface action chips so the user can
  // jump straight to activating, opening the editor, or previewing.
  const SCENE_MUTATING_TOOLS = new Set([
    'create_scene',
    'update_scene',
    'patch_widget',
    'update_widget_content',
  ]);

  /** Pull a {id, name} pair from a tool result if it looks like a Scene. */
  function extractSceneInfo(name: string, result: unknown): { id: string; name: string } | null {
    if (!SCENE_MUTATING_TOOLS.has(name)) return null;
    if (!result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    if (typeof r.error === 'string') return null;
    if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
    return { id: r.id, name: r.name };
  }

  $: sceneInfo = hasResult ? extractSceneInfo(invocation.toolName, resultValue) : null;

  // Display picker state — fetched lazily on first activate-chip click.
  let displays: { id: string; name: string }[] | null = null;
  let displaysError: string | null = null;
  let activating: string | null = null;
  let activated: string | null = null;
  let displayPickerOpen = false;

  async function ensureDisplays() {
    if (displays !== null) return;
    try {
      const res = await fetch('/api/displays');
      if (!res.ok) throw new Error(`failed: ${res.status}`);
      displays = (await res.json()) as { id: string; name: string }[];
    } catch (e) {
      displaysError = e instanceof Error ? e.message : 'failed to load displays';
      displays = [];
    }
  }

  async function activateOn(displayName: string, sceneId: string) {
    activating = displayName;
    try {
      const res = await fetch(`/api/displays/${encodeURIComponent(displayName)}/scene/activate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sceneId }),
      });
      if (!res.ok) throw new Error(`activate failed: ${res.status}`);
      activated = displayName;
      displayPickerOpen = false;
    } catch (e) {
      displaysError = e instanceof Error ? e.message : 'activate failed';
    } finally {
      activating = null;
    }
  }

  async function onActivateClick(sceneId: string) {
    await ensureDisplays();
    if (!displays || displays.length === 0) return;
    if (displays.length === 1) {
      void activateOn(displays[0].name, sceneId);
    } else {
      displayPickerOpen = !displayPickerOpen;
    }
  }

  let busy = false;
  let error: string | null = null;

  /** Run the underlying side effect for a confirm-required tool. The model
   *  asked for it; the user clicked Confirm; we execute against the existing
   *  REST endpoints from the same admin origin. Then post the result back
   *  via addToolResult so the model can continue. */
  async function confirm() {
    if (invocation.state === 'result') return;
    busy = true;
    error = null;
    try {
      const args = (invocation.args ?? {}) as Record<string, unknown>;
      let result: unknown;
      switch (invocation.toolName) {
        case 'activate_scene': {
          const displayName = String(args.displayName ?? '');
          const sceneId = String(args.sceneId ?? '');
          if (!displayName || !sceneId) throw new Error('missing displayName or sceneId');
          const res = await fetch(`/api/displays/${encodeURIComponent(displayName)}/scene/activate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ sceneId }),
          });
          if (!res.ok) throw new Error(`activate failed: ${res.status} ${await res.text()}`);
          result = { confirmed: true, ok: true };
          break;
        }
        case 'delete_scene': {
          const id = String(args.id ?? '');
          if (!id) throw new Error('missing id');
          const res = await fetch(`/api/scenes/${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (!res.ok && res.status !== 204) throw new Error(`delete failed: ${res.status}`);
          result = { confirmed: true, ok: true };
          break;
        }
        case 'delete_widget': {
          const id = String(args.id ?? '');
          if (!id) throw new Error('missing id');
          const res = await fetch(`/api/widgets/${encodeURIComponent(id)}`, { method: 'DELETE' });
          if (!res.ok) throw new Error(`delete failed: ${res.status}`);
          result = { confirmed: true, ok: true };
          break;
        }
        default:
          throw new Error(`unknown confirm-required tool: ${invocation.toolName}`);
      }
      addToolResult({ toolCallId: invocation.toolCallId, result });
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      addToolResult({ toolCallId: invocation.toolCallId, result: { confirmed: true, ok: false, error } });
    } finally {
      busy = false;
    }
  }

  function reject() {
    addToolResult({
      toolCallId: invocation.toolCallId,
      result: { confirmed: false, message: 'User declined this action.' },
    });
  }

  function summarizeArgs(args: unknown): string {
    if (!args || typeof args !== 'object') return '';
    const entries = Object.entries(args as Record<string, unknown>);
    if (entries.length === 0) return '';
    return entries
      .map(([k, v]) => {
        const s = typeof v === 'string' ? (v.length > 60 ? v.slice(0, 60) + '…' : v) : JSON.stringify(v);
        return `${k}=${s}`;
      })
      .join(', ');
  }

  function summarizeResult(r: unknown): string {
    if (r === undefined || r === null) return '';
    if (typeof r === 'string') return r.length > 200 ? r.slice(0, 200) + '…' : r;
    if (Array.isArray(r)) return `${r.length} items`;
    if (typeof r === 'object') {
      const obj = r as Record<string, unknown>;
      if ('error' in obj) return `error: ${String(obj.error)}`;
      if ('id' in obj && 'name' in obj) return `${String(obj.name)} (${String(obj.id).slice(0, 8)}…)`;
      if ('ok' in obj) return obj.ok ? 'ok' : 'failed';
      return Object.keys(obj).slice(0, 4).join(', ');
    }
    return String(r);
  }
</script>

<div class="tool-call" class:confirm={isConfirmRequired && !hasResult} class:done={hasResult}>
  <div class="tool-head">
    <span class="tool-icon">⚙</span>
    <span class="tool-name">{invocation.toolName}</span>
    <span class="tool-args">{summarizeArgs(invocation.args)}</span>
  </div>

  {#if isConfirmRequired && !hasResult}
    <div class="confirm-body">
      <p class="confirm-prompt">
        {#if invocation.toolName === 'activate_scene'}
          The agent wants to push this scene live to the display. The current scene will transition out.
        {:else if invocation.toolName === 'delete_scene'}
          The agent wants to delete this scene. This is permanent.
        {:else if invocation.toolName === 'delete_widget'}
          The agent wants to delete this widget. This is permanent.
        {:else}
          The agent wants to perform a destructive action.
        {/if}
      </p>
      <div class="confirm-actions">
        <button class="primary" on:click={confirm} disabled={busy}>
          {busy ? 'Working…' : 'Confirm'}
        </button>
        <button class="ghost" on:click={reject} disabled={busy}>Reject</button>
      </div>
      {#if error}<p class="error">{error}</p>{/if}
    </div>
  {:else if hasResult}
    <div class="tool-result">
      → {summarizeResult(resultValue)}
    </div>
    {#if sceneInfo}
      <div class="scene-chips">
        <a class="chip" href={`/admin/scenes/${encodeURIComponent(sceneInfo.id)}`}>
          <span aria-hidden="true">✎</span> Open in editor
        </a>
        <button class="chip" type="button" on:click={() => sceneInfo && onActivateClick(sceneInfo.id)}>
          {#if activated}
            <span aria-hidden="true">✓</span> Showing on {activated}
          {:else if activating}
            <span aria-hidden="true">…</span> Sending to {activating}
          {:else if displays && displays.length === 1}
            <span aria-hidden="true">→</span> Send to {displays[0].name}
          {:else}
            <span aria-hidden="true">→</span> Send to display
          {/if}
        </button>
        {#if displayPickerOpen && displays && displays.length > 1}
          <div class="picker">
            {#each displays as d (d.id)}
              <button class="picker-item" type="button" on:click={() => sceneInfo && activateOn(d.name, sceneInfo.id)}>
                {d.name}
              </button>
            {/each}
          </div>
        {/if}
        {#if displaysError}<span class="chip-error">{displaysError}</span>{/if}
      </div>
    {/if}
  {:else}
    <div class="tool-result tool-result-pending">
      <span class="dot-anim">·</span><span class="dot-anim">·</span><span class="dot-anim">·</span>
    </div>
  {/if}
</div>

<style>
  .tool-call {
    background: var(--c-surface-2);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 0.6rem 0.85rem;
    font-size: 0.85rem;
    line-height: 1.45;
  }
  .tool-call.confirm {
    border-color: var(--c-accent);
    background: var(--c-accent-tint);
  }
  .tool-call.done { opacity: 0.78; }

  .tool-head {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .tool-icon { color: var(--c-fg-3); }
  .tool-name {
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    color: var(--c-fg);
  }
  .tool-args {
    color: var(--c-fg-3);
    font-size: 0.8rem;
    font-family: ui-monospace, 'JetBrains Mono', monospace;
  }

  .confirm-body { margin-top: 0.5rem; }
  .confirm-prompt {
    margin: 0 0 0.55rem;
    color: var(--c-fg-2);
    font-size: 0.85rem;
  }
  .confirm-actions {
    display: flex;
    gap: 0.4rem;
  }
  .confirm-actions button {
    padding: 0.35rem 0.85rem;
    min-height: 0;
    font-size: 0.85rem;
  }

  .tool-result {
    margin-top: 0.35rem;
    color: var(--c-fg-3);
    font-size: 0.8rem;
    font-family: ui-monospace, 'JetBrains Mono', monospace;
  }
  .tool-result-pending { color: var(--c-accent); }
  .dot-anim {
    animation: pulse 1.4s ease-in-out infinite;
    display: inline-block;
    margin-right: 2px;
  }
  .dot-anim:nth-child(2) { animation-delay: 0.2s; }
  .dot-anim:nth-child(3) { animation-delay: 0.4s; }
  @keyframes pulse {
    0%, 100% { opacity: 0.3; transform: translateY(0); }
    50% { opacity: 1; transform: translateY(-1px); }
  }

  .error {
    margin: 0.4rem 0 0;
    color: var(--c-danger);
    font-size: 0.8rem;
  }

  /* Action chips that appear after a scene-mutating tool result. The user
     can jump to the editor or push the scene to a display without going
     back through the chat. Wraps gracefully on narrow widths. */
  .scene-chips {
    margin-top: 0.5rem;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
    position: relative;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    border-radius: 999px;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    color: var(--c-fg-2);
    font-size: 0.8rem;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    transition: background 120ms var(--ease), border-color 120ms var(--ease), color 120ms var(--ease);
    min-height: 0;
  }
  .chip:hover { background: var(--c-surface-hover); color: var(--c-fg); border-color: var(--c-line-strong); }

  .picker {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 0.3rem;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 0.3rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
    z-index: 5;
    min-width: 10rem;
  }
  .picker-item {
    text-align: left;
    background: transparent;
    border: 0;
    color: var(--c-fg);
    padding: 0.45rem 0.65rem;
    border-radius: 0.3rem;
    font-size: 0.85rem;
    cursor: pointer;
    min-height: 0;
  }
  .picker-item:hover { background: var(--c-surface-hover); }

  .chip-error {
    color: var(--c-danger);
    font-size: 0.75rem;
  }
</style>
