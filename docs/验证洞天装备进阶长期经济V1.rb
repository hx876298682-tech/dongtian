#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }
raw = ->(id) { by_id.fetch(id)["value"].to_s }

QUALITIES = %w[normal fine rare epic legendary immortal].freeze
MAPS = %w[bai_cao_valley black_wind_valley].freeze
RESOURCES = %i[spirit_stone spirit_ore spirit_wood spirit_herb pill ancient_scroll demon_core millennium_herb meteor_iron].freeze
HORIZONS = ENV.fetch("DONGTIAN_EQUIPMENT_HORIZONS", "2160,6480").split(",").map(&:to_i).freeze
RUNS = Integer(ENV.fetch("DONGTIAN_EQUIPMENT_RUNS", "50"))
POLICIES = ENV.fetch("DONGTIAN_EQUIPMENT_POLICIES", "qing_fixed,black_fixed,fine_then_black,qing_30d_then_black,qing_90d_then_black").split(",").freeze
ALLOWED_POLICIES = %w[qing_fixed black_fixed fine_then_black qing_30d_then_black qing_90d_then_black].freeze
abort("registered support policy is invalid") unless ALLOWED_POLICIES.include?(raw.call("schedule.equipment.support_policy"))
abort("requested support policy is invalid") unless POLICIES.all? { |policy| ALLOWED_POLICIES.include?(policy) }
abort("high-tier entry gate must be enabled") unless raw.call("dungeon.high_tier.entry_gate.enabled") == "1"
ENTRY_PROFILE = raw.call("dungeon.high_tier.entry_gate.profile")
abort("unsupported high-tier entry profile") unless ENTRY_PROFILE == "collected_p10"
EXIT_POLICY = raw.call("schedule.equipment.exit_policy")
abort("unsupported equipment exit policy") unless EXIT_POLICY == "retain_rare"

BASE_CAPS = RESOURCES.to_h { |resource| [resource, value.call("economy.inventory.cap.#{resource}")] }.freeze

def realm_for_hour(hour, value)
  horizons = {
    "core" => 168,
    "nascent_soul" => value.call("growth.realm.nascent_soul.target_hours"),
    "divine_transformation" => value.call("growth.realm.divine_transformation.target_hours"),
    "void_refining" => value.call("growth.realm.void_refining.target_hours"),
    "body_unity" => value.call("growth.realm.body_unity.target_hours"),
    "great_vehicle" => value.call("growth.realm.great_vehicle.target_hours"),
    "tribulation" => value.call("growth.realm.tribulation.target_hours")
  }
  horizons.each { |realm, end_hour| return realm if hour <= end_hour }
  "tribulation"
end

def high_tier_target_for_realm(realm)
  {
    "core" => "nascent_soul",
    "nascent_soul" => "divine_transformation",
    "divine_transformation" => "void_refining",
    "void_refining" => "body_unity",
    "body_unity" => "great_vehicle",
    "great_vehicle" => "tribulation",
    "tribulation" => "tribulation"
  }.fetch(realm)
end

def breakthrough_milestones(value)
  {
    value.call("growth.realm.nascent_soul.target_hours").to_i => ["core", "nascent_soul"],
    value.call("growth.realm.divine_transformation.target_hours").to_i => ["nascent_soul", "divine_transformation"],
    value.call("growth.realm.void_refining.target_hours").to_i => ["divine_transformation", "void_refining"],
    value.call("growth.realm.body_unity.target_hours").to_i => ["void_refining", "body_unity"],
    value.call("growth.realm.great_vehicle.target_hours").to_i => ["body_unity", "great_vehicle"],
    value.call("growth.realm.tribulation.target_hours").to_i => ["great_vehicle", "tribulation"]
  }
end

def activity_for_hour(hour, support_activity)
  return "bai_cao_valley" if hour <= 48
  return "black_wind_valley" if hour <= 168

  ((hour - 169) % 4).zero? ? support_activity : "high_tier"
end

def support_activity_for_policy(policy, canonical_quality, hour)
  case policy
  when "qing_fixed"
    "qing_feng"
  when "black_fixed"
    "black_wind_valley"
  when "fine_then_black"
    canonical_quality.all? { |quality| quality >= QUALITIES.index("fine") } ? "black_wind_valley" : "qing_feng"
  when "qing_30d_then_black"
    hour <= 720 ? "qing_feng" : "black_wind_valley"
  when "qing_90d_then_black"
    hour <= 2_160 ? "qing_feng" : "black_wind_valley"
  else
    raise "unknown support policy #{policy}"
  end
