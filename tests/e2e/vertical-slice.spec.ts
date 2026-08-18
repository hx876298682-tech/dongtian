import { expect, test, type Page } from '@playwright/test';

import { assertLedgerBalanced, seedVerticalSliceFixture, shiftSettlementClock } from './e2e-fixture.js';

type ApiResponse<T> = {
  readonly status: number;
  readonly json: T;
};

type AuthSessionResponse = {
  readonly data: {
    readonly authenticated: true;
    readonly account_id: string;
    readonly character_id: string;
    readonly account_type: string;
    readonly account_status: string;
    readonly csrf_token: string;
    readonly session_expires_at: string;
  };
};

type Envelope<T> = {
  readonly data: T;
  readonly meta: {
    readonly request_id: string;
    readonly server_time: string;
  };
};

async function apiJson<T>(
  page: Page,
  path: string,
  init: {
    readonly body?: string;
    readonly headers?: Record<string, string>;
    readonly method: string;
  },
): Promise<ApiResponse<T>> {
  return page.evaluate(async ({ path: requestPath, init: requestInit }) => {
    const response = await fetch(requestPath, {
      ...requestInit,
      credentials: 'include',
      headers: requestInit.headers,
    });
    return {
      status: response.status,
      json: await response.json(),
    } as const;
  }, {
    path,
    init,
  }) as Promise<ApiResponse<T>>;
}

