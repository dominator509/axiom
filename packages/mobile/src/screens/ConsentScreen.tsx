import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  CATALOGS,
  CONSENT_CATALOGS,
  interpolate,
  LocaleCatalog,
  PLATFORM_IDS,
  formatDate,
  type ConsentMessageKey,
  type Platform,
  type SupportedLocale,
} from '@axiom/core';
import type { SessionUser } from '../api/auth';
import { ApiError, createIdempotencyKey } from '../api/client';
import {
  getConsentRecords,
  getConsentStatus,
  getModels,
  getUiLocale,
  uploadConsentRecord,
  type MobileConsentRecord,
  type MobileConsentStatus,
  type MobileModelProfile,
} from '../api/endpoints';
import {
  prepareConsentUploadDocument,
  validateConsentUploadDocument,
  type ConsentRecordUploadInput,
  type ConsentUploadDocument,
} from '../consent-upload';
import { palette } from '../theme';

export const CONSENT_STATUS_PLATFORMS: readonly Platform[] = PLATFORM_IDS;
const catalog = new LocaleCatalog(CATALOGS);
const DOC_KINDS = ['2257', 'model_release', 'id_verify', 'platform_consent'] as const;
type ConsentDocKind = (typeof DOC_KINDS)[number];
type ConsentT = (key: ConsentMessageKey, values?: Record<string, string | number>) => string;

export interface ConsentRecordDraft {
  platform: string;
  docKind: ConsentDocKind;
  subjectRef: string;
  validFrom: string;
  validTo: string;
  expiresAt: string;
}

function newConsentDraft(): ConsentRecordDraft {
  return {
    platform: 'instagram',
    docKind: 'model_release',
    subjectRef: '',
    validFrom: new Date().toISOString().slice(0, 10),
    validTo: '',
    expiresAt: '',
  };
}

function consentText(locale: SupportedLocale, key: ConsentMessageKey, values?: Record<string, string | number>): string {
  return interpolate(CONSENT_CATALOGS[locale][key], values);
}

export function canManageConsent(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'manager' || role === 'operator';
}

function validDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function consentDraftError(
  draft: ConsentRecordDraft,
  document: ConsentUploadDocument | null,
): ConsentMessageKey | null {
  const platform = draft.platform.trim();
  const subjectRef = draft.subjectRef.trim();
  if (!platform || platform.length > 50) return 'consent.invalidPlatform';
  if (!DOC_KINDS.includes(draft.docKind)) return 'consent.invalidKind';
  if (!subjectRef || subjectRef.length > 200) return 'consent.invalidReferences';
  if (!validDateOnly(draft.validFrom)
    || (draft.validTo && !validDateOnly(draft.validTo))
    || (draft.validTo && draft.validTo < draft.validFrom)
    || (draft.expiresAt && (!validDateOnly(draft.expiresAt) || draft.expiresAt < draft.validFrom))) {
    return 'consent.invalidRange';
  }
  if (!document || validateConsentUploadDocument(document) !== null) return 'consent.invalidDocument';
  return null;
}

export async function loadConsentSnapshot(modelId: string) {
  const [records, statuses] = await Promise.all([
    getConsentRecords(modelId),
    Promise.all(CONSENT_STATUS_PLATFORMS.map(platform => getConsentStatus(modelId, platform))),
  ]);
  return { records, statuses };
}

