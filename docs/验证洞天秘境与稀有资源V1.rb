#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

expected = {
  "qing_feng" => [600, 2, 2, 1, 20, 10, 5, 1],
  "yan_prison" => [1200, 5, 18, 2, 35, 20, 10, 3],
  "sky_abyss" => [2400, 10, 84, 4, 50, 35, 20, 8]
}

expected.each do |dungeon, (seconds, entry_pill, auto_pill, demon_core, herb_chance, meteor_chance, technique_chance, treasure_chance)|
  actual_seconds = value.call("dungeon.#{dungeon}.target_clear_time")
  abort("#{dungeon}: clear time mismatch") unless actual_seconds == seconds
  fields = {
    "pill_cost" => entry_pill,
    "boss_auto_pill_per_clear" => auto_pill,
    "demon_core_per_clear" => demon_core,
    "millennium_herb_chance" => herb_chance,
    "meteor_iron_chance" => meteor_chance,
    "technique_drop_chance" => technique_chance,
    "treasure_drop_chance" => treasure_chance
  }
  fields.each do |field, expected_value|
    abort("#{dungeon}: #{field} mismatch") unless value.call("dungeon.#{dungeon}.#{field}") == expected_value
  end
  abort("#{dungeon}: chance over 100") unless fields.values_at("millennium_herb_chance", "meteor_iron_chance", "technique_drop_chance", "treasure_drop_chance").all? { |chance| chance.between?(0, 100) }
  clears = 3600.0 / seconds
  puts [dungeon, "clears_per_hour=#{clears}", "pill_per_hour=#{clears * (entry_pill + auto_pill)}", "demon_core_per_hour=#{clears * demon_core}"].join(" ")
end

abort("demon core cap mismatch") unless value.call("economy.inventory.cap.demon_core") == 100
abort("millennium herb cap mismatch") unless value.call("economy.inventory.cap.millennium_herb") == 100
abort("meteor iron cap mismatch") unless value.call("economy.inventory.cap.meteor_iron") == 100
puts "validated rows=#{rows.length} duplicate_parameter_id=0 dungeon_tiers=3"
