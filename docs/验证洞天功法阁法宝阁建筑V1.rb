#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

levels = (1..value.call("building.level.max").to_i).to_a
speed = levels.to_h { |level| [level, value.call("building.level.speed_multiplier_#{level}")] }
growth = value.call("building.upgrade.cost_growth")
cost_for = lambda do |building, level|
  (value.call("building.upgrade.spirit_stone_base_cost.#{building}") * growth**(level - 1)).ceil
end

%w[technique_pavilion treasure_pavilion].each do |building|
  base = value.call("building.upgrade.spirit_stone_base_cost.#{building}")
  costs = (1..4).map { |level| (base * growth**(level - 1)).ceil }
  abort("#{building} upgrade costs mismatch") unless costs == (1..4).map { |level| cost_for.call(building, level) }
  abort("#{building} upgrade costs must increase") unless costs.each_cons(2).all? { |a, b| b > a }
  puts "#{building} upgrade_costs=#{costs.join('/')} total=#{costs.sum}"
end

base_actions = 3600.0 / value.call("building.technique_pavilion.base_interval")
base_xp = value.call("building.technique_pavilion.research_xp_per_action")
research_rates = speed.transform_values { |multiplier| base_actions * base_xp * multiplier }
abort("technique pavilion level 1 rate mismatch") unless research_rates.fetch(1) == 4200.0
abort("technique pavilion level 5 rate mismatch") unless research_rates.fetch(5) == 7140.0

qualities = %w[mortal yellow xuan earth heaven immortal]
research_costs = qualities.to_h do |quality|
  multiplier = value.call("growth.technique.quality_multiplier.#{quality}")
  total = (0...value.call("growth.technique.max_layer").to_i - 1).sum do |layer|
    (value.call("growth.technique.research_base_cost") * value.call("growth.technique.research_growth")**layer * multiplier).ceil
  end
  [quality, total]
end
level1_hours = research_costs.transform_values { |cost| cost / research_rates.fetch(1) }
level5_hours = research_costs.transform_values { |cost| cost / research_rates.fetch(5) }
abort("pavilion speed must reduce research time") unless qualities.all? { |quality| level5_hours.fetch(quality) < level1_hours.fetch(quality) }

token_multiplier = levels.to_h { |level| [level, value.call("building.treasure_pavilion.token_multiplier_#{level}")] }
abort("treasure pavilion token multipliers must increase") unless token_multiplier.values.each_cons(2).all? { |a, b| b > a }
abort("treasure pavilion level 5 multiplier mismatch") unless token_multiplier.fetch(5) == 2.0

raw_tokens = 30.0
exchange_cost = value.call("growth.treasure.collection_token_exchange_cost")
exchanges = levels.to_h { |level| [level, (raw_tokens * token_multiplier.fetch(level) / exchange_cost).floor] }
abort("level 5 must double exchanges") unless exchanges.fetch(5) == exchanges.fetch(1) * 2
abort("token carry must not lose fractional value") unless ((raw_tokens * token_multiplier.fetch(3)) % exchange_cost) >= 0

puts "validated rows=#{rows.length} duplicate_parameter_id=0 research_rate=#{research_rates} mortal_hours=#{level1_hours.fetch('mortal').round(3)}/#{level5_hours.fetch('mortal').round(3)} token_multiplier=#{token_multiplier} exchanges=#{exchanges} modifier_order=interval_then_action_and_token_carry"
