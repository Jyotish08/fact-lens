import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { CustomSource, Session } from "./types";

export interface StoredAsset {
  id: string;
  sessionId: string;
  role: "media" | "corpus";
  file: File;
  source?: CustomSource | undefined;
}

export interface CorpusChunkRecord {
  id: string;
  sessionId: string;
  sourceId: string;
  sourceName: string;
  provenance: string;
  text: string;
  vector: number[];
}

interface VoiceClaimDb extends DBSchema {
  assets: {
    key: string;
    value: StoredAsset;
    indexes: { bySession: string };
  };
  chunks: {
    key: string;
    value: CorpusChunkRecord;
    indexes: { bySession: string };
  };
  history: {
    key: string;
    value: Session;
    indexes: { byStartedAt: string };
  };
}

let database: Promise<IDBPDatabase<VoiceClaimDb>> | undefined;

function db() {
  database ??= openDB<VoiceClaimDb>("voiceclaim-auditor", 2, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("assets")) {
        database
          .createObjectStore("assets", { keyPath: "id" })
          .createIndex("bySession", "sessionId");
      }
      if (!database.objectStoreNames.contains("chunks")) {
        database
          .createObjectStore("chunks", { keyPath: "id" })
          .createIndex("bySession", "sessionId");
      }
      if (!database.objectStoreNames.contains("history")) {
        database
          .createObjectStore("history", { keyPath: "id" })
          .createIndex("byStartedAt", "startedAt");
      }
    },
  });
  return database;
}

export const assetRepository = {
  async storeMedia(sessionId: string, file: File) {
    const asset: StoredAsset = {
      id: `${sessionId}:media:${crypto.randomUUID()}`,
      sessionId,
      role: "media",
      file,
    };
    await (await db()).put("assets", asset);
    return asset.id;
  },

  async storeCorpus(sessionId: string, files: File[]) {
    validateCorpusFiles(files);
    const assets: StoredAsset[] = files.map((file) => {
      const kind = extension(file.name) as CustomSource["kind"];
      return {
        id: `${sessionId}:corpus:${crypto.randomUUID()}`,
        sessionId,
        role: "corpus",
        file,
        source: {
          id: crypto.randomUUID(),
          name: file.name,
          kind,
          sizeBytes: file.size,
          parserStatus: "stored",
          chunkCount: 0,
        },
      };
    });
    const database = await db();
    const transaction = database.transaction("assets", "readwrite");
    await Promise.all([...assets.map((asset) => transaction.store.put(asset)), transaction.done]);
    return assets;
  },

  async get(id: string) {
    return (await db()).get("assets", id);
  },

  async list(sessionId: string, role?: StoredAsset["role"]) {
    const assets = await (await db()).getAllFromIndex("assets", "bySession", sessionId);
    return role ? assets.filter((asset) => asset.role === role) : assets;
  },

  async updateSource(assetId: string, patch: Partial<CustomSource>) {
    const database = await db();
    const asset = await database.get("assets", assetId);
    if (!asset?.source) return;
    asset.source = { ...asset.source, ...patch };
    await database.put("assets", asset);
  },

  async deleteSession(sessionId: string) {
    const database = await db();
    const transaction = database.transaction(["assets", "chunks"], "readwrite");
    const assets = await transaction.objectStore("assets").index("bySession").getAllKeys(sessionId);
    const chunks = await transaction.objectStore("chunks").index("bySession").getAllKeys(sessionId);
    assets.forEach((key) => void transaction.objectStore("assets").delete(key));
    chunks.forEach((key) => void transaction.objectStore("chunks").delete(key));
    await transaction.done;
  },
};

export const chunkRepository = {
  async replace(sessionId: string, chunks: CorpusChunkRecord[]) {
    const database = await db();
    const transaction = database.transaction("chunks", "readwrite");
    const existing = await transaction.store.index("bySession").getAllKeys(sessionId);
    existing.forEach((key) => void transaction.store.delete(key));
    chunks.forEach((chunk) => void transaction.store.put(chunk));
    await transaction.done;
  },
  async list(sessionId: string) {
    return (await db()).getAllFromIndex("chunks", "bySession", sessionId);
  },
};

export const historyRepository = {
  async list() {
    const sessions = await (await db()).getAll("history");
    return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  },
  async get(id: string) {
    return (await db()).get("history", id);
  },
  async save(session: Session) {
    await (await db()).put("history", session);
  },
  async remove(id: string) {
    await (await db()).delete("history", id);
  },
  async clear() {
    await (await db()).clear("history");
  },
};

function extension(name: string) {
  return name.split(".").at(-1)?.toLowerCase() ?? "";
}

function validateCorpusFiles(files: File[]) {
  if (files.length > 5) throw new Error("You can add at most five evidence files.");
  if (files.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) {
    throw new Error("Evidence files exceed the 25 MB session limit.");
  }
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) throw new Error(`${file.name} exceeds 10 MB.`);
    const ext = extension(file.name);
    if (!(["pdf", "txt", "csv"] as string[]).includes(ext))
      throw new Error(`${file.name} is not PDF, TXT, or CSV.`);
    const allowedMime =
      ext === "pdf"
        ? ["application/pdf"]
        : ext === "csv"
          ? ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel"]
          : ["text/plain"];
    if (file.type && !allowedMime.includes(file.type))
      throw new Error(`${file.name} has an unexpected MIME type.`);
  }
}
