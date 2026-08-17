import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CaveEmpty, CaveError, CaveLocked, CaveLoading, CaveMaintenance } from './cave-page.js';

describe('cave page states', () => {
  it('renders loading and failure surfaces without browser APIs', () => {
    const loadingMarkup = renderToStaticMarkup(<CaveLoading />);
    const errorMarkup = renderToStaticMarkup(<CaveError error="boom" onRetry={() => undefined} />);
    const maintenanceMarkup = renderToStaticMarkup(<CaveMaintenance reason="maint" onRetry={() => undefined} />);
    const lockedMarkup = renderToStaticMarkup(<CaveLocked reason="locked" onRetry={() => undefined} />);
    const emptyMarkup = renderToStaticMarkup(<CaveEmpty reason="empty" onRetry={() => undefined} />);

    expect(loadingMarkup).toContain('正在读取洞府权威快照');
    expect(errorMarkup).toContain('洞府页读取失败');
    expect(maintenanceMarkup).toContain('洞府服务维护中');
    expect(lockedMarkup).toContain('洞府功能受限');
    expect(emptyMarkup).toContain('洞府暂无设施');
  });
});
