require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'DeepARTestView'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = { :type => 'MIT' }
  s.author         = 'Nelyon'
  s.homepage       = 'https://github.com/andressan101989/ClipDAG-9bh0w4-26004-20260525'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :path => '.' }
  s.swift_version  = '5.9'

  s.source_files = 'ios/**/*.{swift,h,m,mm}'

  s.dependency 'ExpoModulesCore'
end
