import type { PoolClient } from 'pg';

import type { DatabasePool } from './index.js';

export const assetTypes = ['ITEM', 'CURRENCY'] as const;
export type AssetType = (typeof assetTypes)[number];

export type AssetMutationContext = {
  readonly characterId: string;
  readonly reasonCode: string;
  readonly referenceType: string;
  readonly referenceId: string;
  readonly configVersion: string;
};

export type AssetAmount = AssetMutationContext & {
  readonly assetType: AssetType;
  readonly assetId: string;
  readonly quantity: string;
};

export type AssetReservationRequest = AssetAmount & {
  readonly businessType: string;
  readonly businessId: string;
  readonly expiresAt?: Date;
};

export type AssetReservationLookup = {
  readonly characterId: string;
  readonly businessType: string;
  readonly businessId: string;
};

export type ReservationLifecycleRequest = AssetMutationContext & {
  readonly reservationId: string;
  readonly quantity?: string;
};

export type AssetBalance = {
  readonly assetType: AssetType;
  readonly assetId: string;
  readonly quantity: string;
  readonly reservedQuantity: string;
  readonly availableQuantity: string;
};

export type InventorySnapshot = {
  readonly items: readonly AssetBalance[];
  readonly currencies: readonly AssetBalance[];
  readonly equipmentInstances: readonly EquipmentInstanceRecord[];
};

export type EquipmentInstanceRecord = {
  readonly instanceId: string;
  readonly itemId: string;
  readonly temperLevel: number;
  readonly bound: boolean;
  readonly createdConfigVersion: string;
};

export type AssetMutationResult = AssetBalance & {
  readonly transactionId: string;
  readonly ledgerEntryId: string;
};

export type AssetReservation = {
  readonly reservationId: string;
  readonly characterId: string;
  readonly businessType: string;
  readonly businessId: string;
  readonly assetType: AssetType;
  readonly assetId: string;
  readonly quantity: string;
  readonly status: 'ACTIVE' | 'CONSUMED' | 'RELEASED' | 'EXPIRED';
  readonly expiresAt: Date | null;
};

export type AssetReservationResult = AssetMutationResult & {
  readonly reservation: AssetReservation;
};

export const ACTION_CYCLE_BUSINESS_TYPE = 'ACTION_CYCLE' as const;

export type AssetAuditDiscrepancy = {
  readonly kind: 'LEDGER_BALANCE_MISMATCH' | 'RESERVATION_BALANCE_MISMATCH';
  readonly characterId: string;
  readonly assetType: AssetType;
  readonly assetId: string;
  readonly expected: string;
  readonly actual: string;
};

export type AssetAuditReport = {
  readonly ok: boolean;
  readonly discrepancyCount: number;
  readonly discrepancies: readonly AssetAuditDiscrepancy[];
};

export type AssetRepository = {
  readonly getInventory: (characterId: string, accountId: string) => Promise<InventorySnapshot | null>;
  readonly getInventoryOnTransaction: (
    client: PoolClient,
    characterId: string,
    accountId: string,
  ) => Promise<InventorySnapshot | null>;
  readonly add: (input: AssetAmount) => Promise<AssetMutationResult>;
  readonly addOnTransaction: (client: PoolClient, input: AssetAmount) => Promise<AssetMutationResult>;
  readonly deduct: (input: AssetAmount) => Promise<AssetMutationResult>;
  readonly deductOnTransaction: (client: PoolClient, input: AssetAmount) => Promise<AssetMutationResult>;
  readonly reserve: (input: AssetReservationRequest) => Promise<AssetReservationResult>;
  readonly reserveOnTransaction: (client: PoolClient, input: AssetReservationRequest) => Promise<AssetReservationResult>;
  readonly findActiveReservationsByBusiness: (
    client: PoolClient,
    input: AssetReservationLookup,
  ) => Promise<AssetReservation[]>;
  readonly release: (input: ReservationLifecycleRequest) => Promise<AssetReservationResult>;
  readonly releaseOnTransaction: (client: PoolClient, input: ReservationLifecycleRequest) => Promise<AssetReservationResult>;
  readonly consume: (input: ReservationLifecycleRequest) => Promise<AssetReservationResult>;
  readonly consumeOnTransaction: (client: PoolClient, input: ReservationLifecycleRequest) => Promise<AssetReservationResult>;
  readonly audit: () => Promise<AssetAuditReport>;
};

