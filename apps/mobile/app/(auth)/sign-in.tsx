import { View, Text, StyleSheet } from 'react-native';

export default function SignIn() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Frapp</Text>
      <Text style={styles.subtitle}>The Operating System for Greek Life</Text>
      <View style={styles.placeholder}>
        <Text style={styles.placeholderText}>
          Supabase Auth login coming soon.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#f8fafc' },
  title: { fontSize: 36, fontWeight: 'bold', color: '#0f172a', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#64748b', marginBottom: 32 },
  placeholder: { backgroundColor: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 320, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  placeholderText: { textAlign: 'center', color: '#94a3b8' },
});
