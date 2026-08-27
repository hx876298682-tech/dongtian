#!/usr/bin/env ruby

require_relative "验证洞天长期随机库存V1"

rows = CSV.read(File.join(__dir__, "洞天数值参数表.csv"), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

strategies = {
  retain_rare: "普通/精良分解，稀有以上出售",
  sell_all: "满仓后所有品质出售"
}

HORIZONS.each do |horizon|
  summaries = strategies.keys.to_h do |strategy|
    results = RUNS.times.map { |index| simulate(value, horizon, 180_000 + horizon + index * 101, exit_policy: strategy) }
    abort("#{strategy} #{horizon}h warehouse level too low") unless results.all? { |result| result[:warehouse_level] >= 4 }
    abort("#{strategy} #{horizon}h forced overflow") unless results.all? { |result| result[:overflow][:equipment].to_f.zero? }
    metrics = results.map { |result| result[:metrics] }
    [strategy, {
      mean_sold: metrics.sum { |metric| metric[:sold] } / metrics.length,
      mean_sale_stone: metrics.sum { |metric| metric[:sale_stone] } / metrics.length,
      mean_salvage_ore: metrics.sum { |metric| metric[:salvage_ore] } / metrics.length,
      mean_salvage_wood: metrics.sum { |metric| metric[:salvage_wood] } / metrics.length,
      mean_ratio: metrics.sum { |metric| metric[:max_ratio] } / metrics.length
    }]
  end

  baseline = summaries.fetch(:retain_rare)
  all_sale = summaries.fetch(:sell_all)
  abort("#{horizon}h all-sale must return more stone") unless all_sale[:mean_sale_stone] > baseline[:mean_sale_stone]
  abort("#{horizon}h baseline must return more salvage ore") unless baseline[:mean_salvage_ore] > all_sale[:mean_salvage_ore]
  abort("#{horizon}h baseline must return more salvage wood") unless baseline[:mean_salvage_wood] > all_sale[:mean_salvage_wood]
  puts "horizon=#{horizon}h baseline=#{baseline.transform_values { |v| v.round(2) }} all_sale=#{all_sale.transform_values { |v| v.round(2) }}"
end

puts "validated rows=#{rows.length} duplicate_parameter_id=0 strategies=retain_rare/sell_all horizons=#{HORIZONS.join('/')} tradeoff=stone_vs_material"
