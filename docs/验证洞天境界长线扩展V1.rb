#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

realms = %w[nascent_soul divine_transformation void_refining body_unity great_vehicle tribulation]
previous_xp = value.call("growth.cultivation.core_target_xp")
previous_hours = value.call("growth.pacing.core_complete_hours")
realms.each do |realm|
  xp = value.call("growth.realm.#{realm}.target_xp")
  hours = value.call("growth.realm.#{realm}.target_hours")
  abort("#{realm}: xp not increasing") unless xp > previous_xp
  abort("#{realm}: time not increasing") unless hours > previous_hours
  previous_xp = xp
  previous_hours = hours
end

abort("flight must be event after tribulation") unless by_id.fetch("growth.realm.ascension.trigger")["value"] == "after_tribulation"
puts "validated rows=#{rows.length} duplicate_parameter_id=0 long_term_realms=#{realms.length}"
