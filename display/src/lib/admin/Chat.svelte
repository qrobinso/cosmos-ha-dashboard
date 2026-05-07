<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { useChat } from '@ai-sdk/svelte';
  import type { Message } from '@ai-sdk/ui-utils';
  import { marked } from 'marked';
  import ChatToolCall from './ChatToolCall.svelte';
  import { api } from './api.js';

  const HISTORY_KEY = 'cosmos.agent.history';
  const HISTORY_VERSION = 1;

  let initialMessages: Message[] = [];
  let confirmRequiredTools: string[] = [];
  let hasKey = false;
  let model = '';
  let loaded = false;

  // Restore conversation from localStorage *before* mounting useChat — once
  // useChat is initialized its initialMessages can't be reset.
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { v: number; messages: Message[] };
        if (parsed.v === HISTORY_VERSION && Array.isArray(parsed.messages)) {
          initialMessages = parsed.messages;
        }
      }
    } catch {
      // ignore corrupt history
    }
  }

  const chat = useChat({
    api: '/api/agent/chat',
    initialMessages,
    // Allow the model to chain multiple tool calls without a per-call round-trip
    // through the user. matches server's maxSteps.
    maxSteps: 5,
  });
  const { messages, input, handleSubmit, isLoading, error, addToolResult, setMessages, stop, append } = chat;

  let scrollEl: HTMLDivElement;
  let inputEl: HTMLTextAreaElement;
  let unsubMessages: () => void = () => {};

  // Persist messages to localStorage on every change.
  unsubMessages = messages.subscribe((list) => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify({ v: HISTORY_VERSION, messages: list }));
    } catch {
      // quota exceeded; not worth surfacing
    }
    // Auto-scroll to the bottom on new content.
    void tick().then(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    });
  });

  onMount(async () => {
    try {
      const settings = await api.agent.getSettings();
      hasKey = settings.hasKey;
      model = settings.model;
      confirmRequiredTools = settings.confirmRequiredTools ?? [];
    } catch {
      // server might not be ready yet; the inline error banner will catch it.
    }
    loaded = true;
    // Auto-focus the textarea so the user can just start typing.
    if (inputEl) inputEl.focus();
  });

  onDestroy(() => {
    try { stop(); } catch { /* mid-stream cancel is best-effort */ }
    unsubMessages();
  });

  function clearHistory() {
    if (!confirm('Clear the conversation? This cannot be undone.')) return;
    setMessages([]);
    if (typeof localStorage !== 'undefined') localStorage.removeItem(HISTORY_KEY);
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ($input.trim()) handleSubmit();
    }
  }

  /** Parse a message's text content into HTML, but only for assistant messages.
   *  User messages stay as plain text — the agent doesn't need to render their markdown. */
  function renderMarkdown(text: string): string {
    return marked.parse(text, { gfm: true, breaks: true, async: false }) as string;
  }

  /** Pick the seasonal/holiday suggestion most relevant to a given date.
   *  Pure function — easy to unit-test and predictable across timezones (uses
   *  the user's local date). */
  function holidaySuggestion(now: Date): string | null {
    const m = now.getMonth() + 1;
    const d = now.getDate();
    if (m === 12 && d <= 25) return 'Make a Christmas countdown scene';
    if ((m === 12 && d >= 26) || (m === 1 && d <= 5)) return 'Build a New Year countdown scene';
    if (m === 2 && d <= 14) return "Make a Valentine's Day scene with warm pinks";
    if (m === 3 && d <= 17) return "Make a St. Patrick's Day scene";
    if (m === 4) return 'Build a spring scene with soft pastel gradients';
    if (m === 5) return 'Make a late-spring scene with garden vibes';
    if (m === 6 || m === 7) return 'Build a summer scene with bright sunny colors';
    if (m === 7 && d >= 1 && d <= 4) return 'Build a Fourth of July scene with red, white, and blue';
    if (m === 8) return 'Make a hazy late-summer scene';
    if (m === 9) return 'Make a cozy early-fall scene with autumn tones';
    if (m === 10) return 'Build a Halloween-themed scene with spooky accents';
    if (m === 11 && d <= 28) return 'Make a Thanksgiving warm-autumn scene';
    if (m === 11 && d >= 29) return 'Make an early-holiday scene with twinkling lights';
    return null;
  }

  /** Time-of-day suggestion. */
  function timeOfDaySuggestion(now: Date): string {
    const h = now.getHours();
    if (h >= 5 && h < 11) return 'Make a bright morning scene with the time and weather';
    if (h >= 11 && h < 17) return 'Build a daytime dashboard with my key sensors';
    if (h >= 17 && h < 21) return 'Create a calming evening scene with warm tones';
    return 'Make an ambient night scene with stars and the time';
  }

  /** Build a fresh list of clickable starter prompts. Re-runs on mount and
   *  when the user clears history, so the wording feels current. */
  function buildSuggestions(now: Date): string[] {
    const out: string[] = [];
    out.push(timeOfDaySuggestion(now));
    const holiday = holidaySuggestion(now);
    if (holiday) out.push(holiday);
    out.push('Change the canvas on my main scene to use blue accents');
    out.push('List my scenes');
    return out;
  }

  // Recomputed each component mount + every render where $messages becomes
  // empty again (after Clear). Suggestions are cheap, recompute is fine.
  $: suggestions = $messages.length === 0 ? buildSuggestions(new Date()) : [];

  function sendSuggestion(text: string) {
    void append({ role: 'user', content: text });
  }
