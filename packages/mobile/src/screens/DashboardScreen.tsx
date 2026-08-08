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
import { palette, surfaceShadow } from '../theme';

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
        <ActivityIndicator size="large" color={palette.rose} />
        <Text style={styles.muted}>Loading dashboard…</Text>
      </View>
    );
  }

  const settings = state.settings;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>STUDIO OVERVIEW</Text>
          <Text style={styles.title}>Hello, {user.email.split('@')[0]}</Text>
          <Text style={styles.muted}>Your private workspace is ready.</Text>
        </View>
        <Pressable style={styles.signOutButton} onPress={() => void handleSignOut()}>
          <Text style={styles.signOutText}>Sign out</Text>
        </Pressable>
      </View>

      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      {state.actionMessage ? <Text style={styles.actionMessage}>{state.actionMessage}</Text> : null}

      {/* Org settings */}
      <Text style={styles.sectionTitle}>Org settings</Text>
      <View style={styles.card}>
        {settings ? (
          <>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Viral sharing</Text>
                <Text style={styles.rowHint}>Share winning patterns across models in this org</Text>
              </View>
              {state.togglingViral ? (
                <ActivityIndicator color={palette.rose} />
              ) : (
                <Switch
                  value={settings.viralSharing}
                  onValueChange={(next) => void handleToggleViralSharing(next)}
                  trackColor={{ true: palette.rose, false: palette.line }}
                  thumbColor={palette.text}
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
            <ActivityIndicator color={palette.roseInk} size="small" />
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
  container: { flex: 1, backgroundColor: palette.canvas },
  content: { padding: 18, paddingBottom: 48 },
  centered: {
    flex: 1,
    backgroundColor: palette.canvas,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 7,
    marginBottom: 22,
  },
  eyebrow: {
    color: palette.roseBright,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
    marginBottom: 5,
  },
  title: { color: palette.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.6 },
  muted: { color: palette.muted, fontSize: 12, marginTop: 3 },
  error: {
    color: palette.danger,
    fontSize: 12,
    marginBottom: 10,
    backgroundColor: palette.dangerDeep,
    borderRadius: 10,
    padding: 11,
    overflow: 'hidden',
  },
  actionMessage: {
    color: palette.success,
    fontSize: 12,
    marginBottom: 10,
    backgroundColor: palette.successDeep,
    borderRadius: 10,
    padding: 11,
    overflow: 'hidden',
  },
  sectionTitle: {
    color: palette.textSoft,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.7,
    marginTop: 21,
    marginBottom: 10,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 21,
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
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  rowText: { flex: 1 },
  rowLabel: { color: palette.text, fontSize: 14, fontWeight: '600' },
  rowHint: { color: palette.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  divider: { height: 1, backgroundColor: palette.lineSoft, marginVertical: 15 },
  badgeOn: {
    color: palette.success,
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: palette.successDeep,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  badgeOff: {
    color: palette.warning,
    fontSize: 10,
    fontWeight: '700',
    backgroundColor: palette.warningDeep,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    overflow: 'hidden',
  },
  listItem: {
    borderBottomWidth: 1,
    borderBottomColor: palette.lineSoft,
    paddingVertical: 13,
  },
  itemTitle: { color: palette.text, fontSize: 14, fontWeight: '600' },
  itemSubtitle: { color: palette.textSoft, fontSize: 12, lineHeight: 17, marginTop: 3 },
  itemMeta: { color: palette.faint, fontSize: 10, marginTop: 6 },
  signOutButton: {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  signOutText: { color: palette.muted, fontSize: 11, fontWeight: '600' },
  smallButton: {
    backgroundColor: palette.rose,
    borderRadius: 10,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  smallButtonText: { color: palette.roseInk, fontSize: 11, fontWeight: '800' },
  buttonDisabled: { opacity: 0.5 },
});
