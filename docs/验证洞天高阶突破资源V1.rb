#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

realms = %w[core nascent_soul divine_transformation void_refining body_unity great_vehicle tribulation]
targets = { "core" => value.call("growth.cultivation.core_target_xp") }
realms.drop(1).each { |realm| targets[realm] = value.call("growth.realm.#{realm}.target_xp") }
base_caps = %w[spirit_stone pill ancient_scroll demon_core millennium_herb meteor_iron].to_h do |resource|
  [resource, value.call("economy.inventory.cap.#{resource}")]
end
base_resources = { "spirit_stone" => 50_000, "pill" => 200, "ancient_scroll" => 20, "demon_core" => 50, "millennium_herb" => 100, "meteor_iron" => 100 }

realms.each_cons(2).with_index do |(from, to), index|
  prefix = "breakthrough.#{from}_to_#{to}"
  expected_cultivation = ((targets.fetch(to) - targets.fetch(from)) * 0.35).round
  actual_cultivation = value.call("#{prefix}.cultivation_cost")
  abort("#{prefix} cultivation mismatch") unless actual_cultivation == expected_cultivation
  destination_multiplier = value.call("economy.inventory.cap_multiplier.#{to}")
  base_resources.each do |resource, base_cost|
    cost = value.call("#{prefix}.#{resource}_cost")
    expected_cost = base_cost * (4**index)
    abort("#{prefix} #{resource} growth mismatch") unless cost == expected_cost
    abort("#{prefix} #{resource} exceeds destination capacity") unless cost <= base_caps.fetch(resource) * destination_multiplier
  end
  puts [prefix, "cultivation=#{actual_cultivation.to_i}", "capacity_multiplier=#{destination_multiplier.to_i}", "max_resource_ratio=#{base_resources.keys.map { |resource| value.call("#{prefix}.#{resource}_cost") / base_caps.fetch(resource) }.max.round(4)}"].join(" ")
end

expected_multipliers = { "core" => 1, "nascent_soul" => 4, "divine_transformation" => 16, "void_refining" => 64, "body_unity" => 256, "great_vehicle" => 1024, "tribulation" => 4096 }
expected_multipliers.each { |realm, multiplier| abort("#{realm} capacity multiplier mismatch") unless value.call("economy.inventory.cap_multiplier.#{realm}") == multiplier }
puts "validated rows=#{rows.length} duplicate_parameter_id=0 high_tier_transitions=6 capacity_rule=4x destination_fit=ok"
