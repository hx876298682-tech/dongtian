#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

max_slots = value.call("loot.equipment.reroll.max_locked_slots").to_i
abort("lock slot count must be 1..2") unless max_slots.between?(1, 2)
weights = %w[armor_break body_protection vitality rejuvenation].map do |affix|
  value.call("loot.equipment.affix.special_pool.#{affix}.weight")
end
abort("special affix pool weights must sum to 100") unless weights.sum == 100
indices = %w[armor_break body_protection vitality rejuvenation].map do |affix|
  value.call("loot.equipment.affix.special_pool.#{affix}.effect_index").to_i
end
abort("special affix effect indices must be unique") unless indices == [0, 1, 2, 3]
abort("lock pill cost must be positive") unless value.call("loot.equipment.reroll.lock_pill_cost").positive?

base = value.call("loot.equipment.reroll.lock_base_cost")
growth = value.call("loot.equipment.reroll.lock_cost_growth")
costs = (0...max_slots).map { |slot| (base * growth**slot).ceil }
abort("lock cost must grow") unless costs.each_cons(2).all? { |a, b| b > a }
abort("lock cost base mismatch") unless costs.first == 500

puts "validated rows=#{rows.length} duplicate_parameter_id=0 lock_slots=#{max_slots} lock_costs=#{costs.join('/')} lock_pill=#{value.call('loot.equipment.reroll.lock_pill_cost')} special_pool_weight=100"
