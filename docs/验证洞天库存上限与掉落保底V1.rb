#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

caps = {
  "spirit_stone" => 25_000,
  "spirit_wood" => 10_000,
  "spirit_ore" => 10_000,
  "spirit_herb" => 10_000,
  "pill" => 2_000,
  "ancient_scroll" => 100,
  "equipment" => 200
}
caps.each do |resource, expected|
  actual = value.call("economy.inventory.cap.#{resource}")
  abort("#{resource} cap=#{actual}, expected=#{expected}") unless actual == expected
end
abort("overflow must be discarded in V1") unless value.call("economy.inventory.overflow_return_ratio").zero?

maps = {
  "bai_cao_valley" => [120, 0.5, 100, 1.5219558743],
  "black_wind_valley" => [40, 1.5, 100, 0.7698317418],
  "red_flame_cave" => [15, 3.0, 100, 0.4724669903]
}
maps.each do |map_id, (kills_per_hour, chance_percent, pity_kills, expected_rate)|
  actual_pity = value.call("map.#{map_id}.ancient_scroll_pity_kills")
  abort("#{map_id}: pity=#{actual_pity}") unless actual_pity == pity_kills
  p = chance_percent / 100.0
  cycle = (1 - (1 - p)**pity_kills) / p
  rate = kills_per_hour / cycle
  recorded = value.call("map.#{map_id}.ancient_scroll_effective_per_hour")
  abort("#{map_id}: effective=#{recorded}, expected=#{expected_rate}") unless (rate - recorded).abs < 0.000001
  puts [map_id, "cycle=#{format("%.3f", cycle)}", "scrolls_per_hour=#{format("%.3f", rate)}"].join(" ")
end

red_stones = value.call("map.red_flame_cave.spirit_stone_per_kill") * 3600.0 / value.call("map.red_flame_cave.target_kill_time")
red_pills = value.call("map.red_flame_cave.pill_per_hour")
abort("red flame 24h stone overflow risk") unless red_stones * value.call("offline.settlement.max_hours") <= caps["spirit_stone"]
abort("red flame 24h pill overflow risk") unless (120 - red_pills) * value.call("offline.settlement.max_hours") <= caps["pill"]
puts "validated rows=#{rows.length} duplicate_parameter_id=0 inventory_caps=ok pity=ok"
