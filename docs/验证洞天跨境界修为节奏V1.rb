#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

base_rate = value.call("building.training_room.base_cultivation_rate")
early = [
  ["qi", value.call("growth.cultivation.qi_target_xp"), value.call("growth.pacing.qi_complete_hours"), value.call("growth.cultivation.qi_efficiency_multiplier")],
  ["foundation", value.call("growth.cultivation.foundation_target_xp") - value.call("growth.cultivation.qi_target_xp"), value.call("growth.pacing.foundation_entry_hours") - value.call("growth.pacing.qi_complete_hours"), value.call("growth.cultivation.foundation_efficiency_multiplier")],
  ["core", value.call("growth.cultivation.core_target_xp") - value.call("growth.cultivation.foundation_target_xp"), value.call("growth.pacing.core_complete_hours") - value.call("growth.pacing.foundation_entry_hours"), value.call("growth.cultivation.core_efficiency_multiplier")]
]
early.each do |realm, xp, hours, efficiency|
  achieved = base_rate * efficiency * hours
  abort("#{realm} pacing mismatch") unless (achieved - xp).abs <= 0.01
  puts "realm=#{realm} xp=#{xp.round} hours=#{hours.round} required_rate=#{(xp / hours).round(4)} achieved_rate=#{(base_rate * efficiency).round(4)}"
end

realms = %w[nascent_soul divine_transformation void_refining body_unity great_vehicle tribulation]
previous_xp = value.call("growth.cultivation.core_target_xp")
previous_hours = value.call("growth.pacing.core_complete_hours")
substage_count = value.call("growth.realm.substage_count").to_i
share = value.call("growth.realm.high_tier_training_share")
abort("high-tier training share must be 0..1") unless share.positive? && share <= 1
abort("substage count must be at least two") unless substage_count >= 2
available_rate = base_rate * share

realms.each do |realm|
  xp = value.call("growth.realm.#{realm}.target_xp")
  hours = value.call("growth.realm.#{realm}.target_hours")
  segment_xp = xp - previous_xp
  segment_hours = hours - previous_hours
  required_rate = segment_xp / segment_hours
  abort("#{realm} passive training rate is insufficient") unless available_rate + 1e-9 >= required_rate
  abort("#{realm} substage duration too short") unless segment_hours / substage_count >= 24
  puts "realm=#{realm} segment_xp=#{segment_xp.round} segment_hours=#{segment_hours.round} required_rate=#{required_rate.round(4)} available_rate=#{available_rate.round(4)} substage_xp=#{(segment_xp / substage_count).round} substage_hours=#{(segment_hours / substage_count).round(2)}"
  previous_xp = xp
  previous_hours = hours
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 early_pacing=exact high_realm_training_share=#{share} substages=#{substage_count} high_realm_pacing=covered"
