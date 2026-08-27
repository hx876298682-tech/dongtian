#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

base_interval = value.call("combat.player.base_attack_interval")
speed = value.call("combat.player.base_speed")
min_interval = value.call("combat.speed.min_attack_interval")
interval = [min_interval, base_interval / (1 + speed / 100.0)].max
abort("baseline interval changed") unless interval == 4

power = value.call("combat.player.base_attack") * value.call("combat.power.attack_weight") +
        value.call("combat.player.base_defence") * value.call("combat.power.defence_weight") +
        value.call("combat.player.base_health") * value.call("combat.power.health_weight") +
        speed * value.call("combat.power.speed_weight")
abort("baseline battle power=#{power}") unless power == 250
puts "validated rows=#{rows.length} duplicate_parameter_id=0 baseline_interval=#{interval} baseline_power=#{power}"
