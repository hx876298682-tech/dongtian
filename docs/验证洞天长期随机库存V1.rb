#!/usr/bin/env ruby

require "csv"

ROOT = __dir__
rows = CSV.read(File.join(ROOT, "洞天数值参数表.csv"), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

QUALITIES = %w[normal fine rare epic legendary immortal].freeze
MAPS = %w[bai_cao_valley black_wind_valley red_flame_cave].freeze
RUNS = 50
HORIZONS = [2_160, 6_480].freeze

BASE_CAPS = {
  spirit_stone: value.call("economy.inventory.cap.spirit_stone"),
  spirit_ore: value.call("economy.inventory.cap.spirit_ore"),
  spirit_wood: value.call("economy.inventory.cap.spirit_wood"),
  equipment: value.call("economy.inventory.cap.equipment")
}.freeze

def realm_for_hour(hour, value)
  return "core" if hour <= 168
  return "nascent_soul" if hour <= value.call("schedule.long_horizon.thirty_day_hours")
  return "divine_transformation" if hour <= value.call("schedule.long_horizon.ninety_day_hours")

  "void_refining"
end

def activity_for_hour(hour)
  return "bai_cao_valley" if hour <= 48
  return "black_wind_valley" if hour <= 168

  # 75% high-tier expedition, one 25% support hour per four-hour cycle.
  ((hour - 169) % 4).zero? ? "black_wind_valley" : "high_tier"
end

def add_resource(state, overflow, value, resource, amount, realm)
  cap = BASE_CAPS.fetch(resource) * value.call("economy.inventory.cap_multiplier.#{realm}")
  before = state.fetch(resource, 0.0)
  state[resource] = [before + amount, cap].min
  overflow[resource] += [before + amount - cap, 0.0].max
end

def weighted_quality(rng, value, map_id)
  roll = rng.rand * 100.0
  cumulative = 0.0
  QUALITIES.each do |quality|
    cumulative += value.call("map.#{map_id}.equipment_quality_#{quality}_chance")
    return quality if roll < cumulative
  end
  QUALITIES.last
end

def add_equipment(state, overflow, metrics, value, quality, realm, warehouse_level, rng, exit_policy: :retain_rare)
  base_cap = value.call("economy.warehouse.equipment_cap.#{warehouse_level}")
  cap = base_cap * value.call("economy.warehouse.equipment_cap_multiplier.#{realm}")
  if state[:equipment] < cap
    state[:equipment] += 1
    return
  end

  salvage_low = exit_policy == :retain_rare && %w[normal fine].include?(quality) && value.call("loot.equipment.auto_salvage.#{quality}_enabled") == 1
  if salvage_low
    ore = value.call("loot.equipment.salvage.#{quality}.spirit_ore")
    wood = value.call("loot.equipment.salvage.#{quality}.spirit_wood")
    add_resource(state, overflow, value, :spirit_ore, ore, realm)
    add_resource(state, overflow, value, :spirit_wood, wood, realm)
    metrics["salvaged_#{quality}".to_sym] += 1
    metrics[:salvage_ore] += ore
    metrics[:salvage_wood] += wood
  else
    # Sale is intentionally applied only after the warehouse is full. This
    # preserves rare equipment while preventing unbounded inventory growth.
    metrics[:sold] += 1
    sale = value.call("loot.equipment.sell.spirit_stone.#{quality}")
    add_resource(state, overflow, value, :spirit_stone, sale, realm)
    metrics[:sale_stone] += sale
  end
  metrics[:equipment_rolls] += 1
end

def simulate(value, horizon, seed, exit_policy: :retain_rare)
  rng = Random.new(seed)
  state = Hash.new(0.0)
  overflow = Hash.new(0.0)
  metrics = Hash.new(0.0)
  warehouse_level = 1
  base_caps = (1..value.call("economy.warehouse.max_level").to_i).to_h do |level|
    [level, value.call("economy.warehouse.equipment_cap.#{level}")]
  end
  upgrade_costs = (2..base_caps.keys.max).to_h do |level|
    [level, value.call("economy.warehouse.upgrade.spirit_stone_cost.#{level}")]
  end

  (1..horizon).each do |hour|
    realm = realm_for_hour(hour, value)
    activity = activity_for_hour(hour)
    if activity == "high_tier"
      target = realm == "nascent_soul" ? "nascent_soul" : realm == "divine_transformation" ? "divine_transformation" : "void_refining"
      add_resource(state, overflow, value, :spirit_stone, value.call("dungeon.high_tier.#{target}.spirit_stone_per_hour"), realm)
    else
      map = activity
      kills = 3600.0 / value.call("map.#{map}.target_kill_time")
      add_resource(state, overflow, value, :spirit_stone, kills * value.call("map.#{map}.spirit_stone_per_kill"), realm)
      add_resource(state, overflow, value, :spirit_ore, kills * value.call("map.#{map}.spirit_ore_per_kill"), realm)
      add_resource(state, overflow, value, :spirit_wood, kills * value.call("map.#{map}.spirit_wood_per_kill"), realm)
      drops = (kills * value.call("map.#{map}.equipment_drop_chance") / 100.0)
      whole = drops.floor
      whole.times { add_equipment(state, overflow, metrics, value, weighted_quality(rng, value, map), realm, warehouse_level, rng, exit_policy: exit_policy) }
      add_equipment(state, overflow, metrics, value, weighted_quality(rng, value, map), realm, warehouse_level, rng, exit_policy: exit_policy) if rng.rand < drops - whole
      metrics[:map_equipment_drops] += drops
    end

    # Forge is resource-limited: ore/wood/stone earned by the activity are
    # consumed in the same hourly settlement after incoming drops are rolled.
    nominal = value.call("building.forge_room.output_per_action") * 3600.0 / value.call("building.forge_room.base_interval")
    batches = [nominal, state[:spirit_ore] / value.call("recipe.forge_basic.ore_cost"), state[:spirit_wood] / value.call("recipe.forge_basic.wood_cost"), state[:spirit_stone] / value.call("recipe.forge_basic.stone_cost")].min
    state[:spirit_ore] -= batches * value.call("recipe.forge_basic.ore_cost")
    state[:spirit_wood] -= batches * value.call("recipe.forge_basic.wood_cost")
    state[:spirit_stone] -= batches * value.call("recipe.forge_basic.stone_cost")
    batches.to_i.times { add_equipment(state, overflow, metrics, value, "normal", realm, warehouse_level, rng, exit_policy: exit_policy) }
    metrics[:forge_equipment] += batches

    while warehouse_level < base_caps.keys.max && state[:spirit_stone] >= upgrade_costs.fetch(warehouse_level + 1)
      state[:spirit_stone] -= upgrade_costs.fetch(warehouse_level + 1)
      warehouse_level += 1
      metrics[:upgrades] += 1
    end
    cap = base_caps.fetch(warehouse_level) * value.call("economy.warehouse.equipment_cap_multiplier.#{realm}")
    abort("forced equipment overflow at #{hour}h") if state[:equipment] > cap + 1e-9
    metrics[:max_ratio] = [metrics[:max_ratio], state[:equipment] / cap].max
  end

  { state: state, overflow: overflow, metrics: metrics, warehouse_level: warehouse_level }
end

if __FILE__ == $PROGRAM_NAME
  HORIZONS.each do |horizon|
    results = RUNS.times.map { |index| simulate(value, horizon, 120_000 + horizon + index * 97) }
    abort("#{horizon}h warehouse did not reach level 4") unless results.all? { |result| result[:warehouse_level] >= 4 }
    max_ratio = results.map { |result| result[:metrics][:max_ratio] }
    mean_ratio = max_ratio.sum / max_ratio.length
    mean_sold = results.sum { |result| result[:metrics][:sold] } / results.length
    mean_forge = results.sum { |result| result[:metrics][:forge_equipment] } / results.length
    puts "horizon=#{horizon}h warehouse_min=#{results.map { |r| r[:warehouse_level] }.min} mean_max_occupancy_ratio=#{mean_ratio.round(4)} max_max_occupancy_ratio=#{max_ratio.max.round(4)} mean_sold=#{mean_sold.round(2)} mean_forge_equipment=#{mean_forge.round(2)}"
  end

  puts "validated rows=#{rows.length} duplicate_parameter_id=0 runs=#{RUNS} horizons=#{HORIZONS.join('/')} random_equipment=map+forge auto_salvage=supported sale=full warehouse_realm_capacity=checked"
end
