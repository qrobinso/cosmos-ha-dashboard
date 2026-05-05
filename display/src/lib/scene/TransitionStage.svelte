<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { SceneState } from '$lib/types';
  import type { TransitionDescriptor, StageState } from '$lib/transitions/types';
  import { TransitionController } from '$lib/transitions/controller';
  import SceneCanvas from './SceneCanvas.svelte';

  export let scene: SceneState | null = null;
  export let transition: TransitionDescriptor | null = null;

  const controller = new TransitionController();
  let stageState: StageState = controller.current();
  let unsubscribe = controller.subscribe((s) => (stageState = s));

  let lastSceneRef: typeof scene = null;
  $: if (scene && scene !== lastSceneRef) {
    const sceneChanged = lastSceneRef === null || lastSceneRef.id !== scene.id;
    controller.receive(scene, sceneChanged ? transition : null);
    lastSceneRef = scene;
  }

  onDestroy(() => unsubscribe());

  function styleFor(role: 'outgoing' | 'incoming'): string {
    if (!stageState.transition) return '';
    const phase = role === 'outgoing' ? stageState.transition.out : stageState.transition.in;
    const prefix = role === 'outgoing' ? 'out' : 'in';
    return [
      `--cosmos-${prefix}-keyframes: ${phase.keyframes};`,
      `--cosmos-${prefix}-duration: ${phase.duration_ms}ms;`,
      `--cosmos-${prefix}-easing: ${phase.easing};`,
    ].join(' ');
  }

  $: outgoing = stageState.outgoingScene;
  $: incoming = stageState.incomingScene;
  $: transitioning = stageState.phase === 'transitioning';
</script>

<!--
  Both layers mount simultaneously while transitioning; CSS animations on each
  run in parallel. The outgoing layer keeps `data-phase="out"` for its entire
  lifetime so `animation-fill-mode: forwards` keeps the final keyframe state
  applied right up until unmount — preventing the snap-back-to-default flash.
-->
{#if outgoing && transitioning}
  <div class="cosmos-stage-layer outgoing" data-phase="out" style={styleFor('outgoing')}>
    <SceneCanvas scene={outgoing} />
  </div>
{/if}
{#if incoming}
  <div
    class="cosmos-stage-layer incoming"
    data-phase={transitioning ? 'in' : null}
    style={transitioning ? styleFor('incoming') : ''}
  >
    <SceneCanvas scene={incoming} />
  </div>
{/if}

<style>
  /* The outgoing layer sits above the incoming during a transition so its
     fade-out reads correctly. (z-index inside `.cosmos-stage-layer`'s own
     position:fixed context — harmless when only one layer is mounted.) */
  .cosmos-stage-layer.outgoing { z-index: 2; }
  .cosmos-stage-layer.incoming { z-index: 1; }
</style>
