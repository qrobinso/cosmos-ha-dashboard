<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { api } from '$lib/admin/api';
  import Field from '$lib/admin/Field.svelte';

  type NowPlaying = Awaited<ReturnType<typeof api.musicvideo.nowPlaying>>;
  type OverrideRow = Awaited<ReturnType<typeof api.musicvideo.listOverrides>>[number];
  type HistoryRow = Awaited<ReturnType<typeof api.musicvideo.listHistory>>['rows'][number];
  type Target = {
    artist: string;
    title: string;
    trackKey: string;
    /** Status carried over from the row this target was prefilled from, used
     *  only while no override exists yet — see activeStatus below. */
    sourceStatus?: 'auto' | 'nothing-found';
  };

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
    'non-music': 'Not music — no video will play',
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
    'non-music': 'tag muted',
  };

  let mediaPlayers: Array<{ entity_id: string; state: string; attributes: Record<string, unknown> }> = [];
  let entityId = '';
  let nowPlaying: NowPlaying | null = null;
  let overrides: OverrideRow[] = [];
  let history: HistoryRow[] = [];
  let loading = true;

  /** Recent-list search. Empty means "show the recent list". */
  let search = '';
  let searching = false;
  let searchTimer: ReturnType<typeof setTimeout>;

  /** Paging over the history list. Server-side, so it reaches every song
   *  rather than slicing whatever one page happened to fetch. */
  const PAGE_SIZE = 25;
  let offset = 0;
  let total = 0;
  $: pageStart = total === 0 ? 0 : offset + 1;
  $: pageEnd = Math.min(offset + PAGE_SIZE, total);
  $: hasPrev = offset > 0;
  $: hasNext = offset + PAGE_SIZE < total;

  /** Song section 2 is editing. Null means "follow whatever is currently playing". */
  let target: Target | null = null;
  let pasteUrl = '';
  let saving = false;
  let saveError: string | null = null;
  let saveOk: { resolvedTitle: string; durationSec: number } | null = null;
  let removingKey = '';
  let blockingKey = '';

  /** On-disk video cache. */
  let storage: { maxMb: number; limitMb: number; enabled: boolean; fileCount: number; totalBytes: number } | null = null;
  let maxMbInput = 0;
  let savingStorage = false;
  let storageError: string | null = null;
  let storageNote: string | null = null;

  function fmtBytes(b: number): string {
    if (b < 1024) return `${b} B`;
    const mb = b / (1024 * 1024);
    if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
  }

  async function loadStorage() {
    storage = await api.musicvideo.getStorage();
    maxMbInput = storage.maxMb;
  }

  async function saveStorage() {
    if (savingStorage) return;
    savingStorage = true;
    storageError = null;
    storageNote = null;
    try {
      const res = await api.musicvideo.setStorage(Number(maxMbInput));
      if (!res.ok) {
        storageError = res.error;
        return;
      }
      storageNote =
        res.removed > 0
          ? `Saved. Removed ${res.removed} video${res.removed === 1 ? '' : 's'} to fit.`
          : 'Saved.';
      await loadStorage();
    } finally {
      savingStorage = false;
    }
  }

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
      : (target.sourceStatus ?? 'unresolved')
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
    const q = search;
    const at = offset;
    const res = await api.musicvideo.listHistory({ query: q, limit: PAGE_SIZE, offset: at });
    // A slow response for an abandoned query or page must not overwrite a
    // newer one — typing fast, or clicking Next twice, would otherwise land
    // the wrong page.
    if (q !== search || at !== offset) return;
    history = res.rows;
    total = res.total;
  }

  function goToPage(next: number) {
    offset = Math.max(0, next);
    loadHistory();
  }

  /**
   * Debounced so typing a word costs one request, not one per keystroke.
   * Cleared on destroy alongside the now-playing poll.
   */
  function onSearchInput() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searching = true;
      // A new query invalidates the current page number: searching from page 3
      // would otherwise show an empty result set that looks like "no matches".
      offset = 0;
      loadHistory().finally(() => (searching = false));
    }, 250);
  }

  function clearSearch() {
    search = '';
    clearTimeout(searchTimer);
    offset = 0;
    loadHistory();
  }

  async function refreshAll() {
    await Promise.all([loadNowPlaying(), loadOverrides(), loadHistory(), loadStorage()]);
  }

  async function saveEntity() {
    try {
      await api.musicvideo.setSettings(entityId);
      await loadNowPlaying();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'save failed');
    }
  }

  function prefill(row: {
    trackKey: string;
    artist: string | null;
    title: string | null;
    /** Present on History rows (auto-match/miss); absent on Overrides rows,
     *  where an override always exists and takes precedence anyway. */
    videoId?: string | null;
  }) {
    const [artist, title] = row.artist && row.title ? [row.artist, row.title] : splitTrackKey(row.trackKey);
    const sourceStatus: Target['sourceStatus'] =
      'videoId' in row ? (row.videoId ? 'auto' : 'nothing-found') : undefined;
    target = { artist, title, trackKey: row.trackKey, sourceStatus };
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
      // Deliberately leave `target` as-is: nulling it here would swap the
      // header back to "Now playing" while the confirmation below still
      // describes the song that was just pinned, misattributing it if that
      // song isn't what's currently playing (see Recent → Pin).
      saveOk = { resolvedTitle: res.resolvedTitle, durationSec: res.durationSec };
      pasteUrl = '';
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
    clearTimeout(searchTimer);
  });
