import { randomUUID } from 'node:crypto';

import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import {
  assertLedgerBalanced,
  completeBreakthroughRequirement,
  driftCharacterConfigVersion,
  moveBreakthroughTrialBoundary,
  readBreakthroughDatabaseState,
  seedBreakthroughFixture,
} from './e2e-fixture.js';

type ApiResponse<T> = {
  readonly status: number;
  readonly json: T;
};

type Envelope<T> = {
  readonly data: T;
  readonly meta: { readonly request_id: string; readonly server_time: string };
};

type Session = {
  readonly authenticated: true;
  readonly character_id: string;
  readonly csrf_token: string;
};

type NextData = {
  readonly character: {
    readonly character_id: string;
    readonly state_version: number;
    readonly active_config_version: string;
  };
  readonly config_version: string;
  readonly breakthrough: {
    readonly all_satisfied: boolean;
    readonly success_rate: string;
    readonly requirements: ReadonlyArray<{
      readonly asset_id: string;
      readonly status: 'SATISFIED' | 'MISSING';
      readonly shortfall: string;
      readonly source_route_id: string;
    }>;
  };
};

type RunData = {
  readonly character: {
    readonly character_id: string;
    readonly state_version: number;
    readonly active_config_version?: string;
  };
  readonly run: {
    readonly breakthrough_run_id: string;
    readonly status: string;
    readonly run_version: number;
    readonly config_version: string;
    readonly selected_choice_id: string | null;
    readonly reservation_snapshot: ReadonlyArray<{
      readonly asset_id: string;
      readonly quantity: string;
    }>;
    readonly preview_snapshot: { readonly config_version: string; readonly all_satisfied: boolean };
    readonly result: {
      readonly unlocked_realm_id: string;
      readonly unlock_bundle_id: string;
      readonly queue_slots: number;
      readonly medicine_slots: number;
    } | null;
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
  return page.evaluate(
    async ({ path: requestPath, init: requestInit }) => {
      const response = await fetch(requestPath, {
        ...requestInit,
        credentials: 'include',
        headers: requestInit.headers,
      });
      return { status: response.status, json: await response.json() } as const;
    },
    { path, init },
  ) as Promise<ApiResponse<T>>;
}

async function getSession(page: Page): Promise<Session> {
  await expect
    .poll(
      async () => {
        const response = await apiJson<{ readonly data: { readonly authenticated?: boolean } }>(
          page,
          '/api/v1/auth/session',
          { method: 'GET' },
        );
        return response.json.data.authenticated === true;
      },
      { timeout: 30_000 },
    )
    .toBe(true);

  const response = await apiJson<{ readonly data: Session }>(page, '/api/v1/auth/session', {
    method: 'GET',
  });
  expect(response.status).toBe(200);
  return response.json.data;
}

async function openAnonymousAccount(
  browser: Browser,
): Promise<{ readonly context: BrowserContext; readonly page: Page; readonly session: Session }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/');
  const session = await getSession(page);
  return { context, page, session };
}

async function writeApi<T>(
  page: Page,
  path: string,
  session: Session,
  body: unknown,
  method: 'POST' | 'PUT',
  idempotencyKey = randomUUID(),
) {
  return apiJson<Envelope<T>>(page, path, {
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
      'x-csrf-token': session.csrf_token,
    },
    method,
  });
}

async function breakthroughNext(
  page: Page,
  characterId: string,
): Promise<ApiResponse<Envelope<NextData>>> {
  return apiJson<Envelope<NextData>>(page, `/api/v1/characters/${characterId}/breakthroughs/next`, {
    method: 'GET',
  });
}

async function breakthroughPreview(
  page: Page,
  characterId: string,
): Promise<ApiResponse<Envelope<NextData>>> {
  return apiJson<Envelope<NextData>>(
    page,
    `/api/v1/characters/${characterId}/breakthroughs/preview`,
    {
      body: '{}',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    },
  );
}

async function startTrial(
  page: Page,
  session: Session,
  stateVersion: number,
  configVersion: string,
) {
  return writeApi<RunData>(
    page,
    `/api/v1/characters/${session.character_id}/breakthroughs`,
    session,
    {
      expected_state_version: stateVersion,
      config_version: configVersion,
    },
    'POST',
  );
}

