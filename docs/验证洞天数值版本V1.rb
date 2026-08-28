#!/usr/bin/env ruby

require "csv"
require "digest"

root = __dir__
csv_path = File.join(root, "洞天数值参数表.csv")
rows = CSV.read(csv_path, headers: true)
abort("parameter table must have 12 columns") unless rows.headers.length == 12
abort("parameter table row count changed") unless [1143, 1150].include?(rows.length)
abort("duplicate parameter IDs") unless rows.map { |row| row["parameter_id"] }.uniq.length == rows.length

manifest = File.read(File.join(root, "洞天数值版本V1.md"))
%w[1.0.0-frozen DT-NUM-20260825-10 DT-NUM-20260827-02 qing_90d_then_black retain_rare collected_p10 frozen_v1].each do |token|
  abort("manifest missing #{token}") unless manifest.include?(token)
end

digest = Digest::SHA256.file(csv_path).hexdigest
abort("parameter table digest must be recorded") unless manifest.include?(digest)
statuses = rows.map { |row| row["status"] }.uniq
abort("unfrozen parameter status remains") if statuses.include?("pending_design") || statuses.include?("proposal_v1")
puts "validated rows=#{rows.length} columns=#{rows.headers.length} version=1.0.0-frozen change=DT-NUM-20260825-10 sha256=#{digest} route=qing_90d_then_black exit=retain_rare entry=collected_p10 statuses=#{statuses.join('/') }"
