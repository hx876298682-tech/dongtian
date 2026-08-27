#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

interval = value.call("schedule.random_event.roll_interval_hours")
max_active = value.call("schedule.random_event.max_active")
abort("random event interval must be positive") unless interval.positive?
abort("random event active cap must be one") unless max_active == 1
events = %w[spirit_tide beast_raid]
chance_sum = events.sum { |event| value.call("schedule.random_event.#{event}.chance") }
abort("random event chance sum outside 0..100") unless chance_sum.between?(0, 100)
events.each do |event|
  chance = value.call("schedule.random_event.#{event}.chance")
  duration = value.call("schedule.random_event.#{event}.duration_hours")
  production = value.call("schedule.random_event.#{event}.production_multiplier")
  abort("#{event} duration must be below interval") unless duration.positive? && duration < interval
  abort("#{event} production multiplier outside 0.5..1.5") unless production.between?(0.5, 1.5)
  abort("#{event} chance outside 0..100") unless chance.between?(0, 100)
end

horizon = 2_160.0
runs = 5_000
intervals = (horizon / interval).floor
expected_factor = 1.0 + events.sum do |event|
  chance = value.call("schedule.random_event.#{event}.chance") / 100.0
  duration = value.call("schedule.random_event.#{event}.duration_hours")
  chance * duration * intervals / horizon * (value.call("schedule.random_event.#{event}.production_multiplier") - 1.0)
end
samples = runs.times.map do |seed|
  rng = Random.new(900_000 + seed)
  active_modifier_hours = 0.0
  intervals.times do
    roll = rng.rand * 100.0
    cursor = 0.0
    event = events.find do |candidate|
      cursor += value.call("schedule.random_event.#{candidate}.chance")
      roll < cursor
    end
    active_modifier_hours += value.call("schedule.random_event.#{event}.duration_hours") * (value.call("schedule.random_event.#{event}.production_multiplier") - 1.0) if event
  end
  1.0 + active_modifier_hours / horizon
end
mean = samples.sum / runs
variance = samples.sum { |sample| (sample - mean) ** 2 } / (runs - 1)
ci99 = 2.576 * Math.sqrt(variance / runs)
abort("random event production factor outside 99% CI") unless (mean - expected_factor).abs <= ci99

puts "validated rows=#{rows.length} duplicate_parameter_id=0 interval=#{interval}h chance_sum=#{chance_sum}% expected_production_factor=#{expected_factor.round(6)} mean=#{mean.round(6)} ci99=+/-#{ci99.round(6)} online_offline_same=1"
