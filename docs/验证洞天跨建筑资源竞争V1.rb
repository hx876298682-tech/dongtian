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
  spirit_ore: value.call("economy.inventory.cap.spirit_ore"),
  spirit_wood: value.call("economy.inventory.cap.spirit_wood"),
  spirit_herb: value.call("economy.inventory.cap.spirit_herb"),
  pill: value.call("economy.inventory.cap.pill"),
  ancient_scroll: value.call("economy.inventory.cap.ancient_scroll"),
  demon_core: value.call("economy.inventory.cap.demon_core"),
  millennium_herb: value.call("economy.inventory.cap.millennium_herb"),
  meteor_iron: value.call("economy.inventory.cap.meteor_iron")
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

def upgrade_cost(value, building, from_level)
  (value.call("building.upgrade.spirit_stone_base_cost.#{building}") * value.call("building.upgrade.cost_growth")**(from_level - 1)).ceil
end

def pay_upgrade(state, value, building, levels, target, events)
  total_cost = (levels.fetch(building)...target).sum { |from| upgrade_cost(value, building, from) }
  return false if state[:spirit_stone] < total_cost

  while levels.fetch(building) < target
    from = levels.fetch(building)
    cost = upgrade_cost(value, building, from)
    state[:spirit_stone] -= cost
    levels[building] += 1
    events << [building, from, levels[building], cost]
  end
  true
end

def upgrade_reserve(value, levels, targets)
  targets.sum do |building, target|
    (levels.fetch(building)...target).sum { |from| upgrade_cost(value, building, from) }
  end
end

def production_step(state, overflow, value, levels, realm, reserved_stone: 0, bag_stars: 0)
  speed = ->(building_level) { value.call("building.level.speed_multiplier_#{building_level}") }
  add_resource(state, overflow, value, :spirit_stone, value.call("economy.resource.spirit_stone.base_rate"), realm)
  add_resource(state, overflow, value, :spirit_ore, value.call("economy.resource.spirit_ore.base_rate"), realm)
  add_resource(state, overflow, value, :spirit_wood, value.call("economy.resource.spirit_wood.base_rate"), realm)
  herb_rate = value.call("building.spirit_farm.plot_count") * value.call("building.spirit_farm.herb_yield_per_plot") * 3600.0 / value.call("building.spirit_farm.base_growth_time") * speed.call(levels.fetch(:spirit_farm))
  add_resource(state, overflow, value, :spirit_herb, herb_rate, realm)

  bag_multiplier = 1 + value.call("growth.treasure.heaven_bag.production_bonus_per_star") * bag_stars
  alchemy_actions = value.call("building.alchemy_room.output_per_action") * 3600.0 / value.call("building.alchemy_room.base_interval") * speed.call(levels.fetch(:alchemy_room)) * bag_multiplier
  available_stone = [state[:spirit_stone] - reserved_stone, 0.0].max
  alchemy_batches = [alchemy_actions, state[:spirit_herb] / value.call("recipe.alchemy_basic.herb_cost"), available_stone / value.call("recipe.alchemy_basic.stone_cost")].min
  state[:spirit_herb] -= alchemy_batches * value.call("recipe.alchemy_basic.herb_cost")
  state[:spirit_stone] -= alchemy_batches * value.call("recipe.alchemy_basic.stone_cost")
  add_resource(state, overflow, value, :pill, alchemy_batches, realm)

  forge_actions = value.call("building.forge_room.output_per_action") * 3600.0 / value.call("building.forge_room.base_interval") * speed.call(levels.fetch(:forge_room)) * bag_multiplier
  available_stone = [state[:spirit_stone] - reserved_stone, 0.0].max
  forge_batches = [forge_actions, state[:spirit_ore] / value.call("recipe.forge_basic.ore_cost"), state[:spirit_wood] / value.call("recipe.forge_basic.wood_cost"), available_stone / value.call("recipe.forge_basic.stone_cost")].min
  state[:spirit_ore] -= forge_batches * value.call("recipe.forge_basic.ore_cost")
  state[:spirit_wood] -= forge_batches * value.call("recipe.forge_basic.wood_cost")
  state[:spirit_stone] -= forge_batches * value.call("recipe.forge_basic.stone_cost")
  [alchemy_batches, forge_batches]
end

def breakthrough_costs(value, from, to)
  resources = %w[spirit_stone pill ancient_scroll]
  resources += %w[demon_core millennium_herb meteor_iron] unless %w[qi foundation].include?(from)
  resources.to_h do |resource|
    field = resource == "ancient_scroll" && %w[qi foundation].include?(from) ? "scroll" : resource
    [resource.to_sym, value.call("breakthrough.#{from}_to_#{to}.#{field}_cost")]
  end
end

def pay_breakthrough(state, value, from, to)
  costs = breakthrough_costs(value, from, to)
  return false unless costs.all? { |resource, amount| state.fetch(resource, 0.0) >= amount - 1e-9 }
  costs.each { |resource, amount| state[resource] -= amount }
  true
end

def breakthrough_reserve(value, hour)
  from, to, milestone = if hour.between?(169, 720)
    ["core", "nascent_soul", 720]
  elsif hour.between?(721, 2160)
    ["nascent_soul", "divine_transformation", 2160]
  else
    return {}
  end
  high_tier_hours = (hour..milestone).count { |future_hour| activity_for(future_hour, value) == :high_tier }
  breakthrough_costs(value, from, to).to_h do |resource, cost|
    rate = value.call("dungeon.high_tier.#{to}.#{resource}_per_hour")
    [resource, [cost - rate * high_tier_hours, 0.0].max]
  end
end

