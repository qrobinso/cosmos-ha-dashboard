const KEY = 'cosmos:displayName';

export function getDisplayName(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(KEY);
}

export function setDisplayName(name: string): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(KEY, name);
}

export function clearDisplayName(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(KEY);
}
