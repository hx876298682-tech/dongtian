const ACTIVE_DUNGEON_RUN_KEY = 'dongtian.activeDungeonRunId';

function hasStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function readActiveDungeonRunId(): string | null {
  if (!hasStorage()) {
    return null;
  }

  try {
    const value = window.localStorage.getItem(ACTIVE_DUNGEON_RUN_KEY);
    return value !== null && value.trim().length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function writeActiveDungeonRunId(runId: string): void {
  if (!hasStorage()) {
    return;
  }

  try {
    window.localStorage.setItem(ACTIVE_DUNGEON_RUN_KEY, runId);
  } catch {
    // Ignore storage failures; the run_id is still preserved in the URL.
  }
}

export function clearActiveDungeonRunId(): void {
  if (!hasStorage()) {
    return;
  }

  try {
    window.localStorage.removeItem(ACTIVE_DUNGEON_RUN_KEY);
  } catch {
    // Ignore storage failures.
  }
}