</script>

<svelte:head><title>Cosmos - Video Backdrop</title></svelte:head>

<header class="page-header reveal reveal-1">
  <span class="eyebrow">Video backdrop</span>
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

      {#if activeStatus === 'nothing-found' && !target && nowPlaying?.reason}
        <!-- Without this, "Nothing found" is a dead end: the user cannot tell
             whether to pin something or whether Cosmos is simply being strict. -->
        <p class="reason">{nowPlaying.reason}</p>
      {/if}

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

  {#if storage?.enabled}
    <section class="card reveal reveal-3">
      <h2>Stored videos</h2>
      <p class="hint">
        Videos are downloaded the first time they play, so later plays never touch YouTube —
        no expiry, no re-fetching. When the limit is reached, the least-played videos go first,
        oldest of those first.
      </p>

      <div class="storage-row">
        <Field label="Storage limit (MB)">
          <input type="number" min="0" max={storage.limitMb} step="128" bind:value={maxMbInput} />
        </Field>
        <button type="button" on:click={saveStorage} disabled={savingStorage}>
          {savingStorage ? 'Saving…' : 'Save'}
        </button>
      </div>

      <p class="usage">
        <span class="tag muted">{storage.fileCount} stored</span>
        <span class="usage-bytes">{fmtBytes(storage.totalBytes)} of {storage.maxMb} MB used</span>
      </p>
      {#if maxMbInput === 0}
        <p class="hint">Set to 0 — nothing is stored, and every play streams from YouTube.</p>
      {/if}
      {#if storageError}<p class="error">{storageError}</p>{/if}
      {#if storageNote}<p class="ok">{storageNote}</p>{/if}
    </section>
  {/if}

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
    <p class="hint">
      Songs Cosmos has recently tried to resolve, including misses. Search to reach
      every song it remembers, not just the recent ones.
    </p>

    <div class="search">
      <input
        type="search"
        bind:value={search}
        on:input={onSearchInput}
        placeholder="Search every song by artist or title…"
        aria-label="Search every song"
      />
      {#if search}
        <button class="ghost" on:click={clearSearch}>Clear</button>
      {/if}
    </div>

    {#if searching}
      <p class="empty">Searching…</p>
    {:else if history.length === 0}
      <p class="empty">
        {#if search}
          No song matching “{search}”.
        {:else}
          No resolution history yet.
        {/if}
      </p>
    {:else}
      <p class="hint">
        {#if search}
          {total} match{total === 1 ? '' : 'es'} — showing {pageStart}–{pageEnd}
        {:else}
          Showing {pageStart}–{pageEnd} of {total}
        {/if}
      </p>
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
              {#if !h.videoId && h.reason}
                <p class="reason">{h.reason}</p>
              {/if}
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

      {#if hasPrev || hasNext}
        <div class="pager">
          <button
            type="button"
            class="ghost"
            on:click={() => goToPage(offset - PAGE_SIZE)}
            disabled={!hasPrev}
          >
            Previous
          </button>
          <span class="pager-count">{pageStart}–{pageEnd} of {total}</span>
          <button
            type="button"
            class="ghost"
            on:click={() => goToPage(offset + PAGE_SIZE)}
            disabled={!hasNext}
          >
            Next
          </button>
        </div>
      {/if}
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

  .storage-row {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }
  .storage-row :global(.field) { flex: 1 1 12rem; }

  .usage {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    flex-wrap: wrap;
    margin: 0;
  }
  .usage-bytes {
    color: var(--c-fg-3);
    font-size: 0.85rem;
    font-family: var(--font-mono, monospace);
  }

  /* Why a lookup found nothing. Muted and small — it explains an empty slot,
     it is not the headline. */
  .reason {
    color: var(--c-fg-3);
    font-size: 0.85rem;
    line-height: 1.45;
    margin: 0.35rem 0 0;
    max-width: 60ch;
  }

  .pager {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--c-line);
  }
  .pager-count {
    color: var(--c-fg-3);
    font-size: 0.85rem;
    font-family: var(--font-mono, monospace);
  }

  /* Input styling itself comes from theme.css's global input rule. */
  .search {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1rem;
  }
  .search button {
    flex: none;
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
