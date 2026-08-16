import { useId, type ReactElement, type ReactNode } from 'react';

export type StatusScreenKind = 'normal' | 'empty' | 'loading' | 'local-error' | 'locked' | 'maintenance';

export interface StatusScreenAction {
  readonly label: string;
  readonly onClick: () => void;
}

export interface StatusScreenProps {
  readonly kind: StatusScreenKind;
  readonly title: string;
  readonly description: ReactNode;
  readonly eyebrow?: string;
  readonly actions?: readonly StatusScreenAction[];
  readonly footnote?: ReactNode;
  readonly highlight?: ReactNode;
}

const KIND_LABELS: Record<StatusScreenKind, string> = {
  normal: '正常',
  empty: '空',
  loading: '加载中',
  'local-error': '局部错误',
  locked: '锁定',
  maintenance: '维护',
};

export function StatusScreen({
  actions,
  description,
  eyebrow,
  footnote,
  highlight,
  kind,
  title,
}: StatusScreenProps): ReactElement {
  const titleId = useId();
  const descriptionId = useId();
  const footnoteId = useId();
  const isAlert = kind === 'local-error';

  return (
    <section
      className={`status-screen status-screen--${kind}`}
      aria-labelledby={titleId}
      aria-describedby={footnote ? `${descriptionId} ${footnoteId}` : descriptionId}
      aria-busy={kind === 'loading'}
      aria-live={kind === 'loading' ? 'polite' : isAlert ? 'assertive' : 'polite'}
      role={isAlert ? 'alert' : 'status'}
    >
      <div className="status-screen__badge-row">
        <span className="status-screen__badge">{eyebrow ?? KIND_LABELS[kind]}</span>
        {highlight ? <span className="status-screen__highlight">{highlight}</span> : null}
      </div>
      <h2 className="status-screen__title" id={titleId}>
        {title}
      </h2>
      <div className="status-screen__description" id={descriptionId}>
        {description}
      </div>
      {actions && actions.length > 0 ? (
        <div className="status-screen__actions">
          {actions.map((action) => (
            <button key={action.label} className="status-screen__action" type="button" onClick={action.onClick}>
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
      {footnote ? (
        <div className="status-screen__footnote" id={footnoteId}>
          {footnote}
        </div>
      ) : null}
    </section>
  );
}

export function NormalStateScreen(props: Omit<StatusScreenProps, 'kind'>): ReactElement {
  return <StatusScreen {...props} kind="normal" />;
}

export function EmptyStateScreen(props: Omit<StatusScreenProps, 'kind'>): ReactElement {
  return <StatusScreen {...props} kind="empty" />;
}

export function LoadingStateScreen(props: Omit<StatusScreenProps, 'kind'>): ReactElement {
  return <StatusScreen {...props} kind="loading" />;
}

export function LocalErrorStateScreen(props: Omit<StatusScreenProps, 'kind'>): ReactElement {
  return <StatusScreen {...props} kind="local-error" />;
}

export function LockedStateScreen(props: Omit<StatusScreenProps, 'kind'>): ReactElement {
  return <StatusScreen {...props} kind="locked" />;
}

export function MaintenanceStateScreen(props: Omit<StatusScreenProps, 'kind'>): ReactElement {
  return <StatusScreen {...props} kind="maintenance" />;
}
