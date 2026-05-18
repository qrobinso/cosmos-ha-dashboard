<script lang="ts">
  import type { WidgetState } from '$lib/types';
  import CalendarAgenda from './calendar/CalendarAgenda.svelte';
  import CalendarMonth from './calendar/CalendarMonth.svelte';
  import CalendarWeek from './calendar/CalendarWeek.svelte';
  import CalendarDay from './calendar/CalendarDay.svelte';
  import CalendarLanes from './calendar/CalendarLanes.svelte';

  export let widget: WidgetState;
  $: view = (widget.config as Record<string, unknown>)?.view ?? 'agenda';
</script>

{#if view === 'month'}
  <CalendarMonth {widget} />
{:else if view === 'week'}
  <CalendarWeek {widget} />
{:else if view === 'day'}
  <CalendarDay {widget} />
{:else if view === 'lanes'}
  <CalendarLanes {widget} />
{:else}
  <CalendarAgenda {widget} />
{/if}
