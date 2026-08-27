#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
raw = ->(id) { by_id.fetch(id)["value"].to_s }
value = ->(id) { Float(raw.call(id)) }

REALMS = %w[nascent_soul divine_transformation void_refining body_unity great_vehicle tribulation].freeze
DUNGEONS = %w[qing_feng yan_prison sky_abyss].freeze
ARCHETYPES = %w[star_lantern mountain_core heaven_vessel vermillion_wing tortoise_aegis mirror_gate thunder_sword moon_wheel cloud_seal earth_dragon spirit_compass sun_crown].freeze
RUNS = 100
GATE_RUNS = 20

abort("high-tier entry gate must be enabled") unless raw.call("dungeon.high_tier.entry_gate.enabled") == "1"
abort("high-tier entry gate must use collected_p10") unless raw.call("dungeon.high_tier.entry_gate.profile") == "collected_p10"

def extension_effect(value, by_id, realm, object_id, field, stars)
  archetype = by_id.fetch("growth.treasure.extension_pool.#{realm}.#{object_id}.archetype")["value"]
  base = value.call("growth.treasure.extension_archetype.#{archetype}.#{field}_per_star")
  base * value.call("growth.treasure.extension_pool.#{realm}.effect_scale") * stars
end

def base_profile(value)
  technique = value.call("growth.technique.quality_multiplier.earth") * value.call("growth.technique.max_layer")
  {
    attack: value.call("combat.player.base_attack") + value.call("growth.technique.attack_per_layer") * technique + value.call("growth.treasure.qing_lian_lamp.attack_per_star") * value.call("growth.treasure.max_stars"),
    defence: value.call("combat.player.base_defence") + value.call("growth.technique.defence_per_layer") * technique + value.call("growth.treasure.shan_he_seal.defence_per_star") * value.call("growth.treasure.max_stars"),
    health: value.call("combat.player.base_health") + value.call("growth.technique.health_per_layer") * technique + value.call("growth.treasure.xuan_gui_shell.health_per_star") * value.call("growth.treasure.max_stars"),
    speed: 0.0,
    element: "neutral",
    outgoing_special: 1.0,
    incoming_special: 1.0,
    pill_heal_multiplier: 1.0
  }
end

def profile_with_objects(value, by_id, realm, object_ids)
  profile = base_profile(value)
  object_ids.each do |object_id|
    %i[attack defence health speed].each do |field|
      profile[field] += extension_effect(value, by_id, realm, object_id, field, value.call("growth.treasure.max_stars"))
    end
  end
  profile
end

def collect(value, by_id, horizon, seed)
  rng = Random.new(seed)
  stars = Hash.new(0)
  previous_hours = 168
  REALMS.each do |realm|
    target_hours = value.call("growth.realm.#{realm}.target_hours")
    segment_hours = [[horizon - previous_hours, 0].max, target_hours - previous_hours].min
    if segment_hours.positive?
      expedition_hours = (segment_hours * value.call("dungeon.high_tier.supply_window_ratio")).floor
      pool = ARCHETYPES.to_h do |archetype|
        id = by_id.keys.find { |key| key == "growth.treasure.extension_pool.#{realm}.#{realm}_#{format('%02d', ARCHETYPES.index(archetype) + 1)}_#{archetype}.archetype" }
        object_id = id.split(".")[-2]
        [object_id, value.call("dungeon.high_tier.#{realm}.treasure_pool_weight.#{object_id}")]
      end
      pity = 0
      expedition_hours.times do
        success = rng.rand < value.call("dungeon.high_tier.#{realm}.treasure_drop_chance") / 100.0
        success ||= pity + 1 >= value.call("dungeon.high_tier.#{realm}.treasure_pity_hours")
        pity = success ? 0 : pity + 1
        next unless success
        roll = rng.rand * pool.values.sum
        picked = pool.each do |id, weight|
          roll -= weight
          break id if roll < 0
        end
        stars[picked] += 1 if stars[picked] < value.call("growth.treasure.max_stars")
      end
    end
    previous_hours = target_hours
    break if previous_hours >= horizon
  end
  stars
