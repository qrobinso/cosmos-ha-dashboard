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
  const { messages, input, handleSubmit, isLoading, error, addToolResult, setMessages, stop } = chat;

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
        <ul>
          <li>"List my scenes"</li>
          <li>"Make a kitchen morning scene with the time and a sunrise gradient"</li>
          <li>"Change the canvas on the Energy scene to use blue accents"</li>
          <li>"Activate the Morning scene on Living Room"</li>
        </ul>
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
    /* Flex column with min-height:0 on the scroll child is the standard
       robust pattern for "fill remaining height; scroll the middle". The
       100dvh handles mobile address-bar shrink correctly. The fixed minus
       accounts for the topbar (~60px) + admin-main vertical padding. */
    display: flex;
    flex-direction: column;
    gap: 1rem;
    height: calc(100dvh - 7rem);
    min-height: 30rem;
  }

  .chat-header {
    flex: 0 0 auto;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }
  .clear-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    flex-shrink: 0;
  }
  .chat-header h1 { font-size: clamp(1.5rem, 3vw, 2rem); margin-top: 0.2rem; }
  .model-line { margin: 0.4rem 0 0; font-size: 0.8rem; color: var(--c-fg-3); }
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
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
    /* When .empty is the only child, anchor it to the visual center via the
       container's own justify-content. .msg children override with default
       flex-start naturally — they layer at the top once any history exists. */
    position: relative;
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
    padding: 2rem;
    pointer-events: none;
  }
  .empty > * { pointer-events: auto; }
  .empty ul, .empty li { pointer-events: auto; }
  .empty h2 { color: var(--c-fg-2); margin-bottom: 0.85rem; font-weight: 300; }
  .empty ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    font-size: 0.9rem;
  }
  .empty li {
    background: var(--c-surface-2);
    padding: 0.5rem 0.85rem;
    border-radius: var(--radius-sm);
    border: 1px solid var(--c-line);
  }

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
    flex: 0 0 auto;
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 0.5rem;
  }
  .composer textarea {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--c-fg);
    font-family: inherit;
    font-size: 0.95rem;
    resize: none;
    padding: 0.4rem 0.5rem;
    min-height: 2.4rem;
    max-height: 10rem;
    outline: none;
  }
  .composer textarea:disabled { color: var(--c-fg-3); }
  .composer-actions {
    display: flex;
    gap: 0.4rem;
  }
</style>
