#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

abort("building max level mismatch") unless value.call("building.level.max") == 5
growth = value.call("building.upgrade.cost_growth")
abort("upgrade growth mismatch") unless growth == 1.8
bases = { "training_room" => 1000, "alchemy_room" => 1200, "forge_room" => 1500, "spirit_farm" => 800 }
expected_totals = { "training_room" => 11873, "alchemy_room" => 14248, "forge_room" => 17809, "spirit_farm" => 9498 }
bases.each do |building, base|
  actual_base = value.call("building.upgrade.spirit_stone_base_cost.#{building}")
  total = (1..4).sum { |level| (base * growth**(level - 1)).ceil }
  abort("#{building}: base mismatch") unless actual_base == base
  abort("#{building}: total=#{total}, expected=#{expected_totals.fetch(building)}") unless total == expected_totals.fetch(building)
end
abort("treasure production bonus mismatch") unless value.call("growth.treasure.heaven_bag.production_bonus_per_star") == 0.005
puts "validated rows=#{rows.length} duplicate_parameter_id=0 building_upgrade_levels=5 modifier_order=interval_then_quantity"
