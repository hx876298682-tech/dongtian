#!/usr/bin/env ruby

require "csv"

parameter_file = File.expand_path("洞天数值参数表.csv", __dir__)
rows = CSV.read(parameter_file, headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

player_defence = value.call("combat.player.base_defence")
player_health = value.call("combat.player.base_health")
player_evasion = value.call("combat.player.base_evasion")
enemy_interval = value.call("combat.enemy.base_attack_interval")
coefficient = value.call("combat.damage.base_coefficient")
threshold = value.call("combat.pill.auto_use_threshold_percent") / 100.0
heal = value.call("combat.pill.heal_per_use")

maps = {
  "bai_cao_valley" => [50, 80, 30],
  "black_wind_valley" => [100, 100, 90],
  "red_flame_cave" => [200, 120, 240]
}

maps.each do |map_id, (enemy_attack, enemy_accuracy, kill_seconds)|
  hit_chance = if enemy_accuracy >= player_evasion
                 1 - player_evasion / (2.0 * enemy_accuracy)
               else
                 enemy_accuracy / (2.0 * player_evasion)
               end
  damage_per_hit = enemy_attack * coefficient * 100.0 / (100.0 + player_defence)
  incoming_dps = damage_per_hit * hit_chance / enemy_interval
  damage = incoming_dps * kill_seconds
  pills = [(damage - player_health * (1 - threshold)) / heal, 0].max.ceil
  expected = value.call("map.#{map_id}.pill_per_fight")
  abort("#{map_id}: pill_per_fight=#{pills}, expected=#{expected}") unless pills == expected
  pills_per_hour = pills * 3600.0 / kill_seconds
  puts [map_id, "incoming_dps=#{format("%.4f", incoming_dps)}", "damage=#{format("%.2f", damage)}",
        "pill_per_fight=#{pills}", "pill_per_hour=#{format("%.2f", pills_per_hour)}"].join(" ")
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0"
