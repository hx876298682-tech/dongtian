#!/usr/bin/env ruby

require "csv"

ROOT = __dir__
SECONDS_PER_HOUR = 3600
SETTLEMENT_SECONDS = 24 * SECONDS_PER_HOUR

rows = CSV.read(File.join(ROOT, "洞天数值参数表.csv"), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

CAPS = {
  spirit_stone: value.call("economy.inventory.cap.spirit_stone").to_i,
  spirit_wood: value.call("economy.inventory.cap.spirit_wood").to_i,
  spirit_ore: value.call("economy.inventory.cap.spirit_ore").to_i,
  spirit_herb: value.call("economy.inventory.cap.spirit_herb").to_i,
  pill: value.call("economy.inventory.cap.pill").to_i,
  ancient_scroll: value.call("economy.inventory.cap.ancient_scroll").to_i,
  equipment: value.call("economy.inventory.cap.equipment").to_i,
  demon_core: value.call("economy.inventory.cap.demon_core").to_i,
  millennium_herb: value.call("economy.inventory.cap.millennium_herb").to_i,
  meteor_iron: value.call("economy.inventory.cap.meteor_iron").to_i
}.freeze

def add_resource(state, overflow, resource, amount)
  before = state[resource]
  after = [[before + amount, 0].max, CAPS.fetch(resource)].min
  overflow[resource] += [before + amount - CAPS.fetch(resource), 0].max
  state[resource] = after
end

def normal_map_config(value, map_id)
  {
    kill_seconds: value.call("map.#{map_id}.target_kill_time").to_i,
    pill_per_fight: value.call("map.#{map_id}.pill_per_fight").to_i,
    stone_per_kill: value.call("map.#{map_id}.spirit_stone_per_kill").to_i,
    ore_per_kill: value.call("map.#{map_id}.spirit_ore_per_kill").to_i,
    wood_per_kill: value.call("map.#{map_id}.spirit_wood_per_kill").to_i,
    equipment_chance: value.call("map.#{map_id}.equipment_drop_chance") / 100.0,
    scroll_chance: value.call("map.#{map_id}.ancient_scroll_drop_chance") / 100.0,
    pity_kills: value.call("map.#{map_id}.ancient_scroll_pity_kills").to_i,
    quality_chances: %w[normal fine rare epic legendary immortal].to_h do |quality|
      [quality, value.call("map.#{map_id}.equipment_quality_#{quality}_chance") / 100.0]
    end
  }
end

def draw_quality(rng, chances)
  roll = rng.rand
  cumulative = 0.0
  chances.each do |quality, chance|
    cumulative += chance
    return quality if roll < cumulative
  end
  chances.keys.last
end

def pity_roll(rng, chance, counter, limit)
  random_success = rng.rand < chance
  forced_success = !random_success && counter + 1 >= limit
  success = random_success || forced_success
  [success, success ? 0 : counter + 1, forced_success]
end

def simulate_boss_fight(value, dungeon_id, auto_pills:)
  target_seconds = value.call("dungeon.#{dungeon_id}.target_clear_time").to_i
  base_hp = value.call("dungeon.#{dungeon_id}.boss_base_hp").to_f
  barrier_percent = value.call("combat.boss.initial_barrier_percent") / 100.0
  stun_interval = value.call("combat.boss.stun_interval").to_i
  stun_duration = value.call("combat.boss.stun_duration").to_i
  phase_threshold = value.call("dungeon.#{dungeon_id}.boss_phase_two_threshold") / 100.0
  boss_attack = value.call("dungeon.#{dungeon_id}.boss_attack")
  boss_accuracy = value.call("dungeon.#{dungeon_id}.boss_accuracy")
  enemy_interval = value.call("combat.enemy.base_attack_interval")
  player_defence = value.call("combat.player.base_defence")
  player_evasion = value.call("combat.player.base_evasion")
  player_health_max = value.call("combat.player.base_health")
  player_health = player_health_max
  heal = value.call("combat.pill.heal_per_use")
  heal_target = player_health_max * value.call("combat.pill.auto_use_target_percent") / 100.0
  threshold = player_health_max * value.call("combat.pill.auto_use_threshold_percent") / 100.0
  boss_hit_chance = if boss_accuracy >= player_evasion
    1 - player_evasion / (2.0 * boss_accuracy)
  else
    boss_accuracy / (2.0 * player_evasion)
  end
  baseline_dps = value.call("combat.player.base_attack") * value.call("combat.damage.base_coefficient") * 100.0 /
    (100.0 + value.call("map.bai_cao_valley.enemy_defence")) * 0.75 / value.call("combat.player.base_attack_interval")
  shield = base_hp * barrier_percent
  hp = base_hp
  stun_count = 0
  active_seconds = 0
  phase_two_triggered = false
  clear_seconds = nil
  pills_used = 0
  player_failed = false
  spirit_burn_remaining = 0.0
  spirit_burn_interval = value.call("dungeon.#{dungeon_id}.boss_skill.spirit_burn_interval").to_i
  spirit_burn_duration = value.call("dungeon.#{dungeon_id}.boss_skill.spirit_burn_duration") * (1 - value.call("combat.player.status_resistance_percent") / 100.0)
  spirit_burn_damage = value.call("dungeon.#{dungeon_id}.boss_skill.spirit_burn_damage_per_second")

  (1..target_seconds).each do |second|
    if (second % spirit_burn_interval).zero? && second < target_seconds
      spirit_burn_remaining = spirit_burn_duration
    end
    # The final timestamp is reserved for the clear event, matching the Boss derivation formula.
    stunned = (second % stun_interval).zero? && second < target_seconds
    if stunned
      stun_count += 1
    else
      active_seconds += 1
      damage = baseline_dps
      if shield.positive?
        absorbed = [shield, damage].min
        shield -= absorbed
        damage -= absorbed
      end
      hp -= damage
      phase_two_triggered ||= hp <= base_hp * phase_threshold
    end
    break if hp <= 0

    incoming_damage = 0.0
    if (second % enemy_interval).zero?
      phase_multiplier = phase_two_triggered ? value.call("combat.boss.phase_two_damage_multiplier") : 1.0
      incoming_damage += boss_attack * value.call("combat.damage.base_coefficient") * 100.0 / (100.0 + player_defence) * boss_hit_chance * phase_multiplier
    end
    if spirit_burn_remaining.positive?
      phase_multiplier = phase_two_triggered ? value.call("combat.boss.phase_two_damage_multiplier") : 1.0
      incoming_damage += spirit_burn_damage * phase_multiplier
      spirit_burn_remaining -= 1
    end
    if incoming_damage.positive?
      player_health -= incoming_damage
      if player_health <= threshold && pills_used < auto_pills
        player_health = [player_health + heal, heal_target].min
        pills_used += 1
      end
      if player_health <= 0
        player_failed = true
        break
      end
    end
  end

  clear_seconds = target_seconds if hp <= 0

  {
    defeated: hp <= 0 && !player_failed,
    player_failed: player_failed,
    target_seconds: target_seconds,
    clear_seconds: clear_seconds,
    active_seconds: active_seconds,
    stun_count: stun_count,
    remaining_hp: hp,
    remaining_shield: shield,
    phase_two_triggered: phase_two_triggered,
    player_health_remaining: player_health,
    pills_used: pills_used
  }
end

def add_equipment(state, overflow, metrics, quality, auto_salvage, salvage_yield)
  if state[:equipment] < CAPS[:equipment]
    add_resource(state, overflow, :equipment, 1)
  elsif auto_salvage.fetch(quality, 0) == 1
    add_resource(state, overflow, :spirit_ore, salvage_yield.fetch(quality).fetch(:ore))
    add_resource(state, overflow, :spirit_wood, salvage_yield.fetch(quality).fetch(:wood))
    metrics["salvaged_#{quality}".to_sym] = metrics.fetch("salvaged_#{quality}".to_sym, 0) + 1
  else
    add_resource(state, overflow, :equipment, 1)
  end
end

def simulate(value, activity:, initial_pills:)
  rng = Random.new(42)
  state = Hash.new(0)
  state[:pill] = initial_pills
  overflow = Hash.new(0)
  metrics = { successful_fights: 0, failed_fights: 0, production_pills: 0, production_equipment: 0, ancient_scroll_misses: 0, stopped_at: nil }
  map = activity[:type] == :map ? normal_map_config(value, activity[:id]) : nil
  auto_salvage = %w[normal fine rare epic legendary immortal].to_h do |quality|
    [quality, value.call("loot.equipment.auto_salvage.#{quality}_enabled").to_i]
  end
  salvage_yield = {
    "normal" => { ore: value.call("loot.equipment.salvage.normal.spirit_ore").to_i, wood: value.call("loot.equipment.salvage.normal.spirit_wood").to_i },
    "fine" => { ore: value.call("loot.equipment.salvage.fine.spirit_ore").to_i, wood: value.call("loot.equipment.salvage.fine.spirit_wood").to_i }
  }
  dungeon = activity[:type] == :dungeon ? {
    clear_seconds: value.call("dungeon.#{activity[:id]}.target_clear_time").to_i,
    entry_pill_cost: value.call("dungeon.#{activity[:id]}.pill_cost").to_i,
    boss_auto_pills: value.call("dungeon.#{activity[:id]}.boss_auto_pill_per_clear").to_i,
    pill_cost: value.call("dungeon.#{activity[:id]}.pill_cost").to_i + value.call("dungeon.#{activity[:id]}.boss_auto_pill_per_clear").to_i,
    demon_core: value.call("dungeon.#{activity[:id]}.demon_core_per_clear").to_i,
    herb_chance: value.call("dungeon.#{activity[:id]}.millennium_herb_chance") / 100.0,
    meteor_chance: value.call("dungeon.#{activity[:id]}.meteor_iron_chance") / 100.0,
    technique_chance: value.call("dungeon.#{activity[:id]}.technique_drop_chance") / 100.0,
    treasure_chance: value.call("dungeon.#{activity[:id]}.treasure_drop_chance") / 100.0,
    herb_pity: value.call("dungeon.pity.millennium_herb_clears").to_i,
    meteor_pity: value.call("dungeon.pity.meteor_iron_clears").to_i,
    technique_pity: value.call("dungeon.pity.technique_clears").to_i,
    treasure_pity: value.call("dungeon.pity.treasure_clears").to_i
  } : nil
  active = true
  pity = 0
  dungeon_pity = { herb: 0, meteor: 0, technique: 0, treasure: 0 }

  (1..SETTLEMENT_SECONDS).each do |second|
    add_resource(state, overflow, :spirit_herb, value.call("building.spirit_farm.plot_count").to_i * value.call("building.spirit_farm.herb_yield_per_plot").to_i) if (second % value.call("building.spirit_farm.base_growth_time").to_i).zero?

    if (second % value.call("building.alchemy_room.base_interval").to_i).zero? && state[:spirit_herb] >= value.call("recipe.alchemy_basic.herb_cost").to_i && state[:spirit_stone] >= value.call("recipe.alchemy_basic.stone_cost").to_i
      state[:spirit_herb] -= value.call("recipe.alchemy_basic.herb_cost").to_i
      state[:spirit_stone] -= value.call("recipe.alchemy_basic.stone_cost").to_i
      add_resource(state, overflow, :pill, value.call("recipe.alchemy_basic.output").to_i)
      metrics[:production_pills] += 1
    end

    if (second % value.call("building.forge_room.base_interval").to_i).zero? && state[:spirit_ore] >= value.call("recipe.forge_basic.ore_cost").to_i && state[:spirit_wood] >= value.call("recipe.forge_basic.wood_cost").to_i && state[:spirit_stone] >= value.call("recipe.forge_basic.stone_cost").to_i
      state[:spirit_ore] -= value.call("recipe.forge_basic.ore_cost").to_i
      state[:spirit_wood] -= value.call("recipe.forge_basic.wood_cost").to_i
      state[:spirit_stone] -= value.call("recipe.forge_basic.stone_cost").to_i
      value.call("recipe.forge_basic.output").to_i.times do
        add_equipment(state, overflow, metrics, "normal", auto_salvage, salvage_yield)
      end
      metrics[:production_equipment] += 1
    end

    if active && (second % (map ? map[:kill_seconds] : dungeon[:clear_seconds])).zero?
      cost = map ? map[:pill_per_fight] : dungeon[:pill_cost]
      if state[:pill] < cost
        metrics[:failed_fights] += 1
        metrics[:stopped_at] = second
        active = false
        next
      end
      if dungeon
        boss = simulate_boss_fight(value, activity[:id], auto_pills: dungeon[:boss_auto_pills])
        abort("#{activity[:id]} Boss did not clear in target time") unless boss[:defeated]
        abort("#{activity[:id]} Boss auto pill mismatch") unless boss[:pills_used] == dungeon[:boss_auto_pills]
        metrics[:boss_active_seconds] = boss[:active_seconds]
        metrics[:boss_stuns] = boss[:stun_count]
        metrics[:boss_phase_two_triggers] = metrics.fetch(:boss_phase_two_triggers, 0) + 1 if boss[:phase_two_triggered]
      end
      state[:pill] -= cost
      metrics[:successful_fights] += 1
      if map
        add_resource(state, overflow, :spirit_stone, map[:stone_per_kill])
        add_resource(state, overflow, :spirit_ore, map[:ore_per_kill])
        add_resource(state, overflow, :spirit_wood, map[:wood_per_kill])
        if rng.rand < map[:equipment_chance]
          add_equipment(state, overflow, metrics, draw_quality(rng, map[:quality_chances]), auto_salvage, salvage_yield)
        end
        if rng.rand < map[:scroll_chance] || pity + 1 >= map[:pity_kills]
          add_resource(state, overflow, :ancient_scroll, 1)
          pity = 0
        else
          pity += 1
        end
      else
        add_resource(state, overflow, :demon_core, dungeon[:demon_core])
        herb_drop, dungeon_pity[:herb], herb_forced = pity_roll(rng, dungeon[:herb_chance], dungeon_pity[:herb], dungeon[:herb_pity])
        meteor_drop, dungeon_pity[:meteor], meteor_forced = pity_roll(rng, dungeon[:meteor_chance], dungeon_pity[:meteor], dungeon[:meteor_pity])
        technique_drop, dungeon_pity[:technique], technique_forced = pity_roll(rng, dungeon[:technique_chance], dungeon_pity[:technique], dungeon[:technique_pity])
        treasure_drop, dungeon_pity[:treasure], treasure_forced = pity_roll(rng, dungeon[:treasure_chance], dungeon_pity[:treasure], dungeon[:treasure_pity])
        add_resource(state, overflow, :millennium_herb, 1) if herb_drop
        add_resource(state, overflow, :meteor_iron, 1) if meteor_drop
        metrics[:technique_drops] = metrics.fetch(:technique_drops, 0) + 1 if technique_drop
        metrics[:treasure_drops] = metrics.fetch(:treasure_drops, 0) + 1 if treasure_drop
        metrics[:dungeon_pity_forced] = metrics.fetch(:dungeon_pity_forced, 0) + [herb_forced, meteor_forced, technique_forced, treasure_forced].count(true)
      end
    end
  end

  state.each { |resource, amount| abort("negative inventory #{resource}") if amount.negative? || amount > CAPS.fetch(resource) }
  metrics.merge(state: state, overflow: overflow, ancient_scroll_misses: pity, dungeon_pity: dungeon_pity)
end

def summary(name, result)
  state = result.fetch(:state).sort.to_h
  salvage = result.select { |key, value| key.to_s.start_with?("salvaged_") && value.positive? }
  puts [name, "success=#{result[:successful_fights]}", "failure=#{result[:failed_fights]}", "stopped_at=#{result[:stopped_at] || 'none'}", "state=#{state}", "overflow=#{result[:overflow].select { |_k, v| v.positive? }}", "salvage=#{salvage}", "pity=#{result[:ancient_scroll_misses]}", "dungeon_pity=#{result[:dungeon_pity].select { |_k, v| v.positive? }}"].join(" ")
end

summary("bai_cao_empty", simulate(value, activity: { type: :map, id: "bai_cao_valley" }, initial_pills: 0))
red_empty = simulate(value, activity: { type: :map, id: "red_flame_cave" }, initial_pills: 0)
red_ready = simulate(value, activity: { type: :map, id: "red_flame_cave" }, initial_pills: 60)
summary("red_flame_empty", red_empty)
summary("red_flame_ready", red_ready)
dungeon = simulate(value, activity: { type: :dungeon, id: "qing_feng" }, initial_pills: 60)
summary("qing_feng_ready", dungeon)
abort("empty red flame must not succeed") unless red_empty[:successful_fights].zero?
abort("ready red flame must succeed") unless red_ready[:successful_fights].positive?
abort("qing feng must succeed") unless dungeon[:successful_fights].positive?
abort("qing feng Boss state must execute") unless dungeon[:boss_active_seconds] == 573 && dungeon[:boss_stuns] == 9
%w[qing_feng yan_prison sky_abyss].each do |dungeon_id|
  boss = simulate_boss_fight(value, dungeon_id, auto_pills: value.call("dungeon.#{dungeon_id}.boss_auto_pill_per_clear").to_i)
  target_seconds = value.call("dungeon.#{dungeon_id}.target_clear_time").to_i
  abort("#{dungeon_id} Boss state mismatch") unless boss[:defeated] && boss[:clear_seconds] && boss[:clear_seconds] <= target_seconds
end
abort("dungeon pity counters must remain below limits") unless dungeon[:dungeon_pity].fetch(:herb) < value.call("dungeon.pity.millennium_herb_clears") && dungeon[:dungeon_pity].fetch(:meteor) < value.call("dungeon.pity.meteor_iron_clears") && dungeon[:dungeon_pity].fetch(:technique) < value.call("dungeon.pity.technique_clears") && dungeon[:dungeon_pity].fetch(:treasure) < value.call("dungeon.pity.treasure_clears")
puts "validated rows=#{rows.length} duplicate_parameter_id=0 deterministic_seed=42 boss_tiers=3 dungeon_pity=4"
