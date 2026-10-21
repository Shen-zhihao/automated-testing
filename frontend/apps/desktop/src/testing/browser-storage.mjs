import { session } from 'electron';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { browserPartition } from './browser-policy.mjs';

export const projectBrowserStorage = {
  cacheSize: (id) => session.fromPartition(browserPartition(id)).getCacheSize(),
  async clearBrowserData(id, full) {
    const profile = session.fromPartition(browserPartition(id));
    await profile.closeAllConnections();
    await profile.clearCache();
    await profile.clearCodeCaches({});
    if (full) await profile.clearStorageData();
    else await profile.clearStorageData({ storages: ['cachestorage', 'shadercache'] });
    profile.flushStorageData();
  },
};

// Chromium releases all profile file handles on exit. Retry physical removal on next launch.
export async function purgeDeletedProfiles(store, sessionData) {
  for (const { project_id: id } of store.db
    .prepare('SELECT project_id FROM project_cleanup')
    .all()) {
    if (store.db.prepare('SELECT id FROM projects WHERE id=?').get(id)) continue;
    const directory = path.join(
      sessionData,
      'Partitions',
      browserPartition(id).slice('persist:'.length),
    );
    try {
      await rm(directory, { recursive: true, force: true, maxRetries: 2 });
      store.db.prepare('DELETE FROM project_cleanup WHERE project_id=?').run(id);
    } catch {
      /* An occupied profile is retried on the next launch. */
    }
  }
}
