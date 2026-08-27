#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

max_stars = value.call("growth.treasure.max_stars")
abort("max stars must be 10") unless max_stars == 10
abort("duplicate copy must add one star") unless value.call("growth.treasure.duplicate_copies_per_star") == 1
abort("lamp effect mismatch") unless value.call("growth.treasure.qing_lian_lamp.attack_per_star") * max_stars == 100
abort("seal effect mismatch") unless value.call("growth.treasure.shan_he_seal.defence_per_star") * max_stars == 100
abort("bag effect mismatch") unless value.call("growth.treasure.heaven_bag.production_bonus_per_star") * max_stars == 0.05

alchemy = 3600.0 / value.call("building.alchemy_room.base_interval") * value.call("building.alchemy_room.output_per_action")
forge = 3600.0 / value.call("building.forge_room.base_interval") * value.call("building.forge_room.output_per_action")
farm = value.call("building.spirit_farm.plot_count") * value.call("building.spirit_farm.herb_yield_per_plot") * 3600.0 / value.call("building.spirit_farm.base_growth_time")
bonus = 1 + value.call("growth.treasure.heaven_bag.production_bonus_per_star") * max_stars
abort("production multiplier mismatch") unless [(alchemy * bonus).round, (forge * bonus).round, (farm * bonus).round] == [126, 63, 252]
puts "validated rows=#{rows.length} duplicate_parameter_id=0 treasure_max_stars=#{max_stars} production_multiplier=#{bonus}"
