#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

qualities = {
  "mortal" => [1.0, 261_052],
  "yellow" => [1.25, 326_300],
  "xuan" => [1.6, 417_652],
  "earth" => [2.1, 548_158],
  "heaven" => [2.8, 730_855],
  "immortal" => [3.8, 991_857]
}

qualities.each do |quality, (multiplier, expected_total)|
  actual_multiplier = value.call("growth.technique.quality_multiplier.#{quality}")
  abort("#{quality}: multiplier=#{actual_multiplier}") unless actual_multiplier == multiplier
  total = (0...value.call("growth.technique.max_layer").to_i).sum do |layer|
    (value.call("growth.technique.research_base_cost") * value.call("growth.technique.research_growth")**layer * multiplier).ceil
  end
  abort("#{quality}: research_total=#{total}, expected=#{expected_total}") unless total == expected_total
end

abort("technique max layer must be 100") unless value.call("growth.technique.max_layer") == 100
abort("equipped technique count must be 1") unless value.call("growth.technique.equipped_count") == 1
puts "validated rows=#{rows.length} duplicate_parameter_id=0 technique_max_layer=100"
