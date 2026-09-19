import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { createIdempotencyKey } from '../api/client';
import {
  getCrashReports,
  getDigests,
  getOrgSettings,
  generateDigest,
  patchViralSharing,
  getUiLocale,
  patchUiLocale,
  type CrashReport,
  type DigestCard,
  type OrgSettings,
  type UiLocaleSnapshot,
} from '../api/endpoints';
import LocaleSelector from '../components/LocaleSelector';
import { CATALOGS, LocaleCatalog, type SupportedLocale } from '@axiom/core';
import { palette, surfaceShadow } from '../theme';

interface DashboardScreenProps {
  user: SessionUser;
  onSignOut: () => void;
}

interface DashboardState {
  settings: OrgSettings | null;
  uiLocale: UiLocaleSnapshot | null;
  digests: DigestCard[];
  crashReports: CrashReport[];
  loading: boolean;
  error: string | null;
  actionMessage: string | null;
  togglingViral: boolean;
  generating: boolean;
  savingLocale: boolean;
}

/**
 * Org settings (viral-sharing toggle, publishing), weekly digest cards and
 * crash reports — all fetched from the BFF /api/v1/* with the session cookie.
 */
export default function DashboardScreen({ user, onSignOut }: DashboardScreenProps) {
  const localeCatalog = useMemo(() => new LocaleCatalog(CATALOGS), []);
  const [state, setState] = useState<DashboardState>({
    settings: null,
    uiLocale: null,
    digests: [],
    crashReports: [],
    loading: true,
    error: null,
    actionMessage: null,
    togglingViral: false,
    generating: false,
    savingLocale: false,
  });
  const localeIntent = useRef<string | null>(null);
  const locale = state.uiLocale?.locale ?? 'en';
  const t = useCallback((key: string, values?: Record<string, string | number>) => localeCatalog.t(locale, key, values), [locale, localeCatalog]);

  const loadAll = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [settings, digests, crashReports, uiLocale] = await Promise.all([
        getOrgSettings(),
        getDigests(),
        getCrashReports(),
        getUiLocale(),
      ]);
      setState((prev) => ({
        ...prev,
        settings,
        uiLocale,
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
        actionMessage: `${t('mobile.viralSharing')} ${updated.viralSharing ? t('mobile.on') : t('mobile.off')}`,
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

  async function handleSaveLocale(locale: SupportedLocale) {
    if (state.savingLocale) return;
    localeIntent.current ??= createIdempotencyKey();
    setState((prev) => ({ ...prev, savingLocale: true, actionMessage: null, error: null }));
    try {
      const updated = await patchUiLocale(locale, 'user', localeIntent.current);
      if (updated.locale !== locale || updated.userLocale !== locale) throw new Error('unconfirmed language preference');
      localeIntent.current = null;
      setState((prev) => ({ ...prev, uiLocale: updated, savingLocale: false, actionMessage: t('mobile.languageSaved', { locale }) }));
    } catch (err) {
      setState((prev) => ({ ...prev, savingLocale: false, error: err instanceof Error ? err.message : String(err) }));
    }
  }

  async function handleGenerateDigest() {
    if (state.generating) return;
    setState((prev) => ({ ...prev, generating: true, actionMessage: null, error: null }));
    try {
      const result = await generateDigest();
      setState((prev) => ({
        ...prev,
        actionMessage: t('mobile.digestEnqueued', { jobId: result.jobId }),
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
        <Text style={styles.muted}>{t('mobile.loadingDashboard')}</Text>
      </View>
    );
  }

  const settings = state.settings;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.eyebrow}>{t('mobile.studioOverview')}</Text>
          <Text style={styles.title}>Hello, {user.email.split('@')[0]}</Text>
          <Text style={styles.muted}>{t('mobile.privateWorkspace')}</Text>
        </View>
        <Pressable style={styles.signOutButton} onPress={() => void handleSignOut()}>
          <Text style={styles.signOutText}>{t('mobile.signOut')}</Text>
        </Pressable>
      </View>

      {state.error ? <Text style={styles.error}>{state.error}</Text> : null}
      {state.actionMessage ? <Text style={styles.actionMessage}>{state.actionMessage}</Text> : null}

      {/* Org settings */}
      <Text style={styles.sectionTitle}>{t('mobile.orgSettings')}</Text>
      <View style={styles.card}>
        {settings ? (
          <>
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{t('mobile.viralSharing')}</Text>
                <Text style={styles.rowHint}>{t('mobile.viralSharingHint')}</Text>
              </View>
              {state.togglingViral ? (
                <ActivityIndicator color={palette.rose} />
              ) : (
                <Switch
                  value={settings.viralSharing}
                  onValueChange={(next) => void handleToggleViralSharing(next)}
                  trackColor={{ true: palette.rose, false: palette.line }}
                  thumbColor={palette.text}
                  accessibilityLabel={t('mobile.viralSharing')}
                />
              )}
            </View>
            <View style={styles.divider} />
            <View style={styles.row}>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{t('mobile.publishingEnabled')}</Text>
                <Text style={styles.rowHint}>{t('mobile.publishingHint')}</Text>
              </View>
              <Text style={settings.publishingEnabled ? styles.badgeOn : styles.badgeOff}>
                {settings.publishingEnabled ? t('mobile.on') : t('mobile.off')}
              </Text>
            </View>
          </>
        ) : (
          <Text style={styles.muted}>{t('mobile.noOrgSettings')}</Text>
        )}
      </View>

      {state.uiLocale ? (
        <>
          <Text style={styles.sectionTitle}>Language</Text>
          <LocaleSelector snapshot={state.uiLocale} saving={state.savingLocale} onSave={(locale) => void handleSaveLocale(locale)} />
        </>
      ) : null}

      {/* Weekly digests */}
      <View style={styles.sectionRow}>
        <Text style={styles.sectionTitle}>{t('mobile.weeklyDigests')}</Text>
        <Pressable
          style={[styles.smallButton, state.generating && styles.buttonDisabled]}
          onPress={() => void handleGenerateDigest()}
          disabled={state.generating}
        >
          {state.generating ? (
            <ActivityIndicator color={palette.roseInk} size="small" />
          ) : (
            <Text style={styles.smallButtonText}>{t('mobile.generate')}</Text>
          )}
        </Pressable>
      </View>
      <View style={styles.card}>
        {state.digests.length === 0 ? (
          <Text style={styles.muted}>{t('mobile.digestEmpty')}</Text>
        ) : (
          state.digests.map((digest) => (
            <View key={digest.id} style={styles.listItem}>
              <Text style={styles.itemTitle}>{digest.title || t('mobile.untitledDigest')}</Text>
              {digest.description ? (
                <Text style={styles.itemSubtitle}>{digest.description}</Text>
              ) : null}
              <Text style={styles.itemMeta}>
                {new Date(digest.createdAt).toLocaleString(locale)} ·{' '}
                {digest.channel ?? t('mobile.unknownChannel')} ·{' '}
                {digest.externalDelivery === 'not-attempted' ? 'Stored only' : digest.externalDelivery === 'attempted' ? 'Dispatch attempted' : 'Outcome unknown'}
              </Text>
            </View>
          ))
        )}
      </View>

      {/* Crash reports */}
      <Text style={styles.sectionTitle}>{t('mobile.crashReports')}</Text>
      <View style={styles.card}>
        {state.crashReports.length === 0 ? (
          <Text style={styles.muted}>{t('mobile.noCrashes')}</Text>
        ) : (
          state.crashReports.map((report) => (
            <View key={report.id} style={styles.listItem}>
              <View style={styles.row}>
                <Text style={styles.itemTitle}>{report.service}</Text>
                <Text style={styles.badgeOff}>{report.status}</Text>
              </View>
              <Text style={styles.itemSubtitle}>{report.message || t('mobile.noMessage')}</Text>
              <Text style={styles.itemMeta}>
                {t('mobile.crashCount', { count: report.count })} · {t('mobile.lastSeen', { value: new Date(report.lastSeen).toLocaleString(locale) })}
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
