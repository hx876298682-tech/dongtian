#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

DUNGEONS = %w[qing_feng yan_prison sky_abyss].freeze
status_resistance = value.call("combat.player.status_resistance_percent") / 100.0
control_resistance = value.call("combat.boss.status.control_resistance_percent") / 100.0
dot_resistance = value.call("combat.boss.status.damage_over_time_resistance_percent") / 100.0
abort("player status resistance out of range") unless status_resistance.between?(0, 1)
abort("Boss control resistance out of range") unless control_resistance.between?(0, 1)
abort("Boss DoT resistance out of range") unless dot_resistance.between?(0, 1)

def simulate(value, dungeon, status_resistance)
  target = value.call("dungeon.#{dungeon}.target_clear_time").to_i
  boss_hp_max = value.call("dungeon.#{dungeon}.boss_base_hp")
  boss_hp = boss_hp_max
  shield = boss_hp_max * value.call("combat.boss.initial_barrier_percent") / 100.0
  player_hp_max = value.call("combat.player.base_health")
  player_hp = player_hp_max
  player_dps = value.call("combat.player.base_attack") * value.call("combat.damage.base_coefficient") * 100.0 /
    (100.0 + value.call("map.bai_cao_valley.enemy_defence")) * 0.75 / value.call("combat.player.base_attack_interval")
  enemy_interval = value.call("combat.enemy.base_attack_interval")
  boss_accuracy = value.call("dungeon.#{dungeon}.boss_accuracy")
  player_evasion = value.call("combat.player.base_evasion")
  boss_hit_chance = if boss_accuracy >= player_evasion
    1 - player_evasion / (2.0 * boss_accuracy)
  else
    boss_accuracy / (2.0 * player_evasion)
  end
  pills = 0
  spirit_burn_remaining = 0.0
  spirit_burn_casts = 0
  phase_two = false
  (1..target).each do |second|
    if second > 0 && (second % value.call("dungeon.#{dungeon}.boss_skill.spirit_burn_interval")).zero? && second < target
      spirit_burn_remaining = value.call("dungeon.#{dungeon}.boss_skill.spirit_burn_duration") * (1 - status_resistance)
      spirit_burn_casts += 1
    end

    stunned = (second % value.call("combat.boss.stun_interval")).zero? && second < target
    unless stunned
      damage = player_dps
      if shield.positive?
        absorbed = [shield, damage].min
        shield -= absorbed
        damage -= absorbed
      end
      boss_hp -= damage
      phase_two ||= boss_hp <= boss_hp_max * value.call("dungeon.#{dungeon}.boss_phase_two_threshold") / 100.0
    end
    break if boss_hp <= 0

    incoming = 0.0
    if (second % enemy_interval).zero?
      phase_multiplier = phase_two ? value.call("combat.boss.phase_two_damage_multiplier") : 1.0
      boss_attack = value.call("dungeon.#{dungeon}.boss_attack") * value.call("combat.damage.base_coefficient") * 100.0 /
        (100.0 + value.call("combat.player.base_defence")) * boss_hit_chance * phase_multiplier
      incoming += boss_attack
    end
    if spirit_burn_remaining.positive?
      spirit_burn = value.call("dungeon.#{dungeon}.boss_skill.spirit_burn_damage_per_second") * (phase_two ? value.call("combat.boss.phase_two_damage_multiplier") : 1.0)
      incoming += spirit_burn
      spirit_burn_remaining -= 1
    end
    player_hp -= incoming
    if player_hp.positive? && player_hp <= player_hp_max * value.call("combat.pill.auto_use_threshold_percent") / 100.0
      player_hp = [player_hp + value.call("combat.pill.heal_per_use"), player_hp_max * value.call("combat.pill.auto_use_target_percent") / 100.0].min
      pills += 1
    end
    break if player_hp <= 0
  end
  { defeated: boss_hp <= 0 && player_hp.positive?, pills: pills, casts: spirit_burn_casts, clear_seconds: boss_hp <= 0 ? target : nil }
end

DUNGEONS.each do |dungeon|
  duration = value.call("dungeon.#{dungeon}.boss_skill.spirit_burn_duration")
  interval = value.call("dungeon.#{dungeon}.boss_skill.spirit_burn_interval")
  effective_duration = duration * (1 - status_resistance)
  result = simulate(value, dungeon, status_resistance)
  expected_casts = ((value.call("dungeon.#{dungeon}.target_clear_time") - 1) / interval).floor
  abort("#{dungeon} effective status duration invalid") unless effective_duration.positive? && effective_duration <= duration
  abort("#{dungeon} spirit burn cast count mismatch") unless result[:casts] == expected_casts
  abort("#{dungeon} special skill causes failure") unless result[:defeated]
  abort("#{dungeon} special skill clear target mismatch") unless result[:clear_seconds] == value.call("dungeon.#{dungeon}.target_clear_time")
  puts "#{dungeon} spirit_burn_duration=#{effective_duration.round(2)} casts=#{result[:casts]} pills=#{result[:pills]}"
end

abort("control resistance formula mismatch") unless (4 * (1 - control_resistance) - 3).abs < 1e-9
abort("DoT resistance formula mismatch") unless (100 * (1 - dot_resistance) - 70).abs < 1e-9
abort("failure cooldown mismatch") unless value.call("combat.recovery.failure_cooldown") == 60
abort("failure reward must be zero") unless value.call("combat.failure.reward_multiplier") == 0
puts "validated rows=#{rows.length} duplicate_parameter_id=0 boss_tiers=#{DUNGEONS.length} status_resistance=#{(status_resistance * 100).to_i}% control_resistance=#{(control_resistance * 100).to_i}% dot_resistance=#{(dot_resistance * 100).to_i}% special_skill=spirit_burn failure_recovery_contract=checked"
