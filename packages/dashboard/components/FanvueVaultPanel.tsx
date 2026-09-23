'use client';

import { useState, type FormEvent } from 'react';
import { clientApi as api } from '@/lib/client-api';
import { useLocale } from './LocaleProvider';

type Folder = { name: string; createdAt: string | null; mediaCount: number };
type Media = {
  uuid: string;
  status: string;
  name?: string;
  mediaType?: 'image' | 'video' | 'audio' | 'document';
  recommendedPrice?: number | null;
};

export default function FanvueVaultPanel({
  modelId,
  connectionId,
  capabilities,
}: {
  modelId: string;
  connectionId: string;
  capabilities: string[];
}) {
  const { t } = useLocale();
  const canReadFolders = capabilities.includes('vault.folders.read');
  const canReadMedia = capabilities.includes('vault.media.read');
  const canCreateFolder = capabilities.includes('vault.folder.create');
  const canRenameFolder = capabilities.includes('vault.folder.rename');
  const canDeleteFolder = capabilities.includes('vault.folder.delete');
  const canAddMedia = capabilities.includes('vault.media.add');
  const canRemoveMedia = capabilities.includes('vault.media.remove');
  const canUpdateMedia = capabilities.includes('vault.media.update');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderFilter, setFolderFilter] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [renameValues, setRenameValues] = useState<Record<string, string>>({});
  const [selectedFolder, setSelectedFolder] = useState('');
  const [media, setMedia] = useState<Media[]>([]);
  const [mediaIds, setMediaIds] = useState('');
  const [edits, setEdits] = useState<Record<string, { name: string; price: string }>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  if (!capabilities.some(capability => capability.startsWith('vault.'))) return null;

  async function operate(operation: Record<string, unknown>) {
    return api.social.operate(modelId, connectionId, operation);
  }

  async function reloadFolders() {
    const response = await operate({
        type: 'vault.folders.read', page: 1, size: 50,
        ...(folderFilter.trim() ? { mediaName: folderFilter.trim() } : {}),
      });
      const result = response.data as { type?: string; items?: Folder[] };
      if (result.type !== 'vault.folders' || !Array.isArray(result.items)) throw new Error('invalid vault folder result');
      setFolders(result.items);
      setRenameValues(Object.fromEntries(result.items.map(folder => [folder.name, folder.name])));
      if (selectedFolder && !result.items.some(folder => folder.name === selectedFolder)) {
        setSelectedFolder('');
        setMedia([]);
      }
    return result.items;
  }

  async function loadFolders(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!canReadFolders || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const items = await reloadFolders();
      setMessage(items.length === 0 ? t('network.vaultNoFolders') : t('network.operationSucceeded'));
    } catch {
      setMessage(t('network.operationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function createFolder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!canCreateFolder || !name || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await operate({ type: 'vault.folder.create', name });
      const result = response.data as { type?: string; folder?: Folder };
      if (result.type !== 'vault.folder' || !result.folder) throw new Error('invalid vault folder result');
      setNewFolderName('');
      setMessage(t('network.operationSucceeded'));
      if (canReadFolders) {
        try { await reloadFolders(); } catch { setMessage(t('network.vaultRefreshFailed')); }
      }
    } catch {
      setMessage(t('network.operationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function reloadMedia(name: string) {
      const response = await operate({ type: 'vault.media.read', folderName: name, page: 1, size: 50 });
      const result = response.data as { type?: string; items?: Media[] };
      if (result.type !== 'vault.media' || !Array.isArray(result.items)) throw new Error('invalid vault media result');
      setMedia(result.items);
      setEdits(Object.fromEntries(result.items.map(item => [item.uuid, {
        name: item.name ?? '',
        price: item.recommendedPrice == null ? '' : String(item.recommendedPrice),
      }])));
    return result.items;
  }

  async function openFolder(name: string) {
    if (!canReadMedia || busy) return;
    setBusy(true);
    setMessage('');
    setSelectedFolder(name);
    try {
      const items = await reloadMedia(name);
      setMessage(items.length === 0 ? t('network.vaultNoMedia') : t('network.operationSucceeded'));
    } catch {
      setMessage(t('network.operationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function mutate(operation: Record<string, unknown>, after?: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await operate(operation);
      setMessage(t('network.operationSucceeded'));
      if (after) {
        try { await after(); } catch { setMessage(t('network.vaultRefreshFailed')); }
      }
    } catch {
      setMessage(t('network.operationFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function addMedia(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFolder || !canAddMedia) return;
    const ids = mediaIds.split(/[\s,]+/).map(value => value.trim()).filter(Boolean);
    await mutate({ type: 'vault.media.add', folderName: selectedFolder, mediaUuids: ids }, async () => {
      setMediaIds('');
      if (canReadMedia) await reloadMedia(selectedFolder);
    });
  }

  async function saveMedia(item: Media) {
    if (!selectedFolder || !canUpdateMedia) return;
    const edit = edits[item.uuid] ?? { name: item.name ?? '', price: '' };
    const operation: Record<string, unknown> = {
      type: 'vault.media.update', folderName: selectedFolder, mediaUuid: item.uuid,
    };
    if (edit.name.trim() !== (item.name ?? '')) operation['name'] = edit.name.trim() || null;
    const oldPrice = item.recommendedPrice == null ? '' : String(item.recommendedPrice);
    if (edit.price !== oldPrice) operation['recommendedPrice'] = edit.price === '' ? null : Number(edit.price);
    if (Object.keys(operation).length > 3) await mutate(operation, () => reloadMedia(selectedFolder).then(() => undefined));
  }

  return (
    <section className="stack" aria-label={t('network.vaultTitle')}>
      <h3>{t('network.vaultTitle')}</h3>
      {canReadFolders && (
        <form className="action-row" onSubmit={event => void loadFolders(event)}>
          <label>{t('network.vaultMediaSearch')}<input value={folderFilter} maxLength={255} onChange={event => setFolderFilter(event.target.value)} /></label>
          <button type="submit" disabled={busy}>{t('network.vaultLoadFolders')}</button>
        </form>
      )}
      {canCreateFolder && (
        <form className="action-row" onSubmit={event => void createFolder(event)}>
          <label>{t('network.vaultFolderName')}<input value={newFolderName} maxLength={255} required onChange={event => setNewFolderName(event.target.value)} /></label>
          <button type="submit" disabled={busy}>{t('network.vaultCreateFolder')}</button>
        </form>
      )}
      {folders.map(folder => (
        <article className="card stack" key={folder.name}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            {canReadMedia
              ? <button type="button" disabled={busy} onClick={() => void openFolder(folder.name)}>{t('network.vaultOpenFolder')}: {folder.name} ({folder.mediaCount})</button>
              : <span>{folder.name} ({folder.mediaCount})</span>}
            {canDeleteFolder && <button type="button" disabled={busy} onClick={() => {
              if (window.confirm(t('network.vaultConfirmDelete'))) {
                void mutate({ type: 'vault.folder.delete', folderName: folder.name }, async () => { if (canReadFolders) await reloadFolders(); });
              }
            }}>{t('network.vaultDeleteFolder')}</button>}
          </div>
          {canRenameFolder && (
            <form className="action-row" onSubmit={event => {
              event.preventDefault();
              const name = (renameValues[folder.name] ?? folder.name).trim();
              if (name && name !== folder.name) {
                void mutate({ type: 'vault.folder.rename', folderName: folder.name, name }, async () => { if (canReadFolders) await reloadFolders(); });
              }
            }}>
              <label>{t('network.vaultRenameFolder')}<input value={renameValues[folder.name] ?? folder.name} maxLength={255} required onChange={event => setRenameValues(current => ({ ...current, [folder.name]: event.target.value }))} /></label>
              <button type="submit" disabled={busy}>{t('network.vaultRenameFolder')}</button>
            </form>
          )}
        </article>
      ))}
      {selectedFolder && canReadMedia && (
        <div className="stack" aria-label={`${t('network.vaultMedia')}: ${selectedFolder}`}>
          <h4>{t('network.vaultMedia')}: {selectedFolder}</h4>
          {canAddMedia && (
            <form className="action-row" onSubmit={event => void addMedia(event)}>
              <label>{t('network.vaultMediaIds')}<textarea value={mediaIds} required onChange={event => setMediaIds(event.target.value)} /></label>
              <button type="submit" disabled={busy}>{t('network.vaultAddMedia')}</button>
            </form>
          )}
          {media.map(item => {
            const edit = edits[item.uuid] ?? { name: item.name ?? '', price: '' };
            return (
              <article className="card stack" key={item.uuid}>
                <p>{item.mediaType ?? '—'} · {item.status} · <span className="mono">{item.uuid}</span></p>
                {(canUpdateMedia || item.name) && <label>{t('network.vaultMediaName')}<input value={edit.name} disabled={!canUpdateMedia || busy} maxLength={255} onChange={event => setEdits(current => ({ ...current, [item.uuid]: { ...edit, name: event.target.value } }))} /></label>}
                {canUpdateMedia && <label>{t('network.vaultRecommendedPrice')}<input type="number" min="0" step="1" value={edit.price} disabled={busy} onChange={event => setEdits(current => ({ ...current, [item.uuid]: { ...edit, price: event.target.value } }))} /></label>}
                <div className="action-row">
                  {canUpdateMedia && <button type="button" disabled={busy} onClick={() => void saveMedia(item)}>{t('network.vaultSaveMedia')}</button>}
                  {canRemoveMedia && <button type="button" disabled={busy} onClick={() => void mutate({ type: 'vault.media.remove', folderName: selectedFolder, mediaUuid: item.uuid }, () => reloadMedia(selectedFolder).then(() => undefined))}>{t('network.vaultRemoveMedia')}</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
