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
  s.public_header_files = 'ios/**/*.h'
  s.vendored_frameworks = '../../node_modules/react-native-deepar/ios/Frameworks/DeepAR.xcframework'
  s.frameworks = 'AVFoundation', 'UIKit'
  s.pod_target_xcconfig = {
    'FRAMEWORK_SEARCH_PATHS' => '$(inherited) "${PODS_TARGET_SRCROOT}/../../node_modules/react-native-deepar/ios/Frameworks"',
    'HEADER_SEARCH_PATHS' => '$(inherited) "${PODS_TARGET_SRCROOT}/../../node_modules/react-native-deepar/ios/Frameworks/DeepAR.xcframework/ios-arm64/DeepAR.framework/Headers"',
    'SWIFT_INCLUDE_PATHS' => '$(inherited) "${PODS_TARGET_SRCROOT}/../../node_modules/react-native-deepar/ios/Frameworks/DeepAR.xcframework/ios-arm64/DeepAR.framework/Headers"'
  }

  s.dependency 'ExpoModulesCore'
end
