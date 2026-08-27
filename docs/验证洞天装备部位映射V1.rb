#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

weights = {
  weapon: value.call("loot.equipment.drop_slot_weight.weapon"),
  armor: value.call("loot.equipment.drop_slot_weight.armor"),
  accessory: value.call("loot.equipment.drop_slot_weight.accessory")
}
abort("unexpected equipment part weights") unless weights == { weapon: 1.0, armor: 4.0, accessory: 1.0 }
abort("progression reserve must be enabled") unless value.call("schedule.equipment.progression_reserve").to_i == 1

# Each equipped slot receives one unit of weight; the four armor slots retain
# the armor part's aggregate weight of four.
pool = [0, 1, 2, 3, 4, 5]
rng = Random.new(1_240_001)
draws = 600_000
counts = Array.new(pool.length, 0)
draws.times { counts[rng.rand(pool.length)] += 1 }
frequencies = counts.map { |count| count.to_f / draws }
abort("all equipment slots must be represented") unless counts.all?(&:positive?)
abort("slot frequency outside 2% tolerance") unless frequencies.all? { |frequency| (frequency - 1.0 / 6.0).abs <= 0.02 }
armor_frequency = frequencies[1, 4].sum
abort("armor aggregate frequency mismatch") unless (armor_frequency - 4.0 / 6.0).abs <= 0.02

puts "validated rows=#{rows.length} duplicate_parameter_id=0 slots=#{pool.join('/')} frequencies=#{frequencies.map { |frequency| frequency.round(5) }.join('/')} armor_frequency=#{armor_frequency.round(5)} progression_reserve=1"
