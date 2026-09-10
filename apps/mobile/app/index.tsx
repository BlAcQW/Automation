import { Redirect } from 'expo-router';
import { useAuth } from '@/auth/context';

// Initial route: send the user to the right place once the session is known.
// The AuthGate in _layout keeps them there on later auth changes (login/logout).
export default function Index() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  return <Redirect href={isAuthenticated ? '/(tabs)' : '/(auth)/login'} />;
}
