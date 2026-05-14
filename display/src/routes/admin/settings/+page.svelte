<script lang="ts">
  import { onMount } from 'svelte';
  import { api } from '$lib/admin/api';
  import Field from '$lib/admin/Field.svelte';

  type HaSource = 'environment' | 'manual' | 'supervisor' | 'mock';
  type CanvasFetchMode = 'off' | 'allowlist' | 'any';
  type StatusTone = 'success' | 'warning' | 'danger' | 'muted' | 'cool';
  type StatusItem = { label: string; value: string; detail: string; tone: StatusTone };

  let safeArea = { top: 16, right: 16, bottom: 16, left: 16 };
  let transitionSpeed = 1.0;
  let transitionSpeedRange = { min: 0.25, max: 3.0, default: 1.0 };
  let loaded = false;
  let saving = false;
  let saved = false;
  let savingSpeed = false;
  let savedSpeed = false;

  let haUrlInput = '';
  let haTokenInput = '';
  let haHasToken = false;
  let haRuntime: {
    source: HaSource;
    activeUrl: string | null;
    connected: boolean;
    envConfigured: boolean;
    supervisorAvailable: boolean;
  } = {
    source: 'mock',
    activeUrl: null,
    connected: false,
    envConfigured: false,
    supervisorAvailable: false,
  };
  let savingHa = false;
  let savedHa = false;

  let agentKeyInput = '';
  let agentModel = '';
  let agentHasKey = false;
  let savingAgent = false;
  let savedAgent = false;

  let canvasFetchMode: CanvasFetchMode = 'allowlist';
  let canvasFetchAllowlistText = '';
  let savingCanvasFetch = false;
  let savedCanvasFetch = false;

  let mcpEnabled = false;
  let mcpHasToken = false;
  let mcpToken: string | null = null;
  let mcpEndpointHosts: string[] = [];
  let savingMcp = false;
  let mcpCopied = false;
  let snippetCopied = false;

  const SPEED_PRESETS: { label: string; value: number }[] = [
    { label: 'Slow', value: 1.5 },
    { label: 'Normal', value: 1.0 },
    { label: 'Fast', value: 0.6 },
  ];

  const SETTINGS_SECTIONS = [
    { id: 'status', label: 'Status' },
    { id: 'display', label: 'Display' },
    { id: 'home-assistant', label: 'Home Assistant' },
    { id: 'ai-agent', label: 'AI agent' },
    { id: 'canvas-access', label: 'Canvas access' },
    { id: 'mcp', label: 'MCP' },
  ];

  onMount(async () => {
    const [sa, ts, ha, ag, cf, mcp] = await Promise.all([
      api.settings.getSafeArea(),
      api.settings.getTransitionSpeed(),
      api.settings.getHomeAssistant().catch(() => ({
        url: null,
        hasToken: false,
        runtime: {
          source: 'mock' as const,
          activeUrl: null,
          connected: false,
          envConfigured: false,
          supervisorAvailable: false,
        },
      })),
      api.agent.getSettings().catch(() => ({ hasKey: false, model: '', confirmRequiredTools: [] })),
      api.settings.getCanvasFetch().catch(() => ({ mode: 'allowlist' as const, allowlist: [] })),
      api.agent.getMcpConfig().catch(() => ({ enabled: false, hasToken: false, token: null, endpointHosts: [] })),
    ]);
    safeArea = sa;
    transitionSpeed = ts.multiplier;
    transitionSpeedRange = { min: ts.min, max: ts.max, default: ts.default };
    haUrlInput = ha.url ?? '';
    haHasToken = ha.hasToken;
    haRuntime = ha.runtime;
    agentHasKey = ag.hasKey;
    agentModel = ag.model;
    canvasFetchMode = cf.mode;
    canvasFetchAllowlistText = cf.allowlist.join('\n');
    mcpEnabled = mcp.enabled;
    mcpHasToken = mcp.hasToken;
    mcpToken = mcp.token;
    mcpEndpointHosts = mcp.endpointHosts ?? [];
    loaded = true;
  });

  async function save() {
    saving = true;
    saved = false;
    try {
      safeArea = await api.settings.updateSafeArea(safeArea);
      saved = true;
      setTimeout(() => (saved = false), 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'save failed');
    } finally {
      saving = false;
    }
  }

  async function saveSpeed() {
    savingSpeed = true;
    savedSpeed = false;
    try {
      const res = await api.settings.updateTransitionSpeed(transitionSpeed);
      transitionSpeed = res.multiplier;
      savedSpeed = true;
      setTimeout(() => (savedSpeed = false), 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'save failed');
    } finally {
      savingSpeed = false;
    }
  }

  function pickPreset(value: number) {
    transitionSpeed = value;
  }

  async function saveHa() {
    savingHa = true;
    savedHa = false;
    try {
      const payload: { url?: string; token?: string } = { url: haUrlInput };
      if (haTokenInput) payload.token = haTokenInput;
      const res = await api.settings.updateHomeAssistant(payload);
      haUrlInput = res.url ?? '';
      haHasToken = res.hasToken;
      haRuntime = res.runtime;
      haTokenInput = '';
      savedHa = true;
      setTimeout(() => (savedHa = false), 2500);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'save failed');
    } finally {
      savingHa = false;
    }
  }

  async function clearHaToken() {
    if (!confirm('Clear the stored Home Assistant token? Cosmos will use mock data after restart unless another connection source is available.')) return;
    savingHa = true;
    try {
      const res = await api.settings.updateHomeAssistant({ token: '' });
      haHasToken = res.hasToken;
      haRuntime = res.runtime;
      haTokenInput = '';
    } finally {
      savingHa = false;
    }
  }

  function haSourceLabel(source: HaSource): string {
    if (source === 'environment') return 'Environment variables';
    if (source === 'manual') return 'Settings';
    if (source === 'supervisor') return 'Home Assistant Supervisor';
    return 'Mock data';
  }

  function canvasModeLabel(mode: CanvasFetchMode): string {
    if (mode === 'off') return 'Off';
    if (mode === 'any') return 'Any host';
    return 'Allowlist';
  }

  function canvasModeTone(mode: CanvasFetchMode): StatusTone {
    if (mode === 'off') return 'muted';
    if (mode === 'any') return 'danger';
    return 'cool';
  }

  $: canvasAllowlistCount = canvasFetchAllowlistText
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean).length;

  $: statusItems = [
    {
      label: 'Home Assistant',
      value: haRuntime.connected ? 'Connected' : 'Not connected',
      detail: haSourceLabel(haRuntime.source),
      tone: haRuntime.connected ? 'success' : 'warning',
    },
    {
      label: 'AI agent',
      value: agentHasKey ? 'Key set' : 'Missing key',
      detail: agentModel || 'No model selected',
      tone: agentHasKey ? 'success' : 'warning',
    },
    {
      label: 'Canvas access',
      value: canvasModeLabel(canvasFetchMode),
      detail:
        canvasFetchMode === 'allowlist'
          ? `${canvasAllowlistCount} hosts`
          : canvasFetchMode === 'any'
            ? 'Every host allowed'
            : 'External fetch disabled',
      tone: canvasModeTone(canvasFetchMode),
    },
    {
      label: 'MCP',
      value: mcpEnabled ? 'Enabled' : 'Off',
      detail: mcpEnabled && mcpHasToken ? 'Token ready' : 'Local server disabled',
      tone: mcpEnabled ? 'success' : 'muted',
    },
  ] as StatusItem[];

  async function saveAgent() {
    savingAgent = true;
    savedAgent = false;
    try {
      const payload: { key?: string; model?: string } = {};
      if (agentModel.trim()) payload.model = agentModel.trim();
      if (agentKeyInput) payload.key = agentKeyInput;
      const res = await api.agent.updateSettings(payload);
      agentHasKey = res.hasKey;
      agentModel = res.model;
      agentKeyInput = '';
      savedAgent = true;
      setTimeout(() => (savedAgent = false), 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'save failed');
    } finally {
      savingAgent = false;
    }
  }

  async function saveCanvasFetch() {
    savingCanvasFetch = true;
    savedCanvasFetch = false;
    try {
      const allowlist = canvasFetchAllowlistText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      const res = await api.settings.updateCanvasFetch({ mode: canvasFetchMode, allowlist });
      canvasFetchMode = res.mode;
      canvasFetchAllowlistText = res.allowlist.join('\n');
      savedCanvasFetch = true;
      setTimeout(() => (savedCanvasFetch = false), 2000);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'save failed');
    } finally {
      savingCanvasFetch = false;
    }
  }

  function onMcpToggleChange(e: Event) {
    const target = e.currentTarget as HTMLInputElement;
    toggleMcp(target.checked);
  }

  async function toggleMcp(next: boolean) {
    savingMcp = true;
    try {
      const res = await api.agent.enableMcp(next);
      mcpEnabled = res.enabled;
      mcpHasToken = res.hasToken;
      mcpToken = res.token;
      mcpEndpointHosts = res.endpointHosts ?? [];
    } catch (err) {
      alert(err instanceof Error ? err.message : 'failed to toggle MCP');
    } finally {
      savingMcp = false;
    }
  }

  async function regenerateMcp() {
    if (!confirm('Regenerating will disconnect any agent currently connected. They will need the new token. Continue?')) return;
    savingMcp = true;
    try {
      const res = await api.agent.regenerateMcpToken();
      mcpEnabled = res.enabled;
      mcpHasToken = res.hasToken;
      mcpToken = res.token;
      mcpEndpointHosts = res.endpointHosts ?? [];
    } finally {
      savingMcp = false;
    }
  }

  async function copyMcpToken() {
    if (!mcpToken) return;
    await navigator.clipboard.writeText(mcpToken);
    mcpCopied = true;
    setTimeout(() => (mcpCopied = false), 1600);
  }

  function mcpEndpoint(): string {
    if (typeof window === 'undefined') return '/mcp';
    const url = new URL(window.location.origin);
    const isLoopback =
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '0.0.0.0' ||
      url.hostname === '::1';
    if (isLoopback && mcpEndpointHosts.length > 0) {
      url.hostname = mcpEndpointHosts[0];
    }
    url.pathname = '/mcp';
    return url.toString();
  }

  function mcpClaudeSnippet(): string {
    return JSON.stringify({
      mcpServers: {
        cosmos: {
          url: mcpEndpoint(),
          headers: { Authorization: `Bearer ${mcpToken ?? '<token>'}` },
        },
      },
    }, null, 2);
  }

  async function copyMcpSnippet() {
    await navigator.clipboard.writeText(mcpClaudeSnippet());
    snippetCopied = true;
    setTimeout(() => (snippetCopied = false), 1600);
  }

  async function clearAgentKey() {
    if (!confirm('Clear the OpenRouter key? The agent will be disabled until you set a new one.')) return;
    savingAgent = true;
    try {
      const res = await api.agent.updateSettings({ key: '' });
      agentHasKey = res.hasKey;
      agentKeyInput = '';
    } finally {
      savingAgent = false;
    }
  }
