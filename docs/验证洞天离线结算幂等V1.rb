#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

abort("idempotency disabled") unless value.call("offline.transaction.idempotency_enabled") == 1
abort("clock rollback rejection disabled") unless value.call("offline.transaction.reject_clock_rollback") == 1
abort("overlap handling disabled") unless value.call("offline.transaction.overlap_deduction") == 1
abort("pity counters not persisted") unless value.call("offline.transaction.persist_pity_counters") == 1
abort("random state not persisted") unless value.call("offline.transaction.persist_random_state") == 1
abort("CAS revision disabled") unless value.call("offline.transaction.compare_and_swap_revision") == 1
abort("stale revision rejection disabled") unless value.call("offline.transaction.reject_stale_revision") == 1

ledger = {}
inventory = 0
commit = lambda do |settlement_id, amount|
  return ledger.fetch(settlement_id) if ledger.key?(settlement_id)
  inventory += amount
  ledger[settlement_id] = amount
  amount
end

first = commit.call("s-1", 100)
duplicate = commit.call("s-1", 100)
abort("duplicate settlement changed inventory") unless first == 100 && duplicate == 100 && inventory == 100
abort("new settlement not committed") unless commit.call("s-2", 50) == 50 && inventory == 150
puts "validated rows=#{rows.length} duplicate_parameter_id=0 idempotent_duplicate=ok inventory=#{inventory}"

state = { revision: 7, pity: { ancient_scroll: 12, technique: 3, treasure: 8 }, random_state: 42 }
commit_state = lambda do |settlement_id, expected_revision, next_pity|
  raise "stale revision accepted" unless expected_revision == state[:revision] || ledger.key?(settlement_id)
  return if ledger.key?(settlement_id)
  state[:pity] = next_pity
  state[:random_state] += 1
  state[:revision] += 1
  ledger[settlement_id] = :committed
end
commit_state.call("s-state-1", 7, { ancient_scroll: 13, technique: 4, treasure: 8 })
commit_state.call("s-state-1", 7, { ancient_scroll: 99, technique: 99, treasure: 99 })
abort("duplicate state settlement changed pity") unless state[:pity] == { ancient_scroll: 13, technique: 4, treasure: 8 } && state[:revision] == 8
begin
  commit_state.call("s-state-2", 7, { ancient_scroll: 0, technique: 0, treasure: 0 })
  abort("stale state revision did not reject")
rescue RuntimeError => error
  raise unless error.message == "stale revision accepted"
end
puts "validated state_persistence=pity+random_state cas_revision=ok stale_revision=rejected"
