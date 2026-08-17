export type GameFeedbackTone = 'success' | 'info' | 'warning';

export interface GameFeedbackDetail {
  readonly message: string;
  readonly tone?: GameFeedbackTone;
}

const EVENT_NAME = 'dongtian:game-feedback';

export function emitGameFeedback(message: string, tone: GameFeedbackTone = 'info'): void {
  window.dispatchEvent(new CustomEvent<GameFeedbackDetail>(EVENT_NAME, { detail: { message, tone } }));
}

export function subscribeGameFeedback(listener: (detail: GameFeedbackDetail) => void): () => void {
  const handler = (event: Event): void => {
    const detail = (event as CustomEvent<GameFeedbackDetail>).detail;
    if (detail?.message) listener(detail);
  };
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
