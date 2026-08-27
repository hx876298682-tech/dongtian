#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

counter = {
  "metal" => "wood",
  "wood" => "earth",
  "earth" => "water",
  "water" => "fire",
  "fire" => "metal"
}.freeze

element_multiplier = lambda do |attacker, defender|
  next 1.0 if attacker == "neutral" || defender == "neutral" || attacker == defender
  next value.call("combat.element.counter_damage_multiplier") if counter.fetch(attacker) == defender

  counter.fetch(defender) == attacker ? value.call("combat.element.counter_resistance_multiplier") : 1.0
end

def technique_stats(value, quality, layer)
  multiplier = value.call("growth.technique.quality_multiplier.#{quality}")
  {
    attack: value.call("growth.technique.attack_per_layer") * multiplier * layer,
    defence: value.call("growth.technique.defence_per_layer") * multiplier * layer,
    health: value.call("growth.technique.health_per_layer") * multiplier * layer,
    cultivation_multiplier: 1 + value.call("growth.technique.cultivation_rate_bonus_per_layer") * multiplier * layer
  }
end

def dps(value, attack:, enemy_defence:, enemy_element:, player_element:, speed: 0)
  interval = [value.call("combat.speed.min_attack_interval"), value.call("combat.player.base_attack_interval") / (1 + speed / 100.0)].max
  hit = 0.75
  multiplier = if player_element == "neutral" || player_element == enemy_element
    1.0
  else
    cycle = { "metal" => "wood", "wood" => "earth", "earth" => "water", "water" => "fire", "fire" => "metal" }
    player_element == cycle.fetch(enemy_element) ? value.call("combat.element.counter_resistance_multiplier") :
      cycle.fetch(player_element) == enemy_element ? value.call("combat.element.counter_damage_multiplier") : 1.0
  end
  attack * value.call("combat.damage.base_coefficient") * 100.0 / (100.0 + enemy_defence) * hit * multiplier / interval
end

technique = technique_stats(value, "earth", value.call("growth.technique.max_layer").to_i)
treasure_attack = value.call("growth.treasure.qing_lian_lamp.attack_per_star") * value.call("growth.treasure.max_stars").to_i
attack = value.call("combat.player.base_attack") + technique[:attack] + treasure_attack
baseline = dps(value, attack: value.call("combat.player.base_attack"), enemy_defence: value.call("map.bai_cao_valley.enemy_defence"), enemy_element: "wood", player_element: "neutral")
enhanced = dps(value, attack: attack, enemy_defence: value.call("map.bai_cao_valley.enemy_defence"), enemy_element: "wood", player_element: "neutral")
countered = dps(value, attack: attack, enemy_defence: value.call("map.bai_cao_valley.enemy_defence"), enemy_element: "wood", player_element: "metal")
baseline_kill = value.call("map.bai_cao_valley.enemy_effective_hp") / baseline
enhanced_kill = value.call("map.bai_cao_valley.enemy_effective_hp") / enhanced
countered_kill = value.call("map.bai_cao_valley.enemy_effective_hp") / countered

abort("technique layer mismatch") unless technique[:attack] == 105.0 && technique[:health] == 1050.0
abort("treasure attack mismatch") unless treasure_attack == 100
abort("neutral element mismatch") unless element_multiplier.call("neutral", "wood") == 1.0
abort("counter element mismatch") unless element_multiplier.call("metal", "wood") == 1.25 && element_multiplier.call("wood", "metal") == 0.8
abort("growth must improve DPS") unless enhanced > baseline && countered > enhanced
puts "validated rows=#{rows.length} duplicate_parameter_id=0 technique_attack=#{technique[:attack]} treasure_attack=#{treasure_attack} baseline_dps=#{baseline.round(4)} enhanced_dps=#{enhanced.round(4)} countered_dps=#{countered.round(4)} kill_seconds=#{[baseline_kill, enhanced_kill, countered_kill].map { |n| n.round(2) }.join('/') } cultivation_multiplier=#{technique[:cultivation_multiplier].round(4)}"
