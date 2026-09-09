import { Redirect } from 'expo-router';

// Entry point: the AuthGate in _layout handles redirects, but a concrete
// landing route keeps deep-linking predictable.
export default function Index() {
  return <Redirect href="/(tabs)" />;
}