</script>

<svelte:head><title>Cosmos - Settings</title></svelte:head>

<header class="page-header reveal reveal-1">
  <div>
    <h1>Settings</h1>
    <p>Control how Cosmos connects, renders, and exposes local automation surfaces.</p>
  </div>
</header>

{#if !loaded}
  <p class="loading">Loading...</p>
{:else}
  <div class="settings-shell">
    <aside class="settings-rail reveal reveal-2" aria-label="Settings sections">
      {#each SETTINGS_SECTIONS as section (section.id)}
        <a href={`#${section.id}`}>{section.label}</a>
      {/each}
    </aside>

    <div class="settings-content">
      <section id="status" class="status-grid reveal reveal-2" aria-label="Settings status">
        {#each statusItems as item (item.label)}
          <article class={`status-tile tone-${item.tone}`}>
            <span class="tile-label">{item.label}</span>
            <strong>{item.value}</strong>
            <span class="tile-detail">{item.detail}</span>
          </article>
        {/each}
      </section>

      <section id="display" class="settings-panel reveal reveal-3">
        <div class="panel-head">
          <div>
            <span class="eyebrow">Display</span>
            <h2>Screen fit and motion</h2>
          </div>
          <span class="panel-badge">Live updates</span>
        </div>

        <div class="panel-section">
          <h3>Safe-area padding</h3>
          <p class="hint">Inset widgets and overlays so bezels do not cover them. Background gradients still bleed to the edge.</p>

          <div class="grid">
            <Field label="Top (px)"><input type="number" min="0" bind:value={safeArea.top} /></Field>
            <Field label="Right (px)"><input type="number" min="0" bind:value={safeArea.right} /></Field>
            <Field label="Bottom (px)"><input type="number" min="0" bind:value={safeArea.bottom} /></Field>
            <Field label="Left (px)"><input type="number" min="0" bind:value={safeArea.left} /></Field>
          </div>

          <div class="preview" aria-hidden="true">
            <div
              class="preview-inset"
              style={`top:${Math.min(safeArea.top, 60)}px;right:${Math.min(safeArea.right, 60)}px;bottom:${Math.min(safeArea.bottom, 60)}px;left:${Math.min(safeArea.left, 60)}px;`}
            ></div>
          </div>

          <div class="panel-actions">
            <button class="primary" on:click={save} disabled={saving}>{saving ? 'Saving...' : 'Save padding'}</button>
            {#if saved}<span class="status"><span class="check">✓</span> Saved</span>{/if}
          </div>
        </div>

        <div class="panel-section">
          <h3>Transition speed</h3>
          <p class="hint">
            Global multiplier applied to every scene transition. 1.0x is the baked-in default; lower values are faster, higher values are slower.
          </p>

          <div class="speed-presets">
            {#each SPEED_PRESETS as preset (preset.value)}
              <button
                type="button"
                class="preset"
                class:active={Math.abs(transitionSpeed - preset.value) < 0.01}
                on:click={() => pickPreset(preset.value)}
              >
                <span class="preset-label">{preset.label}</span>
                <span class="preset-value">{preset.value.toFixed(2)}x</span>
              </button>
            {/each}
          </div>

          <Field label={`Custom multiplier - ${transitionSpeed.toFixed(2)}x`}>
            <input
              type="range"
              min={transitionSpeedRange.min}
              max={transitionSpeedRange.max}
              step="0.05"
              bind:value={transitionSpeed}
            />
          </Field>

          <div class="panel-actions">
            <button class="primary" on:click={saveSpeed} disabled={savingSpeed}>
              {savingSpeed ? 'Saving...' : 'Save speed'}
            </button>
            {#if savedSpeed}<span class="status"><span class="check">✓</span> Saved</span>{/if}
          </div>
        </div>
      </section>

      <section id="home-assistant" class="settings-panel reveal reveal-3">
        <div class="panel-head">
          <div>
            <span class="eyebrow">Home Assistant</span>
            <h2>Connection source</h2>
          </div>
          <span class="panel-badge" class:success={haRuntime.connected}>{haRuntime.connected ? 'Connected' : 'Not connected'}</span>
        </div>

        <p class="hint">
          Standalone Cosmos installs can connect with a Home Assistant URL and long-lived access token. Home Assistant app installs can use Supervisor automatically.
        </p>

        <div class="connection-status">
          <span class="status-dot" class:online={haRuntime.connected}></span>
          <span>
            {haRuntime.connected ? 'Connected' : 'Not connected'} via {haSourceLabel(haRuntime.source)}
            {#if haRuntime.activeUrl}
              <code>{haRuntime.activeUrl}</code>
            {/if}
          </span>
        </div>

        {#if haRuntime.envConfigured}
          <p class="warning-box">
            HA_URL/HA_TOKEN environment variables are configured, so they take precedence over saved settings on startup.
          </p>
        {:else if haRuntime.supervisorAvailable && haRuntime.source === 'supervisor'}
          <p class="info-box">
            Supervisor credentials are active for this Home Assistant app install. Saved standalone credentials are only needed outside Home Assistant.
          </p>
        {/if}

        <div class="form-grid">
          <Field label="Home Assistant URL">
            <input
              type="url"
              bind:value={haUrlInput}
              placeholder="http://homeassistant.local:8123"
              autocomplete="off"
              spellcheck="false"
            />
          </Field>

          <Field label="Long-lived access token">
            <input
              type="password"
              bind:value={haTokenInput}
              placeholder={haHasToken ? 'Token is set - type to replace' : 'Paste token'}
              autocomplete="off"
            />
          </Field>
        </div>
        <p class="hint compact">
          Saved changes are picked up when the Cosmos server restarts. The token is stored locally and never sent back to the browser.
        </p>

        <div class="panel-actions">
          <button class="primary" on:click={saveHa} disabled={savingHa}>
            {savingHa ? 'Saving...' : 'Save connection'}
          </button>
          {#if haHasToken}
            <button class="ghost" on:click={clearHaToken} disabled={savingHa}>Clear token</button>
          {/if}
          {#if savedHa}<span class="status">Saved - restart Cosmos to reconnect</span>{/if}
        </div>
      </section>

      <section id="ai-agent" class="settings-panel reveal reveal-4">
        <div class="panel-head">
          <div>
            <span class="eyebrow">AI agent</span>
            <h2>OpenRouter model access</h2>
          </div>
          <span class="panel-badge" class:success={agentHasKey}>{agentHasKey ? 'Key set' : 'Missing key'}</span>
        </div>

        <p class="hint">
          Cosmos can use an LLM via <a href="https://openrouter.ai" target="_blank" rel="noopener">OpenRouter</a> to generate scenes and canvas widgets. Your key stays on this server.
        </p>

        <div class="form-grid">
          <Field label="OpenRouter API key">
            <input
              type="password"
              bind:value={agentKeyInput}
              placeholder={agentHasKey ? 'Key is set - type to replace' : 'sk-or-v1-...'}
              autocomplete="off"
            />
          </Field>

          <Field label="Model">
            <input
              type="text"
              bind:value={agentModel}
              placeholder="anthropic/claude-sonnet-4-6"
              autocomplete="off"
            />
          </Field>
        </div>
        <p class="hint compact">
          Anything from <a href="https://openrouter.ai/models" target="_blank" rel="noopener">openrouter.ai/models</a>.
          Recommended: <code>anthropic/claude-sonnet-4-6</code>, <code>openai/gpt-5</code>, <code>google/gemini-2.5-pro</code>.
        </p>

        <div class="panel-actions">
          <button class="primary" on:click={saveAgent} disabled={savingAgent || (!agentKeyInput && !agentModel.trim())}>
            {savingAgent ? 'Saving...' : 'Save agent'}
          </button>
          {#if agentHasKey}
            <button class="ghost" on:click={clearAgentKey} disabled={savingAgent}>Clear key</button>
          {/if}
          {#if savedAgent}<span class="status"><span class="check">✓</span> Saved</span>{/if}
        </div>
      </section>

      <section id="canvas-access" class="settings-panel reveal reveal-4">
        <div class="panel-head">
          <div>
            <span class="eyebrow">Canvas access</span>
            <h2>External fetch policy</h2>
          </div>
          <span class="panel-badge" class:danger={canvasFetchMode === 'any'}>{canvasModeLabel(canvasFetchMode)}</span>
        </div>

        <p class="hint">
          Lets canvas widgets call <code>cosmos.fetch(url)</code> to pull external HTTP(S) data through the display browser, gated by this allowlist.
        </p>

        <Field label="Mode">
          <select bind:value={canvasFetchMode}>
            <option value="off">Off - canvases cannot fetch</option>
            <option value="allowlist">Allowlist - only the hosts below</option>
            <option value="any">Any - every host (use with care)</option>
          </select>
        </Field>

        {#if canvasFetchMode === 'allowlist'}
          <Field label="Allowed hostnames (one per line)">
            <textarea
              rows="4"
              bind:value={canvasFetchAllowlistText}
              placeholder={'example.com\napi.weather.gov\nrss.cnn.com'}
              spellcheck="false"
              autocapitalize="off"
            ></textarea>
          </Field>
          <p class="hint compact">
            Each entry matches the exact host and any subdomain. Schemes, paths, and ports are ignored.
          </p>
        {:else if canvasFetchMode === 'any'}
          <p class="warning-box">
            Any-host mode lets a canvas widget call any URL. An LLM-authored canvas you paste in could exfiltrate the entity state it can read. Prefer Allowlist for everyday use.
          </p>
        {/if}

        <div class="panel-actions">
          <button class="primary" on:click={saveCanvasFetch} disabled={savingCanvasFetch}>
            {savingCanvasFetch ? 'Saving...' : 'Save policy'}
          </button>
          {#if savedCanvasFetch}<span class="status"><span class="check">✓</span> Saved</span>{/if}
        </div>
      </section>

      <section id="mcp" class="settings-panel reveal reveal-5">
        <div class="panel-head">
          <div>
            <span class="eyebrow">MCP</span>
            <h2>Agent-to-agent access</h2>
          </div>
          <span class="panel-badge" class:success={mcpEnabled}>{mcpEnabled ? 'Enabled' : 'Off'}</span>
        </div>

        <p class="hint">
          Let external agents connect to Cosmos to inspect and edit your wall display. Read and edit only; destructive actions are not exposed over MCP.
        </p>

        <label class="toggle">
          <input
            type="checkbox"
            checked={mcpEnabled}
            on:change={onMcpToggleChange}
            disabled={savingMcp}
          />
          <span>Enable MCP server</span>
        </label>

        {#if mcpEnabled}
          <div class="credential-box">
            <Field label="Endpoint">
              <input type="text" readonly value={mcpEndpoint()} />
            </Field>

            <Field label="Bearer token">
              <div class="token-row">
                <input type="text" readonly value={mcpToken ?? ''} />
                <button type="button" class="ghost" on:click={copyMcpToken} disabled={!mcpToken}>
                  {mcpCopied ? '✓ Copied' : 'Copy'}
                </button>
                <button type="button" class="ghost" on:click={regenerateMcp} disabled={savingMcp}>
                  Regenerate
                </button>
              </div>
            </Field>

            <Field label="Claude Desktop config snippet">
              <div class="snippet-row">
                <pre class="snippet">{mcpClaudeSnippet()}</pre>
                <button type="button" class="ghost" on:click={copyMcpSnippet} disabled={!mcpToken}>
                  {snippetCopied ? '✓ Copied' : 'Copy snippet'}
                </button>
              </div>
            </Field>
          </div>
        {/if}
      </section>
    </div>
  </div>
{/if}

<style>
  .page-header {
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
    margin-bottom: 1.25rem;
  }
  .page-header h1 {
    font-size: clamp(1.6rem, 3.5vw, 2.25rem);
  }
  .page-header p {
    max-width: 42rem;
    color: var(--c-fg-2);
    font-size: 0.98rem;
  }

  .loading { color: var(--c-fg-3); }
  .hint {
    color: var(--c-fg-3);
    font-size: 0.9rem;
    margin: 0 0 1rem;
    line-height: 1.55;
  }
  .hint.compact {
    margin-top: -0.25rem;
    font-size: 0.84rem;
  }

  .settings-shell {
    display: grid;
    grid-template-columns: minmax(10rem, 13rem) minmax(0, 1fr);
    gap: 1.25rem;
    align-items: start;
  }
  .settings-rail {
    position: sticky;
    top: 5rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.5rem;
    background: color-mix(in srgb, var(--c-surface) 78%, transparent);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
  }
  .settings-rail a {
    color: var(--c-fg-2);
    border-radius: var(--radius-sm);
    padding: 0.7rem 0.8rem;
    font-size: 0.9rem;
    text-decoration: none;
  }
  .settings-rail a:hover,
  .settings-rail a:focus-visible {
    background: var(--c-surface-2);
    color: var(--c-fg);
    outline: none;
  }
  .settings-content {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .status-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.75rem;
    scroll-margin-top: 5rem;
  }
  .status-tile {
    position: relative;
    min-height: 6.5rem;
    padding: 0.95rem;
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
    background: linear-gradient(180deg, rgba(255, 255, 255, 0.025), transparent), var(--c-surface);
    overflow: hidden;
  }
  .status-tile::before {
    content: '';
    position: absolute;
    inset: 0 auto 0 0;
    width: 3px;
    background: var(--c-fg-3);
  }
  .status-tile.tone-success::before { background: var(--c-success); }
  .status-tile.tone-warning::before { background: var(--c-accent); }
  .status-tile.tone-danger::before { background: var(--c-danger); }
  .status-tile.tone-cool::before { background: var(--c-cool); }
  .tile-label {
    display: block;
    margin-bottom: 0.65rem;
    color: var(--c-fg-3);
    font-size: 0.72rem;
    font-family: var(--f-mono);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .status-tile strong {
    display: block;
    color: var(--c-fg);
    font-size: 1.02rem;
    line-height: 1.25;
  }
  .tile-detail {
    display: block;
    margin-top: 0.3rem;
    color: var(--c-fg-3);
    font-size: 0.82rem;
    line-height: 1.35;
    overflow-wrap: anywhere;
  }

  .settings-panel {
    scroll-margin-top: 5rem;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-md);
    padding: clamp(1rem, 2.6vw, 1.4rem);
    box-shadow: 0 1px 0 rgba(255, 255, 255, 0.025) inset;
  }
  .panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .panel-head h2 {
    margin-top: 0.25rem;
    font-size: 1.2rem;
  }
  .panel-badge {
    display: inline-flex;
    align-items: center;
    min-height: 1.65rem;
    padding: 0 0.55rem;
    border-radius: 999px;
    border: 1px solid var(--c-line-strong);
    color: var(--c-fg-2);
    font-family: var(--f-mono);
    font-size: 0.72rem;
    white-space: nowrap;
  }
  .panel-badge.success {
    color: var(--c-success);
    border-color: rgba(109, 213, 140, 0.4);
  }
  .panel-badge.danger {
    color: var(--c-danger);
    border-color: rgba(240, 107, 117, 0.45);
    background: var(--c-danger-tint);
  }
  .panel-section {
    padding-top: 1rem;
    border-top: 1px solid var(--c-line);
  }
  .panel-section:first-of-type {
    padding-top: 0;
    border-top: 0;
  }
  .panel-section + .panel-section { margin-top: 1.2rem; }
  .panel-section h3 { margin-bottom: 0.4rem; }

  .grid,
  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.75rem;
  }
  .grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    margin-bottom: 1rem;
  }
  .panel-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-top: 1rem;
  }

  .preview {
    position: relative;
    width: 100%;
    aspect-ratio: 16 / 9;
    background:
      linear-gradient(135deg, rgba(255, 209, 122, 0.12), rgba(168, 166, 255, 0.10)),
      var(--c-surface-2);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .preview-inset {
    position: absolute;
    border: 1.5px dashed rgba(255, 209, 122, 0.62);
    border-radius: 0.4rem;
    background: rgba(255, 255, 255, 0.025);
    transition: top 200ms var(--ease), right 200ms var(--ease), bottom 200ms var(--ease), left 200ms var(--ease);
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--c-success);
    font-size: 0.9rem;
  }
  .check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.1rem;
    height: 1.1rem;
    border-radius: 999px;
    background: rgba(109, 213, 140, 0.18);
    font-size: 0.7rem;
  }

  .connection-status,
  .info-box,
  .warning-box,
  .credential-box {
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    background: var(--c-surface-2);
  }
  .connection-status {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    color: var(--c-fg-2);
    padding: 0.65rem 0.8rem;
    margin: 0 0 1rem;
    flex-wrap: wrap;
  }
  .connection-status code {
    margin-left: 0.35rem;
    overflow-wrap: anywhere;
  }
  .status-dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 999px;
    background: var(--c-danger);
    box-shadow: 0 0 0 3px rgba(240, 107, 117, 0.12);
    flex: 0 0 auto;
  }
  .status-dot.online {
    background: var(--c-success);
    box-shadow: 0 0 0 3px rgba(109, 213, 140, 0.14);
  }
  .warning-box,
  .info-box {
    padding: 0.75rem 0.85rem;
    margin: 0 0 1rem;
    color: var(--c-fg-2);
    font-size: 0.88rem;
    line-height: 1.5;
  }
  .warning-box {
    color: var(--c-danger);
    background: var(--c-danger-tint);
    border-color: rgba(240, 107, 117, 0.28);
  }
  .info-box {
    color: var(--c-fg-2);
    background: var(--c-cool-tint);
    border-color: rgba(168, 166, 255, 0.24);
  }

  textarea {
    width: 100%;
    min-height: 6rem;
    font-family: var(--f-mono);
    font-size: 0.85rem;
    resize: vertical;
  }
  .speed-presets {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
    margin: 0.5rem 0 1.25rem;
  }
  .preset {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.2rem;
    padding: 0.85rem 0.5rem;
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    background: var(--c-surface-2);
    color: var(--c-fg-2);
    cursor: pointer;
    transition: border-color 150ms var(--ease), color 150ms var(--ease), background 150ms var(--ease);
  }
  .preset:hover {
    border-color: var(--c-line-strong);
    color: var(--c-fg);
  }
  .preset.active {
    border-color: var(--c-accent);
    color: var(--c-fg);
    background: var(--c-accent-tint);
  }
  .preset-label {
    font-size: 0.95rem;
    font-weight: 500;
  }
  .preset-value {
    font-family: var(--f-mono);
    font-size: 0.8rem;
    opacity: 0.75;
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    cursor: pointer;
    user-select: none;
    margin: 0.25rem 0 1rem;
    color: var(--c-fg-2);
  }
  .toggle input {
    width: 1.1rem;
    height: 1.1rem;
    min-height: 0;
  }
  .credential-box {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
  }
  .token-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .token-row input {
    flex: 1 1 18rem;
    min-width: 0;
  }
  .snippet-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .snippet {
    background: var(--c-bg);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 0.85rem;
    margin: 0;
    font-family: var(--f-mono);
    font-size: 0.8rem;
    overflow-x: auto;
    color: var(--c-fg-2);
  }

  @media (max-width: 900px) {
    .settings-shell { grid-template-columns: 1fr; }
    .settings-rail {
      position: sticky;
      top: 3.75rem;
      z-index: 8;
      flex-direction: row;
      overflow-x: auto;
      border-radius: var(--radius-sm);
    }
    .settings-rail a { white-space: nowrap; }
    .status-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }

  @media (max-width: 620px) {
    .status-grid,
    .form-grid,
    .grid,
    .speed-presets {
      grid-template-columns: 1fr;
    }
    .panel-head {
      flex-direction: column;
      align-items: flex-start;
    }
    .token-row { align-items: stretch; }
    .token-row button { flex: 1 1 auto; }
  }
</style>
