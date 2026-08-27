#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
raw = ->(id) { by_id.fetch(id)["value"].to_s }
value = ->(id) { Float(raw.call(id)) }

QUALITIES = %w[normal fine rare epic legendary immortal].freeze
MAPS = %w[bai_cao_valley black_wind_valley red_flame_cave].freeze
AFFIX_KINDS = %w[speed element special].freeze

def expected_sale_distribution(value, quality)
  slots = value.call("loot.equipment.affix.utility_slots.#{quality}").to_i
  weights = AFFIX_KINDS.to_h { |kind| [kind, value.call("loot.equipment.affix.roll_weight.#{kind}")] }
  speed_rating = %w[normal fine].include?(quality) ? 0.0 : value.call("loot.equipment.affix.speed_rating.#{quality}")
  special_grade = %w[normal fine].include?(quality) ? 0.0 : value.call("loot.equipment.affix.special_grade.#{quality}")
  speed_value = speed_rating * value.call("loot.equipment.affix.sale.speed_value_per_point")
  special_value = special_grade * value.call("loot.equipment.affix.sale.special_value_per_grade")
  states = { false => { 0.0 => 1.0 }, true => {} }
  slots.times do
    next_states = { false => Hash.new(0.0), true => Hash.new(0.0) }
    states.each do |element_active, distribution|
      available = element_active ? weights.reject { |kind, _weight| kind == "element" } : weights
      total = available.values.sum
      available.each do |kind, weight|
        add = { "speed" => speed_value, "element" => value.call("loot.equipment.affix.sale.element_value"), "special" => special_value }.fetch(kind)
        distribution.each do |current, probability|
          next_states[element_active || kind == "element"][current + add] += probability * weight / total
        end
      end
    end
    states = next_states
  end
  states.values.flat_map(&:to_a).group_by(&:first).transform_values { |pairs| pairs.sum { |_sale, probability| probability } }
end

expected_sale = {}
QUALITIES.each do |quality|
  distribution = expected_sale_distribution(value, quality)
  quality_value = value.call("loot.equipment.value.#{quality}")
  expected = distribution.sum { |affix_value, probability| ((quality_value + affix_value) * 0.5).floor * probability }
  registered = value.call("loot.equipment.affix.expected_sale_spirit_stone.#{quality}")
  abort("#{quality} registered expected sale mismatch") unless (expected - registered).abs < 0.00001
  expected_sale[quality] = distribution.transform_keys { |affix_value| ((quality_value + affix_value) * 0.5).floor }
end

abort("affix-adjusted sale must exceed base for rare+") unless %w[rare epic legendary immortal].all? do |quality|
  value.call("loot.equipment.affix.expected_sale_spirit_stone.#{quality}") > value.call("loot.equipment.sell.spirit_stone.#{quality}")
end

MAPS.each do |map_id|
  equipment_per_hour = 3600.0 / value.call("map.#{map_id}.target_kill_time") * value.call("map.#{map_id}.equipment_drop_chance") / 100.0
  expected_per_equipment = QUALITIES.sum do |quality|
    value.call("map.#{map_id}.equipment_quality_#{quality}_chance") / 100.0 * value.call("loot.equipment.affix.expected_sale_spirit_stone.#{quality}")
  end
  expected_per_hour = equipment_per_hour * expected_per_equipment
  samples = 5_000.times.map do |index|
    rng = Random.new(3_100_000 + index * 17 + map_id.length)
    roll = rng.rand * 100.0
    cursor = 0.0
    quality = QUALITIES.find do |candidate|
      cursor += value.call("map.#{map_id}.equipment_quality_#{candidate}_chance")
      roll < cursor
    end || QUALITIES.last
    distribution = expected_sale.fetch(quality)
    pick = rng.rand
    sale = distribution.each_with_object(nil) do |(amount, probability), selected|
      break amount if pick < probability
      pick -= probability
    end || distribution.keys.last
    sale
  end
  mean = samples.sum.to_f / samples.length
  variance = samples.sum { |sample| (sample - mean) ** 2 } / (samples.length - 1)
  ci99 = 2.576 * Math.sqrt(variance / samples.length)
  abort("#{map_id} sale sample outside 99% CI") unless (mean - expected_per_equipment).abs <= ci99
  puts "map=#{map_id} equipment_per_hour=#{equipment_per_hour.round(4)} expected_sale_per_equipment=#{expected_per_equipment.round(4)} expected_sale_stone_per_hour=#{expected_per_hour.round(2)} sample=#{mean.round(4)} ci99=#{ci99.round(4)}"
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 maps=#{MAPS.length} quality_sale=affix_adjusted samples=5000 confidence=99%"
