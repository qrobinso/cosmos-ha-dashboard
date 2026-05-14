<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { WidgetState, CameraData } from '$lib/types';

  export let widget: WidgetState;

  $: cam = widget.data as CameraData | null;
  $: cfg = widget.config as Record<string, unknown>;
  $: view = (typeof cfg.view === 'string' ? cfg.view : 'auto') as 'auto' | 'live';
  $: protocol = (typeof cfg.protocol === 'string' ? cfg.protocol : 'auto') as 'auto' | 'webrtc' | 'hls' | 'mjpeg';
  $: fit = (typeof cfg.fit === 'string' ? cfg.fit : 'cover') as 'cover' | 'contain' | 'fill';
  $: aspectRatio = typeof cfg.aspect_ratio === 'string' && cfg.aspect_ratio
    ? cfg.aspect_ratio.replace(':', ' / ')
    : '';
  $: refreshSec = (() => {
    const v = cfg.refresh_interval_s;
    return typeof v === 'number' && Number.isFinite(v) && v >= 1 ? v : 10;
  })();
  $: showName = cfg.show_name === true;
  $: showState = cfg.show_state === true;
  $: nameOverride = typeof cfg.name === 'string' ? cfg.name : '';
  $: displayName = nameOverride || cam?.friendly_name || '';

  // Cache-busting tick for snapshot polling. The url itself is stable so we
  // append `?t=<ms>` and bump the value to force the browser to refetch.
  let tick = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  let mounted = false;
  let videoEl: HTMLVideoElement;
  let liveError: string | null = null;
  let stopLive: (() => void) | null = null;
  let liveRun = 0;
  let activeLiveKey = '';

  function clearTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  $: {
    // Re-arm the polling timer whenever view/refresh changes.
    clearTimer();
    if (cam?.available && view === 'auto' && refreshSec > 0) {
      timer = setInterval(() => {
        tick = Date.now();
      }, refreshSec * 1000);
    }
  }

  function proxiedEntityPath(entityId: string, path: string): string {
    return `/api/cameras/${encodeURIComponent(entityId)}${path}`;
  }

  function pickLiveKind(): 'webrtc' | 'hls' | 'mjpeg' {
    const types = cam?.stream_types ?? [];
    if (protocol === 'webrtc') return 'webrtc';
    if (protocol === 'hls') return 'hls';
    if (protocol === 'mjpeg') return 'mjpeg';
    if (types.includes('web_rtc')) return 'webrtc';
    if (types.includes('hls')) return 'hls';
    return 'mjpeg';
  }

  function cleanupLive() {
    stopLive?.();
    stopLive = null;
    if (videoEl) {
      videoEl.pause();
      videoEl.removeAttribute('src');
      videoEl.srcObject = null;
      videoEl.load();
    }
  }

  function prepareVideo() {
    if (!videoEl) return;
    videoEl.muted = true;
    videoEl.autoplay = true;
    videoEl.playsInline = true;
  }

  async function playVideo() {
    prepareVideo();
    await videoEl?.play().catch(() => {});
  }

  function selectHlsPlaylist(masterPlaylist: string, masterUrl: string): string {
    const playlistRegexp = /#EXT-X-STREAM-INF:.*?(?:\n|\r\n)(.+)/g;
    const first = playlistRegexp.exec(masterPlaylist);
    const second = playlistRegexp.exec(masterPlaylist);
    if (first?.[1] && !second) return new URL(first[1].trim(), new URL(masterUrl, window.location.href)).href;
    return masterUrl;
  }

  async function startHls(entityId: string, run: number) {
    const abort = new AbortController();
    stopLive = () => abort.abort();
    const res = await fetch(proxiedEntityPath(entityId, '/stream-url?format=hls'), {
      cache: 'no-store',
      signal: abort.signal,
    });
    if (!res.ok) throw new Error('HLS stream unavailable');
    const { url } = (await res.json()) as { url?: string };
    if (!url) throw new Error('HLS stream unavailable');
    if (!videoEl || run !== liveRun || abort.signal.aborted) return;

    prepareVideo();
    const masterRes = await fetch(url, { cache: 'no-store', signal: abort.signal });
    if (!masterRes.ok) throw new Error('HLS stream unavailable');
    const playlistUrl = selectHlsPlaylist(await masterRes.text(), url);
    if (!videoEl || run !== liveRun || abort.signal.aborted) return;

    const nativeHls = videoEl.canPlayType('application/vnd.apple.mpegurl') !== '';
    const mod = await import('hls.js');
    const Hls = mod.default;
    if (run !== liveRun || abort.signal.aborted) return;

    if (Hls.isSupported()) {
      const hls = new Hls({
        backBufferLength: 60,
        lowLatencyMode: true,
        maxLiveSyncPlaybackRate: 2,
        fragLoadingTimeOut: 30000,
        manifestLoadingTimeOut: 30000,
        levelLoadingTimeOut: 30000,
      });
      stopLive = () => {
        abort.abort();
        hls.destroy();
      };
      hls.attachMedia(videoEl);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(playlistUrl));
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        void playVideo();
      });
      hls.on(Hls.Events.FRAG_LOADED, () => {
        if (run === liveRun) liveError = null;
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          hls.recoverMediaError();
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          hls.startLoad();
        }
      });
    } else if (nativeHls) {
      videoEl.src = playlistUrl;
      stopLive = () => abort.abort();
      videoEl.addEventListener('loadedmetadata', () => void playVideo(), { once: true });
    } else {
      throw new Error('HLS is not supported in this browser');
    }
    await playVideo();
  }

  function parseNdjsonChunk(buffer: string): { lines: string[]; rest: string } {
    const parts = buffer.split(/\r?\n/);
    return { lines: parts.slice(0, -1), rest: parts[parts.length - 1] ?? '' };
  }

  async function startWebRtc(entityId: string, run: number) {
    if (typeof RTCPeerConnection === 'undefined') throw new Error('WebRTC is not supported in this browser');

    const abort = new AbortController();
    const configRes = await fetch(proxiedEntityPath(entityId, '/webrtc/client-config'), { signal: abort.signal });
    if (!configRes.ok) throw new Error('WebRTC client configuration unavailable');
    const clientConfig = (await configRes.json()) as { configuration?: RTCConfiguration; dataChannel?: string };
    if (run !== liveRun || abort.signal.aborted) return;

    const pc = new RTCPeerConnection(clientConfig.configuration ?? {});
    const remote = new MediaStream();
    let sessionId: string | null = null;
    let candidates: RTCIceCandidate[] = [];
    let remoteDescriptionSet = false;

    stopLive = () => {
      abort.abort();
      remote.getTracks().forEach((track) => track.stop());
      pc.close();
    };

    if (clientConfig.dataChannel) pc.createDataChannel(clientConfig.dataChannel);
    prepareVideo();
    if (videoEl) videoEl.srcObject = remote;
    pc.ontrack = (event) => {
      if (event.track.kind === 'audio') return;
      remote.addTrack(event.track);
      if (videoEl) videoEl.srcObject = remote;
      void playVideo();
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };
    pc.onicecandidate = (event) => {
      if (!event.candidate?.candidate) return;
      if (!sessionId) {
        candidates.push(event.candidate);
        return;
      }
      void fetch(proxiedEntityPath(entityId, '/webrtc/candidate'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, candidate: event.candidate.toJSON() }),
      }).catch(() => {});
    };
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.addTransceiver('video', { direction: 'recvonly' });

    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    if (run !== liveRun || abort.signal.aborted) return;
    await waitForInitialIceCandidates(pc, abort.signal, 250);
    const initialCandidateLines = candidates.map((candidate) => `a=${candidate.candidate}\r\n`).join('');
    candidates = [];

    const offerRes = await fetch(proxiedEntityPath(entityId, '/webrtc/offer'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offer: `${offer.sdp ?? ''}${initialCandidateLines}` }),
      signal: abort.signal,
    });
    if (!offerRes.ok || !offerRes.body) throw new Error('WebRTC offer failed');

    const reader = offerRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (run === liveRun && !abort.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseNdjsonChunk(buffer);
      buffer = parsed.rest;
      for (const line of parsed.lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as {
          type?: string;
          session_id?: string;
          answer?: string;
          candidate?: RTCIceCandidateInit;
          message?: string;
        };
        if (event.type === 'session' && event.session_id) {
          sessionId = event.session_id;
          for (const candidate of candidates) {
            void fetch(proxiedEntityPath(entityId, '/webrtc/candidate'), {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ session_id: sessionId, candidate: candidate.toJSON() }),
            }).catch(() => {});
          }
          candidates = [];
        } else if (event.type === 'answer' && event.answer) {
          if (remoteDescriptionSet || pc.signalingState === 'stable' || pc.signalingState === 'closed') continue;
          await pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: event.answer }));
          remoteDescriptionSet = true;
          await playVideo();
        } else if (event.type === 'candidate' && event.candidate) {
          const candidate = event.candidate.sdpMid || event.candidate.sdpMLineIndex != null
            ? new RTCIceCandidate(event.candidate)
            : new RTCIceCandidate({ candidate: event.candidate.candidate, sdpMid: '0' });
          await pc.addIceCandidate(candidate).catch(() => {});
        } else if (event.type === 'error') {
          throw new Error(event.message || 'WebRTC stream failed');
        }
      }
    }
  }

  async function waitForInitialIceCandidates(
    pc: RTCPeerConnection,
    abortSignal: AbortSignal,
    timeoutMs: number
  ): Promise<void> {
    if (pc.iceGatheringState === 'complete' || abortSignal.aborted) return;
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onStateChange);
        abortSignal.removeEventListener('abort', done);
        resolve();
      };
      const onStateChange = () => {
        if (pc.iceGatheringState === 'complete') done();
      };
      const timer = setTimeout(done, timeoutMs);
      pc.addEventListener('icegatheringstatechange', onStateChange);
      abortSignal.addEventListener('abort', done, { once: true });
    });
  }

  async function startLive() {
    cleanupLive();
    liveError = null;
    const entityId = cam?.entity_id;
    if (!mounted || !cam?.available || view !== 'live' || !entityId) return;
    const kind = pickLiveKind();
    if (kind === 'mjpeg') return;
    const run = ++liveRun;
    try {
      if (kind === 'webrtc') await startWebRtc(entityId, run);
      else await startHls(entityId, run);
    } catch (err) {
      if (run === liveRun && kind === 'webrtc' && (cam?.stream_types ?? []).includes('hls')) {
        try {
          await startHls(entityId, run);
          return;
        } catch {
          // Fall through to the MJPEG fallback below.
        }
      }
      if (run === liveRun) {
        liveError = err instanceof Error ? err.message : 'Live stream failed';
        cleanupLive();
      }
    }
  }

  $: liveKind = view === 'live' && cam?.available ? pickLiveKind() : 'mjpeg';
  $: liveKey = `${cam?.entity_id ?? ''}|${cam?.available ? 'available' : 'unavailable'}|${cam?.stream_types?.join(',') ?? ''}|${view}|${protocol}`;
  $: if (mounted && liveKey && liveKey !== activeLiveKey) {
    activeLiveKey = liveKey;
    void startLive();
  }

  onMount(() => {
    mounted = true;
    if (liveKey) {
      activeLiveKey = liveKey;
      void startLive();
    }
  });

  onDestroy(() => {
    clearTimer();
    liveRun += 1;
    cleanupLive();
  });

  $: imgSrc = (() => {
    if (!cam || !cam.snapshot_url) return '';
    if (view === 'live' && liveKind === 'mjpeg') return cam.stream_url;
    return `${cam.snapshot_url}?t=${tick}`;
  })();
