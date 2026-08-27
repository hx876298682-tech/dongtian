#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

alchemy_output = value.call("building.alchemy_room.output_per_action") * value.call("building.alchemy_room.base_interval")
alchemy_per_hour = 3600.0 / value.call("building.alchemy_room.base_interval") * value.call("building.alchemy_room.output_per_action")
abort("unexpected alchemy rate=#{alchemy_per_hour}") unless alchemy_per_hour == 120

stone_enhance = (0...10).sum { |level| (value.call("loot.equipment.enhancement.spirit_stone_base_cost") * value.call("loot.equipment.enhancement.spirit_stone_growth")**level).ceil }
ore_enhance = (0...10).sum { |level| (value.call("loot.equipment.enhancement.spirit_ore_base_cost") * value.call("loot.equipment.enhancement.material_growth")**level).ceil }
wood_enhance = (0...10).sum { |level| (value.call("loot.equipment.enhancement.spirit_wood_base_cost") * value.call("loot.equipment.enhancement.material_growth")**level).ceil }
abort("enhancement total mismatch") unless [stone_enhance, ore_enhance, wood_enhance] == [1096, 37, 37]

maps = {
  "bai_cao_valley" => [30, 600, 120, 120],
  "black_wind_valley" => [90, 800, 80, 80],
  "red_flame_cave" => [240, 900, 60, 60]
}

maps.each do |map_id, (kill_seconds, stone_per_hour, ore_per_hour, wood_per_hour)|
  kills = 3600.0 / kill_seconds
  scrolls = value.call("map.#{map_id}.ancient_scroll_effective_per_hour")
  qi_stone_hours = value.call("breakthrough.qi_to_foundation.spirit_stone_cost") / stone_per_hour
  qi_scroll_hours = value.call("breakthrough.qi_to_foundation.scroll_cost") / scrolls
  core_stone_hours = value.call("breakthrough.foundation_to_core.spirit_stone_cost") / stone_per_hour
  core_scroll_hours = value.call("breakthrough.foundation_to_core.scroll_cost") / scrolls
  stone_hours = stone_enhance.to_f / stone_per_hour
  ore_hours = ore_enhance.to_f / ore_per_hour
  wood_hours = wood_enhance.to_f / wood_per_hour
  puts [map_id, "qi_hours=#{format("%.2f", [qi_stone_hours, qi_scroll_hours].max)}",
        "core_hours=#{format("%.2f", [core_stone_hours, core_scroll_hours].max)}",
        "enhance_hours=#{format("%.2f", stone_hours)}", "material_hours=#{format("%.2f", [ore_hours, wood_hours].max)}"].join(" ")
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 alchemy_per_hour=#{alchemy_per_hour}"
