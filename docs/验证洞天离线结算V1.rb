#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

batch_interval = value.call("offline.settlement.batch_interval")
max_hours = value.call("offline.settlement.max_hours")
resource_cap_hours = value.call("offline.settlement.resource_cap_hours")
carry = value.call("offline.settlement.remainder_carry")
stop_on_failure = value.call("offline.settlement.combat_stop_on_failure")

abort("batch interval must be 60s") unless batch_interval == 60
abort("max offline hours must be 24") unless max_hours == 24
abort("resource cap hours must be 24") unless resource_cap_hours == 24
abort("remainder carry must be enabled") unless carry == 1
abort("combat must stop on first failure") unless stop_on_failure == 1

base_action_xp = value.call("building.training_room.base_cultivation_xp")
actions_per_hour = value.call("building.training_room.base_actions_per_hour")
qi_efficiency = value.call("growth.cultivation.qi_efficiency_multiplier")
day_xp = base_action_xp * actions_per_hour * qi_efficiency * max_hours
target_xp = value.call("growth.cultivation.qi_target_xp")
abort("24h cultivation=#{day_xp}, target=#{target_xp}") unless day_xp.round == target_xp.round

puts "validated rows=#{rows.length} duplicate_parameter_id=0 offline_cap=#{max_hours}h qi_24h=#{day_xp.round(6)}"
