import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type { SessionUser } from '../api/auth';
import {
  getModels,
  getPatreonData,
  getPatreonStatus,
  getSocialConnections,
  patreonAuthorizeUrl,
  syncPatreon,
  type MobileModelProfile,
  type MobilePatreonRecord,
  type MobilePatreonStatus,
  type PatreonResource,
} from '../api/endpoints';
import {
  boundedRecordList,
  capabilityBoundaryCopy,
  canManagePatreon,
  selectVisibleModel,
  syncButtonLabel,
} from '../patreon/presentation';
import { palette, surfaceShadow } from '../theme';

interface PatreonScreenProps {
  user: SessionUser;
}

type Records = Record<PatreonResource, MobilePatreonRecord[]>;

const EMPTY_RECORDS: Records = { campaign: [], members: [], posts: [] };
const RESOURCES: PatreonResource[] = ['campaign', 'members', 'posts'];

interface PatreonScreenState {
  models: MobileModelProfile[];
  selectedModelId: string | null;
  modelsLoading: boolean;
  communityLoading: boolean;
  connectionId: string | null;
  status: MobilePatreonStatus | null;
  records: Records;
  error: string | null;
  actionMessage: string | null;
  busy: PatreonResource | null;
}

function resourceTitle(resource: PatreonResource): string {
  if (resource === 'campaign') return 'Campaigns';
  if (resource === 'members') return 'Members and tiers';
  return 'Post history';
}

