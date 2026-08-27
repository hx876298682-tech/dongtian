#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }
realms = %w[nascent_soul divine_transformation void_refining body_unity great_vehicle tribulation]

realms.each do |realm|
  prefix = "dungeon.high_tier.#{realm}.boss_failure"
  abort("#{realm} failure must increment revision") unless value.call("#{prefix}.state_revision_increment") == 1
  abort("#{realm} failure must require expected revision") unless value.call("#{prefix}.require_expected_revision") == 1
  abort("#{realm} failure attempt must be idempotent") unless value.call("#{prefix}.idempotent_attempt") == 1
  abort("#{realm} failure cooldown missing") unless value.call("dungeon.high_tier.#{realm}.boss_failure_recovery_seconds") == 60
end

# Two devices race the same failed encounter. Only the first CAS can commit;
# retrying that attempt returns its original failure without changing state.
state = { revision: 4, cooldown_until: 0, pills: 20, pity: 7 }
attempts = {}
commit_failure = lambda do |attempt_id, expected_revision, now|
  return attempts.fetch(attempt_id) if attempts.key?(attempt_id)
  raise "stale revision accepted" unless expected_revision == state[:revision]
  raise "retry before cooldown" if now < state[:cooldown_until]
  state[:revision] += 1
  state[:cooldown_until] = now + 60
  result = { reward: 0, pill_charge: 0, pity_delta: 0, revision: state[:revision] }
  attempts[attempt_id] = result
  result
end

first = commit_failure.call("attempt-1", 4, 1_000)
duplicate = commit_failure.call("attempt-1", 4, 1_000)
abort("duplicate failure changed state") unless first == duplicate && state[:revision] == 5 && state[:pills] == 20 && state[:pity] == 7
begin
  commit_failure.call("attempt-2", 4, 1_001)
  abort("cross-device stale failure accepted")
rescue RuntimeError => error
  raise unless error.message == "stale revision accepted"
end
begin
  commit_failure.call("attempt-3", 5, 1_010)
  abort("failure retry ignored cooldown")
rescue RuntimeError => error
  raise unless error.message == "retry before cooldown"
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 realms=#{realms.length} failure_cas=ok duplicate_attempt=ok cooldown=60s"
