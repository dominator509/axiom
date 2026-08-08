import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getCrashReports, getDigests, type CrashReport, type DigestCard } from '../api/endpoints';
import { palette, surfaceShadow } from '../theme';

interface RelayScreenState {
  digests: DigestCard[];
  crashReports: CrashReport[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

/**
 * Relay: digest cards and crash incidents pushed through the relay channel.
 */
export default function RelayScreen() {
  const [state, setState] = useState<RelayScreenState>({
    digests: [],
    crashReports: [],
    loading: true,
    refreshing: false,
    error: null,
  });

  const load = useCallback(async (refreshing = false) => {
    if (!refreshing) setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [digests, crashReports] = await Promise.all([getDigests(), getCrashReports()]);
      setState((prev) => ({
        ...prev,
        digests: digests.data,
        crashReports: crashReports.data,
        loading: false,
        refreshing: false,
        error: null,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        refreshing: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={palette.rose} />
        <Text style={styles.muted}>Loading relay…</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={state.refreshing}
          onRefresh={() => void load(true)}
          tintColor={palette.rose}
        />
      }
    >
      <Text style={styles.eyebrow}>LIVE SIGNALS</Text>
      <Text style={styles.title}>Relay</Text>
      <Text style={styles.subtitle}>The pulse of your private studio.</Text>
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}

      <Text style={styles.sectionTitle}>Incidents</Text>
      <View style={styles.card}>
        {state.crashReports.length === 0 ? (
          <Text style={styles.muted}>No incidents. The relay is quiet.</Text>
        ) : (
          state.crashReports.map((report) => (
            <View key={report.id} style={styles.listItem}>
              <View style={styles.row}>
                <Text
                  style={[
                    styles.icon,
                    report.severity === 'sev-1'
                      ? styles.sevOne
                      : report.severity === 'sev-2'
                        ? styles.sevTwo
                        : styles.sevOther,
                  ]}
                >
                  ●
                </Text>
                <View style={styles.rowText}>
                  <Text style={styles.itemTitle}>{report.service}</Text>
                  <Text style={styles.itemSubtitle}>
                    {report.message || '(no message)'} · ×{report.count}
                  </Text>
                </View>
              </View>
              <Text style={styles.itemMeta}>
                {report.status} · last seen {new Date(report.lastSeen).toLocaleString()}
              </Text>
            </View>
          ))
        )}
      </View>

      <Text style={styles.sectionTitle}>Digest cards</Text>
      <View style={styles.card}>
        {state.digests.length === 0 ? (
          <Text style={styles.muted}>No digest cards relayed yet.</Text>
        ) : (
          state.digests.map((digest) => (
            <View key={digest.id} style={styles.listItem}>
              <View style={styles.row}>
                <Text style={styles.digestIcon}>✦</Text>
                <View style={styles.rowText}>
                  <Text style={styles.itemTitle}>{digest.title || 'Untitled digest'}</Text>
                  {digest.description ? (
                    <Text style={styles.itemSubtitle}>{digest.description}</Text>
                  ) : null}
                </View>
              </View>
              <Text style={styles.itemMeta}>
                {digest.channel ?? 'relay'} · {new Date(digest.createdAt).toLocaleString()}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  content: { padding: 18, paddingBottom: 48 },
  centered: {
    flex: 1,
    backgroundColor: palette.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  eyebrow: {
    color: palette.roseBright,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginTop: 7,
    marginBottom: 5,
  },
  title: { color: palette.text, fontSize: 30, fontWeight: '700', letterSpacing: -0.6 },
  subtitle: { color: palette.muted, fontSize: 12, marginTop: 3, marginBottom: 7 },
  muted: { color: palette.muted, fontSize: 12 },
  error: {
    color: palette.danger,
    fontSize: 12,
    marginTop: 10,
    marginBottom: 8,
    backgroundColor: palette.dangerDeep,
    borderRadius: 10,
    padding: 11,
    overflow: 'hidden',
  },
  sectionTitle: {
    color: palette.textSoft,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
    marginTop: 22,
    marginBottom: 10,
  },
  card: {
    backgroundColor: palette.panel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.lineSoft,
    padding: 17,
    marginBottom: 6,
    ...surfaceShadow,
  },
  listItem: {
    borderBottomWidth: 1,
    borderBottomColor: palette.lineSoft,
    paddingVertical: 13,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1 },
  icon: { fontSize: 14 },
  sevOne: { color: palette.danger },
  sevTwo: { color: palette.warning },
  sevOther: { color: palette.success },
  digestIcon: { color: palette.roseBright, fontSize: 18 },
  itemTitle: { color: palette.text, fontSize: 14, fontWeight: '600' },
  itemSubtitle: { color: palette.textSoft, fontSize: 12, lineHeight: 17, marginTop: 3 },
  itemMeta: { color: palette.faint, fontSize: 10, marginTop: 7 },
});
