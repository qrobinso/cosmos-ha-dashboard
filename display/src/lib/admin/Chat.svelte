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
    <button class="ghost" on:click={clearHistory} disabled={$messages.length === 0}>Clear</button>
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
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    gap: 1rem;
    min-height: calc(100vh - 6rem);
    max-height: calc(100vh - 6rem);
  }

  .chat-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 1rem;
  }
  .chat-header h1 { font-size: clamp(1.5rem, 3vw, 2rem); margin-top: 0.2rem; }
  .model-line { margin: 0.4rem 0 0; font-size: 0.8rem; color: var(--c-fg-3); }
  .model-line code { font-family: ui-monospace, 'JetBrains Mono', monospace; }
  .muted { color: var(--c-fg-3); }

  .warning {
    background: var(--c-surface-2);
    border-left: 3px solid var(--c-accent);
    padding: 0.85rem 1rem;
  }
  .warning p { margin: 0.3rem 0 0; color: var(--c-fg-2); font-size: 0.9rem; }
  .warning a { color: var(--c-accent); }

  .scroll {
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--c-surface);
    border: 1px solid var(--c-line);
    border-radius: var(--radius-sm);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .empty {
    margin: auto;
    text-align: center;
    color: var(--c-fg-3);
    max-width: 36rem;
  }
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

  .composer {
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
