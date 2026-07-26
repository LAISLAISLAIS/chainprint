/**
 * Persist the Analyze workspace (library + dry stems) in IndexedDB
 * so leaving the page doesn’t wipe references / chains.
 */

const DB_NAME = "chainprint.analyze.v1";
const DB_VERSION = 1;
const STORE = "workspace";

/**
 * @param {string | null | undefined} userId
 */
export function workspaceKey(userId) {
  return userId ? `user:${userId}` : "guest";
}

/**
 * @returns {Promise<IDBDatabase>}
 */
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

/**
 * @param {string} key
 * @returns {Promise<object | null>}
 */
export async function loadWorkspace(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(key);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result || null);
    });
  } catch (err) {
    console.warn("[chainprint] workspace load failed", err);
    return null;
  }
}

/**
 * @param {string} key
 * @param {object} data
 */
export async function saveWorkspace(key, data) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put({ ...data, savedAt: new Date().toISOString() }, key);
    });
  } catch (err) {
    console.warn("[chainprint] workspace save failed", err);
    if (err?.name === "QuotaExceededError") {
      console.warn("[chainprint] IndexedDB quota exceeded — clear old references to free space.");
    }
  }
}

/**
 * @param {string} key
 */
export async function clearWorkspace(key) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(key);
    });
  } catch (err) {
    console.warn("[chainprint] workspace clear failed", err);
  }
}

/**
 * @param {Blob | File | null | undefined} blob
 * @param {string} [name]
 * @param {string} [type]
 * @returns {File | null}
 */
export function toFile(blob, name = "audio", type = "") {
  if (!blob) return null;
  if (blob instanceof File) return blob;
  return new File([blob], name || "audio", {
    type: type || blob.type || "application/octet-stream",
  });
}

/**
 * @param {import('./library.js').LibraryEntry} entry
 */
export function serializeEntry(entry) {
  /** @type {object | null} */
  let source = null;
  if (entry.source?.kind === "url") {
    source = {
      kind: "url",
      url: entry.source.url,
      manualQuery: entry.source.manualQuery || null,
    };
  } else if (entry.source?.kind === "file" && entry.source.file) {
    source = {
      kind: "file",
      name: entry.source.file.name || entry.name || "reference",
      type: entry.source.file.type || "",
      blob: entry.source.file,
    };
  } else if (entry.source?.kind === "blend") {
    source = { kind: "blend" };
  }

  /** @type {object | null} */
  let audioFile = null;
  if (entry.audioFile instanceof Blob) {
    audioFile = {
      name: entry.audioFile instanceof File ? entry.audioFile.name : entry.name || "audio",
      type: entry.audioFile.type || "",
      blob: entry.audioFile,
    };
  }

  return {
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    artwork: entry.artwork ?? null,
    meta: entry.meta ?? null,
    result: entry.result ?? null,
    blendOf: entry.blendOf || null,
    weight: entry.weight ?? null,
    createdAt: entry.createdAt,
    source,
    audioFile,
  };
}

/**
 * @param {ReturnType<typeof serializeEntry>} raw
 */
export function deserializeEntry(raw) {
  if (!raw?.id) return null;

  /** @type {import('./library.js').LibraryEntry['source']} */
  let source = null;
  if (raw.source?.kind === "url") {
    source = {
      kind: "url",
      url: raw.source.url,
      manualQuery: raw.source.manualQuery || undefined,
    };
  } else if (raw.source?.kind === "file") {
    const file = toFile(raw.source.blob, raw.source.name, raw.source.type);
    source = file ? { kind: "file", file } : null;
  } else if (raw.source?.kind === "blend") {
    source = { kind: "blend" };
  }

  const audioFile = raw.audioFile?.blob
    ? toFile(raw.audioFile.blob, raw.audioFile.name, raw.audioFile.type)
    : null;

  return {
    id: raw.id,
    kind: raw.kind === "blend" ? "blend" : "track",
    name: raw.name || "Reference",
    artwork: raw.artwork ?? null,
    meta: raw.meta ?? null,
    source,
    audioFile,
    result: raw.result ?? null,
    blendOf: Array.isArray(raw.blendOf) ? raw.blendOf : undefined,
    weight: raw.weight ?? undefined,
    createdAt: raw.createdAt || new Date().toISOString(),
  };
}

/**
 * @param {{ name?: string, type?: string, blob?: Blob } | null | undefined} raw
 * @returns {File | null}
 */
export function deserializeStem(raw) {
  if (!raw?.blob) return null;
  return toFile(raw.blob, raw.name, raw.type);
}

/**
 * @param {File | null | undefined} file
 */
export function serializeStem(file) {
  if (!(file instanceof Blob)) return null;
  return {
    name: file instanceof File ? file.name : "dry",
    type: file.type || "",
    blob: file,
  };
}
