#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

base_rate = 3600.0 / value.call("building.alchemy_room.base_interval") * value.call("building.alchemy_room.output_per_action")
speed = (1..value.call("building.level.max").to_i).to_h { |level| [level, value.call("building.level.speed_multiplier_#{level}")] }
rates = speed.transform_values { |multiplier| base_rate * multiplier }
bonus = 1 + value.call("growth.treasure.heaven_bag.production_bonus_per_star") * value.call("growth.treasure.max_stars")
treasure_rate = rates.transform_values { |rate| (rate * bonus).floor }
farm_rate = (1..value.call("building.level.max").to_i).to_h do |level|
  [level, value.call("building.spirit_farm.plot_count") * value.call("building.spirit_farm.herb_yield_per_plot") * 3600.0 / value.call("building.spirit_farm.base_growth_time") * speed.fetch(level)]
end
effective_rate = lambda do |alchemy_level, farm_level, bag_stars|
  nominal = rates.fetch(alchemy_level) * (1 + value.call("growth.treasure.heaven_bag.production_bonus_per_star") * bag_stars)
  [nominal, farm_rate.fetch(farm_level) / value.call("recipe.alchemy_basic.herb_cost"), value.call("economy.resource.spirit_stone.base_rate") / value.call("recipe.alchemy_basic.stone_cost")].min
end

pill_demand = {
  "qing_feng" => 3600.0 / value.call("dungeon.qing_feng.target_clear_time") * (value.call("dungeon.qing_feng.pill_cost") + value.call("dungeon.qing_feng.boss_auto_pill_per_clear")),
  "yan_prison" => 3600.0 / value.call("dungeon.yan_prison.target_clear_time") * (value.call("dungeon.yan_prison.pill_cost") + value.call("dungeon.yan_prison.boss_auto_pill_per_clear")),
  "sky_abyss" => 3600.0 / value.call("dungeon.sky_abyss.target_clear_time") * (value.call("dungeon.sky_abyss.pill_cost") + value.call("dungeon.sky_abyss.boss_auto_pill_per_clear"))
}
abort("qing feng must sustain at level 1") unless effective_rate.call(1, 1, 0) >= pill_demand.fetch("qing_feng")
abort("yan prison must sustain at level 1") unless effective_rate.call(1, 1, 0) >= pill_demand.fetch("yan_prison")
minimum_sky_level = value.call("dungeon.sky_abyss.minimum_alchemy_room_level").to_i
abort("sky abyss minimum level mismatch") unless minimum_sky_level == 3
abort("sky abyss must fail with level 1 farm") unless effective_rate.call(minimum_sky_level, 1, 0) < pill_demand.fetch("sky_abyss")
abort("sky abyss must sustain with level 3 farm") unless effective_rate.call(minimum_sky_level, 3, 0) >= pill_demand.fetch("sky_abyss")
abort("10-star treasure must not sustain below the updated skill demand") unless effective_rate.call(2, 3, value.call("growth.treasure.max_stars")) < pill_demand.fetch("sky_abyss")
abort("10-star treasure must not bypass level 1 farm input cap") unless effective_rate.call(2, 1, value.call("growth.treasure.max_stars")) < pill_demand.fetch("sky_abyss")

upgrade_to_three = (1..2).sum { |level| (value.call("building.upgrade.spirit_stone_base_cost.alchemy_room") * value.call("building.upgrade.cost_growth")**(level - 1)).ceil }
abort("alchemy level 3 upgrade cost mismatch") unless upgrade_to_three == 3360
puts "validated rows=#{rows.length} duplicate_parameter_id=0 alchemy_base=#{base_rate} pill_demand=#{pill_demand} farm_rates=#{farm_rate} sky_effective_3_3=#{effective_rate.call(3, 3, 0)} sky_effective_2_3_bag10=#{effective_rate.call(2, 3, value.call("growth.treasure.max_stars"))} upgrade_to3=#{upgrade_to_three}"