end

def resource_cap(value, resource, realm)
  BASE_CAPS.fetch(resource) * value.call("economy.inventory.cap_multiplier.#{realm}")
end

def credit(state, overflow, value, resource, amount, realm)
  before = state.fetch(resource, 0.0)
  cap = resource_cap(value, resource, realm)
  state[resource] = [before + amount, cap].min
  overflow[resource] += [before + amount - cap, 0.0].max
end

def quality_pick(rng, value, map_id)
  roll = rng.rand * 100.0
  total = 0.0
  QUALITIES.each do |quality|
    total += value.call("map.#{map_id}.equipment_quality_#{quality}_chance")
    return quality if roll < total
  end
  QUALITIES.last
end

def slot_pick(rng, value)
  pool = []
  slot_ids = { "weapon" => [0], "armor" => [1, 2, 3, 4], "accessory" => [5] }
  slot_ids.each do |slot, ids_for_slot|
    weight = value.call("loot.equipment.drop_slot_weight.#{slot}").to_i
    ids_for_slot.each { |slot_id| pool << slot_id if weight.positive? }
  end
  pool.fetch(rng.rand(pool.length))
end

def salvage_equipment(state, overflow, metrics, value, quality, realm)
  if %w[normal fine].include?(quality)
    credit(state, overflow, value, :spirit_ore, value.call("loot.equipment.salvage.#{quality}.spirit_ore"), realm)
    credit(state, overflow, value, :spirit_wood, value.call("loot.equipment.salvage.#{quality}.spirit_wood"), realm)
    metrics[:salvaged] += 1
  else
    credit(state, overflow, value, :spirit_stone, value.call("loot.equipment.affix.expected_sale_spirit_stone.#{quality}"), realm)
    metrics[:sold] += 1
  end
end

def equipment_drop(state, overflow, metrics, duplicates, canonical_quality, value, quality, slot, realm, warehouse_level)
  base_cap = value.call("economy.warehouse.equipment_cap.#{warehouse_level}")
  cap = base_cap * value.call("economy.warehouse.equipment_cap_multiplier.#{realm}")
  quality_index = QUALITIES.index(quality)
  if metrics[:stored_equipment] >= cap && value.call("schedule.equipment.progression_reserve").to_i == 1 && quality_index <= QUALITIES.index("fine")
    needed_slot = canonical_quality.each_index.find do |candidate_slot|
      canonical_quality[candidate_slot] == quality_index && duplicates[candidate_slot][quality_index].zero?
    end
    if needed_slot
      candidates = []
      duplicates.each_with_index do |slot_duplicates, candidate_slot|
        slot_duplicates.each_with_index do |count, candidate_quality|
          minimum = canonical_quality[candidate_slot] == candidate_quality ? 1 : 0
          candidates << [candidate_quality, candidate_slot] if count > minimum
        end
      end
      unless candidates.empty?
        evict_quality, evict_slot = candidates.min_by { |candidate_quality, candidate_slot| [candidate_quality, candidate_slot] }
        duplicates[evict_slot][evict_quality] -= 1
        metrics[:stored_equipment] -= 1
        salvage_equipment(state, overflow, metrics, value, QUALITIES[evict_quality], realm)
      end
    end
  end
  if metrics[:stored_equipment] < cap
    duplicates[slot][quality_index] += 1
    metrics[:stored_equipment] += 1
    return
  end
  salvage_equipment(state, overflow, metrics, value, quality, realm)
end

def pay?(state, costs, reserve = {})
  costs.all? { |resource, amount| state.fetch(resource, 0.0) - amount + 1e-9 >= reserve.fetch(resource, 0.0) }
end

def pay!(state, costs)
  costs.each { |resource, amount| state[resource] -= amount }
end

def promotion_costs(value, transition)
  {
    spirit_stone: value.call("loot.equipment.promotion.#{transition}.spirit_stone_cost"),
    millennium_herb: value.call("loot.equipment.promotion.#{transition}.millennium_herb_cost"),
    meteor_iron: value.call("loot.equipment.promotion.#{transition}.meteor_iron_cost")
  }
end

def breakthrough_costs(value, from, to)
  resources = if %w[qi foundation].include?(from)
    %w[spirit_stone pill ancient_scroll]
  else
    %w[spirit_stone pill ancient_scroll demon_core millennium_herb meteor_iron]
  end
  resources.to_h do |resource|
    field = resource == "ancient_scroll" && %w[qi foundation].include?(from) ? "scroll" : resource
    [resource.to_sym, value.call("breakthrough.#{from}_to_#{to}.#{field}_cost")]
  end
