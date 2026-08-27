#!/usr/bin/env ruby

require "csv"

rows = CSV.read(File.expand_path("洞天数值参数表.csv", __dir__), headers: true)
ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
by_id = rows.to_h { |row| [row["parameter_id"], row] }
value = ->(id) { Float(by_id.fetch(id)["value"]) }

%w[qi_to_foundation foundation_to_core].each do |transition|
  success = value.call("breakthrough.#{transition}.success_chance")
  abort("#{transition}: success chance is not 100") unless success == 100
end

abort("failure loss must be zero") unless value.call("breakthrough.attempt.failure_loss_percent").zero?
abort("retry cooldown must be zero") unless value.call("breakthrough.attempt.retry_cooldown").zero?
puts "validated rows=#{rows.length} duplicate_parameter_id=0 breakthrough_success=100 failure_loss=0 retry_cooldown=0"
