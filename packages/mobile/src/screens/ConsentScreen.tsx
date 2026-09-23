import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CATALOGS, LocaleCatalog, formatDate, type SupportedLocale } from '@axiom/core';
import {
  getConsentRecords,
  getConsentStatus,
  getModels,
  getUiLocale,
  type MobileConsentRecord,
  type MobileConsentStatus,
  type MobileModelProfile,
} from '../api/endpoints';
import { palette } from '../theme';

export const CONSENT_STATUS_PLATFORMS = ['instagram', 'x', 'reddit', 'fanvue'] as const;
const catalog = new LocaleCatalog(CATALOGS);

export interface ConsentViewProps {
  locale: SupportedLocale;
  models: MobileModelProfile[];
  selectedModelId: string | null;
  records: MobileConsentRecord[];
  statuses: MobileConsentStatus[];
  modelsLoading: boolean;
  dataLoading: boolean;
  error: boolean;
  onSelectModel: (modelId: string) => void;
  onRetry: () => void;
}

function t(locale: SupportedLocale, key: string, values?: Record<string, string | number>): string {
  return catalog.t(locale, key, values);
}

export function consentRecordState(record: MobileConsentRecord, now = new Date()): 'revoked' | 'expired' | 'notYetValid' | 'needsDocument' | 'current' {
  if (!record.granted || record.revokedAt) return 'revoked';
  const today = now.toISOString().slice(0, 10);
  if (record.validFrom > today) return 'notYetValid';
  if ((record.validTo && record.validTo < today) || (record.expiresAt && Date.parse(record.expiresAt) < now.getTime())) return 'expired';
  if (!record.hasDocument) return 'needsDocument';
  return 'current';
}

function displayDate(value: string | null, locale: SupportedLocale): string {
  if (!value) return '—';
  const isCalendarDate = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const iso = isCalendarDate ? `${value}T00:00:00.000Z` : value;
  const parsed = new Date(iso);
  return Number.isNaN(parsed.valueOf()) ? '—' : formatDate(parsed, locale, isCalendarDate ? { timeZone: 'UTC' } : undefined);
}

