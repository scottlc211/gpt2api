export type AssetRecord = {
  id: string;
  value: string;
};

export type StoredReferenceImage = {
  name: string;
  type: string;
  dataUrl?: string;
  assetId?: string;
};

export type StoredResultImage = {
  id: string;
  status: "loading" | "success" | "error";
  b64_json?: string;
  assetId?: string;
  error?: string;
};

export type ImageTurn = {
  id: string;
  prompt: string;
  mode: "generate" | "edit";
  count: number;
  size: string;
  model: string;
  createdAt: string;
  referenceImages: StoredReferenceImage[];
  images: StoredResultImage[];
  status: "queued" | "generating" | "success" | "error";
  error?: string;
};

export type ImageConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ImageTurn[];
};

const CHAT_STORAGE_KEY = "gpt-img:conversations";
const ACTIVE_KEY = "gpt-img:active-id";
const SIZE_KEY = "gpt-img:last-size";
const ASSET_DB_NAME = "gpt-img-assets";
const ASSET_STORE_NAME = "assets";
const MAX_CONVERSATIONS = 20;
const CHAT_ASSET_PREFIXES = ["chat:ref:", "chat:result:"];
const PRODUCT_ASSET_PREFIXES = ["reference:", "result:"];

export const storageKeys = {
  STORAGE_KEY: CHAT_STORAGE_KEY,
  ACTIVE_KEY,
  SIZE_KEY,
};

async function openAssetDb() {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return null;

  return new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(ASSET_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        db.createObjectStore(ASSET_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function writeAsset(id: string, value: string) {
  const db = await openAssetDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readwrite");
    transaction.objectStore(ASSET_STORE_NAME).put({ id, value } satisfies AssetRecord);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

export async function readAsset(id: string) {
  const db = await openAssetDb();
  if (!db) return undefined;

  return new Promise<string | undefined>((resolve) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readonly");
    const request = transaction.objectStore(ASSET_STORE_NAME).get(id);
    request.onsuccess = () => resolve((request.result as AssetRecord | undefined)?.value);
    request.onerror = () => resolve(undefined);
  });
}

export async function deleteAssets(ids: string[]) {
  if (ids.length === 0) return;
  const db = await openAssetDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readwrite");
    const store = transaction.objectStore(ASSET_STORE_NAME);
    for (const id of ids) store.delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => resolve();
    transaction.onabort = () => resolve();
  });
}

async function listAssetIds() {
  const db = await openAssetDb();
  if (!db) return [] as string[];

  return new Promise<string[]>((resolve) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readonly");
    const store = transaction.objectStore(ASSET_STORE_NAME);
    const keysRequest = store.getAllKeys();
    keysRequest.onsuccess = () => resolve((keysRequest.result as string[]) || []);
    keysRequest.onerror = () => resolve([]);
  });
}

export async function pruneAssets(activeIds: Iterable<string>, options?: { prefixes?: string[] }) {
  const activeSet = new Set(activeIds);
  const existingIds = await listAssetIds();
  const prefixes = options?.prefixes || [];
  const staleIds = existingIds.filter((id) => {
    if (prefixes.length > 0 && !prefixes.some((prefix) => id.startsWith(prefix))) {
      return false;
    }
    return !activeSet.has(id);
  });
  await deleteAssets(staleIds);
}

function limitConversations(items: ImageConversation[]) {
  return sortConversations(items).slice(0, MAX_CONVERSATIONS);
}

function collectConversationAssetIds(items: ImageConversation[]) {
  const ids = new Set<string>();

  for (const conversation of items) {
    for (const turn of conversation.turns) {
      for (const image of turn.referenceImages) {
        if (image.assetId) ids.add(image.assetId);
      }
      for (const image of turn.images) {
        if (image.assetId) ids.add(image.assetId);
      }
    }
  }

  return ids;
}

async function persistConversationAssets(items: ImageConversation[]) {
  return Promise.all(
    items.map(async (conversation) => ({
      ...conversation,
      turns: await Promise.all(
        conversation.turns.map(async (turn) => ({
          ...turn,
          referenceImages: await Promise.all(
            turn.referenceImages.map(async (image, index) => {
              const assetId = image.assetId || `chat:ref:${turn.id}:${index}:${image.name}`;
              if (image.dataUrl) {
                await writeAsset(assetId, image.dataUrl);
              }
              return {
                name: image.name,
                type: image.type,
                assetId,
              } satisfies StoredReferenceImage;
            }),
          ),
          images: await Promise.all(
            turn.images.map(async (image, index) => {
              if (image.status !== "success" || !image.b64_json) {
                return image;
              }
              const assetId = image.assetId || `chat:result:${turn.id}:${index}:${image.id}`;
              await writeAsset(assetId, image.b64_json);
              return {
                id: image.id,
                status: image.status,
                assetId,
              } satisfies StoredResultImage;
            }),
          ),
        })),
      ),
    })),
  );
}

async function hydrateConversationAssets(items: ImageConversation[]) {
  return Promise.all(
    items.map(async (conversation) => ({
      ...conversation,
      turns: await Promise.all(
        conversation.turns.map(async (turn) => ({
          ...turn,
          referenceImages: await Promise.all(
            turn.referenceImages.map(async (image) => ({
              ...image,
              dataUrl: image.dataUrl ?? (image.assetId ? await readAsset(image.assetId) : undefined),
            })),
          ),
          images: await Promise.all(
            turn.images.map(async (image) => ({
              ...image,
              b64_json: image.b64_json ?? (image.assetId ? await readAsset(image.assetId) : undefined),
            })),
          ),
        })),
      ),
    })),
  );
}

export async function readConversations(): Promise<ImageConversation[]> {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    const items = raw ? (JSON.parse(raw) as ImageConversation[]) : [];
    return hydrateConversationAssets(limitConversations(items));
  } catch {
    return [];
  }
}

export async function writeConversations(items: ImageConversation[]) {
  if (typeof window === "undefined") return;
  const serializableItems = await persistConversationAssets(limitConversations(items));
  window.localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(serializableItems));
  await pruneAssets(collectConversationAssetIds(serializableItems), { prefixes: CHAT_ASSET_PREFIXES });
}

export function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("??????"));
    reader.readAsDataURL(file);
  });
}

export function dataUrlToFile(dataUrl: string, fileName: string, mimeType?: string) {
  const [header, content] = dataUrl.split(",", 2);
  const matchedMimeType = header.match(/data:(.*?);base64/)?.[1];
  const binary = atob(content || "");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], fileName, { type: mimeType || matchedMimeType || "image/png" });
}

export function sortConversations(items: ImageConversation[]) {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  if (typeof window === "undefined") return;
  const anchor = window.document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.click();
}

export const assetScopes = {
  chatPrefixes: CHAT_ASSET_PREFIXES,
  productPrefixes: PRODUCT_ASSET_PREFIXES,
};
