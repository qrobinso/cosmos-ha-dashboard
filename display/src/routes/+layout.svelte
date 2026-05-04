<script lang="ts">
  import '$lib/fonts.css';
  import '$lib/transitions/keyframes.css';
</script>

<slot />

<style>
  /* Per-display orientation. When set to "portrait", we rotate the entire body
     so a tablet that's physically mounted vertically (in its native landscape
     OS orientation) renders content as portrait. The wrapper swaps width/height
     and centers the rotated content over the viewport. */
  :global(html),
  :global(body) {
    margin: 0;
    height: 100%;
    overflow: hidden;
  }
  :global(body[data-orientation='portrait']) {
    position: fixed;
    top: 50%;
    left: 50%;
    width: 100vh;
    height: 100vw;
    transform: translate(-50%, -50%) rotate(90deg);
    transform-origin: center center;
  }
</style>
