#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

abort("normal auto salvage disabled") unless value.call("loot.equipment.auto_salvage.normal_enabled") == 1
abort("fine auto salvage disabled") unless value.call("loot.equipment.auto_salvage.fine_enabled") == 1
abort("rare auto salvage must be disabled") unless value.call("loot.equipment.auto_salvage.rare_enabled") == 0
abort("normal salvage mismatch") unless [value.call("loot.equipment.salvage.normal.spirit_ore"), value.call("loot.equipment.salvage.normal.spirit_wood")] == [1, 1]
abort("fine salvage mismatch") unless [value.call("loot.equipment.salvage.fine.spirit_ore"), value.call("loot.equipment.salvage.fine.spirit_wood")] == [2, 2]
abort("immortal quality must remain") unless value.call("loot.equipment.auto_salvage.immortal_enabled") == 0
puts "validated rows=#{rows.length} duplicate_parameter_id=0 auto_salvage=normal,fine"