end

def profile_from_stars(value, by_id, stars)
  profile = base_profile(value)
  stars.each do |object_id, count|
    realm = REALMS.find { |candidate| object_id.start_with?("#{candidate}_") }
    %i[attack defence health speed].each do |field|
      profile[field] += extension_effect(value, by_id, realm, object_id, field, count)
    end
  end
  profile
end

def simulate(value, by_id, dungeon_id, realm, profile)
  target = value.call("dungeon.#{dungeon_id}.target_clear_time").to_i
  boss_hp_max = value.call("dungeon.#{dungeon_id}.boss_base_hp.growth_profile.earth100_lamp10") * value.call("dungeon.high_tier.#{realm}.boss_hp_multiplier")
  boss_hp = boss_hp_max
  shield = boss_hp_max * value.call("combat.boss.initial_barrier_percent") / 100.0
  player_hp_max = profile[:health]
  player_hp = player_hp_max
  interval = [value.call("combat.speed.min_attack_interval"), value.call("combat.player.base_attack_interval") / (1.0 + profile[:speed] / 100.0)].max
  boss_defence = value.call("map.bai_cao_valley.enemy_defence")
  player_dps = profile[:attack] * value.call("combat.damage.base_coefficient") * 100.0 / (100.0 + boss_defence) * 0.75 / interval * profile[:outgoing_special]
  boss_hit = value.call("dungeon.#{dungeon_id}.boss_accuracy") >= value.call("combat.player.base_evasion") ? 1 - value.call("combat.player.base_evasion") / (2.0 * value.call("dungeon.#{dungeon_id}.boss_accuracy")) : 0.5
  phase_two = false
  burn_remaining = 0.0
  burn_interval = value.call("dungeon.#{dungeon_id}.boss_skill.spirit_burn_interval").to_i
  burn_duration = value.call("dungeon.#{dungeon_id}.boss_skill.spirit_burn_duration") * (1 - value.call("combat.player.status_resistance_percent") / 100.0)
  max_seconds = (target * 1.5).ceil

  (1..max_seconds).each do |second|
    burn_remaining = burn_duration if (second % burn_interval).zero? && second < max_seconds
    stunned = (second % value.call("combat.boss.stun_interval")).zero?
    unless stunned
      signature_cd = value.call("dungeon.high_tier.#{realm}.signature_skill.cooldown_seconds").to_i
      signature_duration = value.call("dungeon.high_tier.#{realm}.signature_skill.duration_seconds").to_i
      signature_active = (second % signature_cd).positive? && (second % signature_cd) <= signature_duration
      damage = player_dps * (signature_active ? 1 - value.call("dungeon.high_tier.#{realm}.signature_skill.attack_suppression_percent") / 100.0 : 1.0)
      absorbed = [shield, damage].min
      shield -= absorbed
      boss_hp -= damage - absorbed
      phase_two ||= boss_hp <= boss_hp_max * value.call("dungeon.#{dungeon_id}.boss_phase_two_threshold") / 100.0
    end
    return :success if boss_hp <= 0

    incoming = 0.0
    if (second % value.call("combat.enemy.base_attack_interval")).zero?
      phase_multiplier = phase_two ? value.call("combat.boss.phase_two_damage_multiplier") : 1.0
      incoming += value.call("dungeon.#{dungeon_id}.boss_attack") * value.call("combat.damage.base_coefficient") * 100.0 / (100.0 + profile[:defence]) * boss_hit * phase_multiplier * profile[:incoming_special]
    end
    incoming += value.call("dungeon.#{dungeon_id}.boss_skill.spirit_burn_damage_per_second") * (phase_two ? value.call("combat.boss.phase_two_damage_multiplier") : 1.0) if burn_remaining.positive?
    burn_remaining -= 1 if burn_remaining.positive?
    next unless incoming.positive?
    player_hp -= incoming
    if player_hp <= player_hp_max * value.call("combat.pill.auto_use_threshold_percent") / 100.0
      player_hp = [player_hp + value.call("combat.pill.heal_per_use") * profile[:pill_heal_multiplier], player_hp_max * value.call("combat.pill.auto_use_target_percent") / 100.0].min
    end
    return :death if player_hp <= 0
  end
  :timeout
