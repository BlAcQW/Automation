import { StyleSheet, Text, View } from 'react-native';

export function Placeholder({ title, note }: { title: string; note?: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note ?? 'Coming next — screen scaffolded, API ready.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0f14', padding: 24 },
  title: { color: '#f9fafb', fontSize: 20, fontWeight: '700' },
  note: { color: '#6b7280', fontSize: 14, marginTop: 8, textAlign: 'center' },
});