def activity_for(hour, value, support: :qing_feng)
  return :bai_cao_valley if hour <= 48
  return :black_wind_valley if hour <= 168
  first_end = value.call("schedule.long_horizon.thirty_day_hours")
  phase_start = hour <= first_end ? 169 : first_end + 1
  phase_hour = hour - phase_start
  transition = hour <= first_end ? value.call("dungeon.high_tier.nascent_soul.transition_hours") : value.call("dungeon.high_tier.divine_transformation.transition_hours")
  cycle = 4
  return :high_tier if phase_hour < transition && (phase_hour % cycle) < 3
  support
end

def simulate(value, horizon: 2160)
  state = Hash.new(0.0)
  overflow = Hash.new(0.0)
  levels = { alchemy_room: 1, forge_room: 1, spirit_farm: 1, technique_pavilion: 1, treasure_pavilion: 1 }
  pending_upgrades = {}
  upgrade_events = []
  failures = []
  current_realm = "core"
  (1..horizon).each do |hour|
    upgrade_plan = {
      49 => { alchemy_room: 3 },
      51 => { spirit_farm: 3 },
      169 => { technique_pavilion: 3, treasure_pavilion: 3 },
      721 => { alchemy_room: 5, spirit_farm: 5, technique_pavilion: 5, treasure_pavilion: 5 }
    }
    pending_upgrades.merge!(upgrade_plan.fetch(hour, {}))
    capacity_unlock = value.call("economy.inventory.transition_capacity_unlock") == 1
    current_realm = if capacity_unlock && hour > 168 && hour <= 720
      "nascent_soul"
    elsif capacity_unlock && hour > 720 && hour <= 2160
      "divine_transformation"
    else
      "core"
    end
    breakthrough_hold = if value.call("schedule.priority.resource_reserve") == 1
      breakthrough_reserve(value, hour)
    else
      {}
    end
    stone_hold = breakthrough_hold.fetch(:spirit_stone, 0.0) + upgrade_reserve(value, levels, pending_upgrades)
    production_step(state, overflow, value, levels, current_realm, reserved_stone: stone_hold)
    activity = activity_for(hour, value)
    case activity
    when :bai_cao_valley, :black_wind_valley
      kills = 3600.0 / value.call("map.#{activity}.target_kill_time")
      add_resource(state, overflow, value, :spirit_stone, kills * value.call("map.#{activity}.spirit_stone_per_kill"), current_realm)
      add_resource(state, overflow, value, :spirit_ore, kills * value.call("map.#{activity}.spirit_ore_per_kill"), current_realm)
      add_resource(state, overflow, value, :spirit_wood, kills * value.call("map.#{activity}.spirit_wood_per_kill"), current_realm)
      add_resource(state, overflow, value, :ancient_scroll, kills * value.call("map.#{activity}.ancient_scroll_effective_per_hour"), current_realm)
    when :qing_feng, :sky_abyss
      clears = 3600.0 / value.call("dungeon.#{activity}.target_clear_time")
      pills = clears * (value.call("dungeon.#{activity}.pill_cost") + value.call("dungeon.#{activity}.boss_auto_pill_per_clear"))
      if state[:pill] < pills
        failures << [hour, activity, :pill]
        break
      end
      state[:pill] -= pills
      add_resource(state, overflow, value, :demon_core, clears * value.call("dungeon.#{activity}.demon_core_per_clear"), current_realm)
    when :high_tier
      to = hour <= 720 ? "nascent_soul" : "divine_transformation"
      %w[spirit_stone pill ancient_scroll demon_core millennium_herb meteor_iron].each do |resource|
        add_resource(state, overflow, value, resource.to_sym, value.call("dungeon.high_tier.#{to}.#{resource}_per_hour"), current_realm)
      end
    end

    milestones = { 24 => ["qi", "foundation"], 48 => ["foundation", "core"], 720 => ["core", "nascent_soul"], 2160 => ["nascent_soul", "divine_transformation"] }
    if milestones.key?(hour) && !pay_breakthrough(state, value, *milestones.fetch(hour))
      from, to = milestones.fetch(hour)
      costs = breakthrough_costs(value, from, to)
      missing = costs.to_h { |resource, amount| [resource, [amount - state.fetch(resource, 0.0), 0.0].max] }.reject { |_resource, amount| amount.zero? }
      failures << [hour, :breakthrough, missing]
      break
    end
    pending_cost = upgrade_reserve(value, levels, pending_upgrades)
    if pending_cost.positive? && state[:spirit_stone] - breakthrough_hold.fetch(:spirit_stone, 0.0) >= pending_cost
      pending_upgrades.each { |building, target| pay_upgrade(state, value, building, levels, target, upgrade_events) }
      pending_upgrades.clear
    end
  end
  failures << [horizon, :upgrade, pending_upgrades] unless pending_upgrades.empty?
  { state: state, overflow: overflow, levels: levels, upgrades: upgrade_events, failures: failures }
end

result = simulate(value)
abort("cross-building simulation failed: #{result[:failures].inspect}") unless result[:failures].empty?
abort("all planned upgrades must complete") unless result[:levels].fetch(:alchemy_room) == 5 && result[:levels].fetch(:spirit_farm) == 5 && result[:levels].fetch(:technique_pavilion) == 5 && result[:levels].fetch(:treasure_pavilion) == 5
abort("all four breakthroughs and 16 upgrade levels must be paid") unless result[:state][:spirit_stone] >= 0 && result[:upgrades].length == 16
puts "levels=#{result[:levels]} upgrades=#{result[:upgrades].length} state=#{result[:state].sort.to_h} overflow=#{result[:overflow].select { |_resource, amount| amount.positive? }}"
puts "validated rows=#{rows.length} duplicate_parameter_id=0 horizon=2160h production=alchemy+forge+farm pavilion=technique+treasure resource_competition=passed resource_reserve=#{value.call("schedule.priority.resource_reserve").to_i}"