</script>

<div class="camera" class:has-aspect={!!aspectRatio} style={aspectRatio ? `aspect-ratio: ${aspectRatio};` : ''}>
  {#if !cam || !cam.available}
    <div class="placeholder">
      <span class="dot"></span>
      <span class="msg">{cam ? cam.friendly_name : 'Camera'} unavailable</span>
    </div>
  {:else}
    {#if view === 'live' && liveKind !== 'mjpeg'}
      <video
        bind:this={videoEl}
        class="feed"
        style="object-fit: {fit};"
        poster={cam.snapshot_url}
        muted
        autoplay
        playsinline
      ></video>
      {#if liveError}
        <img class="feed fallback" style="object-fit: {fit};" src={cam.stream_url} alt={displayName || cam.entity_id} />
      {/if}
    {:else}
      <img class="feed" style="object-fit: {fit};" src={imgSrc} alt={displayName || cam.entity_id} />
    {/if}
    {#if showName && displayName}
      <div class="overlay name">{displayName}</div>
    {/if}
    {#if liveError}
      <div class="overlay error">{liveError}</div>
    {/if}
    {#if showState}
      <div class="overlay state" data-state={cam.state}>{cam.state}</div>
    {/if}
  {/if}
</div>

<style>
  .camera {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    border-radius: var(--cosmos-widget-radius, 0.75rem);
    background: #000;
  }
  .camera.has-aspect {
    height: auto;
    max-height: 100%;
    margin: auto;
  }
  .feed {
    width: 100%;
    height: 100%;
    display: block;
  }
  .feed.fallback {
    position: absolute;
    inset: 0;
  }
  .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.9rem;
    background: rgba(255, 255, 255, 0.04);
  }
  .dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: rgba(255, 120, 120, 0.7);
  }
  .overlay {
    position: absolute;
    padding: 0.25rem 0.55rem;
    border-radius: 0.4rem;
    background: rgba(0, 0, 0, 0.55);
    color: #f5f5f5;
    font-size: 0.8rem;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  .overlay.name {
    top: 0.5rem;
    left: 0.5rem;
  }
  .overlay.state {
    top: 0.5rem;
    right: 0.5rem;
    text-transform: capitalize;
    letter-spacing: 0.02em;
  }
  .overlay.error {
    left: 0.5rem;
    bottom: 0.5rem;
    max-width: calc(100% - 1rem);
    background: rgba(120, 24, 28, 0.74);
  }
  .overlay.state[data-state='recording'],
  .overlay.state[data-state='streaming'] {
    background: rgba(220, 60, 60, 0.7);
  }
</style>
