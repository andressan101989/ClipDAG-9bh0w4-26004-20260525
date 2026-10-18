import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const testRequire = createRequire(import.meta.url);
const { transformSync } = testRequire('@babel/core');
const React = testRequire('react');
const { renderToStaticMarkup } = testRequire('react-dom/server');

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootLayoutPath = path.join(projectRoot, 'app', '_layout.tsx');
const rootRuntimePath = path.join(projectRoot, 'components', 'feature', 'RootAppRuntime.tsx');
const alertContextPath = path.join(projectRoot, 'template', 'ui', 'context.tsx');
const alertHookPath = path.join(projectRoot, 'template', 'ui', 'hook.tsx');

function compileTsx(filename) {
  const result = transformSync(readFileSync(filename, 'utf8'), {
    filename,
    babelrc: false,
    configFile: false,
    presets: [
      [testRequire.resolve('@babel/preset-typescript'), { allExtensions: true, isTSX: true }],
      [testRequire.resolve('@babel/preset-react'), { runtime: 'automatic' }],
    ],
    plugins: [testRequire.resolve('@babel/plugin-transform-modules-commonjs')],
  });

  assert.ok(result?.code, `Babel did not compile ${filename}`);
  return result.code;
}

function createRootHarness() {
  const moduleCache = new Map();
  const nativeAlerts = [];
  const PassThrough = ({ children }) => React.createElement(React.Fragment, null, children);
  const GestureRoot = ({ children }) => React.createElement('div', { 'data-gesture-root': 'true' }, children);
  const reactNative = {
    Alert: { alert: (...args) => nativeAlerts.push(args) },
    Modal: PassThrough,
    Platform: {
      OS: 'ios',
      select: choices => choices.ios ?? choices.default,
    },
    Pressable: PassThrough,
    StyleSheet: { create: value => value, hairlineWidth: 1 },
    Text: PassThrough,
    TouchableOpacity: PassThrough,
    View: PassThrough,
  };

  function loadTsx(filename) {
    const resolvedFilename = path.resolve(filename);
    const cached = moduleCache.get(resolvedFilename);
    if (cached) return cached.exports;

    const loadedModule = { exports: {} };
    moduleCache.set(resolvedFilename, loadedModule);

    const localRequire = specifier => {
      if (specifier === 'react') return React;
      if (specifier === 'react/jsx-runtime') return testRequire('react/jsx-runtime');
      if (specifier === 'react-native') return reactNative;
      if (specifier === 'react-native-gesture-handler') {
        return { GestureHandlerRootView: GestureRoot };
      }
      if (specifier === '@/components/ui/ErrorBoundary') {
        return { ErrorBoundary: PassThrough };
      }
      if (specifier === '@/template/ui/context') return loadTsx(alertContextPath);
      if (specifier === '@/template/ui/hook') return loadTsx(alertHookPath);
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const candidate = path.resolve(path.dirname(resolvedFilename), specifier);
        for (const extension of ['', '.ts', '.tsx', '.js', '.mjs']) {
          try {
            return loadTsx(`${candidate}${extension}`);
          } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
          }
        }
      }

      throw new Error(`runtime module evaluated before the alert boundary: ${specifier}`);
    };

    const wrapper = vm.runInThisContext(
      `(function (exports, require, module, __filename, __dirname) { ${compileTsx(resolvedFilename)}\n})`,
      { filename: resolvedFilename },
    );
    wrapper(
      loadedModule.exports,
      localRequire,
      loadedModule,
      resolvedFilename,
      path.dirname(resolvedFilename),
    );
    return loadedModule.exports;
  }

  return { loadTsx, nativeAlerts };
}

