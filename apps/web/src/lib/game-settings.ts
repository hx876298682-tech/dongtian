const STORAGE_KEY = 'dongtian.game-settings.v1';

export function shouldConfirmImportantActions(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    const parsed = JSON.parse(raw) as { confirmImportantActions?: unknown };
    return parsed.confirmImportantActions !== false;
  } catch {
    return true;
  }
}
