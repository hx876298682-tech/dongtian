#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

elements = %w[metal wood earth water fire]
cycle = { "metal" => "wood", "wood" => "earth", "earth" => "water", "water" => "fire", "fire" => "metal" }
elements.each do |attacker|
  target = cycle.fetch(attacker)
  attack_multiplier = value.call("combat.element.counter_damage_multiplier")
  defence_multiplier = value.call("combat.element.counter_resistance_multiplier")
  abort("counter mismatch #{attacker}->#{target}") unless attack_multiplier == 1.25 && defence_multiplier == 0.8
end
abort("neutral player baseline mismatch") unless value.call("combat.player.element_neutral") == 1
%w[bai_cao_valley black_wind_valley red_flame_cave].each do |map_id|
  element = by_id.fetch("map.#{map_id}.enemy_element")["value"]
  abort("unknown map element #{element}") unless elements.include?(element)
end
puts "validated rows=#{rows.length} duplicate_parameter_id=0 element_cycle=5 neutral_baseline=1"
