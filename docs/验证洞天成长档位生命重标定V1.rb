#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

profile_attack = value.call("combat.player.base_attack") +
  value.call("growth.technique.attack_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer") +
  value.call("growth.treasure.qing_lian_lamp.attack_per_star") * value.call("growth.treasure.max_stars")
abort("growth profile attack=#{profile_attack}") unless profile_attack == 325.0

dps = lambda do |enemy_defence|
  profile_attack * value.call("combat.damage.base_coefficient") * 100.0 / (100.0 + enemy_defence) * 0.75 / value.call("combat.player.base_attack_interval")
end

maps = {
  "bai_cao_valley" => [30, 30],
  "black_wind_valley" => [90, 70],
  "red_flame_cave" => [240, 120]
}
maps.each do |id, (target_seconds, enemy_defence)|
  actual_dps = dps.call(enemy_defence)
  expected_hp = (actual_dps * target_seconds).round
  hp = value.call("map.#{id}.growth_profile.earth100_lamp10_enemy_effective_hp")
  baseline_hp = value.call("map.#{id}.enemy_effective_hp")
  abort("#{id} growth hp mismatch") unless hp == expected_hp
  abort("#{id} growth hp must exceed baseline") unless hp > baseline_hp
  abort("#{id} growth target overshoot") unless hp / actual_dps <= target_seconds + 0.05
  puts [id, "dps=#{actual_dps.round(4)}", "hp=#{hp.to_i}", "target_seconds=#{target_seconds}", "kill_seconds=#{(hp / actual_dps).round(3)}"].join(" ")
end

active_seconds = { "qing_feng" => 573, "yan_prison" => 1143, "sky_abyss" => 2283 }
barrier = 1 + value.call("combat.boss.initial_barrier_percent") / 100.0
active_seconds.each do |id, active|
  expected_hp = (dps.call(30) * active / barrier).floor
  hp = value.call("dungeon.#{id}.boss_base_hp.growth_profile.earth100_lamp10")
  baseline_hp = value.call("dungeon.#{id}.boss_base_hp")
  abort("#{id} growth Boss hp mismatch") unless hp == expected_hp
  abort("#{id} growth Boss hp must exceed baseline") unless hp > baseline_hp
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 growth_profile=earth100_lamp10 map_tiers=3 boss_tiers=3"
