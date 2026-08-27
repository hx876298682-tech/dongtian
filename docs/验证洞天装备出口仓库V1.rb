#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

qualities = %w[normal fine rare epic legendary immortal]
qualities.each do |quality|
  expected = (value.call("loot.equipment.value.#{quality}") * 0.5).floor
  actual = value.call("loot.equipment.sell.spirit_stone.#{quality}")
  abort("#{quality} sale value mismatch") unless actual == expected
end

caps = (1..value.call("economy.warehouse.max_level").to_i).to_h do |level|
  [level, value.call("economy.warehouse.equipment_cap.#{level}")]
end
costs = (2..caps.keys.max).to_h { |level| [level, value.call("economy.warehouse.upgrade.spirit_stone_cost.#{level}")] }
abort("warehouse caps must increase") unless caps.values.each_cons(2).all? { |a, b| b > a }
abort("warehouse costs must increase") unless costs.values.each_cons(2).all? { |a, b| b > a }

map_id = "bai_cao_valley"
equipment_rate = 3600.0 / value.call("map.#{map_id}.target_kill_time") * value.call("map.#{map_id}.equipment_drop_chance") / 100.0
stone_rate = 3600.0 / value.call("map.#{map_id}.target_kill_time") * value.call("map.#{map_id}.spirit_stone_per_kill")
utility_slots = qualities.to_h { |quality| [quality, value.call("loot.equipment.affix.utility_slots.#{quality}").to_i] }
speed_rating = { "normal" => 0, "fine" => 0, "rare" => value.call("loot.equipment.affix.speed_rating.rare"), "epic" => value.call("loot.equipment.affix.speed_rating.epic"), "legendary" => value.call("loot.equipment.affix.speed_rating.legendary"), "immortal" => value.call("loot.equipment.affix.speed_rating.immortal") }
special_grade = { "normal" => 0, "fine" => 0, "rare" => value.call("loot.equipment.affix.special_grade.rare"), "epic" => value.call("loot.equipment.affix.special_grade.epic"), "legendary" => value.call("loot.equipment.affix.special_grade.legendary"), "immortal" => value.call("loot.equipment.affix.special_grade.immortal") }
affix_weights = { speed: value.call("loot.equipment.affix.roll_weight.speed"), element: value.call("loot.equipment.affix.roll_weight.element"), special: value.call("loot.equipment.affix.roll_weight.special") }

def expected_affix_sale(value, quality, utility_slots, speed_rating, special_grade, affix_weights)
  states = { false => { probability: 1.0, value: 0.0 }, true => { probability: 0.0, value: 0.0 } }
  utility_slots.fetch(quality).times do
    next_states = { false => { probability: 0.0, value: 0.0 }, true => { probability: 0.0, value: 0.0 } }
    states.each do |element_active, state|
      next if state[:probability].zero?
      available = element_active ? affix_weights.reject { |kind, _weight| kind == :element } : affix_weights
      total_weight = available.values.sum
      available.each do |kind, weight|
        probability = state[:probability] * weight / total_weight
        affix_value = case kind
        when :speed then speed_rating.fetch(quality) * value.call("loot.equipment.affix.sale.speed_value_per_point")
        when :element then value.call("loot.equipment.affix.sale.element_value")
        when :special then special_grade.fetch(quality) * value.call("loot.equipment.affix.sale.special_value_per_grade")
        end
        next_active = element_active || kind == :element
        next_states.fetch(next_active)[:probability] += probability
        next_states.fetch(next_active)[:value] += probability * (state[:value] / state[:probability] + affix_value)
      end
    end
    states = next_states
  end
  states.values.sum { |state| state[:value] }
end

expected_sale_value = qualities.sum do |quality|
  chance = value.call("map.#{map_id}.equipment_quality_#{quality}_chance") / 100.0
  base = value.call("loot.equipment.value.#{quality}")
  affix = expected_affix_sale(value, quality, utility_slots, speed_rating, special_grade, affix_weights)
  chance * ((base + affix) * 0.5).floor
end

def run_route(hours, equipment_rate, stone_rate, caps, costs, expected_sale_value, breakthrough_hours: [24, 48], upgrade:)
  equipment = 0.0
  stone = 0.0
  sold = 0.0
  sale_stone = 0.0
  level = 1
  breakthroughs = 0
  hours.times do |index|
    hour = index + 1
    equipment += equipment_rate
    stone += stone_rate
    if breakthrough_hours.include?(hour)
      cost = breakthroughs.zero? ? 5_000 : 20_000
      if stone >= cost
        stone -= cost
        breakthroughs += 1
      end
    end
    while upgrade && breakthroughs == 2 && level < caps.keys.max && stone >= costs.fetch(level + 1)
      stone -= costs.fetch(level + 1)
      level += 1
    end
    overflow = [equipment - caps.fetch(level), 0].max
    if overflow.positive?
      equipment -= overflow
      sold += overflow
      sale_stone += overflow * expected_sale_value
      stone += overflow * expected_sale_value if upgrade == false
    end
  end
  { level: level, equipment: equipment, stone: stone, sold: sold, sale_stone: sale_stone, breakthroughs: breakthroughs }
end

no_upgrade = run_route(168, equipment_rate, stone_rate, caps, costs, expected_sale_value, upgrade: false)
upgraded = run_route(168, equipment_rate, stone_rate, caps, costs, expected_sale_value, upgrade: true)
abort("no-upgrade route should exercise sale") unless no_upgrade[:sold].positive?
abort("upgrade route must pay both breakthroughs") unless upgraded[:breakthroughs] == 2
abort("warehouse upgrade route must reach level 4") unless upgraded[:level] >= 4
abort("equipment exceeds upgraded cap") unless upgraded[:equipment] <= caps.fetch(upgraded[:level])
abort("negative stone") unless no_upgrade[:stone] >= 0 && upgraded[:stone] >= 0

puts "map=#{map_id} equipment_per_hour=#{equipment_rate.round(4)} expected_sale_value=#{expected_sale_value.round(4)} no_upgrade_sold=#{no_upgrade[:sold].round(3)} no_upgrade_sale_stone=#{no_upgrade[:sale_stone].round(2)} upgraded_level=#{upgraded[:level]} upgraded_equipment=#{upgraded[:equipment].round(3)} upgraded_breakthroughs=#{upgraded[:breakthroughs]}"
puts "validated rows=#{rows.length} duplicate_parameter_id=0 warehouse_levels=#{caps.length} sale_formula=value_points*0.5 long_horizon=168h"
