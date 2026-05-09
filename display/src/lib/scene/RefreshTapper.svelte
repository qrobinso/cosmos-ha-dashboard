<script lang="ts">
  const WINDOW_MS = 1500;
  const THRESHOLD = 4;
  let taps: number[] = [];

  function onTap() {
    const now = Date.now();
    taps.push(now);
    taps = taps.filter((t) => now - t <= WINDOW_MS);
    if (taps.length >= THRESHOLD) {
      taps = [];
      location.reload();
    }
  }
</script>

<svelte:window on:pointerdown={onTap} />
