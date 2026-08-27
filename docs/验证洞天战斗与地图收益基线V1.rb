#!/usr/bin/env ruby

require "csv"

parameter_file = File.expand_path("洞天数值参数表.csv", __dir__)
rows = CSV.read(parameter_file, headers: true)
by_id = rows.to_h { |row| [row["parameter_id"], row] }
duplicates = rows.map { |row| row["parameter_id"] }.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?

value = ->(id) { Float(by_id.fetch(id)["value"]) }
attack = value.call("combat.player.base_attack")
accuracy = value.call("combat.player.base_accuracy")
interval = value.call("combat.player.base_attack_interval")
coefficient = value.call("combat.damage.base_coefficient")

maps = {
  "bai_cao_valley" => [260, 30, 50, 30],
  "black_wind_valley" => [596, 70, 50, 90],
  "red_flame_cave" => [1227, 120, 50, 240]
}

maps.each do |map_id, (effective_hp, defence, evasion, target_seconds)|
  hit_chance = if accuracy >= evasion
                 1 - evasion / (2.0 * accuracy)
               else
                 accuracy / (2.0 * evasion)
               end
  damage_per_hit = attack * coefficient * 100.0 / (100.0 + defence)
  dps = damage_per_hit * hit_chance / interval
  kill_seconds = (effective_hp / dps).ceil
  abort("#{map_id}: kill time #{kill_seconds}s outside target #{target_seconds}s") unless (kill_seconds - target_seconds).abs <= 1

  kills_per_hour = 3600.0 / target_seconds
  stone = value.call("map.#{map_id}.spirit_stone_per_kill") * kills_per_hour
  ore = value.call("map.#{map_id}.spirit_ore_per_kill") * kills_per_hour
  wood = value.call("map.#{map_id}.spirit_wood_per_kill") * kills_per_hour
  equipment_chance = value.call("map.#{map_id}.equipment_drop_chance")
  equipment = kills_per_hour * equipment_chance / 100.0

  puts [map_id, "hit=#{format("%.4f", hit_chance)}", "dps=#{format("%.4f", dps)}",
        "kill_seconds=#{kill_seconds}", "stone_per_hour=#{format("%.2f", stone)}",
        "ore_per_hour=#{format("%.2f", ore)}", "wood_per_hour=#{format("%.2f", wood)}",
        "equipment_per_hour=#{format("%.2f", equipment)}"].join(" ")
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0"
