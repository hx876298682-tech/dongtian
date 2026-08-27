#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

REALMS = %w[core nascent_soul divine_transformation void_refining].freeze
MAP_FOR_HOUR = lambda do |hour|
  hour <= 48 ? "bai_cao_valley" : hour <= 720 ? "black_wind_valley" : "red_flame_cave"
end
REALM_FOR_HOUR = lambda do |hour|
  hour <= 168 ? "core" : hour <= 720 ? "nascent_soul" : hour <= 2160 ? "divine_transformation" : "void_refining"
end
QUALITIES = %w[normal fine rare epic legendary immortal].freeze
RUNS = 100

def weighted_quality(rng, chances)
  roll = rng.rand * 100.0
  cumulative = 0.0
  chances.each_with_index do |chance, index|
    cumulative += chance
    return index if roll < cumulative
  end
  chances.length - 1
end

def simulate(value, horizon, seed)
  rng = Random.new(seed)
  warehouse_level = 1
  equipment = 0
  spirit_stone = 0.0
  sold = 0
  salvaged = Hash.new(0)
  forced_overflow = 0
  max_ratio = 0.0
  upgrades = []
  base_caps = (1..value.call("economy.warehouse.max_level").to_i).to_h { |level| [level, value.call("economy.warehouse.equipment_cap.#{level}")] }
  upgrade_costs = (2..base_caps.keys.max).to_h { |level| [level, value.call("economy.warehouse.upgrade.spirit_stone_cost.#{level}")] }

  (1..horizon).each do |hour|
    map = MAP_FOR_HOUR.call(hour)
    realm = REALM_FOR_HOUR.call(hour)
    multiplier = value.call("economy.warehouse.equipment_cap_multiplier.#{realm}")
    cap = base_caps.fetch(warehouse_level) * multiplier
    kills = (3600.0 / value.call("map.#{map}.target_kill_time")).floor
    stone_per_kill = value.call("map.#{map}.spirit_stone_per_kill")
    quality_chances = QUALITIES.map { |quality| value.call("map.#{map}.equipment_quality_#{quality}_chance") }
    kills.times do
      spirit_stone += stone_per_kill
      next unless rng.rand < value.call("map.#{map}.equipment_drop_chance") / 100.0
      quality = QUALITIES.fetch(weighted_quality(rng, quality_chances))
      if equipment < cap
        equipment += 1
      elsif %w[normal fine].include?(quality)
        salvaged[quality] += 1
      else
        sold += 1
        spirit_stone += value.call("loot.equipment.sell.spirit_stone.#{quality}")
      end
    end

    while warehouse_level < base_caps.keys.max && spirit_stone >= upgrade_costs.fetch(warehouse_level + 1)
      spirit_stone -= upgrade_costs.fetch(warehouse_level + 1)
      warehouse_level += 1
      upgrades << [hour, warehouse_level]
    end
    cap = base_caps.fetch(warehouse_level) * multiplier
    if equipment > cap
      forced_overflow += equipment - cap
      equipment = cap
    end
    max_ratio = [max_ratio, equipment.to_f / cap].max
  end
  { warehouse_level: warehouse_level, equipment: equipment, sold: sold, salvaged: salvaged, forced_overflow: forced_overflow, max_ratio: max_ratio, upgrades: upgrades }
end

abort("warehouse realm multipliers must increase") unless REALMS.map { |realm| value.call("economy.warehouse.equipment_cap_multiplier.#{realm}") }.each_cons(2).all? { |a, b| b > a }
[720, 2160, 6480].each do |horizon|
  results = RUNS.times.map { |seed| simulate(value, horizon, 91_000 + seed * 43 + horizon) }
  abort("#{horizon}h warehouse level did not reach 5") unless results.all? { |result| result[:warehouse_level] == 5 }
  abort("#{horizon}h forced warehouse overflow") unless results.all? { |result| result[:forced_overflow].zero? }
  mean_sold = results.sum { |result| result[:sold] }.to_f / results.length
  mean_ratio = results.sum { |result| result[:max_ratio] }.to_f / results.length
  puts "horizon=#{horizon}h warehouse_level=5 mean_sold=#{mean_sold.round(2)} mean_max_occupancy_ratio=#{mean_ratio.round(4)}"
end
puts "validated rows=#{rows.length} duplicate_parameter_id=0 horizons=720/2160/6480 warehouse_realm_multipliers=1/4/16/64 overflow=0"
