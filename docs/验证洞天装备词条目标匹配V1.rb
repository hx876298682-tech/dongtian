#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
raw = ->(id) { by_id.fetch(id)["value"].to_s }
value = ->(id) { Float(raw.call(id)) }

qualities = %w[legendary immortal]
slots = %w[weapon armor accessory]
special_pool = %w[armor_break body_protection vitality rejuvenation]
target_special = slots.to_h { |slot| [slot, raw.call("loot.equipment.affix.target.special.#{slot}")] }
abort("target special pool mismatch") unless target_special.values.all? { |special| special_pool.include?(special) }
abort("legendary target mismatch") unless raw.call("loot.equipment.affix.target.legendary.required") == "speed|special"
abort("immortal target mismatch") unless raw.call("loot.equipment.affix.target.immortal.required") == "speed|element|special"
abort("target attempts must be positive") unless value.call("loot.equipment.affix.target.max_attempts").positive?
%w[legendary immortal].each do |quality|
  abort("#{quality} target expected stone must be positive") unless value.call("loot.equipment.affix.target.expected_spirit_stone.#{quality}").positive?
  abort("#{quality} target expected pills must be positive") unless value.call("loot.equipment.affix.target.expected_pills.#{quality}").positive?
end

def weighted_affix(rng, value, raw, target_special)
  roll = rng.rand * 100.0
  return "speed" if roll < value.call("loot.equipment.affix.roll_weight.speed")
  roll -= value.call("loot.equipment.affix.roll_weight.speed")
  return "element" if roll < value.call("loot.equipment.affix.roll_weight.element")
  special_roll = rng.rand * 100.0
  cursor = 0.0
  %w[armor_break body_protection vitality rejuvenation].each do |special|
    cursor += value.call("loot.equipment.affix.special_pool.#{special}.weight")
    return ["special", special] if special_roll < cursor
  end
  ["special", target_special]
end

def matching_indices(rolls, target, target_special)
  rolls.each_with_index.filter { |roll, _index| roll == target || (target == "special" && roll == ["special", target_special]) }.map(&:last)
end

def target_met?(rolls, required, target_special)
  required.all? { |target| matching_indices(rolls, target, target_special).any? }
end

def simulate_item(value, raw, quality, slot, seed)
  rng = Random.new(seed)
  utility_slots = value.call("loot.equipment.affix.utility_slots.#{quality}").to_i
  required = raw.call("loot.equipment.affix.target.#{quality}.required").split("|")
  abort("#{quality} target exceeds utility slots") if required.length > utility_slots
  rolls = Array.new(utility_slots) { weighted_affix(rng, value, raw, raw.call("loot.equipment.affix.target.special.#{slot}")) }
  locked = []
  locked_targets = []
  rerolls = 0
  stone = 0.0
  pills = 0
  max_locked = value.call("loot.equipment.reroll.max_locked_slots").to_i
  lock_base = value.call("loot.equipment.reroll.lock_base_cost")
  lock_growth = value.call("loot.equipment.reroll.lock_cost_growth")
  target_special_name = raw.call("loot.equipment.affix.target.special.#{slot}")
  while rerolls <= value.call("loot.equipment.affix.target.max_attempts").to_i
    # Lock matching slots first; this makes the candidate cost a conservative
    # upper bound for the remaining unlocked search.
    required.each do |target|
      # Do not consume another lock slot for a duplicate roll of a target that
      # is already secured. The previous implementation could lock two speed
      # slots before the special target appeared, making success impossible.
      next if locked_targets.include?(target)
      index = matching_indices(rolls, target, target_special_name).find { |candidate| !locked.include?(candidate) }
      if index && locked.length < max_locked
        locked << index
        locked_targets << target
        lock_number = locked.length
        stone += (lock_base * lock_growth**(lock_number - 1)).ceil
        pills += value.call("loot.equipment.reroll.lock_pill_cost").to_i
      end
    end
    if target_met?(rolls, required, target_special_name)
      puts "debug_success quality=#{quality} slot=#{slot} rerolls=#{rerolls} rolls=#{rolls.inspect} locked=#{locked.inspect}" if ENV["DONGTIAN_AFFIX_DEBUG"] == "1" && seed == 1_700_015
      return { success: true, rerolls: rerolls, stone: stone, pills: pills }
    end
    break if rerolls == value.call("loot.equipment.affix.target.max_attempts").to_i
    stone += (value.call("loot.equipment.reroll.spirit_stone_base_cost") * value.call("loot.equipment.affix.target.reroll_spirit_stone_growth")**rerolls).ceil
    pills += 1
    rerolls += 1
    rolls.each_with_index do |_roll, index|
      rolls[index] = weighted_affix(rng, value, raw, target_special_name) unless locked.include?(index)
    end
  end
  puts "debug_failure quality=#{quality} slot=#{slot} rerolls=#{rerolls} rolls=#{rolls.inspect} locked=#{locked.inspect}" if ENV["DONGTIAN_AFFIX_DEBUG"] == "1" && seed == 1_700_015
  { success: false, rerolls: rerolls, stone: stone, pills: pills }
end

qualities.each do |quality|
  slots.each do |slot|
    samples = 5_000.times.map { |index| simulate_item(value, raw, quality, slot, 1_700_000 + index * 31 + quality.length + slot.length) }
    success_rate = samples.count { |sample| sample[:success] }.to_f / samples.length
    abort("#{quality} #{slot} target success rate below 99% rate=#{success_rate}") unless success_rate >= 0.99
    successful = samples.select { |sample| sample[:success] }
    mean_rerolls = successful.sum { |sample| sample[:rerolls] }.to_f / successful.length
    p95_rerolls = successful.map { |sample| sample[:rerolls] }.sort[(successful.length * 0.95).floor]
    mean_stone = successful.sum { |sample| sample[:stone] }.to_f / successful.length
    mean_pills = successful.sum { |sample| sample[:pills] }.to_f / successful.length
    puts "quality=#{quality} slot=#{slot} success_rate=#{success_rate.round(4)} mean_rerolls=#{mean_rerolls.round(2)} p95_rerolls=#{p95_rerolls} mean_stone=#{mean_stone.round(2)} mean_pills=#{mean_pills.round(2)}"
  end
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 qualities=#{qualities.join('/')} slots=#{slots.join('/')} target_attempts=#{value.call('loot.equipment.affix.target.max_attempts').to_i} lock_slots=#{value.call('loot.equipment.reroll.max_locked_slots').to_i} samples=5000"