type BalanceRow = {
  quantity: string;
  reserved_quantity: string;
  available_quantity: string;
};

type ReservationRow = {
  id: string;
  character_id: string;
  business_type: string;
  business_id: string;
  asset_type: AssetType;
  asset_id: string;
  quantity: string;
  status: AssetReservation['status'];
  expires_at: Date | null;
};

type EquipmentInstanceRow = {
  id: string;
  item_id: string;
  temper_level: number;
  bound: boolean;
  created_config_version: string;
};

type AssetTransactionRow = { id: string };
type LedgerRow = { entry_id: string };

function invalidAsset(message: string): Error {
  return new Error(`ASSET_VALIDATION_FAILED:${message}`);
}

function assetError(code: string): Error {
  return new Error(code);
}

function assertContext(input: AssetMutationContext): void {
  const fields: readonly (keyof AssetMutationContext)[] = [
    'characterId',
    'reasonCode',
    'referenceType',
    'referenceId',
    'configVersion',
  ];
  for (const field of fields) {
    if (input[field].length === 0) {
      throw invalidAsset(field);
    }
  }
}

function assertAsset(input: AssetAmount): void {
  assertContext(input);
  if (!assetTypes.includes(input.assetType)) {
    throw invalidAsset('asset_type');
  }
  if (input.assetId.length === 0) {
    throw invalidAsset('asset_id');
  }
  if (input.assetType === 'ITEM' && !/^[1-9]\d*$/.test(input.quantity)) {
    throw invalidAsset('item_quantity');
  }
  if (input.assetType === 'CURRENCY' && !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(input.quantity)) {
    throw invalidAsset('currency_quantity');
  }
  if (input.quantity === '0') {
    throw invalidAsset('quantity_positive');
  }
}

function assertReservationRequest(input: AssetReservationRequest): void {
  assertAsset(input);
  if (input.businessType.length === 0 || input.businessId.length === 0) {
    throw invalidAsset('business_reference');
  }
}

function mutationQuantity(assetType: AssetType, quantity: string): string {
  return assetType === 'ITEM' ? quantity.replace(/\.0+$/, '') : quantity;
}

function balanceFromRow(assetType: AssetType, assetId: string, row: BalanceRow): AssetBalance {
  return {
    assetType,
    assetId,
    quantity: row.quantity,
    reservedQuantity: row.reserved_quantity,
    availableQuantity: row.available_quantity,
  };
}

