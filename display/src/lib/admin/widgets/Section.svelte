<script lang="ts">
  // A labeled config section: an eyebrow header above a stack of fields.
  // Used by every per-kind config component to group fields into
  // Source / Content / Style. Sections after the first (within the same
  // container) get a hairline divider above them.
  export let label: string;
</script>

<section class="w-section">
  <span class="eyebrow">{label}</span>
  <div class="w-section-body">
    <slot />
  </div>
</section>

<style>
  .w-section {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    margin-top: 1.25rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--c-line);
  }
  /* The first section in a container needs no divider — its container
     already provides the visual break. */
  .w-section:first-child {
    margin-top: 0;
    padding-top: 0;
    border-top: none;
  }
  .w-section-body {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
  }
</style>
