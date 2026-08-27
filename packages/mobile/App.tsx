import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { restoreSession, type SessionUser } from './src/api/auth';
import DashboardScreen from './src/screens/DashboardScreen';
import LoginScreen from './src/screens/LoginScreen';
import RelayScreen from './src/screens/RelayScreen';
import { palette } from './src/theme';

type Tab = 'dashboard' | 'relay';

const TABS: Array<{ key: Tab; label: string; icon: string }> = [
  { key: 'dashboard', label: 'Studio', icon: '◇' },
  { key: 'relay', label: 'Relay', icon: '✦' },
];

export default function App() {
  const [restoring, setRestoring] = useState(true);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tab, setTab] = useState<Tab>('dashboard');

  useEffect(() => {
    let mounted = true;
    void restoreSession()
      .then((session) => {
        if (!mounted) return;
        setUser(session?.user ?? null);
      })
      .finally(() => {
        if (mounted) setRestoring(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  function handleAuthed(nextUser: SessionUser) {
    setUser(nextUser);
    setTab('dashboard');
  }

  function handleSignOut() {
    setUser(null);
    setTab('dashboard');
  }

  if (restoring) {
    return (
      <View style={styles.restoreScreen}>
        <ActivityIndicator color={palette.roseBright} />
        <Text style={styles.restoreText}>Restoring secure session…</Text>
      </View>
    );
  }

  if (user === null) return <LoginScreen onAuthed={handleAuthed} />;

  return (
    <View style={styles.root}>
      <View style={styles.brandBar}>
        <View style={styles.brandMark}>
          <Text style={styles.brandLetter}>A</Text>
        </View>
        <View>
          <Text style={styles.brand}>AXIOM</Text>
          <Text style={styles.brandDetail}>CREATOR INTELLIGENCE</Text>
        </View>
        <View style={styles.privatePill}>
          <View style={styles.liveDot} />
          <Text style={styles.privateText}>PRIVATE</Text>
        </View>
      </View>
      <View style={styles.body}>
        {tab === 'dashboard' ? (
          <DashboardScreen user={user} onSignOut={handleSignOut} />
        ) : (
          <RelayScreen />
        )}
      </View>
      <View style={styles.tabBar} accessibilityRole="tablist">
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
              <Text style={[styles.tabIcon, active && styles.tabIconActive]}>{item.icon}</Text>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.canvas },
  restoreScreen: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: palette.canvas,
  },
  restoreText: { color: palette.muted, fontSize: 13 },
  brandBar: {
    minHeight: 70,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.lineSoft,
    backgroundColor: palette.canvasSoft,
  },
  brandMark: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: palette.rose,
  },
  brandLetter: { color: palette.roseInk, fontSize: 18, fontWeight: '800' },
  brand: { color: palette.text, fontSize: 14, fontWeight: '800', letterSpacing: 2.3 },
  brandDetail: {
    color: palette.faint,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1,
    marginTop: 2,
  },
  privatePill: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.success },
  privateText: { color: palette.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  body: { flex: 1 },
  tabBar: {
    minHeight: 72,
    flexDirection: 'row',
    backgroundColor: palette.canvasSoft,
    borderTopWidth: 1,
    borderTopColor: palette.lineSoft,
    paddingHorizontal: 16,
    paddingTop: 7,
    paddingBottom: 8,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 14, gap: 2 },
  tabActive: { backgroundColor: palette.panelRaised },
  tabIcon: { color: palette.faint, fontSize: 17 },
  tabIconActive: { color: palette.roseBright },
  tabText: { color: palette.faint, fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  tabTextActive: { color: palette.text },
});
