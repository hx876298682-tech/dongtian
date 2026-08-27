/** 底部确认面板与切换警告 */
import { X } from 'lucide-react';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import type { ActionView } from '../store/actionView';

export function ConfirmSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  // 打开后短暂忽略遮罩点击：避免“点开面板的同一次点击”立即触发关闭（灵田等地块按钮场景）
  const mountedAtRef = useRef<number | null>(null);
  if (mountedAtRef.current === null) {
    mountedAtRef.current = Date.now(); // 仅首次渲染赋值
  }
  const requestClose = (): void => {
    if (Date.now() - (mountedAtRef.current ?? 0) < 350) return;
    onClose();
  };

  return (
    <>
      <div className="overlay dim" onClick={requestClose} />
      <div className="overlay" style={{ pointerEvents: 'none' }}>
        <div className="sheet" style={{ pointerEvents: 'auto' }} role="dialog" aria-label={title}>
          <i className="sheet-grab" />
          <div className="sheet-head">
            <h3>{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={15} /></button>
          </div>
          <div className="sheet-scroll">{children}</div>
        </div>
      </div>
    </>
  );
}

/** 固定组件：所有会更换主行动的操作复用（对齐设计稿 5.2）。
    仅当存在当前行动时出现。 */
export function SwitchWarnBlock({ view, newLabel }: { view: ActionView | null; newLabel: string }) {
  if (!view) {
    return (
      <p className="switch-warn" style={{ background: 'var(--jade-bg)', color: 'var(--jade)', boxShadow: 'inset 0 0 0 1px rgba(35,99,79,.3)' }}>
        神识空闲，将直接开启「{newLabel}」；产出完成即自动入库。
      </p>
    );
  }
  return (
    <span className="switch-warn">
      ⚠ 将结束当前行动「{view.verb} · {view.targetName}」，其已完成场次与产出由服务端结算入库，随后转入「{newLabel}」。
    </span>
  );
}
