const { createRunOncePlugin } = require('@expo/config-plugins');

function withDeepARFabricView(config) {
  return config;
}

module.exports = createRunOncePlugin(
  withDeepARFabricView,
  'deepar-fabric-view',
  '0.1.0'
);
