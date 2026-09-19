import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getCrashReports, getDigests, getUiLocale, type CrashReport, type DigestCard } from '../api/endpoints';
import { CATALOGS, LocaleCatalog, formatDate, formatNumber, type SupportedLocale } from '@axiom/core';
import { palette, surfaceShadow } from '../theme';

interface RelayScreenState {
  digests: DigestCard[];
  crashReports: CrashReport[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
}

const FALLBACK_LOCALE: SupportedLocale = 'en';

/** The product contract renders timestamps in UTC; the calendar format follows
 * the selected interface locale. */
const UTC_DATE_TIME: Intl.DateTimeFormatOptions = { timeZone: 'UTC' };

export interface RelayViewProps {
  locale: SupportedLocale;
  digests: DigestCard[];
  crashReports: CrashReport[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onRefresh: () => void;
}

/**
 * The real mounted Relay surface. Every visible string and date renders through
 * the persisted interface locale; creator/provider-authored content is never
 * translated. Exported so the screen's own behaviour can be tested directly.
 */
export function RelayView({
  locale,
  digests,
  crashReports,
  loading,
  refreshing,
  error,
  onRefresh,
}: RelayViewProps) {
  const localeCatalog = useMemo(() => new LocaleCatalog(CATALOGS), []);
  const t = useCallback(
    (key: string, values?: Record<string, string | number>) => localeCatalog.t(locale, key, values),
    [locale, localeCatalog],
  );
  const dateTime = useCallback(
    (value: string | number | Date) => formatDate(new Date(value), locale, UTC_DATE_TIME),
    [locale],
  );
  const count = useCallback((value: number) => formatNumber(value, locale), [locale]);

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={palette.rose} />
        <Text style={styles.muted}>{t('mobile.relayLoading')}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.rose} />
      }
    >
      <Text style={styles.eyebrow}>{t('mobile.relayEyebrow')}</Text>
      <Text style={styles.title}>{t('mobile.relayTitle')}</Text>
      <Text style={styles.subtitle}>{t('mobile.relaySubtitle')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Text style={styles.sectionTitle}>{t('mobile.incidents')}</Text>
      <View style={styles.card}>
        {crashReports.length === 0 ? (
          error ? null : <Text style={styles.muted}>{t('mobile.noIncidents')}</Text>
        ) : (
          crashReports.map((report) => (
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
                    {report.message || t('mobile.noReportMessage')} · {t('mobile.crashCount', { count: count(report.count) })}
                  </Text>
                </View>
              </View>
              <Text style={styles.itemMeta}>
                {t('mobile.crashStatus', { status: report.status, value: dateTime(report.lastSeen) })}
              </Text>
            </View>
          ))
        )}
      </View>

      <Text style={styles.sectionTitle}>{t('mobile.digestCards')}</Text>
      <View style={styles.card}>
        {digests.length === 0 ? (
          error ? null : <Text style={styles.muted}>{t('mobile.noDigestCards')}</Text>
        ) : (
          digests.map((digest) => (
            <View key={digest.id} style={styles.listItem}>
              <View style={styles.row}>
                <Text style={styles.digestIcon}>✦</Text>
                <View style={styles.rowText}>
                  <Text style={styles.itemTitle}>{digest.title || t('mobile.untitledDigest')}</Text>
                  {digest.description ? (
                    <Text style={styles.itemSubtitle}>{digest.description}</Text>
                  ) : null}
                </View>
              </View>
              <Text style={styles.itemMeta}>
                {t('mobile.digestMeta', {
                  channel: digest.channel ?? t('mobile.unknownChannel'),
                  value: dateTime(digest.createdAt),
                  delivery:
                    digest.externalDelivery === 'not-attempted'
                      ? t('mobile.storedOnly')
                      : digest.externalDelivery === 'attempted'
                        ? t('mobile.dispatchAttempted')
                        : t('mobile.outcomeUnknown'),
                })}
              </Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

/**
 * Relay: digest cards and crash incidents pushed through the relay channel.
 * Resolves the persisted interface locale, then renders the Relay surface.
 */
export default function RelayScreen() {
  const [uiLocale, setUiLocale] = useState<SupportedLocale | null>(null);
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
      const [digests, crashReports, localeSnapshot] = await Promise.all([
        getDigests(),
        getCrashReports(),
        getUiLocale(),
      ]);
      setUiLocale(localeSnapshot.locale);
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

  return (
    <RelayView
      locale={uiLocale ?? FALLBACK_LOCALE}
      digests={state.digests}
      crashReports={state.crashReports}
      loading={state.loading}
      refreshing={state.refreshing}
      error={state.error}
      onRefresh={() => void load(true)}
    />
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
