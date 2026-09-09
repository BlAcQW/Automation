import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '@/auth/context';

export default function MoreScreen() {
  const { user, tenant, logout } = useAuth();

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.name}>{user?.name}</Text>
        <Text style={styles.meta}>{user?.email}</Text>
        <Text style={styles.meta}>
          {tenant?.name} · {tenant?.businessType} · {user?.role}
        </Text>
        <Text style={styles.meta}>
          WhatsApp: {tenant?.whatsappConnected ? 'Connected' : 'Not connected'}
        </Text>
      </View>

      <TouchableOpacity style={styles.logout} onPress={logout}>
        <Text style={styles.logoutText}>Log out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0f14', padding: 16, gap: 16 },
  card: {
    backgroundColor: '#151b23',
    borderColor: '#232b36',
    borderWidth: 1,
    borderRadius: 16,
    padding: 18,
    gap: 6,
  },
  name: { color: '#f9fafb', fontSize: 18, fontWeight: '700' },
  meta: { color: '#9ca3af', fontSize: 14 },
  logout: {
    borderColor: '#f8717155',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  logoutText: { color: '#f87171', fontSize: 16, fontWeight: '600' },
});
