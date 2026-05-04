<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import type { SceneState } from '$lib/types';
  import type { TransitionDescriptor, StageState } from '$lib/transitions/types';
  import { TransitionController } from '$lib/transitions/controller';
  import SceneCanvas from './SceneCanvas.svelte';

  export let scene: SceneState | null = null;
  export let transition: TransitionDescriptor | null = null;

  const controller = new TransitionController();
  let stageState: StageState = controller.current();
  let unsubscribe = controller.subscribe((s) => (stageState = s));

  let lastReceivedSceneId: string | null = null;
  $: if (scene && scene.id !== lastReceivedSceneId) {
    controller.receive(scene, transition);
    lastReceivedSceneId = scene.id;
  }

  onDestroy(() => unsubscribe());

  function styleFor(role: 'outgoing' | 'incoming'): string {
    if (!stageState.transition) return '';
    const phase = role === 'outgoing' ? stageState.transition.out : stageState.transition.in;
    return [
      `--cosmos-${role === 'outgoing' ? 'out' : 'in'}-keyframes: ${phase.keyframes};`,
      `--cosmos-${role === 'outgoing' ? 'out' : 'in'}-duration: ${phase.duration_ms}ms;`,
      `--cosmos-${role === 'outgoing' ? 'out' : 'in'}-easing: ${phase.easing};`,
    ].join(' ');
  }

  $: outgoing = stageState.outgoingScene;
  $: incoming = stageState.incomingScene;
  $: outPhase = stageState.phase === 'out' ? 'out' : null;
  $: inPhase = stageState.phase === 'in' ? 'in' : null;
</script>

{#if outgoing && stageState.phase !== 'idle'}
  <div class="cosmos-stage-layer" data-phase={outPhase} style={styleFor('outgoing')}>
    <SceneCanvas scene={outgoing} />
  </div>
{/if}
{#if incoming}
  <div
    class="cosmos-stage-layer"
    data-phase={stageState.phase === 'idle' ? null : inPhase}
    style={stageState.phase === 'idle' ? '' : styleFor('incoming')}
  >
    <SceneCanvas scene={incoming} />
  </div>
{/if}
