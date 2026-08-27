#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

realms = %w[nascent_soul divine_transformation void_refining body_unity great_vehicle tribulation]
interval = value.call("dungeon.high_tier.boss_encounter_interval_hours")
abort("high-tier Boss interval must be positive") unless interval.positive?
transition_from = { "nascent_soul" => "core", "divine_transformation" => "nascent_soul", "void_refining" => "divine_transformation", "body_unity" => "void_refining", "great_vehicle" => "body_unity", "tribulation" => "great_vehicle" }
realms.each do |realm|
  abort("#{realm} combat pill inclusion must be enabled") unless value.call("dungeon.high_tier.#{realm}.combat_pill_cost_included").to_i == 1
  supply = value.call("dungeon.high_tier.#{realm}.pill_per_hour")
  abort("#{realm} high-tier pill supply must be positive") unless supply.positive?
  abort("#{realm} Boss HP multiplier missing") unless value.call("dungeon.high_tier.#{realm}.boss_hp_multiplier").positive?
  budget = value.call("dungeon.high_tier.#{realm}.boss_pill_budget_per_encounter")
  demand = budget / interval
  net_supply = supply - demand
  transition_hours = value.call("dungeon.high_tier.#{realm}.transition_hours")
  base_pill_cost = value.call("breakthrough.#{transition_from.fetch(realm)}_to_#{realm}.pill_cost")
  expected_net = base_pill_cost / (transition_hours * value.call("dungeon.high_tier.supply_window_ratio"))
  abort("#{realm} net pill supply mismatch") unless (net_supply - expected_net).abs < 0.001
  contract_ids = %w[boss_failure_recovery_seconds boss_reward_on_failure boss_pill_charge_on_failure boss_pity_advance_on_failure]
  abort("#{realm} failure recovery contract mismatch") unless value.call("dungeon.high_tier.#{realm}.boss_failure_recovery_seconds") == 60 && contract_ids.drop(1).all? { |suffix| value.call("dungeon.high_tier.#{realm}.#{suffix}").zero? }
  puts "realm=#{realm} supply_with_combat=#{supply.round(6)} combat_demand=#{demand.round(6)} net_breakthrough_supply=#{net_supply.round(6)} encounter_interval=#{interval}h failure_contract=checked"
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 realms=#{realms.length} high_tier_combat_pill_boundary=integrated_partial_pending_future_realms"
