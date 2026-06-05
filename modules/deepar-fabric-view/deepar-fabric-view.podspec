require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'DeepARFabricView'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = { :type => 'MIT' }
  s.author         = 'ClipDAG'
  s.homepage       = 'https://clipdag.com'
  s.platforms      = { :ios => '16.4' }
  s.source         = { :path => '.' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.source_files = 'ios/**/*.{swift,h,m,mm}'
  s.frameworks = 'AVFoundation', 'UIKit'

  s.dependency 'ExpoModulesCore'
  s.dependency 'react-native-deepar'
end
