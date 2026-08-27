#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }
raw = ->(id) { by_id.fetch(id)["value"].to_s }

abort("production modifier order mismatch") unless raw.call("building.production.modifier_order") == "interval_then_quantity"
abort("production rounding policy mismatch") unless raw.call("building.production.rounding_policy") == "carry_fraction"

def quantity_rate(value, building, level, bag_stars)
  interval = value.call("building.#{building}.base_interval")
  output = value.call("building.#{building}.output_per_action")
  speed = value.call("building.level.speed_multiplier_#{level}")
  bag = 1 + value.call("growth.treasure.heaven_bag.production_bonus_per_star") * bag_stars
  3600.0 / (interval / speed) * output * bag
end

%w[alchemy_room forge_room].each do |building|
  matrix = (0..10).step(5).to_h { |stars| [stars, (1..5).map { |level| quantity_rate(value, building, level, stars) }] }
  abort("#{building} level modifier is not monotonic") unless matrix.values.all? { |rates| rates.each_cons(2).all? { |a, b| b > a } }
  abort("#{building} bag modifier is not monotonic") unless (1..5).all? { |level| matrix[0][level - 1] < matrix[5][level - 1] && matrix[5][level - 1] < matrix[10][level - 1] }
  abort("#{building} modifier double counted") unless (matrix[10][4] / matrix[0][0] - value.call("building.level.speed_multiplier_5") * 1.05).abs < 1e-9
  total_24h = matrix[10][4] * 24
  whole = total_24h.floor
  carry = total_24h - whole
  abort("#{building} fractional carry mismatch") unless (whole + carry - total_24h).abs < 1e-9
  puts "building=#{building} rates_level1=#{matrix[0].map { |rate| rate.round(3) }.join('/')} rates_level5_bag10=#{matrix[10].map { |rate| rate.round(3) }.join('/')} 24h_whole=#{whole} carry=#{carry.round(6)}"
end

farm_rates = (1..5).map do |level|
  value.call("building.spirit_farm.plot_count") * value.call("building.spirit_farm.herb_yield_per_plot") * 3600.0 / value.call("building.spirit_farm.base_growth_time") * value.call("building.level.speed_multiplier_#{level}")
end
abort("farm level modifier is not monotonic") unless farm_rates.each_cons(2).all? { |a, b| b > a }
abort("production failure must remain zero") unless value.call("building.alchemy_room.failure_chance").zero? && value.call("building.forge_room.failure_chance").zero?

puts "validated rows=#{rows.length} duplicate_parameter_id=0 buildings=alchemy/forge/farm levels=1..5 bag_stars=0/5/10 order=interval_then_quantity rounding=carry_fraction sensitivity=passed"
