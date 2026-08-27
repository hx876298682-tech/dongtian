#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

CAPS = {
  spirit_stone: value.call("economy.inventory.cap.spirit_stone"),
  spirit_wood: value.call("economy.inventory.cap.spirit_wood"),
  spirit_ore: value.call("economy.inventory.cap.spirit_ore"),
  pill: value.call("economy.inventory.cap.pill"),
  ancient_scroll: value.call("economy.inventory.cap.ancient_scroll"),
  equipment: value.call("economy.inventory.cap.equipment"),
  demon_core: value.call("economy.inventory.cap.demon_core"),
  millennium_herb: value.call("economy.inventory.cap.millennium_herb"),
  meteor_iron: value.call("economy.inventory.cap.meteor_iron")
}.freeze

def credit(state, overflow, resource, amount)
  before = state[resource]
  cap = CAPS.fetch(resource)
  state[resource] = [before + amount, cap].min
  overflow[resource] += [before + amount - cap, 0].max
end

def simulate_map(value, map_id, hours: 168)
  state = Hash.new(0.0)
  overflow = Hash.new(0.0)
  breakthrough_hours = [24, 48]
  breakthroughs = 0
  failed_breakthroughs = []
  kills_per_hour = 3600.0 / value.call("map.#{map_id}.target_kill_time")
  pill_net = value.call("building.alchemy_room.output_per_action") * 3600.0 / value.call("building.alchemy_room.base_interval") - value.call("map.#{map_id}.pill_per_hour")
  rates = {
    spirit_stone: kills_per_hour * value.call("map.#{map_id}.spirit_stone_per_kill"),
    spirit_ore: kills_per_hour * value.call("map.#{map_id}.spirit_ore_per_kill"),
    spirit_wood: kills_per_hour * value.call("map.#{map_id}.spirit_wood_per_kill"),
    ancient_scroll: value.call("map.#{map_id}.ancient_scroll_effective_per_hour"),
    equipment: kills_per_hour * value.call("map.#{map_id}.equipment_drop_chance") / 100.0,
    pill: pill_net
  }

  (1..hours).each do |hour|
    rates.each { |resource, amount| credit(state, overflow, resource, amount) }
    next unless breakthrough_hours.include?(hour)

    costs = if hour == 24
      { spirit_stone: value.call("breakthrough.qi_to_foundation.spirit_stone_cost"), pill: value.call("breakthrough.qi_to_foundation.pill_cost"), ancient_scroll: value.call("breakthrough.qi_to_foundation.scroll_cost") }
    else
      { spirit_stone: value.call("breakthrough.foundation_to_core.spirit_stone_cost"), pill: value.call("breakthrough.foundation_to_core.pill_cost"), ancient_scroll: value.call("breakthrough.foundation_to_core.scroll_cost") }
    end
    if costs.all? { |resource, amount| state.fetch(resource) >= amount }
      costs.each { |resource, amount| state[resource] -= amount }
      breakthroughs += 1
    else
      failed_breakthroughs << hour
    end
  end
  { state: state, overflow: overflow, breakthroughs: breakthroughs, failed_breakthroughs: failed_breakthroughs, rates: rates }
end

def simulate_dungeon(value, dungeon_id, hours: 168)
  state = Hash.new(0.0)
  overflow = Hash.new(0.0)
  clears_per_hour = 3600.0 / value.call("dungeon.#{dungeon_id}.target_clear_time")
  rates = {
    pill: value.call("building.alchemy_room.output_per_action") * 3600.0 / value.call("building.alchemy_room.base_interval") - clears_per_hour * (value.call("dungeon.#{dungeon_id}.pill_cost") + value.call("dungeon.#{dungeon_id}.boss_auto_pill_per_clear")),
    demon_core: clears_per_hour * value.call("dungeon.#{dungeon_id}.demon_core_per_clear"),
    millennium_herb: clears_per_hour * value.call("dungeon.#{dungeon_id}.millennium_herb_chance") / 100.0,
    meteor_iron: clears_per_hour * value.call("dungeon.#{dungeon_id}.meteor_iron_chance") / 100.0,
    technique: clears_per_hour * value.call("dungeon.#{dungeon_id}.technique_drop_chance") / 100.0,
    treasure: clears_per_hour * value.call("dungeon.#{dungeon_id}.treasure_drop_chance") / 100.0
  }
  (1..hours).each do
    rates.each do |resource, amount|
      if CAPS.key?(resource)
        credit(state, overflow, resource, amount)
      else
        state[resource] += amount
      end
    end
  end
  { state: state, overflow: overflow, rates: rates }
end

%w[bai_cao_valley black_wind_valley red_flame_cave].each do |map_id|
  result = simulate_map(value, map_id)
  abort("#{map_id} must pay both breakthroughs") unless result[:breakthroughs] == 2 && result[:failed_breakthroughs].empty?
  puts [map_id, "breakthroughs=#{result[:breakthroughs]}", "state=#{result[:state].sort.to_h}", "overflow=#{result[:overflow].select { |_k, v| v.positive? }}"].join(" ")
end

dungeon = simulate_dungeon(value, "qing_feng")
abort("dungeon route must not invent ancient scrolls") if dungeon[:state].key?(:ancient_scroll)
puts ["qing_feng", "state=#{dungeon[:state].sort.to_h}", "overflow=#{dungeon[:overflow].select { |_k, v| v.positive? }}"].join(" ")
puts "validated rows=#{rows.length} duplicate_parameter_id=0 horizon=168h breakthrough_schedule=24/48 dungeon_scroll_source=none"