</script>

<div class="chat">
  <header class="chat-header">
    <div>
      <span class="eyebrow">Agent</span>
      <h1>Ask me to build or change something.</h1>
      {#if loaded && model}
        <p class="model-line"><span class="muted">Model:</span> <code>{model}</code></p>
      {/if}
    </div>
    <button
      class="ghost clear-btn"
      type="button"
      on:click={clearHistory}
      disabled={$messages.length === 0}
      aria-label="Clear conversation history"
    >
      <span aria-hidden="true">⌫</span>
      <span>Clear history</span>
    </button>
  </header>

  {#if loaded && !hasKey}
    <div class="warning card">
      <strong>OpenRouter key missing.</strong>
      <p>Add your key in <a href="/admin/settings">Settings → AI agent</a> to start chatting.</p>
    </div>
  {/if}

  <div class="scroll" bind:this={scrollEl}>
    {#if $messages.length === 0}
      <div class="empty">
        <h2>What should I build?</h2>
        <p class="empty-sub">Tap a starter, or type your own ask below.</p>
        <div class="suggestion-chips">
          {#each suggestions as s (s)}
            <button type="button" class="suggestion" on:click={() => sendSuggestion(s)}>
              <span class="suggestion-icon" aria-hidden="true">✦</span>
              <span>{s}</span>
            </button>
          {/each}
        </div>
      </div>
    {/if}

    {#each $messages as m (m.id)}
      <div class="msg msg-{m.role}">
        <div class="msg-bubble">
          {#if m.content}
            {#if m.role === 'assistant'}
              <div class="md">{@html renderMarkdown(m.content)}</div>
            {:else}
              <div class="text">{m.content}</div>
            {/if}
          {/if}
          {#if m.toolInvocations}
            <div class="tool-list">
              {#each m.toolInvocations as inv (inv.toolCallId)}
                <ChatToolCall invocation={inv} {confirmRequiredTools} {addToolResult} />
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/each}

    {#if $error}
      <div class="msg msg-error">
        <div class="msg-bubble">
          <strong>Error.</strong> {$error.message ?? String($error)}
        </div>
      </div>
    {/if}

    {#if $isLoading}
      <!-- Inline indicator so the chat shows progress between text chunks
           and during tool calls — without it the UI looks frozen while the
           agent thinks. The dots loop until streamed text or a tool result
           appears below. -->
      <div class="msg msg-assistant" aria-live="polite">
        <div class="msg-bubble typing-bubble" aria-label="Agent is working">
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
          <span class="typing-dot"></span>
        </div>
      </div>
    {/if}
  </div>

  <form class="composer" on:submit|preventDefault={handleSubmit}>
    <textarea
      bind:this={inputEl}
      bind:value={$input}
      on:keydown={onKeydown}
      placeholder={hasKey ? 'Tell the agent what you want… (Enter to send, Shift+Enter for newline)' : 'Set your OpenRouter key first.'}
      disabled={!hasKey}
      rows="2"
    ></textarea>
    <div class="composer-actions">
      {#if $isLoading}
        <button type="button" class="ghost" on:click={() => stop()}>Stop</button>
      {/if}
      <button type="submit" class="primary" disabled={!hasKey || !$input.trim() || $isLoading}>
        {$isLoading ? 'Working…' : 'Send'}
      </button>
    </div>
  </form>
</div>

<style>
  .chat {
    /* Pin the chat to the viewport so the page itself never scrolls. The
       .scroll child handles overflow. Chrome math:
         topbar           ~3.5rem (mobile) / ~3.75rem (desktop)
         admin-main pad   2rem (mobile) / 4rem (desktop)
         our gap+slop     ~0.5rem
       100dvh handles mobile keyboard / address-bar shrink correctly. */
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    height: calc(100dvh - 6rem);
    min-height: 22rem;
  }
  @media (min-width: 720px) {
    .chat { height: calc(100dvh - 8rem); }
  }

  .chat-header {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .chat-header h1 {
    /* Smaller on mobile so the title + Clear button fit on one row. */
    font-size: clamp(1.15rem, 4.5vw, 2rem);
    line-height: 1.15;
    margin-top: 0.15rem;
  }
  .clear-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
    /* Slightly smaller on mobile so it doesn't dominate the title. */
    padding: 0.45rem 0.75rem;
    font-size: 0.85rem;
    min-height: 0;
  }
  .model-line {
    margin: 0.3rem 0 0;
    font-size: 0.75rem;
    color: var(--c-fg-3);
    word-break: break-all;
  }
  .model-line code { font-family: ui-monospace, 'JetBrains Mono', monospace; }
  .muted { color: var(--c-fg-3); }

  .warning {
    flex: 0 0 auto;
    background: var(--c-surface-2);
    border-left: 3px solid var(--c-accent);
    padding: 0.85rem 1rem;
  }
  .warning p { margin: 0.3rem 0 0; color: var(--c-fg-2); font-size: 0.9rem; }
  .warning a { color: var(--c-accent); }

  .scroll {
    /* min-height:0 lets the flex child shrink to fit and handle overflow,
       instead of inheriting min-content (the default flex min-height) which
       would force the parent to grow with the content. */
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    position: relative;
  }
  @media (min-width: 600px) {
    .scroll { padding: 1rem; gap: 1rem; }
  }

  .empty {
    /* Centered absolutely so the empty hint floats in the middle of the
       scroll area without affecting flex sizing or the composer below. */
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    color: var(--c-fg-3);
    padding: 1rem;
    pointer-events: none;
    overflow-y: auto;
  }
  @media (min-width: 600px) {
    .empty { padding: 2rem; }
  }
  .empty > * { pointer-events: auto; }
  .empty ul, .empty li { pointer-events: auto; }
  .empty h2 { color: var(--c-fg-2); margin-bottom: 0.4rem; font-weight: 300; max-width: 36rem; }
  .empty-sub { color: var(--c-fg-3); font-size: 0.85rem; margin: 0 0 1rem; max-width: 36rem; }

  .suggestion-chips {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    width: 100%;
    max-width: 36rem;
  }
  .suggestion {
    display: inline-flex;
    align-items: center;
    gap: 0.55rem;
    text-align: left;
    background: var(--c-surface-2);
    border: 1px solid var(--c-line);
    color: var(--c-fg-2);
    padding: 0.65rem 1rem;
    border-radius: 999px;
    font-size: 0.9rem;
    cursor: pointer;
    transition: background 120ms var(--ease), border-color 120ms var(--ease), color 120ms var(--ease), transform 120ms var(--ease);
    min-height: 0;
    line-height: 1.3;
  }
  .suggestion:hover {
    background: var(--c-accent-tint);
    border-color: var(--c-accent);
    color: var(--c-fg);
    transform: translateY(-1px);
  }
  .suggestion-icon { color: var(--c-accent); flex-shrink: 0; }

  .msg { display: flex; }
  .msg-user { justify-content: flex-end; }
  .msg-assistant, .msg-error { justify-content: flex-start; }

  .msg-bubble {
    max-width: 85%;
    padding: 0.75rem 1rem;
    border-radius: 1rem;
    font-size: 0.92rem;
    line-height: 1.5;
  }
  .msg-user .msg-bubble {
    background: var(--c-accent-tint);
    color: var(--c-fg);
    border-bottom-right-radius: 0.3rem;
  }
  .msg-assistant .msg-bubble {
    background: var(--c-surface-2);
    border: 1px solid var(--c-line);
    border-bottom-left-radius: 0.3rem;
  }
  .msg-error .msg-bubble {
    background: rgba(255, 87, 87, 0.12);
    border: 1px solid var(--c-danger);
    color: var(--c-fg);
  }

  .text { white-space: pre-wrap; }
  .md :global(p) { margin: 0 0 0.5rem; }
  .md :global(p:last-child) { margin-bottom: 0; }
  .md :global(code) {
    background: var(--c-bg);
    padding: 0.1rem 0.3rem;
    border-radius: 0.25rem;
    font-family: ui-monospace, 'JetBrains Mono', monospace;
    font-size: 0.85em;
  }
  .md :global(pre) {
    background: var(--c-bg);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 0.75rem 1rem;
    overflow-x: auto;
    margin: 0.5rem 0;
  }
  .md :global(pre code) { background: transparent; padding: 0; }
  .md :global(ul), .md :global(ol) { padding-left: 1.5rem; margin: 0.5rem 0; }

  .tool-list {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }

  /* Typing indicator — three pulsing dots in an assistant bubble. Sized to
     match a single line of text so it sits naturally where the next message
     will arrive. */
  .typing-bubble {
    display: inline-flex;
    gap: 0.35rem;
    align-items: center;
    padding: 0.85rem 1rem;
  }
  .typing-dot {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 999px;
    background: var(--c-fg-3);
    animation: typing-pulse 1.4s ease-in-out infinite;
  }
  .typing-dot:nth-child(2) { animation-delay: 0.2s; }
  .typing-dot:nth-child(3) { animation-delay: 0.4s; }
  @keyframes typing-pulse {
    0%, 60%, 100% { opacity: 0.25; transform: translateY(0); }
    30% { opacity: 1; transform: translateY(-2px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .typing-dot { animation: none; opacity: 0.6; }
  }

  .composer {
    /* flex: none locks the composer at content size — its height is the
       tallest grid item (the textarea, capped at max-height below). Grid
       inside, not flex, so `flex: 1` on the textarea can't accidentally
       expand it cross-axis (the bug that was making this stretch up the
       page when the chat history was empty). */
    flex: none;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: end;
    gap: 0.4rem;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 0.4rem;
  }
  .composer textarea {
    width: 100%;
    background: transparent;
    border: none;
    color: var(--c-fg);
    font-family: inherit;
    /* 16px base prevents iOS Safari zooming the viewport on focus. */
    font-size: 1rem;
    resize: none;
    padding: 0.4rem 0.5rem;
    min-height: 2.6rem;
    /* Cap mobile shorter than desktop so the keyboard doesn't push the
       message area too small when the textarea grows. */
    max-height: 6.5rem;
    box-sizing: border-box;
    outline: none;
  }
  @media (min-width: 720px) {
    .composer textarea { max-height: 10rem; }
  }
  .composer textarea:disabled { color: var(--c-fg-3); }
  .composer-actions {
    display: flex;
    gap: 0.4rem;
    align-self: end;
  }
</style>
