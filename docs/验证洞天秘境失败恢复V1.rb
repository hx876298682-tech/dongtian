#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

def attempt(value, state, pity, random_state, dungeon, now:, success_override: nil)
  cost = value.call("dungeon.#{dungeon}.pill_cost") + value.call("dungeon.#{dungeon}.boss_auto_pill_per_clear")
  if success_override == false || state[:pill] < cost
    return { success: false, state: state.dup, pity: pity.dup, random_state: random_state, reward: 0, retry_at: now + value.call("combat.recovery.failure_cooldown") }
  end
  next_state = state.dup
  next_state[:pill] -= cost
  next_pity = pity.merge(treasure: pity.fetch(:treasure) + 1)
  { success: true, state: next_state, pity: next_pity, random_state: random_state + 1, reward: value.call("dungeon.#{dungeon}.demon_core_per_clear"), retry_at: now }
end

dungeon = "sky_abyss"
cost = value.call("dungeon.#{dungeon}.pill_cost") + value.call("dungeon.#{dungeon}.boss_auto_pill_per_clear")
state = { pill: cost - 1, demon_core: 0 }
pity = { treasure: 7 }
random_state = 42
failed = attempt(value, state, pity, random_state, dungeon, now: 2_400)
abort("insufficient pill attempt must fail") if failed[:success]
abort("failure must not consume pills") unless failed[:state] == state
abort("failure must not advance pity") unless failed[:pity] == pity
abort("failure must not advance random state") unless failed[:random_state] == random_state
abort("failure must not reward demon core") unless failed[:reward].zero?
abort("failure cooldown mismatch") unless failed[:retry_at] == 2_400 + value.call("combat.recovery.failure_cooldown")

retry_state = failed[:state].merge(pill: cost)
retried = attempt(value, retry_state, failed[:pity], failed[:random_state], dungeon, now: failed[:retry_at])
abort("retry after cooldown must succeed") unless retried[:success]
abort("retry must deduct exact cost") unless retried[:state][:pill] == 0
abort("retry reward mismatch") unless retried[:reward] == value.call("dungeon.#{dungeon}.demon_core_per_clear")
abort("retry must advance pity once") unless retried[:pity][:treasure] == pity[:treasure] + 1
abort("retry must advance random state once") unless retried[:random_state] == random_state + 1
puts "validated rows=#{rows.length} duplicate_parameter_id=0 dungeon=#{dungeon} cost=#{cost} failure_cooldown=#{value.call("combat.recovery.failure_cooldown")} reward_on_failure=0 pity_on_failure=unchanged retry=passed"