end

REALMS.each do |realm|
  horizon = value.call("growth.realm.#{realm}.target_hours").to_i
  previous_hours = realm == REALMS.first ? 168 : value.call("growth.realm.#{REALMS[REALMS.index(realm) - 1]}.target_hours").to_i
  prefix = "#{realm}_"
  object_ids = ARCHETYPES.map { |archetype| "#{prefix}#{format('%02d', ARCHETYPES.index(archetype) + 1)}_#{archetype}" }
  variants = {
    "launch_only" => base_profile(value),
    "attack_focus" => profile_with_objects(value, by_id, realm, object_ids.select { |id| %w[star_lantern vermillion_wing thunder_sword sun_crown].any? { |a| id.end_with?(a) } }.first(2)),
    "defence_focus" => profile_with_objects(value, by_id, realm, object_ids.select { |id| %w[mountain_core tortoise_aegis moon_wheel earth_dragon].any? { |a| id.end_with?(a) } }.first(2)),
    "balanced_three" => profile_with_objects(value, by_id, realm, object_ids.first(3))
  }
  collected = RUNS.times.map { |index| profile_from_stars(value, by_id, collect(value, by_id, horizon, 2_400_000 + horizon + index * 37)) }
  variants["collected_p10"] = collected.sort_by { |profile| profile[:attack] + profile[:defence] * 0.8 + profile[:health] * 0.05 }.first
  gate_times = GATE_RUNS.times.map do |index|
    checkpoints = [previous_hours + 24, previous_hours + 168, previous_hours + 1_008, previous_hours + 5_040, horizon].select { |candidate| candidate <= horizon }.uniq.sort
    checkpoints.find do |candidate_hour|
      profile = profile_from_stars(value, by_id, collect(value, by_id, candidate_hour, 2_400_000 + horizon + index * 37))
      %i[attack defence health].all? do |field|
        profile.fetch(field) + 1e-9 >= value.call("dungeon.high_tier.#{realm}.entry_profile.collected_p10.#{field}")
      end
    end || horizon
  end
  sorted_gate_times = gate_times.sort
  blocked_boss_window = gate_times.sum { |gate_hour| [(gate_hour - previous_hours) * value.call("dungeon.high_tier.supply_window_ratio"), 0.0].max } / GATE_RUNS
  puts "realm=#{realm} gate_hours_mean=#{(gate_times.sum.to_f / GATE_RUNS).round(1)} p10=#{sorted_gate_times[(GATE_RUNS * 0.1).floor]} p50=#{sorted_gate_times[(GATE_RUNS * 0.5).floor]} p95=#{sorted_gate_times[(GATE_RUNS * 0.95).floor]} blocked_boss_window_hours=#{blocked_boss_window.round(1)}"
  gate = variants.fetch("collected_p10")
  %i[attack defence health].each do |field|
    threshold = value.call("dungeon.high_tier.#{realm}.entry_profile.collected_p10.#{field}")
    abort("#{realm} collected_p10 #{field} below entry gate") if gate.fetch(field) + 1e-9 < threshold
  end

  variants.each do |variant, profile|
    results = DUNGEONS.map { |dungeon_id| simulate(value, by_id, dungeon_id, realm, profile) }
    puts "realm=#{realm} variant=#{variant} attack=#{profile[:attack].round(1)} defence=#{profile[:defence].round(1)} health=#{profile[:health].round(1)} outcomes=#{results.join('/')}"
  end
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 realms=#{REALMS.length} variants=launch/attack/defence/balanced/collected_p10 window=1.5x natural_failure=classified"
