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

    expect(loadingMarkup).toContain('正在查看洞天设施');
    expect(errorMarkup).toContain('洞天设施暂时无法打开');
    expect(maintenanceMarkup).toContain('洞府服务维护中');
    expect(lockedMarkup).toContain('洞府功能受限');
    expect(emptyMarkup).toContain('洞府暂未发现设施');
    expect(emptyMarkup).not.toContain('服务端');
    expect(emptyMarkup).not.toContain('error');
  });
});
