// A native/external activity owns playback until Android returns its result.
// Keeping this outside React also blocks late preference reads and retry timers.
let delegated = false;
const listeners = new Set<() => void>();

export function isPlaybackDelegated(): boolean { return delegated; }

export function setPlaybackDelegated(value: boolean): void {
  delegated = value;
  if (value) listeners.forEach(listener => listener());
}

export function onPlaybackDelegated(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
