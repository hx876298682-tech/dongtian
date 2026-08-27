#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

realm = "nascent_soul"
prefix = "dungeon.high_tier.#{realm}"
drop_prefix = "#{prefix}.boss_drop"
abort("entry gate must be enabled") unless by_id.fetch("dungeon.high_tier.entry_gate.enabled")["value"] == "1"
abort("entry gate profile mismatch") unless by_id.fetch("dungeon.high_tier.entry_gate.profile")["value"] == "collected_p10"
budget = value.call("#{prefix}.boss_pill_budget_per_encounter")
cooldown = value.call("#{prefix}.boss_failure_recovery_seconds")
natural_failure_rate = value.call("#{prefix}.boss_natural_failure_rate")
abort("candidate natural failure rate must be bounded") unless natural_failure_rate.between?(0, 100)
abort("candidate failure stop policy must be local") unless value.call("#{prefix}.boss_failure_stops_expedition").to_i == 0

state = {
  revision: 4,
  cooldown_until: 0,
  pill: budget,
  ancient_scroll: 0,
  demon_core: 0,
  equipment: 0,
  pity: 9
}
attempts = {}

resolve = lambda do |attempt_id:, expected_revision:, now:, outcome:, equipment_roll: false, gate_met: true|
  return attempts.fetch(attempt_id) if attempts.key?(attempt_id)
  return { outcome: :entry_blocked, reward: 0, pill_charge: 0, pity_delta: 0, revision: state[:revision] } unless gate_met
  raise "stale revision accepted" unless expected_revision == state[:revision]
  raise "encounter started during cooldown" if now < state[:cooldown_until]

  if outcome == :failure
    state[:revision] += value.call("#{prefix}.boss_failure.state_revision_increment").to_i
    state[:cooldown_until] = now + cooldown
    result = { outcome: :failure, reward: 0, pill_charge: 0, pity_delta: 0, revision: state[:revision] }
  elsif outcome == :success
    raise "success charged insufficient pills" if state[:pill] + 1e-9 < budget
    state[:pill] -= budget
    state[:ancient_scroll] += value.call("#{drop_prefix}.ancient_scroll.amount")
    state[:demon_core] += value.call("#{drop_prefix}.demon_core.amount")
    state[:equipment] += value.call("#{drop_prefix}.equipment.amount") if equipment_roll
    result = { outcome: :success, reward: 1, pill_charge: budget, pity_delta: 0, revision: state[:revision] }
  else
    raise "unknown encounter outcome"
  end
  attempts[attempt_id] = result
  result
end

# A failed encounter writes only recovery state. Retrying the same request is
# idempotent; the next distinct attempt can succeed after the 60-second lockout.
blocked_before = state.dup
blocked = resolve.call(attempt_id: "entry-blocked", expected_revision: 4, now: 900, outcome: :success, gate_met: false)
abort("entry gate did not block underpowered profile") unless blocked[:outcome] == :entry_blocked && state == blocked_before
failed = resolve.call(attempt_id: "encounter-1", expected_revision: 4, now: 1_000, outcome: :failure)
duplicate = resolve.call(attempt_id: "encounter-1", expected_revision: 4, now: 1_001, outcome: :failure)
abort("failure changed rewards or pill state") unless failed == duplicate && state[:pill] == budget && state[:ancient_scroll].zero? && state[:demon_core].zero? && state[:equipment].zero? && state[:pity] == 9

begin
  resolve.call(attempt_id: "encounter-2", expected_revision: 5, now: 1_059, outcome: :success)
  abort("cooldown was bypassed")
rescue RuntimeError => error
  raise unless error.message == "encounter started during cooldown"
end

success = resolve.call(attempt_id: "encounter-2", expected_revision: 5, now: 1_060, outcome: :success, equipment_roll: true)
abort("success did not charge registered encounter budget") unless success[:pill_charge] == budget && state[:pill].zero?
abort("success did not grant independent resources") unless state[:ancient_scroll] == value.call("#{drop_prefix}.ancient_scroll.amount") && state[:demon_core] == value.call("#{drop_prefix}.demon_core.amount")
abort("success equipment roll was not isolated") unless state[:equipment] == value.call("#{drop_prefix}.equipment.amount") && state[:pity] == 9

puts "validated rows=#{rows.length} duplicate_parameter_id=0 realm=#{realm} entry_gate=collected_p10 failed_reward=0 failed_pill_charge=0 failed_pity_delta=0 cooldown=#{cooldown}s retry_success_pill_charge=#{budget} independent_drop=success_only"
