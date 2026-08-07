<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/admin/api';
  import Field from '$lib/admin/Field.svelte';

  type NowPlaying = Awaited<ReturnType<typeof api.musicvideo.nowPlaying>>;
  type OverrideRow = Awaited<ReturnType<typeof api.musicvideo.listOverrides>>[number];
  type HistoryRow = Awaited<ReturnType<typeof api.musicvideo.listHistory>>[number];
  type Target = { artist: string; title: string; trackKey: string };

  const POLL_MS = 5000;
  const STATUS_LABELS: Record<string, string> = {
    pinned: 'Pinned',
    blocked: 'Blocked',
    auto: 'Auto-matched',
    'nothing-found': 'Nothing found',
    unresolved: 'Looking…',
    'no-entity': 'No player selected',
    'entity-missing': 'Player unavailable',
    'nothing-playing': 'Nothing playing',
  };
  const STATUS_TAG_CLASS: Record<string, string> = {
    pinned: 'tag accent',
    blocked: 'tag danger',
    auto: 'tag success',
    'nothing-found': 'tag muted',
    unresolved: 'tag muted',
    'no-entity': 'tag muted',
    'entity-missing': 'tag danger',
    'nothing-playing': 'tag muted',
  };

  let mediaPlayers: Array<{ entity_id: string; state: string; attributes: Record<string, unknown> }> = [];
  let entityId = '';
  let nowPlaying: NowPlaying | null = null;
  let overrides: OverrideRow[] = [];
  let history: HistoryRow[] = [];
  let loading = true;

  /** Song section 2 is editing. Null means "follow whatever is currently playing". */
  let target: Target | null = null;
  let pasteUrl = '';
  let saving = false;
  let saveError: string | null = null;
  let saveOk: { resolvedTitle: string; durationSec: number } | null = null;
  let removingKey = '';
  let blockingKey = '';

  let formSection: HTMLElement | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;

  let liveTarget: Target | null = null;
  $: liveTarget = nowPlaying?.trackKey
    ? { artist: nowPlaying.artist ?? '', title: nowPlaying.title ?? '', trackKey: nowPlaying.trackKey }
    : null;
  $: activeTarget = target ?? liveTarget;
  $: overrideForActive = activeTarget
    ? overrides.find((o) => o.trackKey === activeTarget!.trackKey) ?? null
    : null;
  $: activeStatus = target
    ? overrideForActive
      ? overrideForActive.videoId
        ? 'pinned'
        : 'blocked'
      : 'unresolved'
    : (nowPlaying?.status ?? 'no-entity');

  function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
  }
  function statusTagClass(status: string): string {
    return STATUS_TAG_CLASS[status] ?? 'tag muted';
  }

  function fmtDuration(sec: number | undefined): string {
    if (sec === undefined || Number.isNaN(sec)) return '';
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function playerLabel(p: { entity_id: string; attributes: Record<string, unknown> }): string {
    const name = p.attributes?.friendly_name;
    return typeof name === 'string' && name ? name : p.entity_id;
  }

  function splitTrackKey(key: string): [string, string] {
    const idx = key.indexOf('|');
    if (idx === -1) return [key, ''];
    return [key.slice(0, idx), key.slice(idx + 1)];
  }

  async function loadMediaPlayers() {
    mediaPlayers = await api.ha.listEntities('media_player');
  }

  async function loadSettings() {
    const res = await api.musicvideo.getSettings();
    entityId = res.entityId ?? '';
  }

  async function loadNowPlaying() {
    nowPlaying = await api.musicvideo.nowPlaying();
  }

  async function loadOverrides() {
    overrides = await api.musicvideo.listOverrides();
  }

  async function loadHistory() {
    history = await api.musicvideo.listHistory();
  }

  async function refreshAll() {
    await Promise.all([loadNowPlaying(), loadOverrides(), loadHistory()]);
  }

  async function saveEntity() {
    try {
      await api.musicvideo.setSettings(entityId);
      await loadNowPlaying();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'save failed');
    }
  }

  function prefill(row: { trackKey: string; artist: string | null; title: string | null }) {
    const [artist, title] = row.artist && row.title ? [row.artist, row.title] : splitTrackKey(row.trackKey);
    target = { artist, title, trackKey: row.trackKey };
    pasteUrl = '';
    saveError = null;
    saveOk = null;
    formSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function followNowPlaying() {
    target = null;
    pasteUrl = '';
    saveError = null;
    saveOk = null;
  }

  async function savePin() {
    if (!activeTarget || saving) return;
    const url = pasteUrl.trim();
    if (!url) {
      saveError = 'Paste a YouTube link first.';
      return;
    }
    saving = true;
    saveError = null;
    saveOk = null;
    try {
      const res = await api.musicvideo.pin({ artist: activeTarget.artist, title: activeTarget.title, url });
      if (!res.ok) {
        saveError = res.error;
        return;
      }
      saveOk = { resolvedTitle: res.resolvedTitle, durationSec: res.durationSec };
      pasteUrl = '';
      target = null;
      await refreshAll();
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Save failed.';
    } finally {
      saving = false;
    }
  }

  async function saveBlock() {
    if (!activeTarget || saving) return;
    saving = true;
    saveError = null;
    saveOk = null;
    try {
      const res = await api.musicvideo.block({ artist: activeTarget.artist, title: activeTarget.title });
      if (!res.ok) {
        saveError = res.error;
        return;
      }
      pasteUrl = '';
      target = null;
      await refreshAll();
    } catch (err) {
      saveError = err instanceof Error ? err.message : 'Save failed.';
    } finally {
      saving = false;
    }
  }

  /** Block button on a Recent row: blocks that row's song directly, unlike
   *  Pin which only prefills section 2 for review before saving. */
  async function blockRow(row: { trackKey: string; artist: string | null; title: string | null }) {
    if (blockingKey) return;
    const [artist, title] = row.artist && row.title ? [row.artist, row.title] : splitTrackKey(row.trackKey);
    blockingKey = row.trackKey;
    try {
      const res = await api.musicvideo.block({ artist, title });
      if (!res.ok) {
        alert(res.error);
        return;
      }
      await refreshAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'block failed');
    } finally {
      blockingKey = '';
    }
  }

  async function removeOverride(trackKey: string) {
    removingKey = trackKey;
    try {
      await api.musicvideo.removeOverride(trackKey);
      await refreshAll();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'remove failed');
    } finally {
      removingKey = '';
    }
  }

  onMount(async () => {
    await Promise.all([loadMediaPlayers(), loadSettings()]);
    await refreshAll();
    loading = false;
    pollTimer = setInterval(() => {
      // A transient 5xx here must degrade quietly — this is a long-lived
      // admin tab polling every 5s, not a one-shot request.
      loadNowPlaying().catch(() => {});
    }, POLL_MS);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
  });