export interface ConsentViewProps {
  locale: SupportedLocale;
  canManage: boolean;
  models: MobileModelProfile[];
  selectedModelId: string | null;
  records: MobileConsentRecord[];
  statuses: MobileConsentStatus[];
  modelsLoading: boolean;
  dataLoading: boolean;
  error: boolean;
  draft: ConsentRecordDraft;
  hasSelectedDocument: boolean;
  uploadPending: boolean;
  uploading: boolean;
  uploadError: string | null;
  uploadMessage: string | null;
  onSelectModel: (modelId: string) => void;
  onRetry: () => void;
  onDraftChange: (field: keyof ConsentRecordDraft, value: string) => void;
  onPickDocument: () => void;
  onUpload: () => void;
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
  canManage,
  models,
  selectedModelId,
  records,
  statuses,
  modelsLoading,
  dataLoading,
  error,
  draft,
  hasSelectedDocument,
  uploadPending,
  uploading,
  uploadError,
  uploadMessage,
  onSelectModel,
  onRetry,
  onDraftChange,
  onPickDocument,
  onUpload,
}: ConsentViewProps) {
  const selectedModel = models.find(model => model.id === selectedModelId) ?? null;
  const tConsent: ConsentT = (key, values) => consentText(locale, key, values);
  const formLocked = uploading || uploadPending;
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
                  accessibilityState={{ selected, disabled: formLocked }}
                  disabled={formLocked}
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

          {canManage ? (
            <View style={styles.card} accessibilityLabel={tConsent('consent.addMetadata')}>
              <Text style={styles.sectionTitle}>{tConsent('consent.addMetadata')}</Text>
              <Text style={styles.muted}>{tConsent('consent.formDescription')}</Text>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>{tConsent('consent.platform')}</Text>
                <TextInput
                  accessibilityLabel={tConsent('consent.platform')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!formLocked}
                  maxLength={50}
                  onChangeText={value => onDraftChange('platform', value)}
                  style={styles.input}
                  value={draft.platform}
                />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>{tConsent('consent.documentKind')}</Text>
                <View style={styles.kindList}>
                  {DOC_KINDS.map(kind => {
                    const selected = draft.docKind === kind;
                    return (
                      <Pressable
                        key={kind}
                        accessibilityRole="button"
                        accessibilityState={{ selected, disabled: formLocked }}
                        disabled={formLocked}
                        onPress={() => onDraftChange('docKind', kind)}
                        style={[styles.kindButton, selected && styles.kindButtonActive]}
                      >
                        <Text style={[styles.kindText, selected && styles.kindTextActive]}>{kind}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>{tConsent('consent.subjectReference')}</Text>
                <TextInput
                  accessibilityLabel={tConsent('consent.subjectReference')}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!formLocked}
                  maxLength={200}
                  onChangeText={value => onDraftChange('subjectRef', value)}
                  secureTextEntry
                  style={styles.input}
                  value={draft.subjectRef}
                />
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tConsent('consent.uploadDocument')}
                accessibilityState={{ disabled: formLocked }}
                disabled={formLocked}
                onPress={onPickDocument}
                style={[styles.secondaryButton, formLocked && styles.buttonDisabled]}
              >
                <Text style={styles.secondaryButtonText}>{tConsent('consent.uploadDocument')}</Text>
              </Pressable>
              {hasSelectedDocument ? (
                <Text style={styles.successText}>{t(locale, 'mobile.consent.documentSelected')}</Text>
              ) : null}
              <View style={styles.formField}>
                <Text style={styles.formLabel}>{tConsent('consent.validFrom')}</Text>
                <TextInput
                  accessibilityLabel={tConsent('consent.validFrom')}
                  autoCapitalize="none"
                  editable={!formLocked}
                  keyboardType="numbers-and-punctuation"
                  onChangeText={value => onDraftChange('validFrom', value)}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={palette.faint}
                  style={styles.input}
                  value={draft.validFrom}
                />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>{tConsent('consent.validToOptional')}</Text>
                <TextInput
                  accessibilityLabel={tConsent('consent.validToOptional')}
                  autoCapitalize="none"
                  editable={!formLocked}
                  keyboardType="numbers-and-punctuation"
                  onChangeText={value => onDraftChange('validTo', value)}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={palette.faint}
                  style={styles.input}
                  value={draft.validTo}
                />
              </View>
              <View style={styles.formField}>
                <Text style={styles.formLabel}>{tConsent('consent.expiry')}</Text>
                <TextInput
                  accessibilityLabel={tConsent('consent.expiry')}
                  autoCapitalize="none"
                  editable={!formLocked}
                  keyboardType="numbers-and-punctuation"
                  onChangeText={value => onDraftChange('expiresAt', value)}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={palette.faint}
                  style={styles.input}
                  value={draft.expiresAt}
                />
              </View>
              {uploadError ? <Text accessibilityRole="alert" style={styles.danger}>{uploadError}</Text> : null}
              {uploadMessage ? <Text accessibilityLiveRegion="polite" style={styles.successText}>{uploadMessage}</Text> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: uploading || !hasSelectedDocument }}
                disabled={uploading || !hasSelectedDocument}
                onPress={onUpload}
                style={[styles.primaryButton, (uploading || !hasSelectedDocument) && styles.buttonDisabled]}
              >
                {uploading ? <ActivityIndicator color={palette.roseInk} /> : null}
                <Text style={styles.primaryButtonText}>{tConsent(uploading ? 'consent.saving' : 'consent.save')}</Text>
              </Pressable>
              <Text style={styles.privacyNote}>{t(locale, 'mobile.consent.privacyNote')}</Text>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

export default function ConsentScreen({ user }: { user: SessionUser }) {
  const [locale, setLocale] = useState<SupportedLocale>('en');
  const [models, setModels] = useState<MobileModelProfile[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [records, setRecords] = useState<MobileConsentRecord[]>([]);
  const [statuses, setStatuses] = useState<MobileConsentStatus[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [draft, setDraft] = useState<ConsentRecordDraft>(newConsentDraft);
  const [selectedDocument, setSelectedDocument] = useState<ConsentUploadDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const uploadIntent = useRef<{
    modelId: string;
    input: ConsentRecordUploadInput;
    idempotencyKey: string;
  } | null>(null);
  const canManage = canManageConsent(user.role);

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
    void loadConsentSnapshot(selectedModelId).then(({ records: nextRecords, statuses: nextStatuses }) => {
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
  const selectModel = useCallback((modelId: string) => {
    if (uploadIntent.current) return;
    setSelectedModelId(modelId);
    setDraft(newConsentDraft());
    setSelectedDocument(null);
    setUploadError(null);
    setUploadMessage(null);
  }, []);
  const changeDraft = useCallback((field: keyof ConsentRecordDraft, value: string) => {
    setDraft(current => field === 'docKind'
      ? { ...current, docKind: value as ConsentDocKind }
      : { ...current, [field]: value });
    setUploadError(null);
    setUploadMessage(null);
  }, []);
  const pickDocument = useCallback(async () => {
    if (!canManage || uploading || uploadIntent.current) return;
    setUploadError(null);
    setUploadMessage(null);
    try {
      const DocumentPicker = await import('expo-document-picker');
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        multiple: false,
        copyToCacheDirectory: false,
        base64: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) {
        setUploadError(consentText(locale, 'consent.invalidDocument'));
        return;
      }
      const picked: ConsentUploadDocument = {
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType,
        size: asset.size,
        file: asset.file,
      };
      if (validateConsentUploadDocument(picked) !== null) {
        setSelectedDocument(null);
        setUploadError(consentText(locale, 'consent.invalidDocument'));
        return;
      }
      setSelectedDocument(await prepareConsentUploadDocument(picked));
    } catch {
      setSelectedDocument(null);
      // Picker errors may contain device-local paths; keep them out of the UI and logs.
      setUploadError(consentText(locale, 'consent.invalidDocument'));
    }
  }, [canManage, locale, uploading]);
  const handleUpload = useCallback(async () => {
    if (!canManage || !selectedModelId || uploading) return;
    setUploadError(null);
    setUploadMessage(null);
    if (!uploadIntent.current) {
      const invalid = consentDraftError(draft, selectedDocument);
      if (invalid) {
        setUploadError(consentText(locale, invalid));
        return;
      }
      const input: ConsentRecordUploadInput = {
        platform: draft.platform.trim(),
        docKind: draft.docKind,
        subjectRef: draft.subjectRef.trim(),
        validFrom: draft.validFrom,
        ...(draft.validTo ? { validTo: draft.validTo } : {}),
        ...(draft.expiresAt ? { expiresAt: `${draft.expiresAt}T23:59:59.999Z` } : {}),
        document: selectedDocument!,
      };
      uploadIntent.current = { modelId: selectedModelId, input, idempotencyKey: createIdempotencyKey() };
      setUploadPending(true);
    }
    const intent = uploadIntent.current;
    if (!intent) return;
    setUploading(true);
    try {
      const saved = await uploadConsentRecord(intent.modelId, intent.input, intent.idempotencyKey);
      setRecords(current => [saved, ...current.filter(record => record.id !== saved.id)].slice(0, 100));
      uploadIntent.current = null;
      setUploadPending(false);
      setSelectedDocument(null);
      setDraft(newConsentDraft());
      setUploadMessage(consentText(locale, 'consent.saved'));
      void loadConsentSnapshot(intent.modelId).then(snapshot => {
        setRecords(snapshot.records);
        setStatuses(snapshot.statuses);
      }).catch(() => undefined);
    } catch (failure) {
      if (failure instanceof ApiError && [400, 401, 403, 404, 409, 413, 415, 422].includes(failure.status)) {
        uploadIntent.current = null;
        setUploadPending(false);
      }
      setUploadError(failure instanceof ApiError
        ? consentText(locale, 'consent.saveHttp', { status: failure.status })
        : consentText(locale, 'consent.saveUnconfirmed'));
    } finally {
      setUploading(false);
    }
  }, [canManage, draft, locale, selectedDocument, selectedModelId, uploading]);
  const viewProps = useMemo(() => ({
    locale, canManage, models, selectedModelId, records, statuses, modelsLoading, dataLoading, error,
    draft, hasSelectedDocument: selectedDocument !== null, uploadPending, uploading, uploadError, uploadMessage,
    onSelectModel: selectModel, onRetry: retry, onDraftChange: changeDraft, onPickDocument: () => void pickDocument(),
    onUpload: () => void handleUpload(),
  }), [locale, canManage, models, selectedModelId, records, statuses, modelsLoading, dataLoading, error,
    draft, selectedDocument, uploadPending, uploading, uploadError, uploadMessage, selectModel, retry, changeDraft, pickDocument, handleUpload]);
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
  formField: { gap: 6 },
  formLabel: { color: palette.textSoft, fontSize: 12, fontWeight: '700' },
  input: { minHeight: 46, borderWidth: 1, borderColor: palette.line, borderRadius: 10, paddingHorizontal: 12, color: palette.text, backgroundColor: palette.canvas, fontSize: 15 },
  kindList: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  kindButton: { borderWidth: 1, borderColor: palette.line, borderRadius: 18, paddingHorizontal: 10, paddingVertical: 7 },
  kindButtonActive: { borderColor: palette.rose, backgroundColor: palette.roseInk },
  kindText: { color: palette.textSoft, fontSize: 11, fontWeight: '700' },
  kindTextActive: { color: palette.roseBright },
  secondaryButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: palette.line },
  secondaryButtonText: { color: palette.text, textAlign: 'center', fontSize: 12, fontWeight: '700' },
  primaryButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, backgroundColor: palette.roseBright, paddingHorizontal: 12 },
  primaryButtonText: { color: palette.roseInk, fontSize: 13, fontWeight: '800' },
  buttonDisabled: { opacity: 0.55 },
  successText: { color: palette.success, fontSize: 12, lineHeight: 18 },
  danger: { color: palette.danger, fontSize: 13 },
  retryButton: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderColor: palette.line, borderWidth: 1, borderRadius: 8 },
  retryText: { color: palette.text, fontWeight: '700' },
});
