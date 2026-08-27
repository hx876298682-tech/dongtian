#!/usr/bin/env ruby

require "csv"

ROOT = __dir__
rows = CSV.read(File.join(ROOT, "洞天数值参数表.csv"), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
raw = ->(id) { by_id.fetch(id)["value"].to_s }
value = ->(id) { Float(raw.call(id)) }

REALMS = %w[nascent_soul divine_transformation void_refining body_unity great_vehicle tribulation].freeze
ARCHETYPES = %w[star_lantern mountain_core heaven_vessel vermillion_wing tortoise_aegis mirror_gate thunder_sword moon_wheel cloud_seal earth_dragon spirit_compass sun_crown].freeze
HORIZONS = [720, 2_160, 6_480, 19_440, 58_320, 174_960].freeze
RUNS = 100

def pool_members(by_id, realm)
  prefix = "growth.treasure.extension_pool.#{realm}."
  by_id.keys.grep(/^#{Regexp.escape(prefix)}.+\.archetype$/).map do |id|
    id.delete_prefix(prefix).delete_suffix(".archetype")
  end.sort
end

def weighted_pick(rng, weights)
  roll = rng.rand * weights.values.sum
  weights.each do |id, weight|
    roll -= weight
    return id if roll < 0
  end
  weights.keys.last
end

def pity_roll(rng, chance, counter, limit)
  random_success = rng.rand < chance
  forced = !random_success && counter + 1 >= limit
  success = random_success || forced
  [success, success ? 0 : counter + 1]
end

def collect(value, by_id, horizon, seed)
  rng = Random.new(seed)
  stars = Hash.new(0)
  pity = Hash.new(0)
  previous_hours = 168
  REALMS.each do |realm|
    target_hours = value.call("growth.realm.#{realm}.target_hours")
    segment_hours = [[horizon - previous_hours, 0].max, target_hours - previous_hours].min
    if segment_hours.positive?
      expedition_hours = (segment_hours * value.call("dungeon.high_tier.supply_window_ratio")).floor
      pool = pool_members(by_id, realm).to_h { |id| [id, value.call("dungeon.high_tier.#{realm}.treasure_pool_weight.#{id}")] }
      expedition_hours.times do
        drop, pity[realm] = pity_roll(rng, value.call("dungeon.high_tier.#{realm}.treasure_drop_chance") / 100.0, pity.fetch(realm, 0), value.call("dungeon.high_tier.#{realm}.treasure_pity_hours").to_i)
        next unless drop
        id = weighted_pick(rng, pool)
        stars[id] += 1 if stars.fetch(id, 0) < value.call("growth.treasure.max_stars")
      end
    end
    previous_hours = target_hours
    break if previous_hours >= horizon
  end
  stars
end

def profile_from_stars(value, by_id, stars)
  technique_quality = value.call("growth.technique.quality_multiplier.earth")
  profile = {
    # Long-term extension pools are entered after the six launch treasures
    # have reached their established 10-star collection baseline.
    attack: value.call("combat.player.base_attack") + value.call("growth.technique.attack_per_layer") * technique_quality * value.call("growth.technique.max_layer") + value.call("growth.treasure.qing_lian_lamp.attack_per_star") * value.call("growth.treasure.max_stars"),
    defence: value.call("combat.player.base_defence") + value.call("growth.technique.defence_per_layer") * technique_quality * value.call("growth.technique.max_layer") + value.call("growth.treasure.shan_he_seal.defence_per_star") * value.call("growth.treasure.max_stars"),
    health: value.call("combat.player.base_health") + value.call("growth.technique.health_per_layer") * technique_quality * value.call("growth.technique.max_layer") + value.call("growth.treasure.xuan_gui_shell.health_per_star") * value.call("growth.treasure.max_stars"),
    speed: 0.0
  }
  fields = { attack: :attack, defence: :defence, health: :health, speed: :speed }
  stars.each do |id, count|
    realm = REALMS.find { |candidate| id.start_with?("#{candidate}_") }
    archetype = raw_id = by_id.fetch("growth.treasure.extension_pool.#{realm}.#{id}.archetype")["value"]
    fields.each do |field, suffix|
      base = value.call("growth.treasure.extension_archetype.#{archetype}.#{field}_per_star")
      scale = value.call("growth.treasure.extension_pool.#{realm}.effect_scale")
      profile[suffix] += base * scale * count
    end
  end
  profile
end

def simulate_boss(value, by_id, dungeon_id, profile, realm)
  target = value.call("dungeon.#{dungeon_id}.target_clear_time").to_i
  boss_hp_multiplier = by_id.key?("dungeon.high_tier.#{realm}.boss_hp_multiplier") ? value.call("dungeon.high_tier.#{realm}.boss_hp_multiplier") : 1.0
  boss_hp_max = value.call("dungeon.#{dungeon_id}.boss_base_hp.growth_profile.earth100_lamp10").to_f * boss_hp_multiplier
  boss_hp = boss_hp_max
  shield = boss_hp_max * value.call("combat.boss.initial_barrier_percent") / 100.0
  interval = [value.call("combat.speed.min_attack_interval"), value.call("combat.player.base_attack_interval") / (1.0 + profile[:speed] / 100.0)].max
  # The life anchors in this profile were calibrated against the normal
  # growth-defense baseline; the independent Boss defense belongs only to the
  # explicitly marked full-affix pressure profile.
  boss_defence = value.call("map.bai_cao_valley.enemy_defence")
  player_dps = profile[:attack] * value.call("combat.damage.base_coefficient") * 100.0 / (100.0 + boss_defence) * 0.75 / interval
  player_hp = profile[:health]
  pills = 0
  spirit_burn_remaining = 0.0
  burn_interval = value.call("dungeon.#{dungeon_id}.boss_skill.spirit_burn_interval").to_i
  burn_duration = value.call("dungeon.#{dungeon_id}.boss_skill.spirit_burn_duration") * (1 - value.call("combat.player.status_resistance_percent") / 100.0)
  burn_dps = value.call("dungeon.#{dungeon_id}.boss_skill.spirit_burn_damage_per_second")
  signature_cooldown = value.call("dungeon.high_tier.#{realm}.signature_skill.cooldown_seconds").to_i
  signature_duration = value.call("dungeon.high_tier.#{realm}.signature_skill.duration_seconds").to_i
  signature_suppression = value.call("dungeon.high_tier.#{realm}.signature_skill.attack_suppression_percent") / 100.0
  phase_two = false

  simulation_limit = (target * 50).to_i
  (1..simulation_limit).each do |second|
    spirit_burn_remaining = burn_duration if (second % burn_interval).zero? && second < simulation_limit
    stunned = (second % value.call("combat.boss.stun_interval")).zero? && second < simulation_limit
    unless stunned
      signature_active = (second % signature_cooldown).positive? && (second % signature_cooldown) <= signature_duration
      damage = player_dps * (signature_active ? (1.0 - signature_suppression) : 1.0)
      if shield.positive?
        absorbed = [shield, damage].min
        shield -= absorbed
        damage -= absorbed
      end
      boss_hp -= damage
      phase_two ||= boss_hp <= boss_hp_max * value.call("dungeon.#{dungeon_id}.boss_phase_two_threshold") / 100.0
    end
    return { defeated: true, clear_seconds: second, pills: pills } if boss_hp <= 0

    incoming = spirit_burn_remaining.positive? ? burn_dps : 0.0
    if (second % value.call("combat.enemy.base_attack_interval")).zero?
      boss_accuracy = value.call("dungeon.#{dungeon_id}.boss_accuracy")
      evasion = value.call("combat.player.base_evasion")
      hit = boss_accuracy >= evasion ? 1 - evasion / (2.0 * boss_accuracy) : boss_accuracy / (2.0 * evasion)
      phase_multiplier = phase_two ? value.call("combat.boss.phase_two_damage_multiplier") : 1.0
      incoming += value.call("dungeon.#{dungeon_id}.boss_attack") * value.call("combat.damage.base_coefficient") * 100.0 / (100.0 + profile[:defence]) * hit * phase_multiplier
    end
    spirit_burn_remaining -= 1 if spirit_burn_remaining.positive?
    next unless incoming.positive?
    player_hp -= incoming
    if player_hp <= profile[:health] * value.call("combat.pill.auto_use_threshold_percent") / 100.0
      player_hp = [player_hp + value.call("combat.pill.heal_per_use"), profile[:health] * value.call("combat.pill.auto_use_target_percent") / 100.0].min
      pills += 1
    end
    return { defeated: false, clear_seconds: nil, pills: pills } if player_hp <= 0
  end
  { defeated: false, clear_seconds: nil, pills: pills }
end

HORIZONS.each do |horizon|
  realm = REALMS.find { |candidate| horizon <= value.call("growth.realm.#{candidate}.target_hours") } || REALMS.last
  profiles = RUNS.times.map do |index|
    stars = collect(value, by_id, horizon, 230_000 + horizon + index * 109)
    profile_from_stars(value, by_id, stars)
  end
  mean_attack = profiles.sum { |profile| profile[:attack] } / profiles.length
  mean_defence = profiles.sum { |profile| profile[:defence] } / profiles.length
  mean_health = profiles.sum { |profile| profile[:health] } / profiles.length
  puts "horizon=#{horizon}h mean_attack=#{mean_attack.round(2)} mean_defence=#{mean_defence.round(2)} mean_health=#{mean_health.round(2)}"
  %w[qing_feng yan_prison sky_abyss].each do |dungeon_id|
    results = profiles.map { |profile| simulate_boss(value, by_id, dungeon_id, profile, realm) }
    natural_failures = results.count { |result| !result[:defeated] }
    abort("#{horizon}h #{dungeon_id} extension profile failed survival") unless natural_failures.zero?
    mean_clear = results.sum { |result| result[:clear_seconds] }.to_f / results.length
    mean_pills = results.sum { |result| result[:pills] }.to_f / results.length
    target = value.call("dungeon.#{dungeon_id}.target_clear_time")
    p95_clear = results.map { |result| result[:clear_seconds] }.sort[(results.length * 0.95).floor]
    if by_id.key?("dungeon.high_tier.#{realm}.boss_hp_multiplier")
      abort("#{horizon}h #{dungeon_id} mean clear time fell outside rebalance band") unless mean_clear.between?(target * 0.75, target * 1.25)
      abort("#{horizon}h #{dungeon_id} p95 clear tail is too long") unless p95_clear <= target * 1.5
    end
    puts "horizon=#{horizon}h realm=#{realm} dungeon=#{dungeon_id} mean_clear_seconds=#{mean_clear.round(2)} p95_clear_seconds=#{p95_clear} mean_pills=#{mean_pills.round(2)} max_pills=#{results.map { |result| result[:pills] }.max} natural_failures=#{natural_failures}/#{results.length}"
  end
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 runs=#{RUNS} horizons=#{HORIZONS.join('/')} extension_treasure=long_term combat=survival_only"
