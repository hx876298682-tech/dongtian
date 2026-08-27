#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

qualities = %w[normal fine rare epic legendary immortal]
maps = %w[bai_cao_valley black_wind_valley red_flame_cave]

quality_multipliers = qualities.to_h do |quality|
  [quality, value.call("loot.equipment.quality.multiplier.#{quality}")]
end

maps.each do |map_id|
  chances = qualities.to_h do |quality|
    [quality, value.call("map.#{map_id}.equipment_quality_#{quality}_chance")]
  end
  total = chances.values.sum
  abort("#{map_id}: quality chance sum=#{total}") unless total == 100
  expected = chances.sum { |quality, chance| chance / 100.0 * quality_multipliers.fetch(quality) }
  recorded = value.call("map.#{map_id}.equipment_quality_expected_multiplier")
  abort("#{map_id}: expected multiplier=#{expected}, recorded=#{recorded}") unless (expected - recorded).abs < 0.000001
  puts [map_id, "chance_sum=#{total}", "expected_multiplier=#{format("%.4f", expected)}"].join(" ")
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0"
