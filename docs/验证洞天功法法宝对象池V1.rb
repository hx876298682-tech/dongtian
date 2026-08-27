#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
raw = ->(id) { by_id.fetch(id)["value"].to_s }
value = ->(id) { Float(raw.call(id)) }

qualities = %w[mortal yellow xuan earth heaven immortal]
technique_ids = by_id.keys.grep(/^growth\.technique\.pool\..+\.quality$/).map { |id| id.sub("growth.technique.pool.", "").sub(/\.quality\z/, "") }.sort
abort("expected 12 technique pool members") unless technique_ids.length == 12 && technique_ids.uniq.length == technique_ids.length
technique_quality = technique_ids.to_h { |id| [id, raw.call("growth.technique.pool.#{id}.quality")] }
technique_elements = technique_ids.to_h { |id| [id, raw.call("growth.technique.pool.#{id}.element")] }
abort("unknown technique quality") unless technique_quality.values.all? { |quality| qualities.include?(quality) }
elements = %w[metal wood earth water fire neutral]
abort("unknown technique element") unless technique_elements.values.all? { |element| elements.include?(element) }

technique_by_quality = qualities.to_h do |quality|
  members = technique_ids.select { |id| technique_quality.fetch(id) == quality }
  weights = members.to_h { |id| [id, value.call("growth.technique.pool.#{id}.weight")] }
  abort("#{quality} technique pool must have two members") unless members.length == 2
  abort("#{quality} technique member weights must sum 100") unless weights.values.sum == 100
  [quality, weights]
end

dungeons = %w[qing_feng yan_prison sky_abyss]
technique_quality_weights = dungeons.to_h do |dungeon|
  weights = qualities.to_h { |quality| [quality, value.call("dungeon.#{dungeon}.technique_pool_weight.#{quality}")] }
  abort("#{dungeon} technique quality weights must sum 100") unless weights.values.sum == 100
  [dungeon, weights]
end

treasure_ids = %w[qing_lian_lamp shan_he_seal heaven_bag zhu_que_feather xuan_gui_shell tai_xu_mirror]
treasure_ids.each do |id|
  abort("missing treasure element #{id}") unless raw.call("growth.treasure.#{id}.element")
end
treasure_weights = dungeons.to_h do |dungeon|
  weights = treasure_ids.to_h { |id| [id, value.call("dungeon.#{dungeon}.treasure_pool_weight.#{id}")] }
  abort("#{dungeon} treasure weights must sum 100") unless weights.values.sum == 100
  [dungeon, weights]
end

def weighted_pick(rng, weights)
  total = weights.values.sum.to_f
  roll = rng.rand * total
  weights.each do |key, weight|
    roll -= weight
    return key if roll < 0
  end
  weights.keys.last
end

def pity_roll(rng, chance, counter, limit)
  random_success = rng.rand < chance
  forced = !random_success && counter + 1 >= limit
  success = random_success || forced
  [success, success ? 0 : counter + 1]
end

def expected_per_hour(value, dungeon, drop_field, pity_field)
  clears = 3600.0 / value.call("dungeon.#{dungeon}.target_clear_time")
  p = value.call("dungeon.#{dungeon}.#{drop_field}") / 100.0
  n = value.call("dungeon.pity.#{pity_field}")
  cycle = (1 - (1 - p)**n) / p
  clears / cycle
end