/** Native Patreon surface. It uses the authenticated BFF and never holds provider credentials. */
export default function PatreonScreen({ user }: PatreonScreenProps) {
  const [state, setState] = useState<PatreonScreenState>({
    models: [],
    selectedModelId: null,
    modelsLoading: true,
    communityLoading: false,
    connectionId: null,
    status: null,
    records: EMPTY_RECORDS,
    error: null,
    actionMessage: null,
    busy: null,
  });
  const managePatreon = useMemo(() => canManagePatreon(user.role), [user.role]);

  const loadCommunity = useCallback(async (modelId: string): Promise<boolean> => {
    setState(prev => ({
      ...prev,
      selectedModelId: modelId,
      communityLoading: true,
      connectionId: null,
      status: null,
      records: EMPTY_RECORDS,
      error: null,
      actionMessage: null,
    }));
    try {
      const connections = await getSocialConnections(modelId);
      const connection = connections.find(item => item.platform === 'patreon') ?? null;
      if (!connection) {
        setState(prev => ({ ...prev, communityLoading: false, connectionId: null }));
        return true;
      }
      const [status, campaign, members, posts] = await Promise.all([
        getPatreonStatus(connection.id),
        getPatreonData(connection.id, 'campaign'),
        getPatreonData(connection.id, 'members'),
        getPatreonData(connection.id, 'posts'),
      ]);
      setState(prev => ({
        ...prev,
        communityLoading: false,
        connectionId: connection.id,
        status,
        records: { campaign, members, posts },
      }));
      return true;
    } catch {
      setState(prev => ({
        ...prev,
        communityLoading: false,
        error: 'Patreon community data could not be loaded. Retry without changing provider data.',
      }));
      return false;
    }
  }, []);

  const loadModels = useCallback(async () => {
    setState(prev => ({ ...prev, modelsLoading: true, error: null }));
    try {
      const page = await getModels();
      const models = page.data.slice(0, 100);
      const selected = selectVisibleModel(models, null);
      setState(prev => ({
        ...prev,
        models,
        selectedModelId: selected?.id ?? null,
        modelsLoading: false,
        error: null,
      }));
      if (selected) void loadCommunity(selected.id);
    } catch {
      setState(prev => ({ ...prev, modelsLoading: false, error: 'Assigned models could not be loaded. Retry.' }));
    }
  }, [loadCommunity]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  async function openPatreonAuthorize() {
    if (!state.selectedModelId) return;
    try {
      await Linking.openURL(patreonAuthorizeUrl(state.selectedModelId));
      setState(prev => ({ ...prev, actionMessage: 'The secure browser handoff opened. Return here and refresh after authorization.' }));
    } catch {
      setState(prev => ({ ...prev, error: 'The secure browser handoff could not be opened.' }));
    }
  }

  async function runSync(resource: PatreonResource) {
    if (!state.connectionId || state.busy !== null) return;
    const cursor = state.status?.sync.find(item => item.resource === resource)?.nextCursor ?? null;
    setState(prev => ({ ...prev, busy: resource, error: null, actionMessage: null }));
    try {
      const result = await syncPatreon(state.connectionId, resource, cursor);
      const refreshed = state.selectedModelId ? await loadCommunity(state.selectedModelId) : true;
      if (refreshed) {
        setState(prev => ({
          ...prev,
          error: null,
          actionMessage: result.replay
            ? `${resourceTitle(resource)} were already synchronized for that cursor.`
            : `${resourceTitle(resource)} synchronized: ${result.count} record${result.count === 1 ? '' : 's'}.`,
        }));
      }
    } catch {
      setState(prev => ({ ...prev, error: `${resourceTitle(resource)} sync failed; no provider payload was displayed.` }));
    } finally {
      setState(prev => ({ ...prev, busy: null }));
    }
  }

  const selectedModel = selectVisibleModel(state.models, state.selectedModelId);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerRow}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>COMMUNITY</Text>
          <Text style={styles.title}>Patreon</Text>
          <Text style={styles.muted}>Read-only campaigns, memberships and posts.</Text>
        </View>
        <View style={styles.privatePill}><Text style={styles.privateText}>V2 · READ / SYNC</Text></View>
      </View>

      {state.error ? <Text style={styles.error} accessibilityRole="alert">{state.error}</Text> : null}
      {state.actionMessage ? <Text style={styles.actionMessage} accessibilityLiveRegion="polite">{state.actionMessage}</Text> : null}

      <Text style={styles.sectionTitle}>Model</Text>
      <View style={styles.card}>
        {state.modelsLoading ? (
          <View style={styles.centeredRow}><ActivityIndicator color={palette.rose} /><Text style={styles.muted}>Loading assigned models…</Text></View>
        ) : state.models.length === 0 ? (
          <Text style={styles.muted}>No models are assigned to this account. The server returned an empty scope.</Text>
        ) : (
          <View style={styles.modelList}>
            {state.models.map(model => {
              const selected = model.id === selectedModel?.id;
              return (
                <Pressable
                  key={model.id}
                  style={[styles.modelButton, selected && styles.modelButtonSelected]}
                  onPress={() => void loadCommunity(model.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`Select ${model.displayName}`}
                >
                  <Text style={[styles.modelName, selected && styles.modelNameSelected]}>{model.displayName}</Text>
                  {model.handle ? <Text style={styles.modelHandle}>@{model.handle}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        )}
        {state.error && !state.modelsLoading ? (
          <Pressable style={styles.secondaryButton} onPress={() => void loadModels()} accessibilityRole="button">
            <Text style={styles.secondaryButtonText}>Retry model list</Text>
          </Pressable>
        ) : null}
      </View>

      {selectedModel ? (
        <>
          <Text style={styles.sectionTitle}>{selectedModel.displayName} community</Text>
          {state.communityLoading ? (
            <View style={[styles.card, styles.centeredRow]}><ActivityIndicator color={palette.rose} /><Text style={styles.muted}>Loading Patreon community data…</Text></View>
          ) : state.connectionId === null ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Patreon is not connected</Text>
              <Text style={styles.muted}>{managePatreon ? 'Connect through the secure browser handoff. This app never receives Patreon secrets.' : capabilityBoundaryCopy(false)}</Text>
              {managePatreon ? (
                <Pressable style={styles.primaryButton} onPress={() => void openPatreonAuthorize()} accessibilityRole="button">
                  <Text style={styles.primaryButtonText}>Connect Patreon</Text>
                </Pressable>
              ) : null}
              <Text style={styles.boundaryText}>{capabilityBoundaryCopy(managePatreon)}</Text>
            </View>
          ) : state.status ? (
            <View style={styles.stack}>
              <View style={styles.card}>
                <View style={styles.row}><Text style={styles.cardTitle}>{state.status.connection.displayName}</Text><Text style={styles.badgeGood}>{state.status.connection.status}</Text></View>
                <Text style={styles.muted}>Provider credentials remain server-side and encrypted.</Text>
                <View style={styles.countGrid}>
                  <Count label="Campaigns" value={state.status.counts.campaigns} />
                  <Count label="Members" value={state.status.counts.members} />
                  <Count label="Posts" value={state.status.counts.posts} />
                </View>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Sync controls</Text>
                {managePatreon ? (
                  <>
                    <Text style={styles.muted}>Sync is bounded and retry-safe. Existing pages continue from their saved cursor.</Text>
                    <View style={styles.syncList}>
                      {RESOURCES.map(resource => {
                        const syncState = state.status?.sync.find(item => item.resource === resource);
                        const busy = state.busy === resource;
                        return (
                          <View style={styles.syncRow} key={resource}>
                            <View style={styles.rowCopy}>
                              <Text style={styles.rowLabel}>{resourceTitle(resource)}</Text>
                              <Text style={styles.rowHint}>{syncState?.hasError ? 'Last sync failed; retry is safe.' : syncState?.lastSyncedAt ? 'Last sync completed.' : 'Not synchronized yet.'}</Text>
                            </View>
                            <Pressable style={[styles.smallButton, state.busy !== null && !busy && styles.buttonDisabled]} onPress={() => void runSync(resource)} disabled={state.busy !== null} accessibilityRole="button">
                              {busy ? <ActivityIndicator color={palette.roseInk} size="small" /> : <Text style={styles.smallButtonText}>{syncButtonLabel(resource, syncState?.nextCursor ?? null, false)}</Text>}
                            </Pressable>
                          </View>
                        );
                      })}
                    </View>
                  </>
                ) : (
                  <Text style={styles.muted}>Your role can view assigned Patreon data. Synchronization is reserved for workspace operators.</Text>
                )}
                <Text style={styles.muted}>{state.status.hasWebhook ? 'Signed webhook activity has been received.' : 'No signed webhook activity has been received yet.'}</Text>
              </View>

              {RESOURCES.map(resource => (
                <View style={styles.card} key={resource}>
                  <Text style={styles.cardTitle}>{resourceTitle(resource)}</Text>
                  {boundedRecordList(state.records[resource]).length === 0 ? (
                    <Text style={styles.muted}>No normalized records synchronized yet.</Text>
                  ) : boundedRecordList(state.records[resource]).map(record => (
                    <View style={styles.record} key={record.id}>
                      <View style={styles.row}><Text style={styles.rowLabel}>{record.title}</Text><Text style={styles.providerRef}>{record.providerRef}</Text></View>
                      <Text style={styles.rowHint}>{record.detail}</Text>
                      {record.updatedAt ? <Text style={styles.meta}>Updated {record.updatedAt}</Text> : null}
                    </View>
                  ))}
                </View>
              ))}

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Manual-assist boundary</Text>
                <Text style={styles.muted}>{capabilityBoundaryCopy(managePatreon)}</Text>
                <Text style={styles.meta}>No publishing, DMs, payouts, member removal, email/address scope or revenue analytics.</Text>
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return <View style={styles.count}><Text style={styles.countValue}>{value}</Text><Text style={styles.countLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.canvas },
  content: { padding: 18, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 7, marginBottom: 20, gap: 12 },
  headerCopy: { flex: 1 },
  eyebrow: { color: palette.roseBright, fontSize: 9, fontWeight: '800', letterSpacing: 1.4, marginBottom: 5 },
  title: { color: palette.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.6 },
  muted: { color: palette.muted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  sectionTitle: { color: palette.textSoft, fontSize: 12, fontWeight: '700', letterSpacing: 0.7, marginTop: 18, marginBottom: 10 },
  card: { backgroundColor: palette.panel, borderRadius: 18, borderWidth: 1, borderColor: palette.lineSoft, padding: 16, marginBottom: 9, ...surfaceShadow },
  stack: { gap: 2 },
  cardTitle: { color: palette.text, fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  rowCopy: { flex: 1 },
  rowLabel: { color: palette.text, fontSize: 13, fontWeight: '600' },
  rowHint: { color: palette.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  modelList: { gap: 8 },
  modelButton: { borderWidth: 1, borderColor: palette.line, borderRadius: 12, padding: 12 },
  modelButtonSelected: { borderColor: palette.roseBright, backgroundColor: palette.panelRaised },
  modelName: { color: palette.textSoft, fontSize: 13, fontWeight: '700' },
  modelNameSelected: { color: palette.text },
  modelHandle: { color: palette.faint, fontSize: 11, marginTop: 3 },
  centeredRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  primaryButton: { alignSelf: 'flex-start', backgroundColor: palette.rose, borderRadius: 11, paddingHorizontal: 14, paddingVertical: 10, marginTop: 14 },
  primaryButtonText: { color: palette.roseInk, fontSize: 12, fontWeight: '800' },
  secondaryButton: { alignSelf: 'flex-start', borderWidth: 1, borderColor: palette.line, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9, marginTop: 12 },
  secondaryButtonText: { color: palette.textSoft, fontSize: 11, fontWeight: '700' },
  boundaryText: { color: palette.faint, fontSize: 11, lineHeight: 16, marginTop: 15 },
  privatePill: { borderWidth: 1, borderColor: palette.line, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  privateText: { color: palette.muted, fontSize: 8, fontWeight: '800', letterSpacing: 0.8 },
  error: { color: palette.danger, fontSize: 12, lineHeight: 17, marginBottom: 10, backgroundColor: palette.dangerDeep, borderRadius: 10, padding: 11 },
  actionMessage: { color: palette.success, fontSize: 12, lineHeight: 17, marginBottom: 10, backgroundColor: palette.successDeep, borderRadius: 10, padding: 11 },
  badgeGood: { color: palette.success, backgroundColor: palette.successDeep, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, fontSize: 10, fontWeight: '700' },
  countGrid: { flexDirection: 'row', gap: 8, marginTop: 15 },
  count: { flex: 1, backgroundColor: palette.panelRaised, borderRadius: 12, padding: 11 },
  countValue: { color: palette.text, fontSize: 18, fontWeight: '800' },
  countLabel: { color: palette.muted, fontSize: 10, marginTop: 3 },
  syncList: { gap: 10, marginTop: 14, marginBottom: 13 },
  syncRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  smallButton: { backgroundColor: palette.rose, borderRadius: 10, minWidth: 88, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8 },
  smallButtonText: { color: palette.roseInk, fontSize: 10, fontWeight: '800', textAlign: 'center' },
  buttonDisabled: { opacity: 0.45 },
  record: { borderTopWidth: 1, borderTopColor: palette.lineSoft, paddingTop: 10, marginTop: 10 },
  providerRef: { color: palette.faint, fontSize: 10, fontFamily: 'monospace' },
  meta: { color: palette.faint, fontSize: 10, lineHeight: 15, marginTop: 5 },
});
