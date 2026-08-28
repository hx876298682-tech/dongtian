/** 壳层上下文：页面栈 / 底部面板 / toast / 共享行动流。AppRoot 提供实现。 */
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import type { useActionFlow } from '../flows/useActionFlow';

/** 二级页 id（全屏推入）。 */
export type PageId =
  | 'training'
  | 'alchemy'
  | 'forge'
  | 'farm'
  | 'pavilion'
  | 'treasure_pavilion'
  | 'codex'
  | 'leaderboard'
  | 'journal'
  | 'breakthrough'
  | 'settings';

export type TabId = 'cave' | 'journey' | 'bag' | 'path';

export type ShellApi = {
  openPage(id: PageId): void;
  closePage(): void;
  /** 底部确认面板（同一时刻最多一个） */
  openSheet(node: ReactNode): void;
  closeSheet(): void;
  showToast(text: string, tone?: 'ok' | 'warn'): void;
};

export const ShellContext = createContext<ShellApi | null>(null);

export function useShell(): ShellApi {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell 必须在 AppRoot 内使用');
  return ctx;
}

/** 全应用唯一的行动流实例（行动条与各页面共用 settling/busy 状态）。 */
export type FlowApi = ReturnType<typeof useActionFlow>;
export const FlowContext = createContext<FlowApi | null>(null);

export function useFlow(): FlowApi {
  const ctx = useContext(FlowContext);
  if (!ctx) throw new Error('useFlow 必须在 AppRoot 内使用');
  return ctx;
}
