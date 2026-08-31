'use client';

import Dexie, { type EntityTable } from 'dexie';
import type { AppState } from './model';

interface StoredWorkspace extends AppState {
  id: 'primary';
}

class GaugeBaseDatabase extends Dexie {
  workspaces!: EntityTable<StoredWorkspace, 'id'>;

  constructor() {
    super('GaugeBase');
    this.version(1).stores({ workspaces: 'id' });
  }
}

const database = typeof window === 'undefined' ? null : new GaugeBaseDatabase();

export async function loadWorkspace() {
  if (!database) return undefined;
  const stored = await database.workspaces.get('primary');
  if (!stored) return undefined;
  const { id: _id, ...state } = stored;
  return state as AppState;
}

export async function saveWorkspace(state: AppState) {
  if (!database) return;
  await database.workspaces.put({ id: 'primary', ...state });
}

export async function clearWorkspace() {
  if (!database) return;
  await database.workspaces.delete('primary');
}
