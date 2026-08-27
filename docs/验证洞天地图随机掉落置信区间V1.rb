#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

MAPS = %w[bai_cao_valley black_wind_valley red_flame_cave].freeze
QUALITIES = %w[normal fine rare epic legendary immortal].freeze
RUNS = 500
HOURS = 2160
Z99 = 2.5758293035489004

def sample_std(values)
  mean = values.sum / values.length
  Math.sqrt(values.sum { |item| (item - mean)**2 } / (values.length - 1))
end

def pity_count(rng, kills, chance, pity_limit)
  counter = 0
  drops = 0
  max_gap = 0
  gap = 0
  kills.times do
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

def quality_index(rng, chances)
  roll = rng.rand * 100.0
  cumulative = 0.0
  chances.each_with_index do |chance, index|
    cumulative += chance
    return index if roll < cumulative
  end
  chances.length - 1
end

def equipment_quality_counts(rng, kills, equipment_chance, quality_chances)
  counts = Array.new(quality_chances.length, 0)
  kills.times do
    next unless rng.rand < equipment_chance
    counts[quality_index(rng, quality_chances)] += 1
  end
  counts
end

def expected_pity_rate(value, map)
  kills_per_hour = 3600.0 / value.call("map.#{map}.target_kill_time")
  chance = value.call("map.#{map}.ancient_scroll_drop_chance") / 100.0
  pity_limit = value.call("map.#{map}.ancient_scroll_pity_kills")
  cycle = (1 - (1 - chance)**pity_limit) / chance
  kills_per_hour / cycle
end

summaries = []
MAPS.each_with_index do |map, map_index|
  kills_per_hour = 3600.0 / value.call("map.#{map}.target_kill_time")
  kills = (kills_per_hour * HOURS).floor
  equipment_chance = value.call("map.#{map}.equipment_drop_chance") / 100.0
  quality_chances = QUALITIES.map { |quality| value.call("map.#{map}.equipment_quality_#{quality}_chance") }
  abort("#{map} quality weights must sum to 100") unless (quality_chances.sum - 100.0).abs < 1e-9

  equipment_samples = []
  quality_samples = QUALITIES.to_h { |quality| [quality, []] }
  scroll_samples = []
  max_gaps = []
  pity_limit = value.call("map.#{map}.ancient_scroll_pity_kills").to_i

  RUNS.times do |run|
    rng = Random.new(20_000 + run * 37 + map_index * 1_003)
    quality_counts = equipment_quality_counts(rng, kills, equipment_chance, quality_chances)
    quality_counts.each_with_index { |count, index| quality_samples.fetch(QUALITIES.fetch(index)) << count.to_f / HOURS }
    equipment_samples << quality_counts.sum.to_f / HOURS
    scrolls, max_gap = pity_count(rng, kills, value.call("map.#{map}.ancient_scroll_drop_chance") / 100.0, pity_limit)
    scroll_samples << scrolls.to_f / HOURS
    max_gaps << max_gap
  end

  expected_equipment = kills_per_hour * equipment_chance
  equipment_mean = equipment_samples.sum / equipment_samples.length
  equipment_margin = Z99 * sample_std(equipment_samples) / Math.sqrt(RUNS)
  abort("#{map} equipment expected rate outside 99% CI") unless expected_equipment.between?(equipment_mean - equipment_margin, equipment_mean + equipment_margin)

  quality_samples.each do |quality, samples|
    expected = expected_equipment * value.call("map.#{map}.equipment_quality_#{quality}_chance") / 100.0
    mean = samples.sum / samples.length
    margin = Z99 * sample_std(samples) / Math.sqrt(RUNS)
    abort("#{map} #{quality} expected rate outside 99% CI") unless expected.between?(mean - margin, mean + margin)
    summaries << [map, quality, expected, mean, margin]
  end

  scroll_mean = scroll_samples.sum / scroll_samples.length
  scroll_margin = Z99 * sample_std(scroll_samples) / Math.sqrt(RUNS)
  expected_scroll = expected_pity_rate(value, map)
  abort("#{map} scroll expected rate outside 99% CI") unless expected_scroll.between?(scroll_mean - scroll_margin, scroll_mean + scroll_margin)
  abort("#{map} scroll pity gap exceeded") unless max_gaps.max <= pity_limit
  puts "#{map} equipment expected=#{expected_equipment.round(5)}/h mean=#{equipment_mean.round(5)} ci99=+/-#{equipment_margin.round(5)} scroll expected=#{expected_scroll.round(5)}/h mean=#{scroll_mean.round(5)} ci99=+/-#{scroll_margin.round(5)} max_gap=#{max_gaps.max}"
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 maps=#{MAPS.length} qualities=#{QUALITIES.length} runs=#{RUNS} horizon=#{HOURS}h confidence=99% equipment_and_scroll_pity=checked"
