#!/usr/bin/env ruby

require "csv"

ROOT = __dir__
rows = CSV.read(File.join(ROOT, "洞天数值参数表.csv"), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

BASE_CAPS = {
  spirit_stone: value.call("economy.inventory.cap.spirit_stone"),
  spirit_herb: value.call("economy.inventory.cap.spirit_herb"),
  pill: value.call("economy.inventory.cap.pill"),
  ancient_scroll: value.call("economy.inventory.cap.ancient_scroll"),
  demon_core: value.call("economy.inventory.cap.demon_core"),
  millennium_herb: value.call("economy.inventory.cap.millennium_herb"),
  meteor_iron: value.call("economy.inventory.cap.meteor_iron"),
  equipment: value.call("economy.inventory.cap.equipment")
}.freeze

def cap_for(value, resource, realm)
  BASE_CAPS.fetch(resource) * value.call("economy.inventory.cap_multiplier.#{realm}")
end

def add_resource(state, overflow, value, resource, amount, realm)
  cap = cap_for(value, resource, realm)
  before = state.fetch(resource, 0.0)
  state[resource] = [before + amount, cap].min
  overflow[resource] += [before + amount - cap, 0.0].max
end

def room_multiplier(value, level)
  value.call("building.level.speed_multiplier_#{level}")
end

def production_step(state, overflow, value, farm_level:, alchemy_level:, bag_stars:, realm:)
  herb_rate = value.call("building.spirit_farm.plot_count") * value.call("building.spirit_farm.herb_yield_per_plot") * 3600.0 / value.call("building.spirit_farm.base_growth_time") * room_multiplier(value, farm_level)
  add_resource(state, overflow, value, :spirit_herb, herb_rate, realm)
  nominal_pills = value.call("building.alchemy_room.output_per_action") * 3600.0 / value.call("building.alchemy_room.base_interval") * room_multiplier(value, alchemy_level)
  nominal_pills *= 1.0 + value.call("growth.treasure.heaven_bag.production_bonus_per_star") * bag_stars
  recipe_herb = value.call("recipe.alchemy_basic.herb_cost")
  recipe_stone = value.call("recipe.alchemy_basic.stone_cost")
  # The common stone line is the already-registered base production line.
  add_resource(state, overflow, value, :spirit_stone, value.call("economy.resource.spirit_stone.base_rate"), realm)
  batches = [nominal_pills, state.fetch(:spirit_herb, 0.0) / recipe_herb, state.fetch(:spirit_stone, 0.0) / recipe_stone].min
  state[:spirit_herb] -= batches * recipe_herb
  state[:spirit_stone] -= batches * recipe_stone
  add_resource(state, overflow, value, :pill, batches * value.call("recipe.alchemy_basic.output"), realm)
  batches
end

def map_step(state, overflow, value, map_id, realm)
  kills = 3600.0 / value.call("map.#{map_id}.target_kill_time")
  add_resource(state, overflow, value, :spirit_stone, kills * value.call("map.#{map_id}.spirit_stone_per_kill"), realm)
  add_resource(state, overflow, value, :ancient_scroll, kills * value.call("map.#{map_id}.ancient_scroll_effective_per_hour"), realm)
  value.call("map.#{map_id}.pill_per_hour")
end

def dungeon_step(state, overflow, value, dungeon_id, realm)
  clears = 3600.0 / value.call("dungeon.#{dungeon_id}.target_clear_time")
  pill_cost = value.call("dungeon.#{dungeon_id}.pill_cost") + value.call("dungeon.#{dungeon_id}.boss_auto_pill_per_clear")
  [clears * pill_cost, clears * value.call("dungeon.#{dungeon_id}.demon_core_per_clear")]
end

def high_tier_step(state, overflow, value, realm_to, realm, hour, rng)
  %w[spirit_stone pill ancient_scroll demon_core millennium_herb meteor_iron].each do |resource|
    add_resource(state, overflow, value, resource.to_sym, value.call("dungeon.high_tier.#{realm_to}.#{resource}_per_hour"), realm)
  end
  interval = value.call("dungeon.high_tier.boss_encounter_interval_hours").to_i
  return unless (hour % interval).zero?
  prefix = "dungeon.high_tier.#{realm_to}.boss_drop"
  %w[ancient_scroll demon_core].each do |resource|
    chance = value.call("#{prefix}.#{resource}.chance")
    add_resource(state, overflow, value, resource.to_sym, value.call("#{prefix}.#{resource}.amount"), realm) if rng.rand * 100.0 < chance
  end
  equipment_chance = value.call("#{prefix}.equipment.chance")
  add_resource(state, overflow, value, :equipment, value.call("#{prefix}.equipment.amount"), realm) if rng.rand * 100.0 < equipment_chance
end

def breakthrough_costs(value, from, to)
  resources = if from == "qi" || from == "foundation"
    %w[spirit_stone pill ancient_scroll]
  else
    %w[spirit_stone pill ancient_scroll demon_core millennium_herb meteor_iron]
  end
  resources.to_h do |resource|
    field = resource == "ancient_scroll" && (from == "qi" || from == "foundation") ? "scroll" : resource
    [resource.to_sym, value.call("breakthrough.#{from}_to_#{to}.#{field}_cost")]
  end
end

def pay_breakthrough(state, value, from, to)
  costs = breakthrough_costs(value, from, to)
  return false unless costs.all? { |resource, cost| state.fetch(resource, 0.0) + 1e-9 >= cost }
  costs.each { |resource, cost| state[resource] -= cost }
  true
end

def schedule_kind(hour, value, support_activity)
  return :bai_cao_valley if hour <= 48
  return :black_wind_valley if hour <= 168
  supply_share = value.call("dungeon.high_tier.supply_window_ratio")
  first_transition_end = value.call("schedule.long_horizon.thirty_day_hours")
  phase_start = hour <= first_transition_end ? 169 : first_transition_end + 1
  phase_hour = hour - phase_start
  transition_hours = hour <= first_transition_end ? value.call("dungeon.high_tier.nascent_soul.transition_hours") : value.call("dungeon.high_tier.divine_transformation.transition_hours")
  cycle = (1.0 / (1.0 - supply_share)).round
  return :high_tier if phase_hour < transition_hours && (phase_hour % cycle) < (cycle * supply_share).round
  support_activity.to_sym
end

def simulate(value, horizon:, support_activity:, farm_level:, alchemy_level:, bag_stars: 0, capacity_unlock: value.call("economy.inventory.transition_capacity_unlock") == 1)
  state = Hash.new(0.0)
  overflow = Hash.new(0.0)
  failures = []
  paid = []
  activity_hours = Hash.new(0)
  current_realm = "core"
  boss_rng = Random.new(610_000 + horizon)
  (1..horizon).each do |hour|
    # Capacity unlocks when the high-tier expedition preparation starts, before the breakthrough is paid.
    if capacity_unlock && hour > 168 && hour <= value.call("schedule.long_horizon.thirty_day_hours")
      current_realm = "nascent_soul"
    elsif capacity_unlock && hour > value.call("schedule.long_horizon.thirty_day_hours") && hour <= value.call("schedule.long_horizon.ninety_day_hours")
      current_realm = "divine_transformation"
    elsif hour > value.call("schedule.long_horizon.ninety_day_hours")
      current_realm = "divine_transformation"
    end
    production_step(state, overflow, value, farm_level: farm_level, alchemy_level: alchemy_level, bag_stars: bag_stars, realm: current_realm)
    activity = schedule_kind(hour, value, support_activity)
    activity_hours[activity] += 1
    case activity
    when :bai_cao_valley, :black_wind_valley, :red_flame_cave
      pill_cost = map_step(state, overflow, value, activity.to_s, current_realm)
      if state[:pill] + 1e-9 < pill_cost
        failures << [hour, activity, state[:pill], pill_cost]
        break
      end
      state[:pill] -= pill_cost
    when :qing_feng, :yan_prison, :sky_abyss
      pill_cost, demon_core_reward = dungeon_step(state, overflow, value, activity.to_s, current_realm)
      if state[:pill] + 1e-9 < pill_cost
        failures << [hour, activity, state[:pill], pill_cost]
        break
      end
      state[:pill] -= pill_cost
      add_resource(state, overflow, value, :demon_core, demon_core_reward, current_realm)
    when :high_tier
      to = hour <= value.call("schedule.long_horizon.thirty_day_hours") ? "nascent_soul" : "divine_transformation"
      high_tier_step(state, overflow, value, to, current_realm, hour, boss_rng)
    else
      abort("unknown activity #{activity}")
    end

    milestones = { 24 => ["qi", "foundation"], 48 => ["foundation", "core"], 720 => ["core", "nascent_soul"], 2160 => ["nascent_soul", "divine_transformation"] }
    if milestones.key?(hour)
      from, to = milestones.fetch(hour)
      if pay_breakthrough(state, value, from, to)
        paid << [hour, from, to]
      else
        failures << [hour, :breakthrough, state.dup, breakthrough_costs(value, from, to)]
        break if value.call("schedule.priority.breakthrough_first") == 1
      end
    end
  end
  { state: state, overflow: overflow, failures: failures, paid: paid, activity_hours: activity_hours }
end

def continuous_sky(value, hours:, farm_level:, alchemy_level:, bag_stars:, initial_pills:)
  state = Hash.new(0.0)
  state[:pill] = initial_pills
  overflow = Hash.new(0.0)
  failed_at = nil
  (1..hours).each do |hour|
    production_step(state, overflow, value, farm_level: farm_level, alchemy_level: alchemy_level, bag_stars: bag_stars, realm: "core")
    cost, = dungeon_step(state, overflow, value, "sky_abyss", "core")
    if state[:pill] + 1e-9 < cost
      failed_at = hour
      break
    end
    state[:pill] -= cost
  end
  { failed_at: failed_at, state: state }
end

thirty = value.call("schedule.long_horizon.thirty_day_hours").to_i
ninety = value.call("schedule.long_horizon.ninety_day_hours").to_i
abort("support share must complement supply share") unless (value.call("schedule.rotation.support_share") + value.call("dungeon.high_tier.supply_window_ratio") - 1).abs < 1e-9

rotation_qing = simulate(value, horizon: ninety, support_activity: "qing_feng", farm_level: 1, alchemy_level: 1)
rotation_sky = simulate(value, horizon: ninety, support_activity: "sky_abyss", farm_level: 1, alchemy_level: 1)
capacity_disabled = simulate(value, horizon: thirty, support_activity: "qing_feng", farm_level: 1, alchemy_level: 1, capacity_unlock: false)
abort("qing feng rotation must pay 4 milestones") unless rotation_qing[:paid].length == 4 && rotation_qing[:failures].empty?
abort("sky rotation must pay 4 milestones") unless rotation_sky[:paid].length == 4 && rotation_sky[:failures].empty?
abort("capacity unlock must be required for first high-tier breakthrough") unless capacity_disabled[:failures].any? { |hour, type, *_rest| hour == thirty && type == :breakthrough }
abort("30-day qing feng rotation must reach nascent soul") unless rotation_qing[:paid].any? { |hour, _from, to| hour == thirty && to == "nascent_soul" }
abort("90-day qing feng rotation must reach divine transformation") unless rotation_qing[:paid].any? { |hour, _from, to| hour == ninety && to == "divine_transformation" }

continuous_low = continuous_sky(value, hours: 240, farm_level: 1, alchemy_level: 3, bag_stars: 0, initial_pills: BASE_CAPS[:pill])
continuous_closed = continuous_sky(value, hours: 240, farm_level: 3, alchemy_level: 3, bag_stars: 0, initial_pills: BASE_CAPS[:pill])
abort("level 3 alchemy with level 1 farm must fail continuous sky") unless continuous_low[:failed_at]
abort("level 3 alchemy with level 3 farm must sustain continuous sky") if continuous_closed[:failed_at]

[rotation_qing, rotation_sky].each_with_index do |result, index|
  name = index.zero? ? "qing_rotation_90d" : "sky_rotation_90d"
  puts [name, "paid=#{result[:paid].length}", "failures=#{result[:failures].length}", "activity_hours=#{result[:activity_hours].sort.to_h}", "state=#{result[:state].sort.to_h}", "overflow=#{result[:overflow].select { |_k, v| v.positive? }}"].join(" ")
end
puts "continuous_sky_low_farm_failed_at=#{continuous_low[:failed_at]} continuous_sky_closed_loop_failed_at=#{continuous_closed[:failed_at] || 'none'}"
puts "capacity_unlock_disabled_failure=#{capacity_disabled[:failures].first&.first || 'none'}"
puts "validated rows=#{rows.length} duplicate_parameter_id=0 horizons=#{thirty}/#{ninety} input_capped_alchemy=1 breakthrough_priority=1"