export function ConsentView({
  locale,
  models,
  selectedModelId,
  records,
  statuses,
  modelsLoading,
  dataLoading,
  error,
  onSelectModel,
  onRetry,
}: ConsentViewProps) {
  const selectedModel = models.find(model => model.id === selectedModelId) ?? null;
  return (
    <ScrollView contentContainerStyle={styles.page} accessibilityLabel={t(locale, 'mobile.consent.aria')}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>{t(locale, 'mobile.consent.eyebrow')}</Text>
        <Text style={styles.title}>{t(locale, 'mobile.consent.title')}</Text>
        <Text style={styles.description}>{t(locale, 'mobile.consent.description')}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>{t(locale, 'mobile.consent.selectModel')}</Text>
        {modelsLoading ? (
          <View style={styles.statusRow}><ActivityIndicator color={palette.roseBright} /><Text style={styles.muted}>{t(locale, 'mobile.consent.loadingModels')}</Text></View>
        ) : models.length === 0 ? (
          <Text style={styles.muted}>{t(locale, 'mobile.consent.noModels')}</Text>
        ) : (
          <View style={styles.modelList}>
            {models.map(model => {
              const selected = model.id === selectedModelId;
              return (
                <Pressable
                  key={model.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => onSelectModel(model.id)}
                  style={[styles.modelButton, selected && styles.modelButtonActive]}
                >
                  <Text style={[styles.modelText, selected && styles.modelTextActive]}>{model.displayName}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
      </View>

      {error ? (
        <View style={styles.card}>
          <Text accessibilityRole="alert" style={styles.danger}>{t(locale, 'mobile.consent.loadFailed')}</Text>
          <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
            <Text style={styles.retryText}>{t(locale, 'mobile.consent.retry')}</Text>
          </Pressable>
        </View>
      ) : selectedModel ? (
        <>
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t(locale, 'mobile.consent.publishGate')}</Text>
            {dataLoading ? (
              <View style={styles.statusRow}><ActivityIndicator color={palette.roseBright} /><Text style={styles.muted}>{t(locale, 'mobile.consent.loadingStatus')}</Text></View>
            ) : statuses.map(status => (
              <View key={status.platform} style={styles.statusCard}>
                <View style={styles.statusHeading}>
                  <Text style={styles.statusPlatform}>{status.platform}</Text>
                  <Text style={[styles.badge, status.ok ? styles.badgeGood : styles.badgeBad]}>
                    {t(locale, status.ok ? 'mobile.consent.allowed' : 'mobile.consent.blocked')}
                  </Text>
                </View>
                {!status.ok && <Text style={styles.muted}>{t(locale, 'mobile.consent.missing', { documents: status.missing.join(', ') || '—' })}</Text>}
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{t(locale, 'mobile.consent.records')}</Text>
            {dataLoading ? null : records.length === 0 ? (
              <Text style={styles.muted}>{t(locale, 'mobile.consent.noRecords')}</Text>
            ) : records.map(record => {
              const recordStateKey = `mobile.consent.${consentRecordState(record)}`;
              return (
                <View key={record.id} style={styles.recordCard}>
                  <View style={styles.statusHeading}>
                    <Text style={styles.recordKind}>{record.docKind}</Text>
                    <Text style={styles.recordState}>{t(locale, recordStateKey)}</Text>
                  </View>
                  <Text style={styles.muted}>{t(locale, 'mobile.consent.platform')}: {record.platform}</Text>
                  <Text style={styles.muted}>{t(locale, 'mobile.consent.validFrom')}: {displayDate(record.validFrom, locale)}</Text>
                  <Text style={styles.muted}>{t(locale, 'mobile.consent.validTo')}: {record.validTo ? displayDate(record.validTo, locale) : t(locale, 'mobile.consent.openEnded')}</Text>
                  <Text style={styles.muted}>{t(locale, record.hasDocument ? 'mobile.consent.documentStored' : 'mobile.consent.documentMissing')}</Text>
                </View>
              );
            })}
            <Text style={styles.privacyNote}>{t(locale, 'mobile.consent.privacyNote')}</Text>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

export default function ConsentScreen() {
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const [models, setModels] = useState<MobileModelProfile[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [records, setRecords] = useState<MobileConsentRecord[]>([]);
  const [statuses, setStatuses] = useState<MobileConsentStatus[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    void getUiLocale().then(snapshot => { if (active) setLocale(snapshot.locale); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setModelsLoading(true);
    setError(false);
    void getModels().then(page => {
      if (!active) return;
      const nextModels = page.data.slice(0, 100);
      setModels(nextModels);
      setSelectedModelId(current => current && nextModels.some(model => model.id === current) ? current : nextModels[0]?.id ?? null);
      setModelsLoading(false);
    }).catch(() => {
      if (active) { setError(true); setModelsLoading(false); }
    });
    return () => { active = false; };
  }, [reloadKey]);

  useEffect(() => {
    if (!selectedModelId) {
      setRecords([]);
      setStatuses([]);
      return;
    }
    let active = true;
    setDataLoading(true);
    setError(false);
    void Promise.all([
      getConsentRecords(selectedModelId),
      Promise.all(CONSENT_STATUS_PLATFORMS.map(platform => getConsentStatus(selectedModelId, platform))),
    ]).then(([nextRecords, nextStatuses]) => {
      if (!active) return;
      setRecords(nextRecords);
      setStatuses(nextStatuses);
      setDataLoading(false);
    }).catch(() => {
      if (active) { setError(true); setDataLoading(false); }
    });
    return () => { active = false; };
  }, [selectedModelId, reloadKey]);

  const retry = useCallback(() => setReloadKey(key => key + 1), []);
  const viewProps = useMemo(() => ({
    locale, models, selectedModelId, records, statuses, modelsLoading, dataLoading, error,
    onSelectModel: setSelectedModelId, onRetry: retry,
  }), [locale, models, selectedModelId, records, statuses, modelsLoading, dataLoading, error, retry]);
  return <ConsentView {...viewProps} />;
}

const styles = StyleSheet.create({
  page: { padding: 18, gap: 14, backgroundColor: palette.canvas, flexGrow: 1 },
  header: { gap: 8, paddingVertical: 8 },
  eyebrow: { color: palette.roseBright, fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  title: { color: palette.text, fontSize: 25, fontWeight: '800' },
  description: { color: palette.textSoft, fontSize: 14, lineHeight: 21 },
  card: { backgroundColor: palette.panel, borderColor: palette.line, borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  sectionTitle: { color: palette.text, fontSize: 16, fontWeight: '800' },
  muted: { color: palette.muted, fontSize: 12, lineHeight: 18 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  modelList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modelButton: { borderRadius: 18, borderColor: palette.line, borderWidth: 1, paddingVertical: 8, paddingHorizontal: 12 },
  modelButtonActive: { backgroundColor: palette.roseInk, borderColor: palette.rose },
  modelText: { color: palette.textSoft, fontSize: 12, fontWeight: '700' },
  modelTextActive: { color: palette.roseBright },
  statusCard: { gap: 6, paddingVertical: 10, borderTopColor: palette.lineSoft, borderTopWidth: 1 },
  statusHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  statusPlatform: { color: palette.text, fontWeight: '800', textTransform: 'capitalize' },
  badge: { fontSize: 10, fontWeight: '800', borderRadius: 12, paddingHorizontal: 9, paddingVertical: 5, overflow: 'hidden' },
  badgeGood: { color: palette.success, backgroundColor: palette.successDeep },
  badgeBad: { color: palette.warning, backgroundColor: palette.warningDeep },
  recordCard: { gap: 5, padding: 10, backgroundColor: palette.panelRaised, borderRadius: 10 },
  recordKind: { color: palette.text, fontWeight: '800' },
  recordState: { color: palette.roseBright, fontSize: 11, fontWeight: '700' },
  privacyNote: { color: palette.faint, fontSize: 11, lineHeight: 16 },
  danger: { color: palette.danger, fontSize: 13 },
  retryButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderColor: palette.line, borderWidth: 1, borderRadius: 8 },
  retryText: { color: palette.text, fontWeight: '700' },
});
