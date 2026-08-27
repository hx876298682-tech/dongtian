#!/usr/bin/env ruby

ROOT = __dir__
scripts = Dir[File.join(ROOT, "验证*.rb")].sort
abort("expected at least 32 validators, got #{scripts.length}") unless scripts.length >= 32
scripts.each do |script|
  abort("validator failed: #{File.basename(script)}") unless system(RbConfig.ruby, script)
end

node_audit = File.expand_path("../demo/scripts/audit-release-inputs.mjs", __dir__)
abort("Node release-input audit failed") unless system(ENV.fetch("DONGTIAN_NODE", "node"), "--experimental-strip-types", node_audit)

puts "full_audit_passed validators=#{scripts.length} parameter_table=read_only node_release_inputs=read_only"
