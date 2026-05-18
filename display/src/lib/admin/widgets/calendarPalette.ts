// Shared color palette for calendar widget sources. Imported by both
// `widgetKinds.ts` (initial source color in defaultConfig) and
// `CalendarConfig.svelte` (color assignment when adding sources or
// falling back for sources without an explicit color). Keep these in
// sync by referencing this single constant — never inline the array.

export const CALENDAR_SOURCE_PALETTE = [
  '#ff8855',
  '#0099ff',
  '#7ec46b',
  '#d96bf0',
  '#ffd166',
  '#5fb8ff',
  '#ff6b9a',
  '#ffae5b',
] as const;
