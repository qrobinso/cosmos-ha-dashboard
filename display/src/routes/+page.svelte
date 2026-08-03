<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { getDisplayName, setDisplayName } from '$lib/storage';
  import { setDisplayName as setReportDisplayName } from '$lib/scene/reportPalette';
  import { connect, type ServerMessage, type Orientation, type CosmosConnection } from '$lib/ws';
  import type { SceneState } from '$lib/types';
  import TransitionStage from '$lib/scene/TransitionStage.svelte';
  import type { TransitionDescriptor } from '$lib/transitions/types';
  import MessageOverlay from '$lib/overlay/MessageOverlay.svelte';
  import FullscreenButton from '$lib/scene/FullscreenButton.svelte';
  import RefreshTapper from '$lib/scene/RefreshTapper.svelte';
  import type { OverlayMessage } from '$lib/types';
  import type { VoiceOverlayState } from '$lib/voice/types';
  import type { VoiceBootstrapHandle } from '$lib/voice/bootstrap';

  let name: string | null = null;
  let inputName = '';
  let greeting: string | null = null;
  let scene: SceneState | null = null;
  let error: string | null = null;
  let socket: CosmosConnection | null = null;
  let pendingTransition: TransitionDescriptor | null = null;
  let overlay: OverlayMessage | null = null;
  let orientation: Orientation = 'landscape';
  // Voice bootstrap is armed at most once per session, lazily, only for
  // displays with voiceEnabled — see armVoice(). null until (if ever) armed,
  // and set back to null after stop() so a later display_config can re-arm.
  let voiceHandle: VoiceBootstrapHandle | null = null;
  // Synchronous re-entrancy guard: armVoice's async chain (first WASM fetch)
  // can take seconds, and voiceHandle itself isn't set until it settles. A
  // second display_config arriving in that window must not double-arm the
  // mic — this flag closes that gap.
  let voiceArming = false;
  // Latest desired voice state per the most recent display_config. Read at
  // the end of armVoice's async chain so a toggle-off that lands mid-arm
  // (mic permission prompt, WASM fetch, ONNX model load — all can take
  // seconds) doesn't leave a freshly-armed mic running for a state nobody
  // wants anymore.
  let voiceWanted = false;

  $: if (typeof document !== 'undefined') {
    document.body.dataset.orientation = orientation;
  }

  // Voice overlay states reuse the kiosk's single MessageOverlay slot rather
  // than a second overlay UI (per the voice-assistant design spec). This means
  // a voice state and a server-pushed OverlayMessage can't be shown
  // simultaneously — whichever lands last wins. Acceptable for this task;
  // revisit if that collision turns out to matter in practice.
  function voiceOverlayFor(state: VoiceOverlayState, text?: string): OverlayMessage | null {
    switch (state) {
      case 'listening':
        // Backstop: if no further voice_result ever arrives (e.g. the
        // capture arm-timeout expires with no speech, or the WS drops
        // mid-utterance), this overlay must not stick forever.
        return { title: 'Listening…', icon: '🎙️', timeout_ms: 8000 };
      case 'thinking':
        // Backstop for a stt-end/intent-end with no eventual tts-end or
        // error (see server/src/voice/relay.ts's per-utterance timeout).
        return { title: text ?? 'Thinking…', icon: '💭', timeout_ms: 30000 };
      case 'response':
        return { title: text ?? 'Done', icon: '🔊', timeout_ms: 6000 };
      case 'error':
        return { title: 'Voice error', body: text, icon: '⚠️', timeout_ms: 5000 };
      default:
        return null;
    }
  }

  function onVoiceOverlayState(state: VoiceOverlayState, text?: string) {
    overlay = voiceOverlayFor(state, text);
  }

  // Dynamically imported: voice/bootstrap.ts (transitively wakeword.ts) pulls
  // in onnxruntime-web's ~26MB WASM runtime. A static top-level import here
  // would bloat every kiosk boot, including displays with voice disabled.
  async function armVoice(connection: CosmosConnection) {
    if (voiceHandle || voiceArming) return; // already armed, or an arm is already in flight
    voiceArming = true;
    try {
      const { startVoiceBootstrap } = await import('$lib/voice/bootstrap');
      const handle = await startVoiceBootstrap(connection, onVoiceOverlayState);
      if (!voiceWanted) {
        // Voice was toggled off again while the arm was in flight — don't
        // leave the mic/AudioContext/wake-word session it just created
        // running for a state we no longer want.
        void handle?.stop();
        voiceHandle = null;
        return;
      }
      voiceHandle = handle;
    } finally {
      voiceArming = false;
    }
  }

  function handleMessage(msg: ServerMessage) {
    if (msg.type === 'welcome') {
      greeting = msg.message;
      error = null;
    } else if (msg.type === 'display_config') {
      orientation = msg.config.orientation;
      voiceWanted = !!msg.config.voiceEnabled;
      if (voiceWanted && socket) {
        void armVoice(socket);
      } else if (voiceHandle) {
        // Admin turned voice off on an already-armed display — disarm so the
        // mic/AudioContext/wake-word session doesn't just run forever.
        const handle = voiceHandle;
        voiceHandle = null;
        void handle.stop();
      }
    } else if (msg.type === 'scene') {
      pendingTransition = msg.transition ?? null;
      scene = msg.state;
      error = null;
    } else if (msg.type === 'overlay') {
      overlay = msg.overlay;
    } else if (msg.type === 'overlay_dismiss') {
      overlay = null;
    } else if (msg.type === 'voice_result') {
      voiceHandle?.handleServerMessage(msg);
    } else {
      error = msg.error;
    }
  }

  function start(n: string) {
    name = n;
    setReportDisplayName(n);
    socket = connect(n, handleMessage);
  }

  function submitOnboarding(e: Event) {
    e.preventDefault();
    const trimmed = inputName.trim();
    if (!trimmed) return;
    setDisplayName(trimmed);
    start(trimmed);
  }

  onMount(() => {
    // ?display=<name> launches a one-shot preview without overwriting the
    // device's saved display name. Useful for the admin Preview button.
    const params = new URLSearchParams(window.location.search);
    const previewName = params.get('display')?.trim();
    if (previewName) {
      start(previewName);
      return;
    }
    const stored = getDisplayName();
    if (stored) start(stored);
  });

  onDestroy(() => {
    socket?.close();
    setReportDisplayName(null);
    void voiceHandle?.stop();
  });
