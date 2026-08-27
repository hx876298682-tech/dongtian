#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

counter = { "metal" => "wood", "wood" => "earth", "earth" => "water", "water" => "fire", "fire" => "metal" }
element_multiplier = lambda do |attacker, defender|
  next 1.0 if attacker == "neutral" || defender == "neutral" || attacker == defender
  next value.call("combat.element.counter_damage_multiplier") if counter.fetch(attacker) == defender
  next value.call("combat.element.counter_resistance_multiplier") if counter.fetch(defender) == attacker
  1.0
end

technique_quality = value.call("growth.technique.quality_multiplier.earth")
technique_layer = value.call("growth.technique.max_layer")
technique_defence = value.call("growth.technique.defence_per_layer") * technique_quality * technique_layer
technique_health = value.call("growth.technique.health_per_layer") * technique_quality * technique_layer
treasure_defence = value.call("growth.treasure.shan_he_seal.defence_per_star") * value.call("growth.treasure.max_stars")
profiles = {
  "base_neutral" => [value.call("combat.player.base_defence"), value.call("combat.player.base_health"), "neutral"],
  "earth100_neutral" => [value.call("combat.player.base_defence") + technique_defence, value.call("combat.player.base_health") + technique_health, "neutral"],
  "earth100_seal10_neutral" => [value.call("combat.player.base_defence") + technique_defence + treasure_defence, value.call("combat.player.base_health") + technique_health, "neutral"],
  "earth100_seal10_water" => [value.call("combat.player.base_defence") + technique_defence + treasure_defence, value.call("combat.player.base_health") + technique_health, "water"]
}
maps = {
  "bai_cao_valley" => [50, 80, 30, "wood"],
  "black_wind_valley" => [100, 100, 90, "earth"],
  "red_flame_cave" => [200, 120, 240, "fire"]
}

profiles.each do |profile, (defence, health, element)|
  results = maps.map do |map_id, (enemy_attack, enemy_accuracy, kill_seconds, enemy_element)|
    hit_chance = enemy_accuracy >= value.call("combat.player.base_evasion") ?
      1 - value.call("combat.player.base_evasion") / (2.0 * enemy_accuracy) :
      enemy_accuracy / (2.0 * value.call("combat.player.base_evasion"))
    damage_per_hit = enemy_attack * value.call("combat.damage.base_coefficient") * 100.0 / (100.0 + defence)
    incoming_dps = damage_per_hit * hit_chance * element_multiplier.call(enemy_element, element) / value.call("combat.enemy.base_attack_interval")
    damage = incoming_dps * kill_seconds
    pills = [(damage - health * (1 - value.call("combat.pill.auto_use_threshold_percent") / 100.0)) / value.call("combat.pill.heal_per_use"), 0].max.ceil
    [map_id, pills, pills * 3600.0 / kill_seconds]
  end
  abort("#{profile} has invalid pill cost") unless results.all? { |_map, pills, per_hour| pills >= 0 && per_hour >= 0 }
  abort("base red flame baseline changed") if profile == "base_neutral" && results.fetch(2).fetch(1) != 4
  abort("#{profile} must not increase red flame pills over base") if profile != "base_neutral" && results.fetch(2).fetch(1) > 4
  puts [profile, results.map { |map, pills, per_hour| "#{map}=#{pills}/#{per_hour.round(2)}" }.join(" ")].join(" ")
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 profiles=#{profiles.length} maps=#{maps.length} survival=connected"