end

def simulate(value, raw, horizon, seed, support_policy)
  rng = Random.new(seed)
  state = Hash.new(0.0)
  overflow = Hash.new(0.0)
  duplicates = Array.new(6) { Array.new(QUALITIES.length, 0) }
  canonical_quality = Array.new(6, 0)
  awakenings = Array.new(6, 0)
  affix_target_quality = Array.new(6, -1)
  metrics = Hash.new(0.0)
  metrics[:stored_equipment] = 6.0
  metrics[:support_qing_hours] = 0.0
  metrics[:support_black_hours] = 0.0
  metrics[:target_matches] = 0.0
  metrics[:target_match_spirit_stone] = 0.0
  metrics[:target_match_pills] = 0.0
  metrics[:high_tier_gate_blocks] = 0.0
  warehouse_level = 1
  breakthrough_paid = []
  event_remaining = 0
  event_multiplier = 1.0
  milestones = { 24 => ["qi", "foundation"], 48 => ["foundation", "core"] }
  milestones.merge!(breakthrough_milestones(value))
  switch_hour = nil
  previous_support_activity = nil

  (1..horizon).each do |hour|
    realm = realm_for_hour(hour, value)
    support_activity = support_activity_for_policy(support_policy, canonical_quality, hour)
    activity = activity_for_hour(hour, support_activity)
    if activity == "qing_feng"
      metrics[:support_qing_hours] += 1
    elsif activity == "black_wind_valley" && hour > 168
      metrics[:support_black_hours] += 1
    end
    switch_hour ||= hour if previous_support_activity && support_activity != previous_support_activity && support_activity == "black_wind_valley"
    previous_support_activity = support_activity
    future_milestones = milestones.keys.select { |milestone| milestone >= hour }.sort
    reserve_milestones = hour < 24 ? future_milestones.first(2) : future_milestones.first(1)
    reserve = reserve_milestones.each_with_object(Hash.new(0.0)) do |milestone, total|
      breakthrough_costs(value, *milestones.fetch(milestone)).each { |resource, amount| total[resource] += amount }
    end
    if ((hour - 1) % value.call("schedule.random_event.roll_interval_hours").to_i).zero?
      roll = rng.rand * 100.0
      event_multiplier = 1.0
      event_remaining = 0
      cursor = value.call("schedule.random_event.spirit_tide.chance")
      if roll < cursor
        event_multiplier = value.call("schedule.random_event.spirit_tide.production_multiplier")
        event_remaining = value.call("schedule.random_event.spirit_tide.duration_hours").to_i
      elsif roll < cursor + value.call("schedule.random_event.beast_raid.chance")
        event_multiplier = value.call("schedule.random_event.beast_raid.production_multiplier")
        event_remaining = value.call("schedule.random_event.beast_raid.duration_hours").to_i
      end
    end
    active_multiplier = event_remaining.positive? ? event_multiplier : 1.0
    event_remaining -= 1 if event_remaining.positive?

    # Farm and alchemy are kept in the same ledger so progression competes
    # with breakthrough pills instead of receiving an unbounded free supply.
    farm_rate = value.call("building.spirit_farm.plot_count") * value.call("building.spirit_farm.herb_yield_per_plot") * 3600.0 / value.call("building.spirit_farm.base_growth_time") * value.call("building.level.speed_multiplier_3") * active_multiplier
    credit(state, overflow, value, :spirit_herb, farm_rate, realm)
    credit(state, overflow, value, :spirit_stone, value.call("economy.resource.spirit_stone.base_rate") * active_multiplier, realm)
    batches = [value.call("building.alchemy_room.output_per_action") * 3600.0 / value.call("building.alchemy_room.base_interval") * value.call("building.level.speed_multiplier_3") * active_multiplier, state[:spirit_herb] / value.call("recipe.alchemy_basic.herb_cost"), state[:spirit_stone] / value.call("recipe.alchemy_basic.stone_cost")].min
    state[:spirit_herb] -= batches * value.call("recipe.alchemy_basic.herb_cost")
    state[:spirit_stone] -= batches * value.call("recipe.alchemy_basic.stone_cost")
    credit(state, overflow, value, :pill, batches, realm)

    if activity == "high_tier"
      # At the exact breakthrough hour, the preparation window still pays
      # the transition into the newly unlocked realm; after that hour the
      # current realm's next transition becomes the expedition target.
      target = milestones.key?(hour) ? realm : high_tier_target_for_realm(realm)
      %w[spirit_stone ancient_scroll demon_core millennium_herb meteor_iron].each do |resource|
        # Expedition supply is an activity rate, not a building production
        # action; random production events do not silently reduce breakthrough supply.
        credit(state, overflow, value, resource.to_sym, value.call("dungeon.high_tier.#{target}.#{resource}_per_hour"), realm)
      end
      gate_open = hour >= value.call("growth.realm.#{target}.target_hours")
      if (hour % value.call("dungeon.high_tier.boss_encounter_interval_hours").to_i).zero? && gate_open
        natural_failure_rate = value.call("dungeon.high_tier.#{target}.boss_natural_failure_rate")
        boss_failed = natural_failure_rate.positive? && rng.rand * 100.0 < natural_failure_rate
        if boss_failed
          metrics[:high_tier_failures] += 1
          # Failure recovery is local to the encounter. It does not remove
          # the hourly expedition supply or advance any drop/pity state.
        else
          metrics[:high_tier_successes] += 1
          %w[ancient_scroll demon_core].each do |resource|
            prefix = "dungeon.high_tier.#{target}.boss_drop.#{resource}"
            credit(state, overflow, value, resource.to_sym, value.call("#{prefix}.amount"), realm) if rng.rand * 100.0 < value.call("#{prefix}.chance")
          end
          boss_quality = raw.call("dungeon.high_tier.#{target}.boss_drop.equipment.quality")
          equipment_drop(state, overflow, metrics, duplicates, canonical_quality, value, boss_quality, slot_pick(rng, value), realm, warehouse_level) if rng.rand * 100.0 < value.call("dungeon.high_tier.#{target}.boss_drop.equipment.chance")
        end
      elsif (hour % value.call("dungeon.high_tier.boss_encounter_interval_hours").to_i).zero?
        metrics[:high_tier_gate_blocks] += 1
      end
    elsif activity == "qing_feng"
      clears = 3600.0 / value.call("dungeon.qing_feng.target_clear_time")
      credit(state, overflow, value, :demon_core, clears * value.call("dungeon.qing_feng.demon_core_per_clear"), realm)
      credit(state, overflow, value, :millennium_herb, clears * value.call("dungeon.qing_feng.millennium_herb_chance") / 100.0, realm)
      credit(state, overflow, value, :meteor_iron, clears * value.call("dungeon.qing_feng.meteor_iron_chance") / 100.0, realm)
    else
      kills = 3600.0 / value.call("map.#{activity}.target_kill_time") * active_multiplier
      %w[spirit_stone spirit_ore spirit_wood].each do |resource|
        credit(state, overflow, value, resource.to_sym, kills * value.call("map.#{activity}.#{resource}_per_kill"), realm)
      end
      credit(state, overflow, value, :ancient_scroll, kills * value.call("map.#{activity}.ancient_scroll_effective_per_hour"), realm)
      drops = kills * value.call("map.#{activity}.equipment_drop_chance") / 100.0
      whole = drops.floor
      whole.times { equipment_drop(state, overflow, metrics, duplicates, canonical_quality, value, quality_pick(rng, value, activity), slot_pick(rng, value), realm, warehouse_level) }
      equipment_drop(state, overflow, metrics, duplicates, canonical_quality, value, quality_pick(rng, value, activity), slot_pick(rng, value), realm, warehouse_level) if rng.rand < drops - whole
    end

    # Forge output is another duplicate source and is limited by current inputs.
    nominal = value.call("building.forge_room.output_per_action") * 3600.0 / value.call("building.forge_room.base_interval") * active_multiplier
    forge_stone = [state[:spirit_stone] - reserve.fetch(:spirit_stone, 0.0), 0.0].max
    batches = [nominal, state[:spirit_ore] / value.call("recipe.forge_basic.ore_cost"), state[:spirit_wood] / value.call("recipe.forge_basic.wood_cost"), forge_stone / value.call("recipe.forge_basic.stone_cost")].min
    state[:spirit_ore] -= batches * value.call("recipe.forge_basic.ore_cost")
    state[:spirit_wood] -= batches * value.call("recipe.forge_basic.wood_cost")
    state[:spirit_stone] -= batches * value.call("recipe.forge_basic.stone_cost")
    batches.floor.times { equipment_drop(state, overflow, metrics, duplicates, canonical_quality, value, "normal", rng.rand(6), realm, warehouse_level) }

    if milestones.key?(hour)
      from, to = milestones.fetch(hour)
      costs = breakthrough_costs(value, from, to)
      abort("#{horizon}h #{hour}h breakthrough went negative state=#{state.inspect} costs=#{costs.inspect}") unless pay?(state, costs)
      pay!(state, costs)
      breakthrough_paid << to
    end

    progression_milestones = milestones.keys.select { |milestone| milestone > hour }.sort
    progression_reserve_milestones = hour < 24 ? progression_milestones.first(2) : progression_milestones.first(1)
    progression_reserve = progression_reserve_milestones.each_with_object(Hash.new(0.0)) do |milestone, total|
      breakthrough_costs(value, *milestones.fetch(milestone)).each { |resource, amount| total[resource] += amount }
    end

    # Breakthroughs are paid first; only then can optional gear progression use resources.
    6.times do |slot|
      quality = canonical_quality[slot]
      while quality < QUALITIES.length - 1
        transition = "#{QUALITIES[quality]}_to_#{QUALITIES[quality + 1]}"
        costs = promotion_costs(value, transition)
        break unless duplicates[slot][quality].positive? && pay?(state, costs, progression_reserve)
        duplicates[slot][quality] -= 1
        metrics[:stored_equipment] -= 1
        pay!(state, costs)
        quality += 1
        canonical_quality[slot] = quality
        metrics[:promotions] += 1
      end
      if quality == QUALITIES.length - 1
        while awakenings[slot] < value.call("loot.equipment.awakening.max_level")
          level = awakenings[slot]
          costs = {
            spirit_stone: (value.call("loot.equipment.awakening.spirit_stone_base_cost") * value.call("loot.equipment.awakening.spirit_stone_growth")**level).ceil,
            demon_core: value.call("loot.equipment.awakening.demon_core_per_level"),
            meteor_iron: value.call("loot.equipment.awakening.meteor_iron_per_level")
          }
          break unless pay?(state, costs, progression_reserve)
          pay!(state, costs)
          awakenings[slot] += 1
          metrics[:awakenings] += 1
        end
      end
      [4, 5].each do |target_quality|
        next if quality < target_quality || affix_target_quality[slot] >= target_quality
        target_name = QUALITIES[target_quality]
        target_costs = {
          spirit_stone: value.call("loot.equipment.affix.target.expected_spirit_stone.#{target_name}"),
          pill: value.call("loot.equipment.affix.target.expected_pills.#{target_name}")
        }
        next unless pay?(state, target_costs, progression_reserve)
        pay!(state, target_costs)
        affix_target_quality[slot] = target_quality
        metrics[:target_matches] += 1
        metrics[:target_match_spirit_stone] += target_costs[:spirit_stone]
        metrics[:target_match_pills] += target_costs[:pill]
        metrics[:locks] += value.call("loot.equipment.reroll.max_locked_slots").to_i
      end
    end
    while warehouse_level < value.call("economy.warehouse.max_level") && state[:spirit_stone] - value.call("economy.warehouse.upgrade.spirit_stone_cost.#{warehouse_level + 1}") >= progression_reserve.fetch(:spirit_stone, 0.0)
      state[:spirit_stone] -= value.call("economy.warehouse.upgrade.spirit_stone_cost.#{warehouse_level + 1}")
      warehouse_level += 1
    end
    RESOURCES.each { |resource| abort("negative #{resource}") if state[resource] < -1e-7 }
    cap = value.call("economy.warehouse.equipment_cap.#{warehouse_level}") * value.call("economy.warehouse.equipment_cap_multiplier.#{realm}")
    abort("equipment warehouse overflow") if metrics[:stored_equipment] > cap + 1e-7
  end

  { canonical_quality: canonical_quality, awakenings: awakenings, affix_target_quality: affix_target_quality, breakthrough_paid: breakthrough_paid, warehouse_level: warehouse_level, metrics: metrics, overflow: overflow, switch_hour: switch_hour, state: state, duplicates: duplicates }
