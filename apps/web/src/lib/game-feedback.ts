export type GameFeedbackTone = 'success' | 'info' | 'warning';

export interface GameFeedbackDetail {
  readonly message: string;
  readonly tone?: GameFeedbackTone;
}

const EVENT_NAME = 'dongtian:game-feedback';

export function emitGameFeedback(message: string, tone: GameFeedbackTone = 'info'): void {
  window.dispatchEvent(new CustomEvent<GameFeedbackDetail>(EVENT_NAME, { detail: { message, tone } }));
  try {
    const stored = JSON.parse(window.localStorage.getItem('dongtian.game-settings.v1') ?? '{}') as { desktopNotifications?: boolean };
    if (stored.desktopNotifications === true && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('洞天修行', { body: message });
    }
  } catch {
    // Browser notifications are optional; in-game feedback still succeeds.
  }
}

export function subscribeGameFeedback(listener: (detail: GameFeedbackDetail) => void): () => void {
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<GameFeedbackDetail>).detail;
    if (detail?.message) listener(detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
