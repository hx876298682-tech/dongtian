#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

DUNGEONS = %w[qing_feng yan_prison sky_abyss].freeze
RUNS = 500
HOURS = 2160
Z99 = 2.5758293035489004

def expected_rate(value, dungeon, drop_field, pity_field)
  clears = 3600.0 / value.call("dungeon.#{dungeon}.target_clear_time")
  p = value.call("dungeon.#{dungeon}.#{drop_field}") / 100.0
  n = value.call("dungeon.pity.#{pity_field}")
  cycle = (1 - (1 - p)**n) / p
  clears / cycle
end

def sample_std(values)
  mean = values.sum / values.length
  Math.sqrt(values.sum { |value| (value - mean)**2 } / (values.length - 1))
end

def pity_count(rng, clears, chance, pity_limit)
  counter = 0
  drops = 0
  max_gap = 0
  gap = 0
  clears.times do
    random = rng.rand < chance
    forced = !random && counter + 1 >= pity_limit
    success = random || forced
    if success
      drops += 1
      max_gap = [max_gap, gap + 1].max
      gap = 0
      counter = 0
    else
      counter += 1
      gap += 1
    end
  end
  [drops, max_gap]
end

summaries = []
DUNGEONS.each_with_index do |dungeon, dungeon_index|
  clears = (3600.0 / value.call("dungeon.#{dungeon}.target_clear_time") * HOURS).floor
  {
    technique: ["technique_drop_chance", "technique_clears"],
    treasure: ["treasure_drop_chance", "treasure_clears"]
  }.each do |kind, (drop_field, pity_field)|
    chance = value.call("dungeon.#{dungeon}.#{drop_field}") / 100.0
    pity_limit = value.call("dungeon.pity.#{pity_field}").to_i
    samples = []
    max_gaps = []
    RUNS.times do |run|
      drops, max_gap = pity_count(Random.new(10_000 + run * 31 + dungeon_index * 997), clears, chance, pity_limit)
      samples << drops.to_f / HOURS
      max_gaps << max_gap
    end
    mean = samples.sum / samples.length
    standard_deviation = sample_std(samples)
    margin = Z99 * standard_deviation / Math.sqrt(samples.length)
    expected = expected_rate(value, dungeon, drop_field, pity_field)
    abort("#{dungeon} #{kind} expected rate outside 99% CI") unless expected.between?(mean - margin, mean + margin)
    abort("#{dungeon} #{kind} pity gap exceeded") unless max_gaps.max <= pity_limit
    summaries << [dungeon, kind, expected, mean, margin, max_gaps.max]
  end
end

summaries.each do |dungeon, kind, expected, mean, margin, max_gap|
  puts "#{dungeon} #{kind} expected=#{expected.round(5)}/h mean=#{mean.round(5)}/h ci99=+/-#{margin.round(5)} max_gap=#{max_gap}"
end
puts "validated rows=#{rows.length} duplicate_parameter_id=0 runs=#{RUNS} horizon=#{HOURS}h confidence=99% pity=checked"