def simulate_collection(value, dungeon, technique_by_quality, technique_quality_weights, treasure_weights, treasure_ids, seed:, hours: 2160)
  rng = Random.new(seed)
  clears = (3600.0 / value.call("dungeon.#{dungeon}.target_clear_time") * hours).floor
  technique_counter = 0
  treasure_counter = 0
  techniques = {}
  duplicate_research_xp = 0.0
  stars = Hash.new(0)
  collection_tokens = 0
  technique_pity = value.call("dungeon.pity.technique_clears").to_i
  treasure_pity = value.call("dungeon.pity.treasure_clears").to_i
  clears.times do
    technique_drop, technique_counter = pity_roll(rng, value.call("dungeon.#{dungeon}.technique_drop_chance") / 100.0, technique_counter, technique_pity)
    if technique_drop
      quality = weighted_pick(rng, technique_quality_weights.fetch(dungeon))
      technique_id = weighted_pick(rng, technique_by_quality.fetch(quality))
      if techniques[technique_id]
        duplicate_research_xp += value.call("growth.technique.duplicate_research_xp.#{quality}")
      else
        techniques[technique_id] = quality
      end
    end

    treasure_drop, treasure_counter = pity_roll(rng, value.call("dungeon.#{dungeon}.treasure_drop_chance") / 100.0, treasure_counter, treasure_pity)
    next unless treasure_drop
    treasure_id = weighted_pick(rng, treasure_weights.fetch(dungeon))
    if stars.fetch(treasure_id, 0) < value.call("growth.treasure.max_stars")
      stars[treasure_id] = stars.fetch(treasure_id, 0) + 1
    else
      collection_tokens += value.call("growth.treasure.overflow_collection_token_per_copy")
      while collection_tokens >= value.call("growth.treasure.collection_token_exchange_cost")
        unowned = treasure_weights.fetch(dungeon).reject { |id, _weight| stars.key?(id) }
        target_pool = unowned.empty? ? treasure_weights.fetch(dungeon).reject { |id, _weight| stars.fetch(id, 0) >= value.call("growth.treasure.max_stars") } : unowned
        break if target_pool.empty?
        target = weighted_pick(rng, target_pool)
        collection_tokens -= value.call("growth.treasure.collection_token_exchange_cost")
        stars[target] = stars.fetch(target, 0) + 1
      end
    end
  end
  {
    techniques: techniques,
    duplicate_research_xp: duplicate_research_xp,
    stars: stars,
    collection_tokens: collection_tokens,
    clears: clears
  }
end

expected = dungeons.to_h do |dungeon|
  [dungeon, {
    technique_per_hour: expected_per_hour(value, dungeon, "technique_drop_chance", "technique_clears"),
    treasure_per_hour: expected_per_hour(value, dungeon, "treasure_drop_chance", "treasure_clears")
  }]
end
abort("expected qing feng technique rate mismatch") unless (expected["qing_feng"][:technique_per_hour] - 0.4676).abs < 0.001
abort("expected sky treasure rate mismatch") unless (expected["sky_abyss"][:treasure_per_hour] - 0.1219).abs < 0.001

results = dungeons.flat_map do |dungeon|
  (1..20).map { |seed| simulate_collection(value, dungeon, technique_by_quality, technique_quality_weights, treasure_weights, treasure_ids, seed: seed) }
end
results.each do |result|
  abort("technique collection cannot be empty") if result[:techniques].empty?
  abort("duplicate technique conversion missing") unless result[:duplicate_research_xp].positive?
  abort("treasure star state missing") if result[:stars].empty?
end

by_dungeon = dungeons.to_h do |dungeon|
  dungeon_results = results.each_slice(20).to_a.fetch(dungeons.index(dungeon))
  mean_techniques = dungeon_results.sum { |result| result[:techniques].length }.to_f / dungeon_results.length
  mean_owned_treasures = dungeon_results.sum { |result| result[:stars].length }.to_f / dungeon_results.length
  mean_maxed = dungeon_results.sum { |result| result[:stars].count { |_id, stars| stars >= value.call("growth.treasure.max_stars") } }.to_f / dungeon_results.length
  [dungeon, { mean_techniques: mean_techniques, mean_owned_treasures: mean_owned_treasures, mean_maxed: mean_maxed }]
end
abort("treasure collection should reach all pool members in 90d samples") unless by_dungeon.values.all? { |summary| summary[:mean_owned_treasures] >= treasure_ids.length - 0.5 }

puts expected.map { |dungeon, rates| "#{dungeon} technique=#{rates[:technique_per_hour].round(4)}/h treasure=#{rates[:treasure_per_hour].round(4)}/h" }
by_dungeon.each { |dungeon, summary| puts "#{dungeon} mean_techniques=#{summary[:mean_techniques].round(2)} mean_owned_treasures=#{summary[:mean_owned_treasures].round(2)} mean_maxed=#{summary[:mean_maxed].round(2)}" }
puts "validated rows=#{rows.length} duplicate_parameter_id=0 technique_members=#{technique_ids.length} treasure_members=#{treasure_ids.length} seeds=20 horizon=90d duplicate_conversion=research_xp token_exchange=10"
