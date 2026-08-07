import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  getCrashReports,
  getDigests,
  type CrashReport,
  type DigestCard,
} from '../api/endpoints';

/** Severity glyph for crash reports (falls back to status when unknown). */
function severityIcon(report: CrashReport): string {
  switch (report.severity) {
    case 'sev-1':
      return '🔴';
    case 'sev-2':
      return '🟠';
    case 'sev-3':
      return '🟡';
    case 'sev-4':
      return '🟢';
    default:
      return report.status === 'open' ? '🔴' : '⚪';
  }
}

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
        <ActivityIndicator size="large" color="#4f6ef7" />
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
          tintColor="#4f6ef7"
        />
      }
    >
      <Text style={styles.title}>Relay</Text>
      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}

      <Text style={styles.sectionTitle}>Incidents</Text>
      <View style={styles.card}>
        {state.crashReports.length === 0 ? (
          <Text style={styles.muted}>No incidents. The relay is quiet.</Text>
        ) : (
          state.crashReports.map((report) => (
            <View key={report.id} style={styles.listItem}>
              <View style={styles.row}>
                <Text style={styles.icon}>{severityIcon(report)}</Text>
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
                <Text style={styles.icon}>📬</Text>
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
  container: { flex: 1, backgroundColor: '#0b1220' },
  content: { padding: 16, paddingBottom: 48 },
  centered: {
    flex: 1,
    backgroundColor: '#0b1220',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  title: { color: '#ffffff', fontSize: 24, fontWeight: '800', marginBottom: 4 },
  muted: { color: '#8a94a6', fontSize: 13 },
  error: { color: '#ff6b6b', fontSize: 13, marginBottom: 8 },
  sectionTitle: {
    color: '#e6eaf2',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  card: {
    backgroundColor: '#131c2e',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#22304a',
    padding: 14,
    marginBottom: 8,
  },
  listItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#1c2740',
    paddingVertical: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { flex: 1 },
  icon: { fontSize: 18 },
  itemTitle: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  itemSubtitle: { color: '#aab4c5', fontSize: 13, marginTop: 2 },
  itemMeta: { color: '#8a94a6', fontSize: 12, marginTop: 6 },
});
