import { registerRootComponent } from 'expo';
import { ExpoRoot } from 'expo-router';

// Keep the route context inside the project root. The dependency tree is a
// junction shared with another worktree, so expo-router/_ctx would otherwise
// be created from outside this checkout and can resolve to an empty route tree
// in the iOS development client.
export function App() {
  const context = require.context('./app');
  return <ExpoRoot context={context} />;
}

registerRootComponent(App);