async function withTransaction<T>(pool: DatabasePool, callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function lockWritableCharacter(client: PoolClient, characterId: string): Promise<void> {
  const character = await client.query<{ id: string }>(
    `SELECT id FROM characters WHERE id = $1 FOR UPDATE`,
    [characterId],
  );
  if (!character.rows[0]) {
    throw assetError('CHARACTER_NOT_FOUND');
  }
  const state = await client.query<{ continuation_required: boolean }>(
    `SELECT continuation_required
       FROM settlement_states
      WHERE character_id = $1
      FOR UPDATE`,
    [characterId],
  );
  const row = state.rows[0];
  if (!row) {
    throw assetError('SETTLEMENT_STATE_NOT_FOUND');
  }
  if (row.continuation_required) {
    throw assetError('SETTLEMENT_CONTINUATION_IN_PROGRESS');
  }
}

async function createTransaction(
  client: PoolClient,
  input: AssetMutationContext & { readonly operationType: string },
): Promise<string> {
  const result = await client.query<AssetTransactionRow>(
    `INSERT INTO asset_transactions (
       character_id, operation_type, reason_code, reference_type, reference_id, config_version
     )
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      input.characterId,
      input.operationType,
      input.reasonCode,
      input.referenceType,
      input.referenceId,
      input.configVersion,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('ASSET_TRANSACTION_NOT_CREATED');
  }
  return row.id;
}

async function createLedgerEntry(
  client: PoolClient,
  input: AssetMutationContext & {
    readonly transactionId: string;
    readonly assetType: AssetType;
    readonly assetId: string;
    readonly delta: string;
    readonly balanceAfter: string;
  },
): Promise<string> {
  const result = await client.query<LedgerRow>(
    `INSERT INTO asset_ledger (
       transaction_id, character_id, asset_type, asset_id, delta, balance_after,
       reason_code, reference_type, reference_id, config_version
     )
     VALUES ($1, $2, $3, $4, $5::numeric, $6::numeric, $7, $8, $9, $10)
     RETURNING entry_id`,
    [
      input.transactionId,
      input.characterId,
      input.assetType,
      input.assetId,
      input.delta,
      input.balanceAfter,
      input.reasonCode,
      input.referenceType,
      input.referenceId,
      input.configVersion,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error('ASSET_LEDGER_ENTRY_NOT_CREATED');
  }
  return row.entry_id;
}

function balanceQuery(assetType: AssetType, mutation: 'add' | 'deduct' | 'reserve' | 'release' | 'consume'): string {
  const table = assetType === 'ITEM' ? 'inventories' : 'currency_balances';
  const amountType = assetType === 'ITEM' ? 'bigint' : 'numeric';
  const assetColumn = assetType === 'ITEM' ? 'item_id' : 'currency_id';
  if (mutation === 'add') {
    return `
      INSERT INTO ${table} (character_id, ${assetColumn}, quantity, reserved_quantity)
      VALUES ($1, $3, $2::${amountType}, 0)
      ON CONFLICT (character_id, ${assetColumn}) DO UPDATE
        SET quantity = ${table}.quantity + EXCLUDED.quantity,
            updated_at = CURRENT_TIMESTAMP
      RETURNING quantity::text, reserved_quantity::text,
        (quantity - reserved_quantity)::text AS available_quantity`;
  }
  const available = assetType === 'ITEM'
    ? 'quantity - reserved_quantity'
    : 'quantity - reserved_quantity';
  const quantityChange = mutation === 'consume'
    ? `quantity = quantity - $2::${amountType}, reserved_quantity = reserved_quantity - $2::${amountType}`
    : mutation === 'deduct'
      ? `quantity = quantity - $2::${amountType}`
      : `reserved_quantity = reserved_quantity ${mutation === 'reserve' ? '+' : '-'} $2::${amountType}`;
  const availableCondition = mutation === 'consume'
    ? `AND quantity >= $2::${amountType} AND reserved_quantity >= $2::${amountType}`
    : mutation === 'deduct' || mutation === 'reserve'
      ? `AND ${available} >= $2::${amountType}`
      : `AND reserved_quantity >= $2::${amountType}`;
  return `
    UPDATE ${table}
    SET ${quantityChange}, updated_at = CURRENT_TIMESTAMP
    WHERE character_id = $1 AND ${assetColumn} = $3
      ${availableCondition}
    RETURNING quantity::text, reserved_quantity::text,
      (${available})::text AS available_quantity`;
}

async function mutateBalance(
  client: PoolClient,
  input: AssetAmount,
  mutation: 'add' | 'deduct' | 'reserve' | 'release' | 'consume',
): Promise<AssetBalance> {
  const result = await client.query<BalanceRow>(balanceQuery(input.assetType, mutation), [
    input.characterId,
    input.quantity,
    input.assetId,
  ]);
  const row = result.rows[0];
  if (!row) {
    throw assetError(mutation === 'add' ? 'ASSET_BALANCE_UPDATE_FAILED' : 'ASSET_INSUFFICIENT_AVAILABLE');
  }
  return balanceFromRow(input.assetType, input.assetId, row);
}

async function addOnTransaction(
  client: PoolClient,
  input: AssetAmount,
): Promise<AssetMutationResult> {
  assertAsset(input);
  await lockWritableCharacter(client, input.characterId);
  const transactionId = await createTransaction(client, { ...input, operationType: 'ADD' });
  const balance = await mutateBalance(client, input, 'add');
  const ledgerEntryId = await createLedgerEntry(client, {
    ...input,
    transactionId,
    delta: input.quantity,
    balanceAfter: balance.quantity,
  });
  return { ...balance, transactionId, ledgerEntryId };
}

async function deductOnTransaction(
  client: PoolClient,
  input: AssetAmount,
): Promise<AssetMutationResult> {
  assertAsset(input);
  await lockWritableCharacter(client, input.characterId);
  const transactionId = await createTransaction(client, { ...input, operationType: 'DEDUCT' });
  const balance = await mutateBalance(client, input, 'deduct');
  const ledgerEntryId = await createLedgerEntry(client, {
    ...input,
    transactionId,
    delta: `-${input.quantity}`,
    balanceAfter: balance.quantity,
  });
  return { ...balance, transactionId, ledgerEntryId };
}

function reservationFromRow(row: ReservationRow): AssetReservation {
  return {
    reservationId: row.id,
    characterId: row.character_id,
    businessType: row.business_type,
    businessId: row.business_id,
    assetType: row.asset_type,
    assetId: row.asset_id,
    quantity: row.quantity,
    status: row.status,
    expiresAt: row.expires_at,
  };
}

async function findActiveReservation(client: PoolClient, reservationId: string, characterId: string): Promise<AssetReservation> {
  const result = await client.query<ReservationRow>(
    `SELECT id, character_id, business_type, business_id, asset_type, asset_id,
            quantity::text, status, expires_at
       FROM asset_reservations
      WHERE id = $1 AND character_id = $2
      FOR UPDATE`,
    [reservationId, characterId],
  );
  const row = result.rows[0];
  if (!row) {
    throw assetError('RESERVATION_NOT_FOUND');
  }
  if (row.status !== 'ACTIVE') {
    throw assetError('RESERVATION_NOT_ACTIVE');
  }
  return reservationFromRow(row);
}

async function reserveOnTransaction(
  client: PoolClient,
  input: AssetReservationRequest,
): Promise<AssetReservationResult> {
  assertReservationRequest(input);
  await lockWritableCharacter(client, input.characterId);
  const transactionId = await createTransaction(client, { ...input, operationType: 'RESERVE' });
  const balance = await mutateBalance(client, input, 'reserve');
  const reservationResult = await client.query<ReservationRow>(
    `INSERT INTO asset_reservations (
       character_id, business_type, business_id, asset_type, asset_id, quantity,
       created_transaction_id, expires_at
     )
     VALUES ($1, $2, $3, $4, $5, $6::numeric, $7, $8)
     RETURNING id, character_id, business_type, business_id, asset_type, asset_id,
               quantity::text, status, expires_at`,
    [
      input.characterId,
      input.businessType,
      input.businessId,
      input.assetType,
      input.assetId,
      input.quantity,
      transactionId,
      input.expiresAt ?? null,
    ],
  );
  const reservationRow = reservationResult.rows[0];
  if (!reservationRow) {
    throw new Error('RESERVATION_NOT_CREATED');
  }
  const ledgerEntryId = await createLedgerEntry(client, {
    ...input,
    transactionId,
    delta: '0',
    balanceAfter: balance.quantity,
  });
  return { ...balance, transactionId, ledgerEntryId, reservation: reservationFromRow(reservationRow) };
}

async function releaseOnTransaction(
  client: PoolClient,
  input: ReservationLifecycleRequest,
): Promise<AssetReservationResult> {
  assertContext(input);
  await lockWritableCharacter(client, input.characterId);
  const reservation = await findActiveReservation(client, input.reservationId, input.characterId);
  const amount: AssetAmount = {
    ...input,
    assetType: reservation.assetType,
    assetId: reservation.assetId,
    quantity: mutationQuantity(reservation.assetType, reservation.quantity),
  };
  const transactionId = await createTransaction(client, { ...input, operationType: 'RELEASE' });
  const balance = await mutateBalance(client, amount, 'release');
  await client.query(
    `UPDATE asset_reservations
        SET status = 'RELEASED', released_transaction_id = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1`,
    [reservation.reservationId, transactionId],
  );
  const ledgerEntryId = await createLedgerEntry(client, {
    ...input,
    transactionId,
    assetType: reservation.assetType,
    assetId: reservation.assetId,
    delta: '0',
    balanceAfter: balance.quantity,
  });
  return {
    ...balance,
    transactionId,
    ledgerEntryId,
    reservation: { ...reservation, status: 'RELEASED' as const },
  };
}

async function consumeOnTransaction(
  client: PoolClient,
  input: ReservationLifecycleRequest,
): Promise<AssetReservationResult> {
  assertContext(input);
  await lockWritableCharacter(client, input.characterId);
  const reservation = await findActiveReservation(client, input.reservationId, input.characterId);
  const consumeQuantity = input.quantity ?? reservation.quantity;
  if (!/^\d+(?:\.\d+)?$/.test(consumeQuantity) || Number(consumeQuantity) <= 0) {
    throw assetError('RESERVATION_QUANTITY_INVALID');
  }
  if (Number(consumeQuantity) > Number(reservation.quantity)) {
    throw assetError('RESERVATION_QUANTITY_EXCEEDS_AVAILABLE');
  }
  const amount: AssetAmount = {
    ...input,
    assetType: reservation.assetType,
    assetId: reservation.assetId,
    quantity: mutationQuantity(reservation.assetType, consumeQuantity),
  };
  const transactionId = await createTransaction(client, { ...input, operationType: 'CONSUME' });
  const balance = await mutateBalance(client, amount, 'consume');
  const fullyConsumed = consumeQuantity === reservation.quantity;
  await client.query(
    fullyConsumed
      ? `UPDATE asset_reservations
            SET status = 'CONSUMED', consumed_transaction_id = $2, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`
      : `UPDATE asset_reservations
            SET quantity = quantity - $2::numeric, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1`,
    fullyConsumed ? [reservation.reservationId, transactionId] : [reservation.reservationId, consumeQuantity],
  );
  const ledgerEntryId = await createLedgerEntry(client, {
    ...input,
    transactionId,
    assetType: reservation.assetType,
    assetId: reservation.assetId,
    delta: `-${consumeQuantity}`,
    balanceAfter: balance.quantity,
  });
  return {
    ...balance,
    transactionId,
    ledgerEntryId,
    reservation: fullyConsumed
      ? { ...reservation, status: 'CONSUMED' as const }
      : { ...reservation, quantity: (BigInt(reservation.quantity) - BigInt(consumeQuantity)).toString() },
  };
}

async function loadInventory(
  pool: Pick<DatabasePool, 'query'>,
  characterId: string,
  accountId: string,
): Promise<InventorySnapshot | null> {
  const character = await pool.query<{ id: string }>(
    'SELECT id FROM characters WHERE id = $1 AND account_id = $2',
    [characterId, accountId],
  );
  if (!character.rows[0]) {
    return null;
  }

  const [items, currencies, equipmentInstances] = await Promise.all([
    pool.query<BalanceRow & { item_id: string }>(
      `SELECT item_id, quantity::text, reserved_quantity::text,
              (quantity - reserved_quantity)::text AS available_quantity
         FROM inventories WHERE character_id = $1 ORDER BY item_id`,
      [characterId],
    ),
    pool.query<BalanceRow & { currency_id: string }>(
      `SELECT currency_id, quantity::text, reserved_quantity::text,
              (quantity - reserved_quantity)::text AS available_quantity
         FROM currency_balances WHERE character_id = $1 ORDER BY currency_id`,
      [characterId],
    ),
    pool.query<EquipmentInstanceRow>(
      `SELECT id, item_id, temper_level, bound, created_config_version
         FROM equipment_instances WHERE character_id = $1 ORDER BY created_at, id`,
      [characterId],
    ),
  ]);

  return {
    items: items.rows.map((row) => balanceFromRow('ITEM', row.item_id, row)),
    currencies: currencies.rows.map((row) => balanceFromRow('CURRENCY', row.currency_id, row)),
    equipmentInstances: equipmentInstances.rows.map((row) => ({
      instanceId: row.id,
      itemId: row.item_id,
      temperLevel: row.temper_level,
      bound: row.bound,
      createdConfigVersion: row.created_config_version,
    })),
  };
}

export function createAssetRepository(pool: DatabasePool): AssetRepository {
  async function findActiveReservationsByBusiness(
    client: PoolClient,
    input: AssetReservationLookup,
  ): Promise<AssetReservation[]> {
    const result = await client.query<ReservationRow>(
      `SELECT id, character_id, business_type, business_id, asset_type, asset_id,
              quantity::text, status, expires_at
         FROM asset_reservations
        WHERE character_id = $1
          AND business_type = $2
          AND business_id = $3
          AND status = 'ACTIVE'
        ORDER BY asset_type ASC, asset_id ASC, created_at ASC
        FOR UPDATE`,
      [input.characterId, input.businessType, input.businessId],
    );
    return result.rows.map(reservationFromRow);
  }

  return {
    getInventory: (characterId, accountId) => loadInventory(pool, characterId, accountId),
    getInventoryOnTransaction: (client, characterId, accountId) => loadInventory(client, characterId, accountId),

    async add(input) {
      assertAsset(input);
      return withTransaction(pool, (client) => addOnTransaction(client, input));
    },
    addOnTransaction,

    async deduct(input) {
      assertAsset(input);
      return withTransaction(pool, (client) => deductOnTransaction(client, input));
    },
    deductOnTransaction,

    reserve: (input) => withTransaction(pool, (client) => reserveOnTransaction(client, input)),
    reserveOnTransaction,
    findActiveReservationsByBusiness,
    release: (input) => withTransaction(pool, (client) => releaseOnTransaction(client, input)),
    releaseOnTransaction,
    consume: (input) => withTransaction(pool, (client) => consumeOnTransaction(client, input)),
    consumeOnTransaction,

    async audit() {
      const ledgerResult = await pool.query<{
        character_id: string;
        asset_type: AssetType;
        asset_id: string;
        expected: string;
        actual: string;
      }>(
        `WITH balances AS (
           SELECT character_id, 'ITEM'::text AS asset_type, item_id AS asset_id,
                  quantity::numeric AS expected
             FROM inventories
           UNION ALL
           SELECT character_id, 'CURRENCY'::text AS asset_type, currency_id AS asset_id,
                  quantity AS expected
             FROM currency_balances
         ), ledger AS (
           SELECT character_id, asset_type, asset_id, COALESCE(SUM(delta), 0)::numeric AS actual
             FROM asset_ledger
            GROUP BY character_id, asset_type, asset_id
         )
         SELECT b.character_id, b.asset_type, b.asset_id, b.expected::text,
                COALESCE(l.actual, 0)::text AS actual
           FROM balances b
           LEFT JOIN ledger l USING (character_id, asset_type, asset_id)
          WHERE b.expected <> COALESCE(l.actual, 0)`,
      );
      const reservationResult = await pool.query<{
        character_id: string;
        asset_type: AssetType;
        asset_id: string;
        expected: string;
        actual: string;
      }>(
        `WITH balances AS (
           SELECT character_id, 'ITEM'::text AS asset_type, item_id AS asset_id,
                  reserved_quantity::numeric AS expected
             FROM inventories
           UNION ALL
           SELECT character_id, 'CURRENCY'::text AS asset_type, currency_id AS asset_id,
                  reserved_quantity AS expected
             FROM currency_balances
         ), reservations AS (
           SELECT character_id, asset_type, asset_id, COALESCE(SUM(quantity), 0)::numeric AS actual
             FROM asset_reservations
            WHERE status = 'ACTIVE'
            GROUP BY character_id, asset_type, asset_id
         )
         SELECT b.character_id, b.asset_type, b.asset_id, b.expected::text,
                COALESCE(r.actual, 0)::text AS actual
           FROM balances b
           LEFT JOIN reservations r USING (character_id, asset_type, asset_id)
          WHERE b.expected <> COALESCE(r.actual, 0)`,
      );
      const discrepancies: AssetAuditDiscrepancy[] = [
        ...ledgerResult.rows.map((row) => ({
          kind: 'LEDGER_BALANCE_MISMATCH' as const,
          characterId: row.character_id,
          assetType: row.asset_type,
          assetId: row.asset_id,
          expected: row.expected,
          actual: row.actual,
        })),
        ...reservationResult.rows.map((row) => ({
          kind: 'RESERVATION_BALANCE_MISMATCH' as const,
          characterId: row.character_id,
          assetType: row.asset_type,
          assetId: row.asset_id,
          expected: row.expected,
          actual: row.actual,
        })),
      ];
      return {
        ok: discrepancies.length === 0,
        discrepancyCount: discrepancies.length,
        discrepancies,
      };
    },
  };
}
