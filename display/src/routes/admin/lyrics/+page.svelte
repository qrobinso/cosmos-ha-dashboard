<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api, type LyricsCandidate, type LyricsRow } from '$lib/admin/api';
  import Field from '$lib/admin/Field.svelte';

  type NowPlaying = Awaited<ReturnType<typeof api.lyrics.nowPlaying>>;
  /** `status` is the row's state when the song was picked from a list. */
  type Target = { trackKey: string; name: string; status: string };

  const POLL_MS = 5000;
  /** Mirrors the server's automatic matching tolerance. */
  const LENGTH_TOLERANCE_S = 3;
  const STATUS: Record<string, [label: string, tag: string]> = {
    pinned: ['Pinned', 'tag accent'],
    blocked: ['Blocked', 'tag danger'],
    auto: ['Auto-matched', 'tag success'],
    'nothing-found': ['Nothing found', 'tag muted'],
    unresolved: ['Looking…', 'tag muted'],
    'no-entity': ['No player selected', 'tag muted'],
    'entity-missing': ['Player unavailable', 'tag danger'],
    'nothing-playing': ['Nothing playing', 'tag muted'],
    'non-music': ['Not music — no lyrics will show', 'tag muted'],
  };
  const KIND: Record<LyricsRow['kind'], string> = {
    synced: 'Time-synced',
    plain: 'Text only',
    instrumental: 'Instrumental',
    none: '',
  };

  let mediaPlayers: Array<{ entity_id: string; state: string; attributes: Record<string, unknown> }> = [];
  let entityId = '';
  let nowPlaying: NowPlaying | null = null;
  let pins: LyricsRow[] = [];
  let history: LyricsRow[] = [];
  let loading = true;

  /** Song the picker is editing. Null means "follow whatever is playing". */
  let target: Target | null = null;
  let query = '';
  let candidates: LyricsCandidate[] | null = null;
  let searching = false;
  let busy = false;
  let error: string | null = null;
  let note: string | null = null;

  let historySearch = '';
  let historyTimer: ReturnType<typeof setTimeout>;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let formSection: HTMLElement | undefined;

  $: liveTarget = nowPlaying?.trackKey
    ? {
        trackKey: nowPlaying.trackKey,
        name: `${nowPlaying.artist || '(unknown artist)'} — ${nowPlaying.title || '(unknown title)'}`,
        status: nowPlaying.status,
      }
    : null;
  $: active = target ?? liveTarget;
  $: activePin = active ? pins.find((p) => p.trackKey === active.trackKey) ?? null : null;
  $: activeStatus = target
    ? activePin
      ? activePin.kind === 'none' ? 'blocked' : 'pinned'
      : target.status
    : (nowPlaying?.status ?? 'no-entity');
  /** Only the playing song has a length to compare candidates against. */
  $: playingSec = !target ? nowPlaying?.durationSec : undefined;

  // A new song gets a fresh picker: its own search text, no stale results.
  let pickerKey = '';
  $: if ((active?.trackKey ?? '') !== pickerKey) {
    pickerKey = active?.trackKey ?? '';
    query = pickerKey.replace('|', ' ');
    candidates = null;
    error = null;
    note = null;
  }

  function rowStatus(r: LyricsRow): string {
    if (r.pinned) return r.kind === 'none' ? 'blocked' : 'pinned';
    return r.kind === 'none' ? 'nothing-found' : 'auto';
  }
  function rowName(key: string): string {
    return key.replace('|', ' — ');
  }
  function fmtDuration(sec: number | null): string {
    if (sec === null) return '';
    return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
  }
  function playerLabel(p: { entity_id: string; attributes: Record<string, unknown> }): string {
    const name = p.attributes?.friendly_name;
    return typeof name === 'string' && name ? name : p.entity_id;
  }

  async function loadNowPlaying() {
    nowPlaying = await api.lyrics.nowPlaying();
  }
  async function loadHistory() {
    const q = historySearch;
    const rows = await api.lyrics.listHistory(q);
    if (q === historySearch) history = rows; // drop a slow answer to an abandoned query
  }
  async function refreshAll() {
    const [p] = await Promise.all([api.lyrics.listPins(), loadNowPlaying(), loadHistory()]);
    pins = p;
  }

  async function saveEntity() {
    error = null;
    try {
      await api.musicvideo.setSettings(entityId);
      await loadNowPlaying();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Save failed.';
    }
  }

  function edit(r: LyricsRow) {
    target = { trackKey: r.trackKey, name: rowName(r.trackKey), status: rowStatus(r) };
    formSection?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function runSearch() {
    const q = query.trim();
    if (!q || searching) return;
    searching = true;
    error = null;
    note = null;
    try {
      const res = await api.lyrics.search(q);
      if (res.ok) candidates = res.results;
      else error = res.error;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Search failed.';
    } finally {
      searching = false;
    }
  }

  /** Every write goes through here: one busy flag, one error slot, one refresh. */
  async function mutate(run: () => Promise<{ ok: true } | { ok: false; error: string } | void>, done: string) {
    if (busy) return;
    busy = true;
    error = null;
    note = null;
    try {
      const res = await run();
      if (res && !res.ok) {
        error = res.error;
        return;
      }
      note = done;
      await refreshAll();
    } catch (err) {
      error = err instanceof Error ? err.message : 'Save failed.';
    } finally {
      busy = false;
    }
  }

  const use = (c: LyricsCandidate) =>
    active && mutate(() => api.lyrics.pin({ trackKey: active.trackKey, lrclibId: c.id }), `Pinned “${c.artist} — ${c.track}”.`);
  const block = (trackKey: string) =>
    mutate(() => api.lyrics.pin({ trackKey, block: true }), 'Lyrics are off for this song.');
  const unpin = (trackKey: string) =>
    mutate(() => api.lyrics.unpin(trackKey), 'Back to automatic matching.');

  function onHistorySearch() {
    clearTimeout(historyTimer);
    historyTimer = setTimeout(loadHistory, 250);
  }

  onMount(async () => {
    const [players, settings] = await Promise.all([api.ha.listEntities('media_player'), api.musicvideo.getSettings()]);
    mediaPlayers = players;
    entityId = settings.entityId ?? '';
    await refreshAll();
    loading = false;
    // A transient failure must degrade quietly in a long-lived admin tab.
    pollTimer = setInterval(() => loadNowPlaying().catch(() => {}), POLL_MS);
  });

  onDestroy(() => {
    if (pollTimer) clearInterval(pollTimer);
    clearTimeout(historyTimer);
  });
</script>

<svelte:head><title>Cosmos - Lyrics</title></svelte:head>

<header class="page-header reveal reveal-1">
  <span class="eyebrow">Lyrics</span>
  <h1>Matches</h1>
  <p class="sub">See which lyrics a song matched, pick the right ones when it matched wrong, or turn lyrics off for a song.</p>
</header>

{#if loading}
  <p class="loading">Loading…</p>
{:else}
  <section class="card reveal reveal-2">
    <h2>Watched player</h2>
    <p class="hint">Cosmos watches this player's current track. Shared with the Video Backdrop page.</p>
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
        <button type="button" class="ghost" on:click={() => (target = null)}>Back to now playing</button>
      {/if}
    </div>

    {#if active}
      <p class="track">{active.name}</p>
      <p class="tags">
        <span class={STATUS[activeStatus]?.[1] ?? 'tag muted'}>{STATUS[activeStatus]?.[0] ?? activeStatus}</span>
        {#if !target && nowPlaying?.kind && KIND[nowPlaying.kind]}
          <span class="tag muted">{KIND[nowPlaying.kind]}</span>
        {/if}
      </p>
      {#if activePin?.label}<p class="hint">Pinned to {activePin.label}</p>{/if}

      {#if !target && nowPlaying?.preview?.length}
        <blockquote class="preview" aria-label="First lines of the matched lyrics">
          {#each nowPlaying.preview as line}<span>{line}</span>{/each}
        </blockquote>
      {/if}

      <form class="search" on:submit|preventDefault={runSearch}>
        <input
          type="search"
          bind:value={query}
          placeholder="Artist and song title…"
          aria-label="Search LRCLIB for the right lyrics"
        />
        <button type="submit" class="primary" disabled={searching || !query.trim()}>
          {searching ? 'Searching…' : 'Find lyrics'}
        </button>
      </form>

      {#if candidates}
        {#if candidates.length === 0}
          <p class="empty">No lyrics found for that search. Try just the title, or a different spelling.</p>
        {:else}
          <div class="rows">
            {#each candidates as c (c.id)}
              <div class="row">
                <div class="row-main">
                  <p class="row-title">{c.artist} — {c.track}</p>
                  {#if c.album}<span class="meta">{c.album}</span>{/if}
                  <span class="meta">{fmtDuration(c.durationSec)}</span>
                  <span class="tag muted">{c.instrumental ? 'Instrumental' : c.synced ? 'Time-synced' : 'Text only'}</span>
                  {#if playingSec && c.durationSec !== null && Math.abs(c.durationSec - playingSec) <= LENGTH_TOLERANCE_S}
                    <span class="tag success">Same length</span>
                  {/if}
                </div>
                <div class="row-actions">
                  <button type="button" on:click={() => use(c)} disabled={busy}>Use this</button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      {/if}

      <div class="panel-actions">
        {#if activePin}
          <button type="button" class="ghost" on:click={() => unpin(active.trackKey)} disabled={busy}>
            Back to automatic
          </button>
        {/if}
        {#if activeStatus !== 'blocked'}
          <button type="button" class="ghost danger" on:click={() => block(active.trackKey)} disabled={busy}>
            No lyrics for this song
          </button>
        {/if}
      </div>
    {:else}
      <p class="empty">Nothing playing right now. Use Recent below to fix a song you heard earlier.</p>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if note}<p class="ok" role="status">{note}</p>{/if}
  </section>

  <section class="card reveal reveal-3">
    <h2>Pinned and blocked</h2>
    {#if pins.length === 0}
      <p class="empty">No pinned or blocked songs yet.</p>
    {:else}
      <div class="rows">
        {#each pins as p (p.trackKey)}
          <div class="row">
            <div class="row-main">
              <p class="row-title">{rowName(p.trackKey)}</p>
              <span class={STATUS[rowStatus(p)][1]}>{STATUS[rowStatus(p)][0]}</span>
              {#if p.label}<span class="meta">{p.label}</span>{/if}
            </div>
            <div class="row-actions">
              <button type="button" class="ghost" on:click={() => edit(p)}>Edit</button>
              <button type="button" class="ghost danger" on:click={() => unpin(p.trackKey)} disabled={busy}>Remove</button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <section class="card reveal reveal-4">
    <h2>Recent</h2>
    <p class="hint">
      Songs Cosmos has looked up lyrics for, including misses. Search to reach every song it remembers.
    </p>
    <div class="search">
      <input
        type="search"
        bind:value={historySearch}
        on:input={onHistorySearch}
        placeholder="Search every song by artist or title…"
        aria-label="Search every song"
      />
    </div>
    {#if history.length === 0}
      <p class="empty">{historySearch ? `No song matching “${historySearch}”.` : 'No lyrics looked up yet.'}</p>
    {:else}
      <div class="rows">
        {#each history as h (h.trackKey)}
          <div class="row">
            <div class="row-main">
              <p class="row-title">{rowName(h.trackKey)}</p>
              <span class={STATUS[rowStatus(h)][1]}>{STATUS[rowStatus(h)][0]}</span>
              {#if KIND[h.kind]}<span class="tag muted">{KIND[h.kind]}</span>{/if}
            </div>
            <div class="row-actions">
              <button type="button" class="ghost" on:click={() => edit(h)}>Fix</button>
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
  .tags {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin: 0 0 0.75rem;
  }

  /* The first lines of what matched: enough to recognise the wrong song. */
  .preview {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    margin: 0 0 1rem;
    padding: 0.1rem 0 0.1rem 0.9rem;
    border-left: 1px solid var(--c-line-strong);
    color: var(--c-fg-2);
    font-size: 0.92rem;
    line-height: 1.5;
  }

  .panel-actions {
    display: flex;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin-top: 1rem;
  }

  .error { color: var(--c-danger); font-size: 0.9rem; margin: 0.6rem 0 0; }
  .ok { color: var(--c-success); font-size: 0.9rem; margin: 0.6rem 0 0; }
  .empty { color: var(--c-fg-3); font-size: 0.92rem; margin: 0; }

  /* Input styling itself comes from theme.css's global input rule. */
  .search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1rem;
  }
  .search button { flex: none; }

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
  .meta {
    color: var(--c-fg-3);
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }
  .row-actions {
    display: flex;
    gap: 0.5rem;
    flex-shrink: 0;
  }

  button.ghost.danger { color: var(--c-danger); border-color: var(--c-danger); }
  button.ghost.danger:hover { background: var(--c-danger-tint); }

  @media (max-width: 600px) {
    .row {
      flex-direction: column;
      align-items: stretch;
    }
    .row-actions { justify-content: flex-end; }
  }
</style>