</script>

<main style="display:grid;place-items:center;min-height:100vh;text-align:center;padding:2rem">
  {#if !name}
    <form on:submit={submitOnboarding} style="display:grid;gap:1rem;max-width:24rem;width:100%">
      <h1 style="margin:0;font-weight:300">Name this display</h1>
      <input
        bind:value={inputName}
        placeholder="e.g. Living Room"
        autofocus
        style="font-size:1.25rem;padding:0.75rem;border-radius:0.5rem;border:1px solid #333;background:#111;color:inherit"
      />
      <button
        type="submit"
        style="font-size:1.1rem;padding:0.75rem;border-radius:0.5rem;border:none;background:#f5f5f5;color:#0a0a0a;cursor:pointer"
      >
        Continue
      </button>
    </form>
  {:else if error}
    <p style="color:#ff8a8a">Error: {error}</p>
  {:else if scene}
    <TransitionStage {scene} transition={pendingTransition} displayName={name} />
    <MessageOverlay {overlay} onDismiss={() => (overlay = null)} />
  {:else if greeting}
    <h1 style="font-weight:300;font-size:3rem">{greeting}</h1>
  {:else}
    <p style="opacity:0.6">Connecting…</p>
  {/if}
</main>

{#if name}
  <RefreshTapper />
  <FullscreenButton />
{/if}
