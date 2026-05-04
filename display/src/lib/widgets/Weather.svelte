<script lang="ts">
  import type { WidgetState, WeatherData } from '$lib/types';
  export let widget: WidgetState;
  $: data = widget.data as WeatherData | null;
</script>

{#if data}
  <div class="weather">
    <div class="current">
      <div class="temp">{data.current.temp}°{data.current.unit}</div>
      <div class="condition">{data.current.condition}</div>
    </div>
    <div class="forecast">
      {#each data.forecast as day (day.day)}
        <div class="day">
          <div class="day-name">{day.day}</div>
          <div class="day-temps">
            <span class="hi">{day.high}°</span>
            <span class="lo">{day.low}°</span>
          </div>
        </div>
      {/each}
    </div>
  </div>
{:else}
  <div style="opacity:0.5">No weather</div>
{/if}

<style>
  .weather {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    width: 100%;
    height: 100%;
    padding: 1rem;
    box-sizing: border-box;
  }
  .current {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .temp {
    font-size: clamp(2rem, 6vw, 4rem);
    font-weight: 200;
    line-height: 1;
  }
  .condition {
    opacity: 0.75;
    font-size: 0.95rem;
  }
  .forecast {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 0.5rem;
    margin-top: auto;
  }
  .day {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.8rem;
  }
  .day-name {
    opacity: 0.7;
  }
  .day-temps .lo {
    opacity: 0.6;
    margin-left: 0.25rem;
  }
</style>