</script>

<svelte:head><title>Cosmos - Music Video</title></svelte:head>

<header class="page-header reveal reveal-1">
  <span class="eyebrow">Music video</span>
  <h1>Overrides</h1>
  <p class="sub">Pin a specific YouTube video to a song, or stop one playing entirely.</p>
</header>

{#if loading}
  <p class="loading">Loading…</p>
{:else}
  <section class="card reveal reveal-2">
    <h2>Watched player</h2>
    <p class="hint">Cosmos watches this player's current track to know what song is playing.</p>
    <Field label="Media player">
      <select bind:value={entityId} on:change={saveEntity}>
        <option value="">Select a media player…</option>
        {#each mediaPlayers as p (p.entity_id)}
          <option value={p.entity_id}>{playerLabel(p)}</option>
        {/each}
      </select>
    </Field>
  </section>

  <section class="card reveal reveal-2" bind:this={formSection}>
    <div class="section-head">
      <h2>{target ? 'Editing a song' : 'Now playing'}</h2>
      {#if target}
        <button type="button" class="ghost" on:click={followNowPlaying}>Back to now playing</button>
      {/if}
    </div>

    {#if activeTarget}
      <p class="track">{activeTarget.artist || '(unknown artist)'} — {activeTarget.title || '(unknown title)'}</p>
      <span class={statusTagClass(activeStatus)}>{statusLabel(activeStatus)}</span>

      <div class="form-row">
        <Field label="Paste a YouTube link">
          <input
            type="url"
            bind:value={pasteUrl}
            placeholder="https://www.youtube.com/watch?v=…"
            autocomplete="off"
            spellcheck="false"
          />
        </Field>
      </div>

      <div class="panel-actions">
        <button type="button" class="primary" on:click={savePin} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" class="ghost" on:click={saveBlock} disabled={saving}>Never play</button>
      </div>

      {#if saveError}<p class="error">{saveError}</p>{/if}
      {#if saveOk}
        <p class="ok">Pinned "{saveOk.resolvedTitle}" ({fmtDuration(saveOk.durationSec)})</p>
      {/if}
    {:else}
      <p class="empty">Nothing playing right now. Use Recent below to fix a song you heard earlier.</p>
    {/if}
  </section>

  <section class="card reveal reveal-3">
    <h2>Overrides</h2>
    {#if overrides.length === 0}
      <p class="empty">No pinned or blocked songs yet.</p>
    {:else}
      <div class="rows">
        {#each overrides as o (o.trackKey)}
          <div class="row">
            <div class="row-main">
              <p class="row-title">{o.artist || '(unknown artist)'} — {o.title || '(unknown title)'}</p>
              <span class={o.videoId ? 'tag accent' : 'tag danger'}>{o.videoId ? 'Pinned' : 'Blocked'}</span>
            </div>
            <div class="row-actions">
              <button type="button" class="ghost" on:click={() => prefill(o)}>Edit</button>
              <button
                type="button"
                class="ghost danger"
                on:click={() => removeOverride(o.trackKey)}
                disabled={removingKey === o.trackKey}
              >
                {removingKey === o.trackKey ? 'Removing…' : 'Remove'}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="card reveal reveal-4">
    <h2>Recent</h2>
    <p class="hint">Songs Cosmos has recently tried to resolve, including misses.</p>
    {#if history.length === 0}
      <p class="empty">No resolution history yet.</p>
    {:else}
      <div class="rows">
        {#each history as h (h.trackKey + h.resolvedAt)}
          <div class="row">
            <div class="row-main">
              <p class="row-title">
                {#if h.artist && h.title}
                  {h.artist} — {h.title}
                {:else}
                  {h.trackKey}
                {/if}
              </p>
              <span class={h.videoId ? 'tag success' : 'tag muted'}>{h.videoId ? 'Auto-matched' : 'Nothing found'}</span>
            </div>
            <div class="row-actions">
              <button type="button" class="ghost" on:click={() => prefill(h)}>Pin</button>
              <button
                type="button"
                class="ghost danger"
                on:click={() => blockRow(h)}
                disabled={blockingKey === h.trackKey}
              >
                {blockingKey === h.trackKey ? 'Blocking…' : 'Block'}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<style>
  .page-header {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 1.5rem;
  }
  .page-header h1 { font-size: clamp(1.5rem, 3.5vw, 2rem); }
  .page-header .sub { color: var(--c-fg-2); max-width: 42rem; }
  .loading { color: var(--c-fg-3); }

  .hint {
    color: var(--c-fg-3);
    font-size: 0.9rem;
    margin: 0 0 1rem;
    line-height: 1.5;
  }
  h2 { margin: 0 0 0.5rem; }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .track {
    margin: 0 0 0.5rem;
    font-size: 1.02rem;
    color: var(--c-fg);
  }

  .form-row { margin: 0.9rem 0; max-width: 32rem; }

  .panel-actions {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 0.75rem;
  }

  .error {
    color: var(--c-danger);
    font-size: 0.9rem;
    margin: 0.6rem 0 0;
  }
  .ok {
    color: var(--c-success);
    font-size: 0.9rem;
    margin: 0.6rem 0 0;
  }
  .empty {
    color: var(--c-fg-3);
    font-size: 0.92rem;
    margin: 0;
  }

  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    padding: 0.75rem 0.9rem;
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    background: var(--c-surface-2);
  }
  .row-main {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    min-width: 0;
  }
  .row-title {
    margin: 0;
    font-size: 0.95rem;
    color: var(--c-fg);
    overflow-wrap: anywhere;
  }
  .row-actions {
    display: flex;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  button.ghost.danger { color: var(--c-danger); border-color: rgba(240, 107, 117, 0.4); }
  button.ghost.danger:hover { background: var(--c-danger-tint); }

  @media (max-width: 600px) {
    .row {
      flex-direction: column;
      align-items: stretch;
    }
    .row-actions { justify-content: flex-end; }
  }
</style>
