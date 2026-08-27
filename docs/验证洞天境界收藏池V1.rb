#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
raw = ->(id) { by_id.fetch(id)["value"].to_s }
value = ->(id) { Float(raw.call(id)) }

REALMS = %w[nascent_soul divine_transformation void_refining body_unity great_vehicle tribulation].freeze
ARCHETYPES = %w[star_lantern mountain_core heaven_vessel vermillion_wing tortoise_aegis mirror_gate thunder_sword moon_wheel cloud_seal earth_dragon spirit_compass sun_crown].freeze
SEEDS = 100
HORIZONS = [720, 2160, 6480].freeze

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

def pool_members(by_id, realm)
  prefix = "growth.treasure.extension_pool.#{realm}."
  ids = by_id.keys.grep(/^#{Regexp.escape(prefix)}.+\.archetype$/).map { |id| id.delete_prefix(prefix).delete_suffix(".archetype") }.sort
  ids
end

def simulate(value, by_id, horizon, seed)
  rng = Random.new(seed)
  previous_hours = 168
  stars = Hash.new(0)
  tokens = Hash.new(0)
  pity = 0
  active_realms = []
  REALMS.each do |realm|
    target_hours = value.call("growth.realm.#{realm}.target_hours")
    segment_hours = [[horizon - previous_hours, 0].max, target_hours - previous_hours].min
    if segment_hours.positive?
      active_realms << realm
      expedition_hours = (segment_hours * value.call("dungeon.high_tier.supply_window_ratio")).floor
      pool = pool_members(by_id, realm).to_h { |id| [id, value.call("dungeon.high_tier.#{realm}.treasure_pool_weight.#{id}")] }
      counter = 0
      expedition_hours.times do
        drop, counter = pity_roll(rng, value.call("dungeon.high_tier.#{realm}.treasure_drop_chance") / 100.0, counter, value.call("dungeon.high_tier.#{realm}.treasure_pity_hours").to_i)
        next unless drop
        id = weighted_pick(rng, pool)
        if stars.fetch(id, 0) < value.call("growth.treasure.max_stars")
          stars[id] += 1
        else
          tokens[realm] += value.call("growth.treasure.overflow_collection_token_per_copy")
          while tokens.fetch(realm, 0) >= value.call("growth.treasure.collection_token_exchange_cost")
            unmaxed = pool.keys.reject { |candidate| stars.fetch(candidate, 0) >= value.call("growth.treasure.max_stars") }
            break if unmaxed.empty?
            target = weighted_pick(rng, pool.slice(*unmaxed))
            tokens[realm] -= value.call("growth.treasure.collection_token_exchange_cost")
            stars[target] += 1
          end
        end
      end
    end
    previous_hours = target_hours
    break if previous_hours >= horizon
  end
  { active_realms: active_realms, stars: stars, tokens: tokens }
end

REALMS.each do |realm|
  members = pool_members(by_id, realm)
  abort("#{realm} extension pool must have 12 members") unless members.length == 12
  weights = members.to_h { |id| [id, value.call("dungeon.high_tier.#{realm}.treasure_pool_weight.#{id}")] }
  abort("#{realm} extension pool weights must sum 100") unless (weights.values.sum - 100.0).abs < 1e-9
  members.each do |id|
    archetype = raw.call("growth.treasure.extension_pool.#{realm}.#{id}.archetype")
    abort("#{realm} #{id} unknown archetype") unless ARCHETYPES.include?(archetype)
    abort("#{realm} #{id} missing element") unless raw.call("growth.treasure.extension_pool.#{realm}.#{id}.element").to_s != ""
  end
  abort("#{realm} effect scale must be positive") unless value.call("growth.treasure.extension_pool.#{realm}.effect_scale").positive?
end

HORIZONS.each do |horizon|
  results = SEEDS.times.map { |seed| simulate(value, by_id, horizon, 70_000 + seed * 97 + horizon) }
  active = results.flat_map { |result| result[:active_realms] }.uniq
  maxed_by_realm = REALMS.to_h do |realm|
    members = pool_members(by_id, realm)
    maxed = results.sum do |result|
      result[:stars].count { |id, stars| id.start_with?("#{realm}_") && stars >= value.call("growth.treasure.max_stars") }
    end.to_f / results.length
    [realm, maxed]
  end
  total_stars = results.sum { |result| result[:stars].values.sum }.to_f / results.length
  puts "horizon=#{horizon}h active_realms=#{active.join(',')} mean_total_stars=#{total_stars.round(2)} mean_maxed=#{maxed_by_realm.select { |realm, _| active.include?(realm) }.transform_values { |count| count.round(2) }}"
  abort("#{horizon}h must activate at least one extension realm") if active.empty?
  if horizon == 720
    abort("nascent soul pool saturates too early") if maxed_by_realm.fetch("nascent_soul") >= 12
  elsif horizon == 2160
    abort("divine transformation pool saturates too early") if maxed_by_realm.fetch("divine_transformation") >= 12
  end
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 extension_realms=#{REALMS.length} members_per_realm=12 seeds=#{SEEDS} horizons=#{HORIZONS.join('/')} collection=bounded"
