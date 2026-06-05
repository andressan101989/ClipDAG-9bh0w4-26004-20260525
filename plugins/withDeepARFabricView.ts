import { ConfigPlugin, createRunOncePlugin } from '@expo/config-plugins';

const withDeepARFabricView: ConfigPlugin = (config) => {
  return config;
};

export default createRunOncePlugin(
  withDeepARFabricView,
  'deepar-fabric-view',
  '0.1.0'
);
