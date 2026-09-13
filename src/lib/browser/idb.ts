/**
 * A minimal promise-based key/value store on IndexedDB. Falls back to memory
 * when IndexedDB is unavailable (private windows, locked-down browsers), so
 * callers never need to branch.
 */

const DB_NAME = "maeosan";
const DB_VERSION = 1;
const STORE = "kv";

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, unknown>();

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  dbPromise ??= new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return openDatabase().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) return resolve(undefined);
        try {
          const request = operation(db.transaction(STORE, mode).objectStore(STORE));
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(undefined);
        } catch {
          resolve(undefined);
        }
      }),
  );
}

export const kv = {
  async get<T>(key: string): Promise<T | undefined> {
    const db = await openDatabase();
    if (!db) return memory.get(key) as T | undefined;
    return run<T>("readonly", (store) => store.get(key) as IDBRequest<T>);
  },

  async set(key: string, value: unknown): Promise<void> {
    const db = await openDatabase();
    if (!db) {
      memory.set(key, value);
      return;
    }
    await run("readwrite", (store) => store.put(value, key));
  },

  async delete(key: string): Promise<void> {
    const db = await openDatabase();
    if (!db) {
      memory.delete(key);
      return;
    }
    await run("readwrite", (store) => store.delete(key));
  },
};
