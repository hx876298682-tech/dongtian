#!/usr/bin/env ruby

require "csv"

path = File.expand_path("洞天数值参数表.csv", __dir__)
headers = %w[parameter_id domain parameter_name value unit value_type status source reference_source formula_or_rule rounding notes]
rows = CSV.read(path, headers: true)
abort("headers mismatch") unless rows.headers == headers
abort("column count mismatch") unless rows.all? { |row| row.fields.length == headers.length }

allowed_domains = %w[core growth breakthrough building recipe economy combat map dungeon loot offline schedule]
allowed_types = %w[constant target scalar cost probability policy derived]
allowed_statuses = %w[confirmed pending_design proposal_v1 frozen_v1 derived validated unknown]
bad_domain = rows.reject { |row| allowed_domains.include?(row["domain"]) }
bad_type = rows.reject { |row| allowed_types.include?(row["value_type"]) }
bad_status = rows.reject { |row| allowed_statuses.include?(row["status"]) }
abort("bad domains: #{bad_domain.map { |row| row["domain"] }.uniq}") unless bad_domain.empty?
abort("bad value types: #{bad_type.map { |row| row["value_type"] }.uniq}") unless bad_type.empty?
abort("bad statuses: #{bad_status.map { |row| row["status"] }.uniq}") unless bad_status.empty?

ids = rows.map { |row| row["parameter_id"] }
duplicates = ids.group_by(&:itself).select { |_id, values| values.length > 1 }
abort("duplicate parameter_id: #{duplicates.keys.join(",")}") unless duplicates.empty?
abort("empty parameter name") unless rows.all? { |row| !row["parameter_name"].to_s.empty? }
abort("blank value on fixed status") unless rows.all? { |row| row["status"] == "pending_design" || !row["value"].to_s.empty? }
abort("derived type must have derived or proposal/frozen status") unless rows.all? { |row| row["value_type"] != "derived" || %w[derived proposal_v1 frozen_v1].include?(row["status"]) }

puts "validated rows=#{rows.length} columns=#{headers.length} duplicate_parameter_id=0 schema=ok"
