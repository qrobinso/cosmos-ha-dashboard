<script lang="ts">
  import { onDestroy } from 'svelte';
  import type { SceneState } from '$lib/types';
  import type { TransitionDescriptor, StageState } from '$lib/transitions/types';
  import { TransitionController } from '$lib/transitions/controller';
  import SceneCanvas from './SceneCanvas.svelte';

  export let scene: SceneState | null = null;
  export let transition: TransitionDescriptor | null = null;
  export let displayName: string | null = null;

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

  $: transitioning = stageState.phase === 'transitioning';

  /**
   * Compose both layers as a single keyed each. Keying by `scene.id` lets
   * Svelte preserve the SceneCanvas component (and the running gradient
   * animation inside it) when the previously-incoming scene becomes the
   * outgoing one. Without this, Svelte would tear the SceneCanvas out of
   * the `{#if incoming}` block and remount a new one in the `{#if outgoing}`
   * block — restarting the ambient gradient drift from frame 0 and creating
   * the visible "snap" mid-transition.
   *
   * Order: outgoing first (visually under) then incoming. CSS z-index on the
   * role classes pulls outgoing to the front during the fade.
   */
  type Layer = { scene: SceneState; role: 'outgoing' | 'incoming' };
  $: layers = ((): Layer[] => {
    const out: Layer[] = [];
    if (stageState.outgoingScene && transitioning) {
      out.push({ scene: stageState.outgoingScene, role: 'outgoing' });
    }
    if (stageState.incomingScene) {
      out.push({ scene: stageState.incomingScene, role: 'incoming' });
    }
    return out;
  })();
</script>

{#each layers as layer (layer.scene.id)}
  <div
    class="cosmos-stage-layer"
    class:outgoing={layer.role === 'outgoing'}
    class:incoming={layer.role === 'incoming'}
    data-phase={transitioning ? (layer.role === 'outgoing' ? 'out' : 'in') : null}
    style={transitioning ? styleFor(layer.role) : ''}
  >
    <SceneCanvas scene={layer.scene} {displayName} />
  </div>
{/each}

<style>
  .cosmos-stage-layer.outgoing { z-index: 2; }
  .cosmos-stage-layer.incoming { z-index: 1; }
</style>
