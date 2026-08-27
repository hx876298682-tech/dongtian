#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

def expected_cycle(probability, pity_clears)
  (1 - (1 - probability)**pity_clears) / probability
end

pity = {
  herb: value.call("dungeon.pity.millennium_herb_clears").to_i,
  meteor: value.call("dungeon.pity.meteor_iron_clears").to_i,
  technique: value.call("dungeon.pity.technique_clears").to_i,
  treasure: value.call("dungeon.pity.treasure_clears").to_i
}
abort("invalid pity limits") unless pity.values.all? { |limit| limit.positive? }

tiers = {
  "qing_feng" => [600, [0.20, 0.10, 0.05, 0.01]],
  "yan_prison" => [1200, [0.35, 0.20, 0.10, 0.03]],
  "sky_abyss" => [2400, [0.50, 0.35, 0.20, 0.08]]
}
tiers.each do |id, (clear_seconds, probabilities)|
  clears_per_hour = 3600.0 / clear_seconds
  cycles = probabilities.zip([pity[:herb], pity[:meteor], pity[:technique], pity[:treasure]]).map do |probability, limit|
    expected_cycle(probability, limit)
  end
  rates = cycles.map { |cycle| clears_per_hour / cycle }
  abort("#{id} pity expectation invalid") unless cycles.all?(&:positive?) && rates.all?(&:positive?)
  puts [id, "herb=#{rates[0].round(4)}/h", "meteor=#{rates[1].round(4)}/h", "technique=#{rates[2].round(4)}/h", "treasure=#{rates[3].round(4)}/h"].join(" ")
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 pity_types=4 guarantee_limits=#{pity.values.join('/') }"