function createRuntimeHarness() {
  const moduleCache = new Map();
  const routeNames = [];
  const PassThrough = ({ children }) => React.createElement(React.Fragment, null, children);
  const AuthContext = React.createContext({ isAuthReady: true });
  const Stack = ({ children }) => React.createElement('nav', null, children);
  const StackScreen = ({ name }) => {
    routeNames.push(name);
    return React.createElement('span', { 'data-route': name }, name);
  };
  StackScreen.displayName = 'StackScreen';
  Stack.Screen = StackScreen;

  const runtimeModules = new Map([
    ['expo-router', { Stack }],
    ['react-native', { ActivityIndicator: PassThrough, View: PassThrough }],
    ['react-native-safe-area-context', { SafeAreaProvider: PassThrough }],
    ['@/contexts/AgoraCallContext', { AgoraCallProvider: PassThrough }],
    ['@/contexts/AuthContext', { AuthContext, AuthProvider: PassThrough }],
    ['@/contexts/FeedContext', { FeedProvider: PassThrough }],
    ['@/contexts/I18nContext', { I18nProvider: PassThrough }],
    ['@/contexts/MarketplaceCartContext', { MarketplaceCartProvider: PassThrough }],
    ['@/contexts/MessagesContext', { MessagesProvider: PassThrough }],
    ['@/contexts/NotificationsContext', { NotificationsProvider: PassThrough }],
    ['@/contexts/ShopContext', { ShopProvider: PassThrough }],
    ['@/contexts/StoriesContext', { StoriesProvider: PassThrough }],
    ['@/components/feature/IncomingCallModal', { IncomingCallModal: PassThrough }],
    ['@/components/feature/IosCallKitActionHandler', { IosCallKitActionHandler: PassThrough }],
    ['@/components/feature/PersonalizationGate', { PersonalizationGate: PassThrough }],
    ['@/components/feature/PushNotificationHandler', { PushNotificationHandler: PassThrough }],
    ['@/components/feature/WalletConnectProvider', { WalletConnectProvider: PassThrough }],
    ['@/components/feature/WalletConnectReturnHandler', { WalletConnectReturnHandler: PassThrough }],
    ['@/components/ui/NelyonLogo', { NelyonLogo: PassThrough }],
    ['@/constants/theme', { Colors: { bg: '#000' } }],
    ['@/template/auth/supabase/context', { AuthProvider: PassThrough }],
  ]);

  function loadTsx(filename) {
    const resolvedFilename = path.resolve(filename);
    const cached = moduleCache.get(resolvedFilename);
    if (cached) return cached.exports;

    const loadedModule = { exports: {} };
    moduleCache.set(resolvedFilename, loadedModule);
    const localRequire = specifier => {
      if (specifier === 'react') return React;
      if (specifier === 'react/jsx-runtime') return testRequire('react/jsx-runtime');
      if (runtimeModules.has(specifier)) return runtimeModules.get(specifier);
      throw new Error(`unexpected RootAppRuntime dependency: ${specifier}`);
    };
    const wrapper = vm.runInThisContext(
      `(function (exports, require, module, __filename, __dirname) { ${compileTsx(resolvedFilename)}\n})`,
      { filename: resolvedFilename },
    );
    wrapper(
      loadedModule.exports,
      localRequire,
      loadedModule,
      resolvedFilename,
      path.dirname(resolvedFilename),
    );
    return loadedModule.exports;
  }

  return { loadTsx, routeNames };
}

test('the Expo root registers without evaluating configuration-dependent app runtime modules', () => {
  const harness = createRootHarness();
  const rootModule = harness.loadTsx(rootLayoutPath);

  assert.equal(typeof rootModule.default, 'function');
  assert.equal(typeof rootModule.RootProviderBoundary, 'function');
});

test('login and every auth transition consume the one canonical AlertProvider above navigation', () => {
  const harness = createRootHarness();
  const { RootProviderBoundary } = harness.loadTsx(rootLayoutPath);
  const { useAlert } = harness.loadTsx(alertHookPath);
  const scenarios = [
    'cold-start-without-session',
    'active-session',
    'logout',
    'expired-session',
    'login-deep-link',
    'creator-premium-navigation',
  ];

  function AlertConsumer({ scenario }) {
    const { showAlert } = useAlert();
    showAlert('provider-regression', scenario);
    return React.createElement('span', null, scenario);
  }

  for (const scenario of scenarios) {
    const markup = renderToStaticMarkup(
      React.createElement(
        RootProviderBoundary,
        null,
        React.createElement(AlertConsumer, { scenario }),
      ),
    );
    assert.match(markup, new RegExp(scenario));
  }

  assert.deepEqual(
    harness.nativeAlerts.map(([, message]) => message),
    scenarios,
  );
});

test('the deferred runtime retains login, deep-link and Creator Premium routes', () => {
  const harness = createRuntimeHarness();
  const { default: RootAppRuntime } = harness.loadTsx(rootRuntimePath);

  renderToStaticMarkup(React.createElement(RootAppRuntime));

  for (const route of [
    'login',
    '(tabs)',
    'onboarding/personalization',
    'creator/[id]',
    'creator-premium-offer/[contentId]',
    'creator-premium-viewer/[contentId]',
  ]) {
    assert.ok(harness.routeNames.includes(route), `missing root route: ${route}`);
  }
});
