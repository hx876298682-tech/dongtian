#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

bosses = {
  "qing_feng" => [4132, 600],
  "yan_prison" => [8242, 1200],
  "sky_abyss" => [16463, 2400]
}
barrier = value.call("combat.boss.initial_barrier_percent") / 100.0
player_dps = value.call("combat.player.base_attack") * value.call("combat.damage.base_coefficient") * 100.0 / (100.0 + value.call("map.bai_cao_valley.enemy_defence")) * 0.75 / value.call("combat.player.base_attack_interval")
bosses.each do |boss, (_base_hp, target_seconds)|
  base_hp = value.call("dungeon.#{boss}.boss_base_hp")
  effective_hp = base_hp * (1 + barrier)
  stun_count = ((target_seconds - 1) / value.call("combat.boss.stun_interval")).floor
  active_seconds = target_seconds - stun_count * value.call("combat.boss.stun_duration")
  expected_effective_hp = player_dps * active_seconds
  abort("#{boss}: invalid hp") unless effective_hp.positive?
  abort("#{boss}: hp=#{effective_hp}, expected=#{expected_effective_hp}") unless (effective_hp - expected_effective_hp).abs < 2
  abort("#{boss}: phase threshold mismatch") unless value.call("dungeon.#{boss}.boss_phase_two_threshold") == 50
  abort("#{boss}: target time not positive") unless target_seconds.positive?
  abort("#{boss}: independent defence missing") unless value.call("dungeon.#{boss}.boss_defence").positive?
  puts [boss, "effective_hp=#{effective_hp.round}", "target_seconds=#{target_seconds}", "active_seconds=#{active_seconds}", "baseline_dps=#{player_dps.round(4)}"].join(" ")
end
abort("Boss defence must increase by tier") unless %w[qing_feng yan_prison sky_abyss].map { |boss| value.call("dungeon.#{boss}.boss_defence") }.each_cons(2).all? { |a, b| b > a }
abort("barrier must be 20%") unless barrier == 0.2
abort("stun interval/duration mismatch") unless [value.call("combat.boss.stun_interval"), value.call("combat.boss.stun_duration")] == [60, 3]
puts "validated rows=#{rows.length} duplicate_parameter_id=0 boss_tiers=3 state_rules=registered"
