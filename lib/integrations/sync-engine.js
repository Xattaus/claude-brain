import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { SuperpowersSync } from './superpowers-sync.js';

/**
 * SyncEngine — Orchestrates all sync sources for brain
 */
export class SyncEngine {
  constructor(manager) {
    this.manager = manager;
    this.statePath = join(manager.brainPath, 'sync-state.json');
    this.superpowersSync = new SuperpowersSync(manager);
  }

  async loadSyncState() {
    if (!existsSync(this.statePath)) {
      return { version: 1, lastSync: null, sources: {} };
    }
    try {
      const data = await readFile(this.statePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return { version: 1, lastSync: null, sources: {} };
    }
  }

  async saveSyncState(state) {
    state.lastSync = new Date().toISOString();
    await writeFile(this.statePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  async runSync() {
    const state = await this.loadSyncState();
    const results = await this.superpowersSync.sync(state);
    await this.saveSyncState(state);
    return results;
  }

  async needsSync() {
    const state = await this.loadSyncState();
    if (!state.lastSync) return true;

    const specsDir = join(this.manager.projectPath, 'docs', 'superpowers', 'specs');
    const plansDir = join(this.manager.projectPath, 'docs', 'superpowers', 'plans');

    const specFiles = await this.superpowersSync.scanDirectory(specsDir);
    const planFiles = await this.superpowersSync.scanDirectory(plansDir);

    const allFiles = [...specFiles, ...planFiles];
    for (const { file, hash } of allFiles) {
      const specState = state.sources['superpowers-specs']?.files?.[file];
      const planState = state.sources['superpowers-plans']?.files?.[file];
      const existing = specState || planState;
      if (!existing || existing.hash !== hash) return true;
    }

    return false;
  }
}
