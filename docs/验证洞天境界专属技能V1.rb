#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
abort("duplicate parameter_id") unless ids.uniq.length == ids.length
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

realms = %w[nascent_soul divine_transformation void_refining body_unity great_vehicle tribulation]
cooldowns = []
durations = []
suppression = []
realms.each do |realm|
  prefix = "dungeon.high_tier.#{realm}.signature_skill"
  cd = value.call("#{prefix}.cooldown_seconds")
  duration = value.call("#{prefix}.duration_seconds")
  strength = value.call("#{prefix}.attack_suppression_percent")
  abort("#{realm} signature cooldown must be at least 240s") unless cd >= 240
  abort("#{realm} signature duration must be positive and below cooldown") unless duration.positive? && duration < cd
  abort("#{realm} signature suppression outside 0..40%") unless strength.between?(0, 40)
  cooldowns << cd
  durations << duration
  suppression << strength
  exposure = duration / cd
  abort("#{realm} signature exposure too high") unless exposure <= 0.027
  puts "realm=#{realm} cooldown=#{cd}s duration=#{duration}s suppression=#{strength}% exposure=#{exposure.round(4)}"
end

abort("signature cooldown must not decrease by realm") unless cooldowns.each_cons(2).all? { |a, b| b >= a }
abort("signature duration must not decrease by realm") unless durations.each_cons(2).all? { |a, b| b >= a }
abort("signature suppression must increase by realm") unless suppression.each_cons(2).all? { |a, b| b > a }

puts "validated rows=#{rows.length} duplicate_parameter_id=0 realms=#{realms.length} signature_skill=bounded_monotonic"
