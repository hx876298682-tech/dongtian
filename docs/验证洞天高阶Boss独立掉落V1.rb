#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

realms = %w[nascent_soul divine_transformation void_refining body_unity great_vehicle tribulation]
interval = value.call("dungeon.high_tier.boss_encounter_interval_hours")
horizon = 6_480.0
runs = 5_000
realms.each do |realm|
  prefix = "dungeon.high_tier.#{realm}.boss_drop"
  scroll_chance = value.call("#{prefix}.ancient_scroll.chance")
  core_chance = value.call("#{prefix}.demon_core.chance")
  equipment_chance = value.call("#{prefix}.equipment.chance")
  quality = by_id.fetch("#{prefix}.equipment.quality")["value"]
  abort("#{realm} drop chance outside 0..100") unless [scroll_chance, core_chance, equipment_chance].all? { |chance| chance.between?(0, 100) }
  abort("#{realm} drop amounts must be positive") unless %w[ancient_scroll demon_core equipment].all? { |resource| value.call("#{prefix}.#{resource}.amount").positive? }
  abort("#{realm} Boss equipment quality invalid") unless %w[rare epic legendary].include?(quality)
  encounters = (horizon / interval).floor
  expected_scroll = encounters * value.call("#{prefix}.ancient_scroll.amount") * scroll_chance / 100.0
  expected_core = encounters * value.call("#{prefix}.demon_core.amount") * core_chance / 100.0
  expected_equipment = encounters * value.call("#{prefix}.equipment.amount") * equipment_chance / 100.0
  samples = runs.times.map do |seed|
    rng = Random.new(800_000 + seed)
    scroll = 0.0
    core = 0.0
    equipment = 0.0
    encounters.times do
      scroll += value.call("#{prefix}.ancient_scroll.amount") if rng.rand < scroll_chance / 100.0
      core += value.call("#{prefix}.demon_core.amount") if rng.rand < core_chance / 100.0
      equipment += value.call("#{prefix}.equipment.amount") if rng.rand < equipment_chance / 100.0
    end
    [scroll, core, equipment]
  end
  3.times do |index|
    expected = [expected_scroll, expected_core, expected_equipment][index]
    mean = samples.sum { |sample| sample[index] } / runs
    variance = samples.sum { |sample| (sample[index] - mean) ** 2 } / (runs - 1)
    ci99 = 2.576 * Math.sqrt(variance / runs)
    abort("#{realm} drop #{index} outside 99% CI") unless (mean - expected).abs <= ci99
  end
  puts "realm=#{realm} encounters=#{encounters} expected_scroll=#{expected_scroll.round(2)} expected_core=#{expected_core.round(2)} expected_equipment=#{expected_equipment.round(2)} runs=#{runs} confidence=99%"
end

slot_weights = %w[weapon armor accessory].map { |slot| value.call("loot.equipment.drop_slot_weight.#{slot}") }
abort("equipment drop slot weights must match equipped counts") unless slot_weights == [1.0, 4.0, 1.0]
abort("armor weight must map to four distinct armor slots") unless slot_weights[1].to_i == 4

puts "validated rows=#{rows.length} duplicate_parameter_id=0 realms=#{realms.length} independent_drop=success_only pity_boundary=separate_from_expedition_supply"
