export {
  getBrowserStorage,
  isQuotaExceededError,
  safeGetItem,
  safeRemoveItem,
  safeSetItem,
} from './safeStorage';
export type { SafeSetItemResult } from './safeStorage';

export {
  generateClientId,
  getOrCreateProfile,
  getRoomSession,
  getSavedNickname,
  getSavedProfile,
  listRoomSessions,
  removeRoomSession,
  saveProfileNickname,
  saveRoomSession,
} from './profile';
export type { RoomSessionListEntry } from './profile';

export {
  buildLocalMatchRecord,
  commitLocalSessionTurn,
  createLocalGameSession,
  generateLocalMatchId,
  isValidLocalMatchRecord,
  loadLocalMatches,
  readLocalMatchesSafe,
  redoLocalSession,
  undoLocalSession,
  updateLocalSessionTransient,
  upsertLocalMatch,
} from './localHistory';
export type {
  BuildLocalMatchRecordParams,
  LocalGameSession,
  LocalReplayHistory,
  ReadLocalMatchesResult,
} from './localHistory';