async function getInventory(page: Page, characterId: string) {
  return apiJson<
    Envelope<{
      readonly items: ReadonlyArray<{
        readonly asset_id: string;
        readonly reserved_quantity: number;
        readonly available_quantity: number;
      }>;
      readonly currencies: ReadonlyArray<{
        readonly asset_id: string;
        readonly reserved_quantity: string;
        readonly available_quantity: string;
      }>;
    }>
  >(page, `/api/v1/characters/${characterId}/inventory`, { method: 'GET' });
}

async function saveThreeSlotConditionalQueue(page: Page, session: Session) {
  const current = await apiJson<Envelope<{ readonly queue_version: number }>>(
    page,
    `/api/v1/characters/${session.character_id}/queue`,
    { method: 'GET' },
  );
  expect(current.status).toBe(200);
  const plan = {
    expected_queue_version: current.json.data.queue_version,
    entries: [
      {
        client_entry_id: 'e2e-breakthrough-gather',
        action_id: 'action.t1.herb_baicao_valley',
        mode: 'UNTIL_INVENTORY',
        target_value: 3,
        condition_item_id: 'item.t1.qingling_herb',
        condition_operator: '>=',
        on_blocked: 'FALLBACK',
      },
      {
        client_entry_id: 'e2e-breakthrough-alchemy',
        action_id: 'action.t1.qi_gathering_powder',
        mode: 'UNTIL_INVENTORY',
        target_value: 1,
        condition_item_id: 'item.t1.qi_gathering_powder',
        condition_operator: '>=',
        on_blocked: 'FALLBACK',
      },
      {
        client_entry_id: 'e2e-breakthrough-infinite',
        action_id: 'action.cultivation.qi',
        mode: 'INFINITE',
        on_blocked: 'FALLBACK',
      },
    ],
    fallback: { action_id: 'action.cultivation.qi', mode: 'INFINITE' },
  } as const;
  const saved = await writeApi<{
    readonly queue: {
      readonly queue_version: number;
      readonly entries: ReadonlyArray<{
        readonly mode: string;
        readonly condition_item_id: string | null;
        readonly condition_operator: string | null;
      }>;
    };
  }>(page, `/api/v1/characters/${session.character_id}/queue`, session, plan, 'PUT');
  expect(saved.status).toBe(200);
  expect(saved.json.data.queue.entries).toHaveLength(3);
  expect(
    saved.json.data.queue.entries.slice(0, 2).every((entry) => entry.mode === 'UNTIL_INVENTORY'),
  ).toBe(true);
  expect(saved.json.data.queue.entries[0]?.condition_operator).toBe('>=');
  expect(saved.json.data.queue.entries[1]?.condition_operator).toBe('>=');
  return saved;
}

test.describe.configure({ mode: 'serial' });

