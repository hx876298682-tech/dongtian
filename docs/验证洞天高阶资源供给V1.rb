#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

realms = %w[core nascent_soul divine_transformation void_refining body_unity great_vehicle tribulation]
hours = { "core" => 168 }
realms.drop(1).each { |realm| hours[realm] = value.call("growth.realm.#{realm}.target_hours") }
resources = %w[spirit_stone pill ancient_scroll demon_core millennium_herb meteor_iron]
window_ratio = value.call("dungeon.high_tier.supply_window_ratio")
abort("supply window ratio must be between 0 and 1") unless window_ratio.positive? && window_ratio <= 1

realms.each_cons(2).with_index do |(from, to), index|
  transition_hours = hours.fetch(to) - hours.fetch(from)
  configured_hours = value.call("dungeon.high_tier.#{to}.transition_hours")
  abort("#{to} transition hours mismatch") unless configured_hours == transition_hours
  costs = resources.to_h { |resource| [resource, value.call("breakthrough.#{from}_to_#{to}.#{resource}_cost")] }
  resources.each do |resource|
    rate = value.call("dungeon.high_tier.#{to}.#{resource}_per_hour")
    combat_demand = if resource == "pill" && by_id.key?("dungeon.high_tier.#{to}.combat_pill_cost_included") && value.call("dungeon.high_tier.#{to}.combat_pill_cost_included").to_i == 1
      value.call("dungeon.high_tier.#{to}.boss_pill_budget_per_encounter") / value.call("dungeon.high_tier.boss_encounter_interval_hours")
    else
      0.0
    end
    supplied = (rate - combat_demand) * transition_hours * window_ratio
    abort("#{to} #{resource} supply mismatch") unless (supplied - costs.fetch(resource)).abs < 0.01
  end
  puts ["#{from}_to_#{to}", "transition_hours=#{transition_hours}", "effective_supply_hours=#{(transition_hours * window_ratio).round(2)}", "stone_rate=#{value.call("dungeon.high_tier.#{to}.spirit_stone_per_hour").round(4)}"].join(" ")
end

first_transition = hours.fetch("nascent_soul") - hours.fetch("core")
thirty_day_effective_hours = 720 * window_ratio
abort("30-day horizon cannot fund first high-tier transition") unless thirty_day_effective_hours >= first_transition * window_ratio
puts "validated rows=#{rows.length} duplicate_parameter_id=0 high_tier_supply_transitions=6 first_transition_30d=reachable supply_window=#{window_ratio}"
