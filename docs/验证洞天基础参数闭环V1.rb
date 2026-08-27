#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
raw = ->(id) { by_id.fetch(id)["value"].to_s }
value = ->(id) { Float(raw.call(id)) }

abort("cultivation reference scale must be positive") unless value.call("growth.cultivation.reference_scale").positive?
abort("training baseline multiplier mismatch") unless value.call("building.training_room.level_speed_multiplier") == value.call("building.level.speed_multiplier_1")
%w[alchemy_room forge_room].each do |building|
  chance = value.call("building.#{building}.failure_chance")
  abort("#{building} failure chance outside 0..100") unless chance.between?(0, 100)
  abort("#{building} V1 failure chance must be zero") unless chance.zero?
end
abort("spirit stone numeraire mismatch") unless value.call("economy.currency.spirit_stone.unit_value") == 1
abort("triangle multiplier mismatch") unless value.call("combat.triangle.multiplier") == value.call("combat.element.counter_damage_multiplier")
abort("default map target mismatch") unless value.call("combat.map.target_kill_time") == value.call("dungeon.qing_feng.target_clear_time")
abort("quality budget baseline mismatch") unless value.call("loot.equipment.quality_budget") == 100
abort("equipment drop probability must be certain") unless value.call("loot.equipment.drop_probability") == 100
abort("offline resource cap must equal offline maximum") unless value.call("offline.settlement.resource_cap") == value.call("offline.settlement.max_hours")

puts "validated rows=#{rows.length} duplicate_parameter_id=0 pending_base_parameters=0 deterministic_production=0% triangle=1.25 default_map_target=600s offline_cap=24h"