test('DT-M5-008 golden role graduates across disconnect and saves three conditional slots', async ({
  browser,
}) => {
  const account = await openAnonymousAccount(browser);
  const { context, page, session } = account;
  const fixture = await seedBreakthroughFixture(session.character_id);

  const missing = await breakthroughNext(page, session.character_id);
  expect(missing.status).toBe(200);
  expect(missing.json.data.breakthrough.all_satisfied).toBe(false);
  expect(missing.json.data.breakthrough.success_rate).toBe('0');
  expect(
    missing.json.data.breakthrough.requirements.find(
      (item) => item.asset_id === fixture.missingAssetId,
    ),
  ).toMatchObject({
    status: 'MISSING',
    shortfall: '1',
    source_route_id: 'route.t1.qingshe_cave.safe_exit',
  });

  const previewBefore = await breakthroughPreview(page, session.character_id);
  expect(previewBefore.status).toBe(200);
  expect(previewBefore.json.data.breakthrough.all_satisfied).toBe(false);

  const staleStart = await startTrial(
    page,
    session,
    previewBefore.json.data.character.state_version,
    '2026.08.15.1',
  );
  expect(staleStart.status).toBe(400);
  const inventoryBeforeStart = await getInventory(page, session.character_id);
  expect(
    inventoryBeforeStart.json.data.items.find((item) => item.asset_id === 'item.t2.lingsui')
      ?.reserved_quantity,
  ).toBe(0);

  await completeBreakthroughRequirement(
    session.character_id,
    fixture.missingAssetId ?? 'item.t2.lingsui',
  );
  const preview = await breakthroughPreview(page, session.character_id);
  expect(preview.status).toBe(200);
  expect(preview.json.data.breakthrough.all_satisfied).toBe(true);
  expect(preview.json.data.breakthrough.success_rate).toBe('1');

  const started = await startTrial(
    page,
    session,
    preview.json.data.character.state_version,
    preview.json.data.config_version,
  );
  expect(started.status).toBe(201);
  expect(started.json.data.run.status).toBe('TRIAL_ACTIVE');
  expect(started.json.data.run.reservation_snapshot).toEqual(
    expect.arrayContaining([
      { asset_id: 'item.t1.foundation_pill', quantity: '1' },
      { asset_id: 'item.t2.lingsui', quantity: '3' },
      { asset_id: 'item.t1.meridian_pill', quantity: '2' },
      { asset_id: 'currency.spirit_stone', quantity: '2500' },
    ]),
  );
  const runId = started.json.data.run.breakthrough_run_id;
  const runConfigVersion = started.json.data.run.config_version;
  const inventoryDuringTrial = await getInventory(page, session.character_id);
  expect(
    inventoryDuringTrial.json.data.items.find((item) => item.asset_id === 'item.t2.lingsui')
      ?.reserved_quantity,
  ).toBe(3);
  expect(
    inventoryDuringTrial.json.data.currencies.find(
      (item) => item.asset_id === 'currency.spirit_stone',
    )?.reserved_quantity,
  ).toBe('2500');

  const storageState = await context.storageState();
  await context.close();

  const secondDevice = await browser.newContext({ storageState });
  const secondPage = await secondDevice.newPage();
  await secondPage.goto('/');
  const secondSession = await getSession(secondPage);
  expect(secondSession.character_id).toBe(session.character_id);
  const recoveredView = await apiJson<Envelope<RunData>>(
    secondPage,
    `/api/v1/breakthrough-runs/${runId}`,
    { method: 'GET' },
  );
  expect(recoveredView.status).toBe(200);
  expect(recoveredView.json.data.run.breakthrough_run_id).toBe(runId);
  expect(recoveredView.json.data.run.config_version).toBe(runConfigVersion);
  expect(recoveredView.json.data.run.status).toBe('TRIAL_ACTIVE');

  const selected = await writeApi<RunData>(
    secondPage,
    `/api/v1/breakthrough-runs/${runId}/choices`,
    secondSession,
    {
      choice_id: 'choice.breakthrough.foundation.safe_exit',
      expected_run_version: 0,
    },
    'POST',
  );
  expect(selected.status).toBe(200);
  expect(selected.json.data.run.status).toBe('TRIAL_WAITING_CHOICE');
  expect(selected.json.data.run.selected_choice_id).toBe(
    'choice.breakthrough.foundation.safe_exit',
  );

  await driftCharacterConfigVersion(session.character_id, '2026.08.15.1');
  await moveBreakthroughTrialBoundary(runId, 'trial');
  const finalizeKey = randomUUID();
  const finalized = await writeApi<RunData>(
    secondPage,
    `/api/v1/breakthrough-runs/${runId}/finalize`,
    secondSession,
    {},
    'POST',
    finalizeKey,
  );
  expect(finalized.status).toBe(200);
  expect(finalized.json.data.run.status).toBe('COMPLETED');
  expect(finalized.json.data.run.result).toMatchObject({
    unlocked_realm_id: 'realm.foundation.early',
    unlock_bundle_id: 'unlock.foundation.early',
    queue_slots: 3,
    medicine_slots: 3,
  });

  const databaseAfterFinalize = await readBreakthroughDatabaseState(session.character_id, runId);
  expect(databaseAfterFinalize.realmStageId).toBe('realm.foundation.early');
  expect(databaseAfterFinalize.run?.status).toBe('COMPLETED');
  expect(databaseAfterFinalize.run?.config_version).toBe(runConfigVersion);
  expect(databaseAfterFinalize.run?.result).toMatchObject({
    unlockedRealmId: 'realm.foundation.early',
    queueSlots: 3,
    medicineSlots: 3,
  });
  expect(databaseAfterFinalize.finalizeConsumptions).toHaveLength(4);
  expect(databaseAfterFinalize.finalizeConsumptions).toEqual(
    expect.arrayContaining([
      { assetId: 'item.t1.foundation_pill', transactionCount: 1 },
      { assetId: 'item.t2.lingsui', transactionCount: 1 },
      { assetId: 'item.t1.meridian_pill', transactionCount: 1 },
      { assetId: 'currency.spirit_stone', transactionCount: 1 },
    ]),
  );

  const repeatedFinalize = await writeApi<RunData>(
    secondPage,
    `/api/v1/breakthrough-runs/${runId}/finalize`,
    secondSession,
    {},
    'POST',
    finalizeKey,
  );
  expect(repeatedFinalize.status).toBe(200);
  expect(repeatedFinalize.json.data.run.result).toEqual(finalized.json.data.run.result);
  const databaseAfterRepeat = await readBreakthroughDatabaseState(session.character_id, runId);
  expect(databaseAfterRepeat.finalizeConsumptions).toEqual(
    databaseAfterFinalize.finalizeConsumptions,
  );

  const medicineUse = await writeApi<{
    readonly target_slot_index: number;
    readonly buff_instance: { readonly slot_index: number };
  }>(
    secondPage,
    `/api/v1/characters/${session.character_id}/buffs/use`,
    secondSession,
    {
      item_id: 'item.t1.qi_gathering_powder',
      quantity: 1,
      target_slot_index: 3,
      expected_state_version: finalized.json.data.character.state_version,
    },
    'POST',
  );
  expect(medicineUse.status).toBe(200);
  expect(medicineUse.json.data.target_slot_index).toBe(3);
  expect(medicineUse.json.data.buff_instance.slot_index).toBe(3);
  const databaseAfterMedicineUse = await readBreakthroughDatabaseState(
    session.character_id,
    runId,
  );
  expect(databaseAfterMedicineUse.medicineSlotThreeBuffCount).toBe(1);
  await saveThreeSlotConditionalQueue(secondPage, secondSession);

  expect(databaseAfterRepeat.reservations.every((reservation) => reservation.status === 'CONSUMED')).toBe(
    true,
  );
  expect(finalized.json.data.character.active_config_version).toBe('2026.08.15.1');
  await secondDevice.close();
  await assertLedgerBalanced();
});

