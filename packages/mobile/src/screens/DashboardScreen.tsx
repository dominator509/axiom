import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { signOut, type SessionUser } from '../api/auth';
import {
  getCrashReports,
  getDigests,
  getOrgSettings,
  generateDigest,
  patchViralSharing,
  type CrashReport,
  type DigestCard,
  type OrgSettings,
} from '../api/endpoints';

interface DashboardScreenProps {
  user: SessionUser;
  onSignOut: () => void;
}

interface DashboardState {
  settings: OrgSettings | null;
  digests: DigestCard[];
  crashReports: CrashReport[];
  loading: boolean;
  error: string | null;
  actionMessage: string | null;
  togglingViral: boolean;
  generating: boolean;
}

/**
 * Org settings (viral-sharing toggle, publishing), weekly digest cards and
 * crash reports — all fetched from the BFF /api/v1/* with the session cookie.
 */
export default function DashboardScreen({ user, onSignOut }: DashboardScreenProps) {
  const [state, setState] = useState<DashboardState>({
    settings: null,
    digests: [],
    crashReports: [],
    loading: true,
    error: null,
    actionMessage: null,
    togglingViral: false,
    generating: false,
  });

  const loadAll = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [settings, digests, crashReports] = await Promise.all([
        getOrgSettings(),
        getDigests(),
        getCrashReports(),
      ]);
      setState((prev) => ({
        ...prev,
        settings,
        digests: digests.data,
        crashReports: crashReports.data,
        loading: false,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function handleToggleViralSharing(next: boolean) {
    if (state.togglingViral) return;
    setState((prev) => ({ ...prev, togglingViral: true, actionMessage: null, error: null }));
    try {
      const updated = await patchViralSharing(next);
      setState((prev) => ({
        ...prev,
        settings: updated,
        actionMessage: `Viral sharing ${updated.viralSharing ? 'enabled' : 'disabled'}`,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setState((prev) => ({ ...prev, togglingViral: false }));
    }
  }

  async function handleGenerateDigest() {
    if (state.generating) return;
    setState((prev) => ({ ...prev, generating: true, actionMessage: null, error: null }));
    try {
      const result = await generateDigest();
      setState((prev) => ({
        ...prev,
        actionMessage: `Digest job enqueued (${result.jobId})`,
      }));
      await loadAll();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setState((prev) => ({ ...prev, generating: false }));
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
    } finally {
      onSignOut();
    }
  }

  if (state.loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#4f6ef7" />
        <Text style={styles.muted}>Loading dashboard…</Text>
      </View>
    );
  }

  const settings = state.settings;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Dashboard</Text>
          <Text style={styles.muted}>
            {user.email} · org {user.orgId ?? 'unknown'}
          </Text>
        </View>
        <Pressable style={styles.signOutButton} onPress={() => void handleSignOut()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      {state.actionMessage ? (
        <Text style={styles.actionMessage}>{state.actionMessage}</Text>
      ) : null}

      {/* Org settings */}
      <Text style={styles.sectionTitle}>Org settings</Text>
      <View style={styles.card}>
        {settings ? (
          <>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Viral sharing</Text>
                <Text style={styles.rowHint}>
                  Share winning patterns across models in this org
                </Text>
              </View>
              {state.togglingViral ? (
                <ActivityIndicator color="#4f6ef7" />
              ) : (
                <Switch
                  value={settings.viralSharing}
                  onValueChange={(next) => void handleToggleViralSharing(next)}
                  trackColor={{ true: '#4f6ef7', false: '#22304a' }}
                  accessibilityLabel="Viral sharing toggle"
                />
              )}
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Publishing enabled</Text>
                <Text style={styles.rowHint}>Allow scheduled posts to go live</Text>
              </View>
              <Text style={settings.publishingEnabled ? styles.badgeOn : styles.badgeOff}>
                {settings.publishingEnabled ? 'ON' : 'OFF'}
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.muted}>No org settings returned.</Text>
        )}
      </View>

      {/* Weekly digests */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>Weekly digests</Text>
        <Pressable
          style={[styles.smallButton, state.generating && styles.buttonDisabled]}
          onPress={() => void handleGenerateDigest()}
          disabled={state.generating}
        >
          {state.generating ? (
            <ActivityIndicator color="#ffffff" size="small" />
        ) : (
            <Text style={styles.smallButtonText}>Generate</Text>
          )}
        </Pressable>
      </View>
      <View style={styles.card}>
        {state.digests.length === 0 ? (
          <Text style={styles.muted}>No digests yet — generate this week's digest.</Text>
        ) : (
          state.digests.map((digest) => (
            <View key={digest.id} style={styles.listItem}>
              <Text style={styles.itemTitle}>{digest.title || 'Untitled digest'}</Text>
              {digest.description ? (
                <Text style={styles.itemSubtitle}>{digest.description}</Text>
              ) : null}
              <Text style={styles.itemMeta}>
                {new Date(digest.createdAt).toLocaleString()} ·{' '}
                {digest.channel ?? 'unknown channel'}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Crash reports */}
      <Text style={styles.sectionTitle}>Crash reports</Text>
      <View style={styles.card}>
        {state.crashReports.length === 0 ? (
          <Text style={styles.muted}>No crashes recorded. All systems nominal.</Text>
        ) : (
          state.crashReports.map((report) => (
            <View key={report.id} style={styles.listItem}>
              <View style={styles.row}>
                <Text style={styles.itemTitle}>{report.service}</Text>
                <Text style={styles.badgeOff}>{report.status}</Text>
              </View>
              <Text style={styles.itemSubtitle}>{report.message || '(no message)'}</Text>
              <Text style={styles.itemMeta}>
                ×{report.count} · last seen {new Date(report.lastSeen).toLocaleString()}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  title: { color: '#ffffff', fontSize: 24, fontWeight: '800' },
  muted: { color: '#8a94a6', fontSize: 13 },
  error: { color: '#ff6b6b', fontSize: 13, marginBottom: 8 },
  actionMessage: { color: '#4ade80', fontSize: 13, marginBottom: 8 },
  sectionTitle: { color: '#e6eaf2', fontSize: 15, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowText: { flex: 1 },
  rowLabel: { color: '#e6eaf2', fontSize: 14, fontWeight: '600' },
  rowHint: { color: '#8a94a6', fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: '#22304a', marginVertical: 12 },
  badgeOn: {
    color: '#4ade80',
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: '#143524',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  badgeOff: {
    color: '#ffb86b',
    fontSize: 12,
    fontWeight: '700',
    backgroundColor: '#3a2a14',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  listItem: {
    borderBottomWidth: 1,
    borderBottomColor: '#1c2740',
    paddingVertical: 10,
  },
  itemTitle: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  itemSubtitle: { color: '#aab4c5', fontSize: 13, marginTop: 2 },
  itemMeta: { color: '#8a94a6', fontSize: 12, marginTop: 4 },
  signOutButton: {
    borderWidth: 1,
    borderColor: '#ff6b6b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  signOutText: { color: '#ff6b6b', fontSize: 13, fontWeight: '600' },
  smallButton: {
    backgroundColor: '#4f6ef7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  smallButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
});
