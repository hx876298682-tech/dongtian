import * as Dialog from '@radix-ui/react-dialog';
import type { ReactElement, ReactNode } from 'react';

export interface GameDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly eyebrow: string;
  readonly title: string;
  readonly children: ReactNode;
  readonly primaryLabel?: string;
  readonly onPrimary?: () => void;
  readonly primaryDisabled?: boolean;
}

export function GameDialog({ open, onOpenChange, eyebrow, title, children, primaryLabel, onPrimary, primaryDisabled = false }: GameDialogProps): ReactElement {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="game-dialog__overlay" />
        <Dialog.Content className="game-dialog__content" aria-describedby={undefined}>
          <header className="game-dialog__header">
            <div><p>{eyebrow}</p><Dialog.Title>{title}</Dialog.Title></div>
            <Dialog.Close className="game-dialog__close" aria-label="关闭">×</Dialog.Close>
          </header>
          <div className="game-dialog__body">{children}</div>
          <footer className="game-dialog__actions">
            <Dialog.Close className="ghost-button">返回</Dialog.Close>
            {primaryLabel && onPrimary ? <button className="primary-button" type="button" onClick={onPrimary} disabled={primaryDisabled}>{primaryLabel}</button> : null}
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
