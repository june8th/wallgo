import type { EnvMap } from '../types.js';
import {
  MemoryStore,
  getSharedMemoryStore,
  resetSharedMemoryStore,
} from './memory.js';
import {
  RedisNotConfiguredError,
  StorageBackendError,
  type CasResult,
  type StorageAdapter,
} from './types.js';
import { UnconfiguredStore } from './unconfigured.js';
import {
  CAS_UPDATE_ROOM_SCRIPT,
  CREATE_ROOM_NX_SCRIPT,
  SAVE_MATCH_ATOMIC_SCRIPT,
  UpstashRedisStore,
} from './upstash.js';

export type ResolvedStorageConfig =
  | { mode: 'unconfigured'; reason: 'forced' | 'vercel_missing_redis' }
  | { mode: 'redis'; source: 'upstash' | 'kv'; url: string; token: string }
  | { mode: 'memory'; reason: 'local_fallback' };

function readTrimmed(env: EnvMap, key: string): string {
  const val = env[key];
  return typeof val === 'string' ? val.trim() : '';
}

export function resolveStorageConfig(env: EnvMap = process.env): ResolvedStorageConfig {
  if (readTrimmed(env, 'WALLGO_FORCE_UNCONFIGURED') === '1') {
    return { mode: 'unconfigured', reason: 'forced' };
  }

  const upstashUrl = readTrimmed(env, 'UPSTASH_REDIS_REST_URL');
  const upstashToken = readTrimmed(env, 'UPSTASH_REDIS_REST_TOKEN');
  if (upstashUrl.length > 0 && upstashToken.length > 0) {
    return { mode: 'redis', source: 'upstash', url: upstashUrl, token: upstashToken };
  }

  const kvUrl = readTrimmed(env, 'KV_REST_API_URL');
  const kvToken = readTrimmed(env, 'KV_REST_API_TOKEN');
  if (kvUrl.length > 0 && kvToken.length > 0) {
    return { mode: 'redis', source: 'kv', url: kvUrl, token: kvToken };
  }

  const isVercel =
    readTrimmed(env, 'VERCEL') === '1' || readTrimmed(env, 'VERCEL_ENV').length > 0;
  if (isVercel) {
    return { mode: 'unconfigured', reason: 'vercel_missing_redis' };
  }

  return { mode: 'memory', reason: 'local_fallback' };
}

export interface CreateStoreOptions {
  fetchImpl?: typeof fetch;
  useSharedMemory?: boolean;
}

export function createStore(
  env: EnvMap = process.env,
  options: CreateStoreOptions = {},
): StorageAdapter {
  const resolved = resolveStorageConfig(env);
  if (resolved.mode === 'unconfigured') {
    return new UnconfiguredStore();
  }
  if (resolved.mode === 'redis') {
    return new UpstashRedisStore(resolved.url, resolved.token, options.fetchImpl);
  }
  return options.useSharedMemory === false ? new MemoryStore() : getSharedMemoryStore();
}

export function getStore(env: EnvMap = process.env): StorageAdapter {
  return createStore(env, { useSharedMemory: true });
}

export {
  CAS_UPDATE_ROOM_SCRIPT,
  CREATE_ROOM_NX_SCRIPT,
  MemoryStore,
  RedisNotConfiguredError,
  SAVE_MATCH_ATOMIC_SCRIPT,
  StorageBackendError,
  UnconfiguredStore,
  UpstashRedisStore,
  getSharedMemoryStore,
  resetSharedMemoryStore,
  type CasResult,
  type StorageAdapter,
};