test('DT-M5-008 accelerated new account completes all dependencies and unlocks the third medicine slot', async ({
  browser,
}) => {
  const account = await openAnonymousAccount(browser);
  const { context, page, session } = account;
  const fixture = await seedBreakthroughFixture(session.character_id, { accelerated: true });
  const preview = await breakthroughPreview(page, session.character_id);
  expect(preview.status).toBe(200);
  expect(preview.json.data.breakthrough.all_satisfied).toBe(true);
  expect(
    preview.json.data.breakthrough.requirements.every((item) => item.status === 'SATISFIED'),
  ).toBe(true);

  const started = await startTrial(
    page,
    session,
    preview.json.data.character.state_version,
    fixture.configVersion,
  );
  expect(started.status).toBe(201);
  const runId = started.json.data.run.breakthrough_run_id;
  const selected = await writeApi<RunData>(
    page,
    `/api/v1/breakthrough-runs/${runId}/choices`,
    session,
    {
      choice_id: 'choice.breakthrough.foundation.deep_den',
      expected_run_version: 0,
    },
    'POST',
  );
  expect(selected.status).toBe(200);

  await driftCharacterConfigVersion(session.character_id, '2026.08.15.1');
  await moveBreakthroughTrialBoundary(runId, 'trial');
  const finalized = await writeApi<RunData>(
    page,
    `/api/v1/breakthrough-runs/${runId}/finalize`,
    session,
    {},
    'POST',
    randomUUID(),
  );
  expect(finalized.status).toBe(200);
  expect(finalized.json.data.run.status).toBe('COMPLETED');
  expect(finalized.json.data.run.result).toMatchObject({
    unlocked_realm_id: 'realm.foundation.early',
    queue_slots: 3,
    medicine_slots: 3,
  });
  const databaseState = await readBreakthroughDatabaseState(session.character_id, runId);
  expect(databaseState.realmStageId).toBe('realm.foundation.early');
  expect(databaseState.run?.status).toBe('COMPLETED');
  expect(databaseState.run?.result).toMatchObject({
    unlockedRealmId: 'realm.foundation.early',
    queueSlots: 3,
    medicineSlots: 3,
  });
  expect(databaseState.finalizeConsumptions).toHaveLength(4);
  expect(databaseState.finalizeConsumptions.every((entry) => entry.transactionCount === 1)).toBe(true);

  const medicineUse = await writeApi<{
    readonly target_slot_index: number;
    readonly buff_instance: { readonly slot_index: number };
  }>(
    page,
    `/api/v1/characters/${session.character_id}/buffs/use`,
    session,
    {
      item_id: 'item.t1.qi_gathering_powder',
      quantity: 1,
      target_slot_index: 3,
      expected_state_version: finalized.json.data.character.state_version,
    },
    'POST',
  );
  expect(medicineUse.status).toBe(200);
  expect(medicineUse.json.data.target_slot_index).toBe(3);
  expect(medicineUse.json.data.buff_instance.slot_index).toBe(3);
  const stateAfterMedicineUse = await readBreakthroughDatabaseState(session.character_id, runId);
  expect(stateAfterMedicineUse.medicineSlotThreeBuffCount).toBe(1);
  expect(finalized.json.data.character.active_config_version).toBe('2026.08.15.1');
  await context.close();
  await assertLedgerBalanced();
});

