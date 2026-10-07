import type { Session, SessionSettings } from "./types";
import { historyRepository } from "./storage";

const HISTORY_KEY = "voiceclaim.history.v1";
const SETTINGS_KEY = "voiceclaim.settings.v1";
const LAUNCH_KEY = "voiceclaim.launch.v1";

export const DEFAULT_SETTINGS: SessionSettings = {
  mode: "investor",
  depth: "quick",
  intervalPreset: "balanced",
  sourceCount: 3,
  concurrency: 2,
};

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode — history is best-effort */
  }
}

function writeSession(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(key, JSON.stringify(value));
}

/**
 * Local-only persistence. Swap this implementation for a cloud-backed one
 * without touching callers.
 */
export interface HistoryRepository {
  list(): Promise<Session[]>;
  get(id: string): Promise<Session | undefined>;
  save(session: Session): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

let migration: Promise<void> | undefined;

async function migrateHistory() {
  if (typeof window === "undefined") return;
  const previous = read<Session[]>(HISTORY_KEY, []);
  if (!previous.length) return;
  await Promise.all(previous.map((session) => historyRepository.save(session)));
  window.localStorage.removeItem(HISTORY_KEY);
}

function ensureMigration() {
  migration ??= migrateHistory();
  return migration;
}

export const localHistory: HistoryRepository = {
  list: async () => {
    await ensureMigration();
    return historyRepository.list();
  },
  get: async (id) => {
    await ensureMigration();
    return historyRepository.get(id);
  },
  save: async (session) => {
    await ensureMigration();
    await historyRepository.save(session);
    const sessions = await historyRepository.list();
    await Promise.all(sessions.slice(40).map((item) => historyRepository.remove(item.id)));
  },
  remove: async (id) => historyRepository.remove(id),
  clear: async () => historyRepository.clear(),
};

export function loadSettings(): SessionSettings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<SessionSettings>>(SETTINGS_KEY, {}) };
}

export function saveSettings(settings: SessionSettings) {
  write(SETTINGS_KEY, settings);
}

export interface LaunchConfig {
  sessionId: string;
  title: string;
  source: Session["source"];
  scenarioId: string;
  settings: SessionSettings;
  speed: number;
  serviceMode: "live" | "mock";
  sessionToken: string;
  mediaAssetId?: string | undefined;
  customAssetIds: string[];
}

export function stashLaunch(config: LaunchConfig) {
  writeSession(LAUNCH_KEY, config);
}

export function takeLaunch(sessionId: string): LaunchConfig | undefined {
  if (typeof window === "undefined") return undefined;
  let config: LaunchConfig | null;
  try {
    const raw = window.sessionStorage.getItem(LAUNCH_KEY);
    config = raw ? (JSON.parse(raw) as LaunchConfig) : null;
  } catch {
    return undefined;
  }
  return config?.sessionId === sessionId ? config : undefined;
}
