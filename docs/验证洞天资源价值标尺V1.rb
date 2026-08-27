#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

resources = {
  "spirit_stone" => 1,
  "spirit_wood" => 2,
  "spirit_ore" => 2,
  "spirit_herb" => 2,
  "pill" => 10,
  "ancient_scroll" => 1000,
  "demon_core" => 200,
  "millennium_herb" => 100,
  "meteor_iron" => 150
}
resources.each do |resource, expected|
  abort("#{resource} value mismatch") unless value.call("economy.value.#{resource}") == expected
end

qualities = %w[normal fine rare epic legendary immortal]
expected_equipment_values = { "normal" => 50, "fine" => 80, "rare" => 130, "epic" => 220, "legendary" => 380, "immortal" => 700 }
qualities.each do |quality|
  abort("#{quality} equipment value mismatch") unless value.call("loot.equipment.value.#{quality}") == expected_equipment_values.fetch(quality)
end

expected_total = { "bai_cao_valley" => 3964, "black_wind_valley" => 3283, "red_flame_cave" => 2444 }
expected_total.each do |map_id, expected|
  actual = value.call("map.#{map_id}.value_points_per_hour").round
  abort("#{map_id}: value=#{actual}, expected=#{expected}") unless actual == expected
end
puts "validated rows=#{rows.length} duplicate_parameter_id=0 value_unit=spirit_point"
