#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

transitions = %w[normal_to_fine fine_to_rare rare_to_epic epic_to_legendary legendary_to_immortal]
stone_total = transitions.sum { |transition| value.call("loot.equipment.promotion.#{transition}.spirit_stone_cost") }
herb_total = transitions.sum { |transition| value.call("loot.equipment.promotion.#{transition}.millennium_herb_cost") }
meteor_total = transitions.sum { |transition| value.call("loot.equipment.promotion.#{transition}.meteor_iron_cost") }
abort("promotion costs mismatch") unless [stone_total, herb_total, meteor_total] == [15_500, 155, 230]
abort("promotion must be guaranteed") unless value.call("loot.equipment.promotion.success_chance") == 100
abort("enhancement inheritance must be enabled") unless value.call("loot.equipment.promotion.enhancement_preserved") == 1

wash_total = (0...5).sum { |attempt| (value.call("loot.equipment.reroll.spirit_stone_base_cost") * value.call("loot.equipment.reroll.spirit_stone_growth")**attempt).ceil }
abort("wash cost mismatch") unless wash_total == 3_957

awakening_levels = value.call("loot.equipment.awakening.max_level").to_i
awakening_stone_total = (0...awakening_levels).sum { |level| (value.call("loot.equipment.awakening.spirit_stone_base_cost") * value.call("loot.equipment.awakening.spirit_stone_growth")**level).ceil }
awakening_demon_total = awakening_levels * value.call("loot.equipment.awakening.demon_core_per_level")
awakening_meteor_total = awakening_levels * value.call("loot.equipment.awakening.meteor_iron_per_level")
abort("awakening cost mismatch") unless [awakening_stone_total, awakening_demon_total, awakening_meteor_total] == [13_188, 25, 25]
abort("awakening multiplier mismatch") unless value.call("loot.equipment.awakening.stat_multiplier_per_level") * awakening_levels == 0.15
puts "validated rows=#{rows.length} duplicate_parameter_id=0 promotion_stone=#{stone_total} wash_5=#{wash_total} awakening_stone=#{awakening_stone_total}"
