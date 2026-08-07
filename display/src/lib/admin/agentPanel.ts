import { writable } from 'svelte/store';

/**
 * Whether the agent slide-over is open.
 *
 * A store rather than layout-local state because the panel is opened from two
 * places — the topbar's utility icon and the Overview hero's call to action —
 * and those live in different components. Without this the hero would have to
 * navigate to the full-page route instead, giving the same action two
 * different behaviours depending on which control you pressed.
 */
export const agentOpen = writable(false);
