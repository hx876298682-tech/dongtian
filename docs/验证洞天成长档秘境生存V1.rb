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

extension_effect = lambda do |realm, object_id, field, stars|
  archetype = by_id.fetch("growth.treasure.extension_pool.#{realm}.#{object_id}.archetype")["value"]
  base = value.call("growth.treasure.extension_archetype.#{archetype}.#{field}_per_star")
  scale = value.call("growth.treasure.extension_pool.#{realm}.effect_scale")
  base * scale * stars
end

profiles = {
  "base" => {
    attack: value.call("combat.player.base_attack"),
    defence: value.call("combat.player.base_defence"),
    health: value.call("combat.player.base_health"),
    element: "neutral",
    apply_outgoing_element: false,
    hp_suffix: ""
  },
  "earth100_seal10" => {
    attack: value.call("combat.player.base_attack") + value.call("growth.technique.attack_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer") + value.call("growth.treasure.qing_lian_lamp.attack_per_star") * value.call("growth.treasure.max_stars"),
    defence: value.call("combat.player.base_defence") + value.call("growth.technique.defence_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer") + value.call("growth.treasure.shan_he_seal.defence_per_star") * value.call("growth.treasure.max_stars"),
    health: value.call("combat.player.base_health") + value.call("growth.technique.health_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer"),
    element: "neutral",
    apply_outgoing_element: false,
    hp_suffix: ".growth_profile.earth100_lamp10"
  },
  "earth100_seal10_metal" => {
    attack: value.call("combat.player.base_attack") + value.call("growth.technique.attack_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer") + value.call("growth.treasure.qing_lian_lamp.attack_per_star") * value.call("growth.treasure.max_stars"),
    defence: value.call("combat.player.base_defence") + value.call("growth.technique.defence_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer") + value.call("growth.treasure.shan_he_seal.defence_per_star") * value.call("growth.treasure.max_stars"),
    health: value.call("combat.player.base_health") + value.call("growth.technique.health_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer"),
    element: "metal",
    apply_outgoing_element: false,
    hp_suffix: ".growth_profile.earth100_lamp10"
  },
  "earth100_seal10_immortal_affix" => {
    attack: value.call("combat.player.base_attack") + value.call("growth.technique.attack_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer") + value.call("growth.treasure.qing_lian_lamp.attack_per_star") * value.call("growth.treasure.max_stars") + 357.2,
    defence: value.call("combat.player.base_defence") + value.call("growth.technique.defence_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer") + value.call("growth.treasure.shan_he_seal.defence_per_star") * value.call("growth.treasure.max_stars") + 1018.4,
    health: (value.call("combat.player.base_health") + value.call("growth.technique.health_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer") + 4484.0) * 1.96,
    element: "metal",
    apply_outgoing_element: true,
    speed: 96.0,
    outgoing_special: 1.48,
    incoming_special: 0.52,
    pill_heal_multiplier: 2.2,
    hp_suffix: ".growth_profile.earth100_lamp10_immortal_affix"
  },
  "earth100_nascent_extension10" => {
    attack: value.call("combat.player.base_attack") + value.call("growth.technique.attack_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer") + extension_effect.call("nascent_soul", "nascent_soul_01_star_lantern", "attack", 10),
    defence: value.call("combat.player.base_defence") + value.call("growth.technique.defence_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer") + extension_effect.call("nascent_soul", "nascent_soul_02_mountain_core", "defence", 10),
    health: value.call("combat.player.base_health") + value.call("growth.technique.health_per_layer") * value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer") + extension_effect.call("nascent_soul", "nascent_soul_03_heaven_vessel", "health", 10),
    element: "neutral",
    apply_outgoing_element: false,
    hp_suffix: ".growth_profile.earth100_lamp10"
  }
}