test('DT-M5-008 expired trial releases every reservation without consumption', async ({ browser }) => {
  const account = await openAnonymousAccount(browser);
  const { context, page, session } = account;
  const fixture = await seedBreakthroughFixture(session.character_id, { accelerated: true });
  const preview = await breakthroughPreview(page, session.character_id);
  expect(preview.status).toBe(200);
  const started = await startTrial(
    page,
    session,
    preview.json.data.character.state_version,
    fixture.configVersion,
  );
  expect(started.status).toBe(201);
  const runId = started.json.data.run.breakthrough_run_id;
  const selected = await writeApi<RunData>(
    page,
    `/api/v1/breakthrough-runs/${runId}/choices`,
    session,
    {
      choice_id: 'choice.breakthrough.foundation.deep_den',
      expected_run_version: 0,
    },
    'POST',
  );
  expect(selected.status).toBe(200);

  await moveBreakthroughTrialBoundary(runId, 'expiry');
  const expired = await writeApi<RunData>(
    page,
    `/api/v1/breakthrough-runs/${runId}/finalize`,
    session,
    {},
    'POST',
  );
  expect(expired.status).toBe(200);
  expect(expired.json.data.run.status).toBe('FAILED_RECOVERABLE');
  expect(expired.json.data.run.result).toBeNull();
  const recoveredInventory = await getInventory(page, session.character_id);
  expect(
    recoveredInventory.json.data.items.find((item) => item.asset_id === 'item.t1.foundation_pill')
      ?.reserved_quantity,
  ).toBe(0);
  expect(
    recoveredInventory.json.data.currencies.find(
      (item) => item.asset_id === 'currency.spirit_stone',
    )?.reserved_quantity,
  ).toBe('0');

  const recoveredDatabaseState = await readBreakthroughDatabaseState(session.character_id, runId);
  expect(recoveredDatabaseState.run?.status).toBe('FAILED_RECOVERABLE');
  expect(
    recoveredDatabaseState.reservations.every((reservation) => reservation.status === 'RELEASED'),
  ).toBe(true);
  expect(recoveredDatabaseState.finalizeConsumptions).toEqual([]);
  await context.close();
  await assertLedgerBalanced();
});
