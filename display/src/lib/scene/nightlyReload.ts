// Long-running displays (Chromium kiosk, weeks at a time) accumulate hard-to-
// trace memory pressure — looped <video> decode pipelines, animation layer
// growth, leaked frame buffers from minor browser bugs. The defensive
// digital-signage convention is a cheap nightly reload at a quiet hour.
//
// Schedules one timeout for the next occurrence of `hour:00` local time and
// re-arms after each tick. setTimeout (not setInterval) so a sleep/wake
// doesn't fire accumulated catch-up reloads.

const RELOAD_HOUR = 4; // 04:00 local

export function scheduleNightlyReload(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function nextDelayMs(): number {
    const now = new Date();
    const target = new Date(now);
    target.setHours(RELOAD_HOUR, 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime() - now.getTime();
  }

  function arm() {
    timer = setTimeout(() => {
      // If a transition is mid-flight, defer ten minutes — never reload while
      // the user is watching a scene change. TransitionStage tags the active
      // layers with `data-phase="out"` / `"in"` only while transitioning.
      if (document.querySelector('[data-phase="out"], [data-phase="in"]')) {
        timer = setTimeout(() => location.reload(), 10 * 60 * 1000);
        return;
      }
      location.reload();
    }, nextDelayMs());
  }

  arm();
  return () => { if (timer) clearTimeout(timer); };
}
