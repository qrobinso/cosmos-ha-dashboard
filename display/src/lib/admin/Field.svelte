<script lang="ts">
  export let label: string;
  export let hint: string = '';
</script>

<label class="field">
  <span class="label">{label}</span>
  <slot />
  {#if hint}<span class="hint">{hint}</span>{/if}
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-bottom: 1rem;
  }
  .label {
    font-size: 0.85rem;
    font-weight: 500;
    color: #ddd;
  }
  .hint {
    font-size: 0.75rem;
    color: #888;
  }
</style>