async function getSession(page: Page) {
  await expect
    .poll(
      async () => {
        const response = await apiJson<{ readonly data: { readonly authenticated?: boolean } }>(
          page,
          '/api/v1/auth/session',
          { method: 'GET' },
        );
        return response.status === 200 && response.json.data.authenticated === true;
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  const response = await apiJson<AuthSessionResponse>(page, '/api/v1/auth/session', { method: 'GET' });
  expect(response.status).toBe(200);
  expect(response.json.data.authenticated).toBe(true);
  return response.json.data;
}

async function writeApi<T>(
  page: Page,
  path: string,
  session: AuthSessionResponse['data'],
  init: {
    readonly body: string;
    readonly idempotencyKey?: string;
    readonly method: 'POST' | 'PUT';
  },
): Promise<ApiResponse<Envelope<T>>> {
  return apiJson<Envelope<T>>(page, path, {
    body: init.body,
    headers: {
      'content-type': 'application/json',
      'idempotency-key': init.idempotencyKey ?? 'e2e-fixed-idempotency-key',
      'x-csrf-token': session.csrf_token,
    },
    method: init.method,
  });
}

async function createQueuePlan(page: Page, characterId: string, session: AuthSessionResponse['data']) {
  const queueResponse = await apiJson<Envelope<{
    readonly queue_version: number;
  }>>(page, `/api/v1/characters/${characterId}/queue`, { method: 'GET' });
  expect(queueResponse.status).toBe(200);

  const plan = {
    expected_queue_version: queueResponse.json.data.queue_version,
    entries: [
      {
        client_entry_id: 'e2e-herb-1',
        action_id: 'action.t1.herb_baicao_valley',
        mode: 'COUNT',
        target_value: 2,
        on_blocked: 'FALLBACK',
      },
      {
        client_entry_id: 'e2e-alchemy-1',
        action_id: 'action.t1.qi_gathering_powder',
        mode: 'COUNT',
        target_value: 1,
        on_blocked: 'FALLBACK',
      },
    ],
    fallback: {
      action_id: 'action.cultivation.qi',
      mode: 'INFINITE',
    },
  } as const;

  return {
    plan,
    queueResponse,
    save: async (idempotencyKey: string) => writeApi(page, `/api/v1/characters/${characterId}/queue`, session, {
      body: JSON.stringify(plan),
      idempotencyKey,
      method: 'PUT',
    }),
  };
}

test.describe.configure({ mode: 'serial' });

test('DT-M3-006 vertical slice end-to-end', async ({ page }) => {
  await page.goto('/');
  const session = await getSession(page);
  const fixture = await seedVerticalSliceFixture(session.character_id);

  await page.reload();

  await page.goto('/craft');
  const craftMain = page.getByLabel('百艺 主内容');
  await expect(craftMain.getByText('采药', { exact: true }).first()).toBeVisible();
  await expect(craftMain.getByText('炼制聚气散', { exact: true })).toBeVisible();

  const queuePlan = await createQueuePlan(page, session.character_id, session);
  const firstSaveKey = '11111111-1111-4111-8111-111111111111';
  const firstSave = await queuePlan.save(firstSaveKey);
  expect(firstSave.status).toBe(200);
  const repeatSave = await queuePlan.save(firstSaveKey);
  expect(repeatSave.status).toBe(200);
  expect(repeatSave.json.data.queue.queue_version).toBe(firstSave.json.data.queue.queue_version);

  await page.goto('/dashboard/queue');
  await expect(page.getByRole('progressbar', { name: /全局进度/ })).toBeVisible();
  await expect(page.getByText('百草谷采药').last()).toBeVisible();
  await expect(page.getByRole('button', { name: '查看当前任务' })).toBeVisible();

  await shiftSettlementClock(session.character_id, 1.5);
  await page.reload();
  await expect(page.getByText('离线收获')).toBeVisible();
  await expect(page.getByText('修为与物品')).toBeVisible();

  await page.goto(`/character?preset_id=${encodeURIComponent(fixture.mainPresetId)}&compare_preset_id=${encodeURIComponent(fixture.comparePresetId)}`);
  await expect(page.getByText('青蛇洞主力预设')).toBeVisible();
  await expect(page.getByText('有差异')).toBeVisible();

  const equipmentDraftName = '夜行准备';
  const currentPresetResponse = await apiJson<Envelope<{
    readonly state_version: number;
  }>>(page, `/api/v1/characters/${session.character_id}/loadouts/${fixture.mainPresetId}`, { method: 'GET' });
  expect(currentPresetResponse.status).toBe(200);
  expect(currentPresetResponse.json.data.state_version).toBeGreaterThanOrEqual(0);

  await page.getByRole('textbox', { name: '名称' }).fill(equipmentDraftName);
  await page.getByRole('button', { name: '保存预设' }).click();
  await expect(page.getByText('预设已保存')).toBeVisible();
  await page.getByRole('button', { name: '启用预设' }).click();
  await expect(page.getByText('预设已启用')).toBeVisible();

  await page.goto('/expedition');
  await expect(page.getByText('选择怪物，开始挂机')).toBeVisible();
  await expect(page.getByText('点击怪物开始战斗')).toBeVisible();
  await page.getByRole('button', { name: /青蛇，点击开始战斗挂机/ }).click();
  await expect(page.getByRole('status', { name: '操作反馈' })).toContainText('已开始挂机：青蛇战斗');
  const combatQueue = await apiJson<Envelope<{
    readonly current: { readonly action_id: string } | null;
  }>>(page, `/api/v1/characters/${session.character_id}/queue`, { method: 'GET' });
  expect(combatQueue.status).toBe(200);
  expect(combatQueue.json.data.current?.action_id).toBe('action.t1.combat_qingshe');

  const inventoryResponse = await apiJson<Envelope<{
    readonly items: ReadonlyArray<{ readonly asset_id: string; readonly quantity: number }>;
  }>>(page, `/api/v1/characters/${session.character_id}/inventory?category=ITEM`, { method: 'GET' });
  expect(inventoryResponse.status).toBe(200);
  expect(Array.isArray(inventoryResponse.json.data.items)).toBe(true);

  await page.goto('/dashboard/queue');
  const refreshedQueue = await apiJson<Envelope<{ readonly queue_version: number }>>(page, `/api/v1/characters/${session.character_id}/queue`, { method: 'GET' });
  expect(refreshedQueue.status).toBe(200);
  const secondPlan = {
    expected_queue_version: refreshedQueue.json.data.queue_version,
    entries: [
      {
        client_entry_id: 'e2e-herb-2',
        action_id: 'action.t1.herb_baicao_valley',
        mode: 'COUNT',
        target_value: 3,
        on_blocked: 'FALLBACK',
      },
      {
        client_entry_id: 'e2e-alchemy-2',
        action_id: 'action.t1.qi_gathering_powder',
        mode: 'COUNT',
        target_value: 1,
        on_blocked: 'FALLBACK',
      },
    ],
    fallback: {
      action_id: 'action.cultivation.qi',
      mode: 'INFINITE',
    },
  } as const;
  const secondQueueSave = await writeApi(page, `/api/v1/characters/${session.character_id}/queue`, session, {
    body: JSON.stringify(secondPlan),
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
    method: 'PUT',
  });
  expect(secondQueueSave.status).toBe(200);
  await expect(page.getByRole('button', { name: '查看当前任务' })).toBeVisible();

  await assertLedgerBalanced();
});

test('DT-M3-006 preserves stale drafts on 409 conflicts', async ({ page }) => {
  await page.goto('/');
  const session = await getSession(page);
  const fixture = await seedVerticalSliceFixture(session.character_id);

  await page.goto(`/character?preset_id=${encodeURIComponent(fixture.mainPresetId)}&compare_preset_id=${encodeURIComponent(fixture.comparePresetId)}`);
  await expect(page.getByText('青蛇洞主力预设')).toBeVisible();

  await page.getByRole('textbox', { name: '名称' }).fill('冲突草稿');

  const stalePreset = await apiJson<Envelope<{ readonly state_version: number }>>(page, `/api/v1/characters/${session.character_id}/loadouts/${fixture.mainPresetId}`, { method: 'GET' });
  expect(stalePreset.status).toBe(200);

  const externalSave = await writeApi(page, `/api/v1/characters/${session.character_id}/loadouts/${fixture.mainPresetId}`, session, {
    body: JSON.stringify({
      expected_state_version: stalePreset.json.data.state_version,
      name: '外部改动',
      weapon_instance_id: fixture.weaponInstanceId,
      armor_instance_id: fixture.armorInstanceId,
      accessory_instance_id: fixture.accessoryInstanceId,
      combat_consumables: [],
      strategy_id: 'strategy.safe',
    }),
    idempotencyKey: '33333333-3333-4333-8333-333333333333',
    method: 'PUT',
  });
  expect(externalSave.status).toBe(200);

  await page.getByRole('button', { name: '保存预设' }).click();
  await expect(page.locator('.game-feedback')).toContainText('当前状态已变化，请刷新后重试。');
  await expect(page.getByRole('textbox', { name: '名称' })).toHaveValue('冲突草稿');
  await assertLedgerBalanced();
});
