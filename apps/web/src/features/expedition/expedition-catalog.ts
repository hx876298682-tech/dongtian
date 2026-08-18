export interface ExpeditionMonsterCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly recommendedPower: number;
  readonly loot: readonly string[];
  readonly dungeonId: string | null;
}

export interface ExpeditionRegionCatalogEntry {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly stageLabel: string;
  readonly monsterIds: readonly string[];
  readonly dungeonIds: readonly string[];
}

const MONSTERS: readonly ExpeditionMonsterCatalogEntry[] = [
  { id: 'monster.t1.qingshe', label: '青蛇', description: '青云山麓常见妖蛇，适合初次历练。', hp: 180, attack: 18, defense: 8, recommendedPower: 60, loot: ['青蛇丹'], dungeonId: 'dungeon.t1.qingshe_cave' },
  { id: 'monster.t1.qingshe_wang', label: '青蛇王', description: '盘踞蛇窟深处的精英妖兽。', hp: 240, attack: 26, defense: 14, recommendedPower: 82, loot: ['青蛇丹'], dungeonId: 'dungeon.t1.qingshe_cave' },
  { id: 'monster.t1.zhuling_yao', label: '竹灵妖', description: '雾隐丘陵中由灵竹化形的妖物。', hp: 210, attack: 20, defense: 9, recommendedPower: 72, loot: ['青竹', '凝露花'], dungeonId: null },
  { id: 'monster.t1.gray_wolf', label: '灰狼', description: '黑石山道上成群出没的妖狼。', hp: 360, attack: 26, defense: 12, recommendedPower: 92, loot: ['妖狼牙', '妖丹'], dungeonId: 'dungeon.t1.xuantie_cavern' },
  { id: 'monster.t1.shijia_beast', label: '石甲兽', description: '吞食矿脉、披覆石甲的重型妖兽。', hp: 520, attack: 34, defense: 22, recommendedPower: 130, loot: ['石甲', '玄铁矿'], dungeonId: 'dungeon.t1.xuantie_cavern' },
  { id: 'monster.t1.chitong_jiachong', label: '赤铜甲虫', description: '雾隐丘陵矿洞中的甲壳妖虫。', hp: 260, attack: 22, defense: 11, recommendedPower: 78, loot: ['赤铜矿', '玄铁矿'], dungeonId: 'dungeon.t1.xuantie_cavern' },
  { id: 'monster.t1.wuying_yuan', label: '无影猿', description: '善于藏匿的山林妖猿。', hp: 300, attack: 24, defense: 10, recommendedPower: 84, loot: ['青竹', '妖狼牙'], dungeonId: null },
  { id: 'monster.t1.xingwen_kui', label: '星纹傀', description: '星落矿区由陨铁孕育的矿傀。', hp: 980, attack: 52, defense: 34, recommendedPower: 210, loot: ['星纹钢', '灵玉矿'], dungeonId: null },
  { id: 'monster.t1.heifeng_lang', label: '黑风狼', description: '黑风谷中受煞气侵染的妖狼。', hp: 850, attack: 48, defense: 30, recommendedPower: 190, loot: ['妖狼牙', '黑风晶'], dungeonId: 'dungeon.t1.heifeng_mijing' },
  { id: 'monster.t1.lingquan_shouwei', label: '灵泉守卫', description: '镇守灵泉的高阶妖兽。', hp: 1400, attack: 70, defense: 48, recommendedPower: 250, loot: ['地脉参', '灵髓'], dungeonId: null },
  { id: 'monster.t1.heifeng_yaowang', label: '黑风妖王', description: '黑风谷深处的终段妖王。', hp: 5200, attack: 145, defense: 90, recommendedPower: 520, loot: ['黑风晶', '妖丹'], dungeonId: 'dungeon.t1.heifeng_mijing' },
] as const;

export const EXPEDITION_REGIONS: readonly ExpeditionRegionCatalogEntry[] = [
  { id: 'region.t1.qingyun_foothill', label: '青云山麓', description: '凡人起点的山麓区域。', stageLabel: '凡人', monsterIds: ['monster.t1.qingshe', 'monster.t1.qingshe_wang'], dungeonIds: ['dungeon.t1.qingshe_cave'] },
  { id: 'region.t1.mist_slope', label: '雾隐丘陵', description: '炼气初期的采集与小规模战斗区域。', stageLabel: '炼气初期', monsterIds: ['monster.t1.zhuling_yao', 'monster.t1.chitong_jiachong'], dungeonIds: ['dungeon.t1.xuantie_cavern'] },
  { id: 'region.t1.spirit_spring', label: '灵泉谷地', description: '灵泉滋养的补给区域。', stageLabel: '炼气中期', monsterIds: ['monster.t1.lingquan_shouwei'], dungeonIds: [] },
  { id: 'region.t1.blackstone_pass', label: '黑石山道', description: '炼器与矿材并行推进的山道。', stageLabel: '炼气中期', monsterIds: ['monster.t1.gray_wolf', 'monster.t1.shijia_beast', 'monster.t1.wuying_yuan'], dungeonIds: [] },
  { id: 'region.t2.starfall_mine', label: '星落矿区', description: '炼气后期的陨铁深矿。', stageLabel: '炼气后期', monsterIds: ['monster.t1.xingwen_kui'], dungeonIds: ['dungeon.t1.xuantie_cavern'] },
  { id: 'region.t2.blackwind_valley', label: '黑风谷', description: '筑基前后的终段区域。', stageLabel: '炼气大圆满 / 筑基', monsterIds: ['monster.t1.heifeng_lang', 'monster.t1.heifeng_yaowang'], dungeonIds: ['dungeon.t1.heifeng_mijing'] },
] as const;

export function getExpeditionRegions(): readonly ExpeditionRegionCatalogEntry[] { return EXPEDITION_REGIONS; }
export function getExpeditionMonsters(): readonly ExpeditionMonsterCatalogEntry[] { return MONSTERS; }
export function findExpeditionMonster(monsterId: string): ExpeditionMonsterCatalogEntry | null { return MONSTERS.find((monster) => monster.id === monsterId) ?? null; }
export function getMonsterDungeon(monsterId: string): string | null { return findExpeditionMonster(monsterId)?.dungeonId ?? null; }