end

POLICIES.each do |support_policy|
  HORIZONS.each do |horizon|
    results = RUNS.times.map { |index| simulate(value, raw, horizon, 1_100_000 + horizon + index * 71, support_policy) }
    expected_breakthroughs = results.first[:breakthrough_paid].length
    abort("#{support_policy} #{horizon}h breakthrough route incomplete") unless results.all? { |result| result[:breakthrough_paid].length == expected_breakthroughs }
    min_quality = results.map { |result| result[:canonical_quality].min }.min
    mean_awakenings = results.sum { |result| result[:metrics][:awakenings] } / results.length
    mean_promotions = results.sum { |result| result[:metrics][:promotions] } / results.length
    mean_locks = results.sum { |result| result[:metrics][:locks] } / results.length
    mean_target_matches = results.sum { |result| result[:metrics][:target_matches] } / results.length
    mean_target_stone = results.sum { |result| result[:metrics][:target_match_spirit_stone] } / results.length
    mean_target_pills = results.sum { |result| result[:metrics][:target_match_pills] } / results.length
    mean_gate_blocks = results.sum { |result| result[:metrics][:high_tier_gate_blocks] } / results.length
    mean_sold = results.sum { |result| result[:metrics][:sold] } / results.length
    mean_salvaged = results.sum { |result| result[:metrics][:salvaged] } / results.length
    mean_overflow_equipment = results.sum { |result| result[:overflow][:spirit_stone] } / results.length
    mean_qing_hours = results.sum { |result| result[:metrics][:support_qing_hours] } / results.length
    mean_black_hours = results.sum { |result| result[:metrics][:support_black_hours] } / results.length
    switch_hours = results.map { |result| result[:switch_hour] }.compact
    switch_summary = switch_hours.empty? ? "none" : "#{(switch_hours.sum.to_f / switch_hours.length).round(1)}"
    mean_failures = results.sum { |result| result[:metrics][:high_tier_failures] } / results.length
    full_quality_rates = [1, 2, 3, 4, 5].map do |quality|
      results.count { |result| result[:canonical_quality].all? { |slot_quality| slot_quality >= quality } }.to_f / results.length
    end
    slot_quality_counts = 6.times.map do |slot|
      QUALITIES.each_with_index.map { |_quality, quality_index| results.count { |result| result[:canonical_quality][slot] == quality_index } }
    end
    puts "policy=#{support_policy} horizon=#{horizon}h min_canonical_quality=#{QUALITIES[min_quality]} mean_promotions=#{mean_promotions.round(2)} mean_awakenings=#{mean_awakenings.round(2)} mean_locks=#{mean_locks.round(2)} mean_target_matches=#{mean_target_matches.round(2)} mean_target_stone=#{mean_target_stone.round(2)} mean_target_pills=#{mean_target_pills.round(2)} mean_gate_blocks=#{mean_gate_blocks.round(2)} mean_sold=#{mean_sold.round(2)} mean_salvaged=#{mean_salvaged.round(2)} mean_spirit_stone_overflow=#{mean_overflow_equipment.round(2)} mean_qing_support_hours=#{mean_qing_hours.round(1)} mean_black_support_hours=#{mean_black_hours.round(1)} full_quality_rates=fine:#{full_quality_rates[0].round(3)},rare:#{full_quality_rates[1].round(3)},epic:#{full_quality_rates[2].round(3)},legendary:#{full_quality_rates[3].round(3)},immortal:#{full_quality_rates[4].round(3)} mean_failures=#{mean_failures.round(3)} mean_switch_hour=#{switch_summary} warehouse_min=#{results.map { |r| r[:warehouse_level] }.min}"
    puts "policy=#{support_policy} horizon=#{horizon}h slot_quality_counts=#{slot_quality_counts.inspect}" if ENV["DONGTIAN_EQUIPMENT_VERBOSE"] == "1"
    if ENV["DONGTIAN_EQUIPMENT_VERBOSE"] == "1"
      puts "policy=#{support_policy} horizon=#{horizon}h sample_canonical=#{results.first[:canonical_quality].map { |quality| QUALITIES[quality] }.inspect} sample_affix_targets=#{results.first[:affix_target_quality].map { |quality| quality.negative? ? 'none' : QUALITIES[quality] }.inspect} sample_duplicates=#{results.first[:duplicates].inspect} sample_state=#{results.first[:state].select { |_resource, amount| amount.positive? }.inspect}"
    end
  end
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 runs=#{RUNS} horizons=#{HORIZONS.join('/')} policies=#{POLICIES.join('/')} registered_policy=#{raw.call('schedule.equipment.support_policy')} exit_policy=#{EXIT_POLICY} entry_profile=#{ENTRY_PROFILE} progression=promotion+awakening+target_affix breakthrough_priority=1 warehouse=bounded"
