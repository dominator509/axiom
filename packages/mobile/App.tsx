import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { SessionUser } from './src/api/auth';
import DashboardScreen from './src/screens/DashboardScreen';
import LoginScreen from './src/screens/LoginScreen';
import RelayScreen from './src/screens/RelayScreen';

type Tab = 'dashboard' | 'relay';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'relay', label: 'Relay' },
];

/**
 * Navigation-less shell: a state-based switch between the Login screen and
 * the authenticated Dashboard/Relay tabs. No router dependency needed.
 */
export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');

  function handleAuthed(nextUser: SessionUser) {
    setUser(nextUser);
    setTab('dashboard');
  }

  function handleSignOut() {
    setUser(null);
    setTab('dashboard');
  }

  if (user === null) {
    return <LoginScreen onAuthed={handleAuthed} />;
  }

  return (
    <View style={styles.root}>
      <View style={styles.tabBar}>
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <Pressable
              key={item.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(item.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.body}>
        {tab === 'dashboard' ? (
          <DashboardScreen user={user} onSignOut={handleSignOut} />
        ) : (
          <RelayScreen />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0b1220' },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#131c2e',
    borderBottomWidth: 1,
    borderBottomColor: '#22304a',
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#4f6ef7',
  },
  tabText: { color: '#8a94a6', fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: '#ffffff' },
  body: { flex: 1 },
});