def simulate(value, by_id, element_multiplier, dungeon_id, profile)
  target = value.call("dungeon.#{dungeon_id}.target_clear_time").to_i
  hp_id = "dungeon.#{dungeon_id}.boss_base_hp#{profile[:hp_suffix]}"
  boss_hp_max = value.call(hp_id).to_f
  boss_hp = boss_hp_max
  shield = boss_hp_max * value.call("combat.boss.initial_barrier_percent") / 100.0
  player_hp = profile[:health]
  player_hp_max = profile[:health]
  attack_interval = [value.call("combat.speed.min_attack_interval"), value.call("combat.player.base_attack_interval") / (1 + profile.fetch(:speed, 0) / 100.0)].max
  enemy_interval = value.call("combat.enemy.base_attack_interval")
  boss_defence = profile[:hp_suffix].include?("immortal_affix") ? value.call("dungeon.#{dungeon_id}.boss_defence") : value.call("map.bai_cao_valley.enemy_defence")
  player_dps = profile[:attack] * value.call("combat.damage.base_coefficient") * 100.0 / (100.0 + boss_defence) * 0.75 / attack_interval
  boss_attack = value.call("dungeon.#{dungeon_id}.boss_attack")
  boss_accuracy = value.call("dungeon.#{dungeon_id}.boss_accuracy")
  player_evasion = value.call("combat.player.base_evasion")
  boss_hit = boss_accuracy >= player_evasion ? 1 - player_evasion / (2.0 * boss_accuracy) : boss_accuracy / (2.0 * player_evasion)
  boss_element = by_id.fetch("dungeon.#{dungeon_id}.boss_element")["value"]
  outgoing_element = profile.fetch(:apply_outgoing_element, false) ? element_multiplier.call(profile[:element], boss_element) : 1.0
  player_dps = player_dps * profile.fetch(:outgoing_special, 1.0) * outgoing_element
  pills = 0
  phase_two = false
  failed = false
  clear_seconds = nil
  spirit_burn_remaining = 0.0
  spirit_burn_interval = value.call("dungeon.#{dungeon_id}.boss_skill.spirit_burn_interval").to_i
  spirit_burn_duration = value.call("dungeon.#{dungeon_id}.boss_skill.spirit_burn_duration") * (1 - value.call("combat.player.status_resistance_percent") / 100.0)
  spirit_burn_damage = value.call("dungeon.#{dungeon_id}.boss_skill.spirit_burn_damage_per_second")

  (1..target).each do |second|
    spirit_burn_remaining = spirit_burn_duration if (second % spirit_burn_interval).zero? && second < target
    stunned = (second % value.call("combat.boss.stun_interval")).zero? && second < target
    unless stunned
      damage = player_dps
      if shield.positive?
        absorbed = [shield, damage].min
        shield -= absorbed
        damage -= absorbed
      end
      boss_hp -= damage
      phase_two ||= boss_hp <= boss_hp_max * value.call("dungeon.#{dungeon_id}.boss_phase_two_threshold") / 100.0
    end
    if boss_hp <= 0
      clear_seconds = second
      break
    end
    incoming = 0.0
    if (second % enemy_interval).zero?
      phase_multiplier = phase_two ? value.call("combat.boss.phase_two_damage_multiplier") : 1.0
      incoming += boss_attack * value.call("combat.damage.base_coefficient") * 100.0 / (100.0 + profile[:defence]) * boss_hit * phase_multiplier * element_multiplier.call(boss_element, profile[:element]) * profile.fetch(:incoming_special, 1.0)
    end
    if spirit_burn_remaining.positive?
      phase_multiplier = phase_two ? value.call("combat.boss.phase_two_damage_multiplier") : 1.0
      incoming += spirit_burn_damage * phase_multiplier
      spirit_burn_remaining -= 1
    end
    if incoming.positive?
      player_hp -= incoming
      if player_hp <= player_hp_max * value.call("combat.pill.auto_use_threshold_percent") / 100.0
        player_hp = [player_hp + value.call("combat.pill.heal_per_use") * profile.fetch(:pill_heal_multiplier, 1.0), player_hp_max * value.call("combat.pill.auto_use_target_percent") / 100.0].min
        pills += 1
      end
      if player_hp <= 0
        failed = true
        break
      end
    end
  end
  { defeated: boss_hp <= 0 && !failed, failed: failed, pills: pills, clear_seconds: clear_seconds, player_hp: player_hp }
end

profiles.each do |profile_name, profile|
  %w[qing_feng yan_prison sky_abyss].each do |dungeon_id|
    result = simulate(value, by_id, element_multiplier, dungeon_id, profile)
    abort("#{profile_name} #{dungeon_id} did not clear") unless result[:defeated]
    abort("#{profile_name} #{dungeon_id} exceeded target") unless result[:clear_seconds] <= value.call("dungeon.#{dungeon_id}.target_clear_time")
    if profile_name == "base"
      expected = value.call("dungeon.#{dungeon_id}.boss_auto_pill_per_clear").to_i
      abort("#{dungeon_id} base Boss pill mismatch") unless result[:pills] == expected
    else
      abort("#{profile_name} #{dungeon_id} needs more pills than base") if result[:pills] > value.call("dungeon.#{dungeon_id}.boss_auto_pill_per_clear")
    end
    puts [profile_name, dungeon_id, "pills=#{result[:pills]}", "clear_seconds=#{result[:clear_seconds]}", "player_hp=#{result[:player_hp].round(2)}"].join(" ")
  end
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 growth_profiles=#{profiles.length} dungeon_tiers=3 survival=逐秒"
