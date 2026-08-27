#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { by_id.fetch(id)["value"].to_s }
number = ->(id) { Float(value.call(id)) }

qualities = %w[normal fine rare epic legendary immortal]
slots = { "weapon" => 1, "armor" => 4, "accessory" => 1 }
abort("slot count mismatch") unless slots.values.sum == number.call("loot.equipment.slot_count.total")
abort("affix slot count must be three") unless number.call("loot.equipment.affix.slot_count") == 3
utility_slots = qualities.to_h { |quality| [quality, number.call("loot.equipment.affix.utility_slots.#{quality}").to_i] }
abort("utility slots exceed affix slots") unless utility_slots.values.all? { |count| count.between?(0, 3) }
abort("utility slots must be monotonic") unless utility_slots.values.each_cons(2).all? { |a, b| b >= a }

weights = %w[speed element special].to_h { |kind| [kind, number.call("loot.equipment.affix.roll_weight.#{kind}")] }
abort("affix roll weights must sum to 100") unless weights.values.sum == 100
abort("only one active element is allowed") unless number.call("loot.equipment.affix.element.max_active") == 1
abort("default player element must be neutral") unless value.call("combat.player.default_element") == "neutral"

speed_rating = {
  "normal" => 0,
  "fine" => 0,
  "rare" => number.call("loot.equipment.affix.speed_rating.rare"),
  "epic" => number.call("loot.equipment.affix.speed_rating.epic"),
  "legendary" => number.call("loot.equipment.affix.speed_rating.legendary"),
  "immortal" => number.call("loot.equipment.affix.speed_rating.immortal")
}
special_grade = {
  "normal" => 0,
  "fine" => 0,
  "rare" => number.call("loot.equipment.affix.special_grade.rare"),
  "epic" => number.call("loot.equipment.affix.special_grade.epic"),
  "legendary" => number.call("loot.equipment.affix.special_grade.legendary"),
  "immortal" => number.call("loot.equipment.affix.special_grade.immortal")
}
abort("speed ratings must increase") unless speed_rating.values.each_cons(2).all? { |a, b| b >= a }
abort("special grades must increase") unless special_grade.values.each_cons(2).all? { |a, b| b >= a }

quality_multiplier = ->(quality) { number.call("loot.equipment.quality.multiplier.#{quality}") }
slot_budget = ->(slot) { number.call("loot.equipment.slot_budget.#{slot}") }
shares = {
  "weapon" => { attack: 70, defence: 20, health: 10 },
  "armor" => { defence: 70, health: 30 },
  "accessory" => { attack: 40, defence: 40, health: 20 }
}

def equipment_stats(number, quality_multiplier, slot_budget, shares, slot, quality)
  budget = (slot_budget.call(slot) * quality_multiplier.call(quality)).round
  stats = { attack: 0.0, defence: 0.0, health: 0.0 }
  shares.fetch(slot).each do |attribute, share|
    points = budget * share / 100.0
    stats[attribute] += attribute == :health ? points * number.call("loot.equipment.stat_point.health_value") : points
  end
  stats
end

def full_set_stats(number, quality_multiplier, slot_budget, shares, slots, quality)
  slots.each_with_object({ attack: 0.0, defence: 0.0, health: 0.0 }) do |(slot, count), total|
    item = equipment_stats(number, quality_multiplier, slot_budget, shares, slot, quality)
    item.each { |attribute, amount| total[attribute] += amount * count }
  end
end

def sample_affixes(number, quality, kinds)
  max_slots = number.call("loot.equipment.affix.utility_slots.#{quality}").to_i
  abort("sample exceeds utility slots") if kinds.length > max_slots
  {
    speed: kinds.count("speed") * number.call("loot.equipment.affix.speed_rating.#{quality}"),
    element: kinds.include?("element") ? "metal" : "neutral",
    special_grades: kinds.count("special") * number.call("loot.equipment.affix.special_grade.#{quality}")
  }
end

rare_speed = sample_affixes(number, "rare", %w[speed])
immortal_full_item = sample_affixes(number, "immortal", %w[speed element special])
abort("rare speed sample mismatch") unless rare_speed[:speed] == 5
abort("immortal element sample mismatch") unless immortal_full_item[:element] == "metal"
abort("immortal special sample mismatch") unless immortal_full_item[:special_grades] == 4

equipped_quality = "immortal"
stats = full_set_stats(number, quality_multiplier, slot_budget, shares, slots, equipped_quality)
all_speed = immortal_full_item[:speed] * slots.values.sum
all_special_grades = immortal_full_item[:special_grades] * slots.values.sum
special_outgoing = 1 + all_special_grades * number.call("loot.equipment.affix.special.damage_bonus_per_grade")
special_incoming = [0.0, 1 - all_special_grades * number.call("loot.equipment.affix.special.damage_reduction_per_grade")].max
health_multiplier = 1 + all_special_grades * number.call("loot.equipment.affix.special.health_bonus_per_grade")
pill_multiplier = 1 + all_special_grades * number.call("loot.equipment.affix.special.pill_heal_bonus_per_grade")
interval = [number.call("combat.speed.min_attack_interval"), number.call("combat.player.base_attack_interval") / (1 + all_speed / 100.0)].max
abort("speed must reduce interval") unless interval < number.call("combat.player.base_attack_interval")
abort("special outgoing bound exceeded") unless special_outgoing <= 1.5
abort("special incoming bound invalid") unless special_incoming >= 0.5
abort("health multiplier bound exceeded") unless health_multiplier <= 2.0
abort("pill multiplier bound exceeded") unless pill_multiplier <= 2.5

counter = { "metal" => "wood", "wood" => "earth", "earth" => "water", "water" => "fire", "fire" => "metal" }
element_multiplier = counter.fetch(immortal_full_item[:element]) == "wood" ? number.call("combat.element.counter_damage_multiplier") : 1.0
attack = number.call("combat.player.base_attack") + stats[:attack]
dps = attack * number.call("combat.damage.base_coefficient") * 100.0 / (100.0 + number.call("map.bai_cao_valley.enemy_defence")) * 0.75 * special_outgoing * element_multiplier / interval
abort("equipped affixes must improve DPS") unless dps > number.call("combat.player.base_attack") * number.call("combat.damage.base_coefficient") * 100.0 / (100.0 + number.call("map.bai_cao_valley.enemy_defence")) * 0.75 / number.call("combat.player.base_attack_interval")

base_value = number.call("loot.equipment.value.immortal")
affix_value = immortal_full_item[:speed] * number.call("loot.equipment.affix.sale.speed_value_per_point") +
  (immortal_full_item[:element] == "neutral" ? 0 : number.call("loot.equipment.affix.sale.element_value")) +
  immortal_full_item[:special_grades] * number.call("loot.equipment.affix.sale.special_value_per_grade")
base_sale = number.call("loot.equipment.sell.spirit_stone.immortal")
affix_sale = ((base_value + affix_value) * 0.5).floor
abort("affix sale must exceed base sale") unless affix_sale > base_sale
abort("same-quality sale delta must be positive") unless affix_value.positive?

puts "validated rows=#{rows.length} duplicate_parameter_id=0 equipped_slots=#{slots.values.sum} utility_slots=#{utility_slots} weights=#{weights} rare_speed=#{rare_speed[:speed]} immortal_speed=#{all_speed} interval=#{interval.round(4)} special_outgoing=#{special_outgoing.round(4)} special_incoming=#{special_incoming.round(4)} health_multiplier=#{health_multiplier.round(4)} dps=#{dps.round(4)} base_sale=#{base_sale} affix_sale=#{affix_sale}"
