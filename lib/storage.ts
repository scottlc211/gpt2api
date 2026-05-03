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

type AssetRecord = {
  id: string;
  value: string;
};

const STORAGE_KEY = "gpt-img:conversations";
const ACTIVE_KEY = "gpt-img:active-id";
const SIZE_KEY = "gpt-img:last-size";
const ASSET_DB_NAME = "gpt-img-assets";
const ASSET_STORE_NAME = "assets";
const MAX_CONVERSATIONS = 20;

export const storageKeys = { STORAGE_KEY, ACTIVE_KEY, SIZE_KEY };

function openAssetDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || typeof indexedDB === "undefined") return Promise.resolve(null);

  return new Promise((resolve) => {
    const request = indexedDB.open(ASSET_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(ASSET_STORE_NAME)) {
        db.createObjectStore(ASSET_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

async function putAsset(id: string, value: string) {
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

async function getAsset(id: string) {
  const db = await openAssetDb();
  if (!db) return undefined;

  return new Promise<string | undefined>((resolve) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readonly");
    const request = transaction.objectStore(ASSET_STORE_NAME).get(id);
    request.onsuccess = () => resolve((request.result as AssetRecord | undefined)?.value);
    request.onerror = () => resolve(undefined);
  });
}

async function listAssetIds() {
  const db = await openAssetDb();
  if (!db) return [] as string[];

  return new Promise<string[]>((resolve) => {
    const transaction = db.transaction(ASSET_STORE_NAME, "readonly");
    const store = transaction.objectStore(ASSET_STORE_NAME);
    const request = store.openCursor();
    const ids: string[] = [];

    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(ids);
        return;
      }
      ids.push(String(cursor.key));
      cursor.continue();
    };
    request.onerror = () => resolve(ids);
  });
}

async function deleteAssets(ids: string[]) {
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

function limitConversations(items: ImageConversation[]) {
  return sortConversations(items).slice(0, MAX_CONVERSATIONS);
}

function collectReferencedAssetIds(items: ImageConversation[]) {
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

async function pruneUnreferencedAssets(items: ImageConversation[]) {
  const referencedIds = collectReferencedAssetIds(items);
  const storedIds = await listAssetIds();
  const staleIds = storedIds.filter((id) => !referencedIds.has(id));
  await deleteAssets(staleIds);
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
              const assetId = image.assetId || `ref:${turn.id}:${index}:${image.name}`;
              if (image.dataUrl) {
                await putAsset(assetId, image.dataUrl);
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
              const assetId = image.assetId || `result:${turn.id}:${index}:${image.id}`;
              await putAsset(assetId, image.b64_json);
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
              dataUrl: image.dataUrl ?? (image.assetId ? await getAsset(image.assetId) : undefined),
            })),
          ),
          images: await Promise.all(
            turn.images.map(async (image) => ({
              ...image,
              b64_json: image.b64_json ?? (image.assetId ? await getAsset(image.assetId) : undefined),
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
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const items = raw ? (JSON.parse(raw) as ImageConversation[]) : [];
    const limitedItems = limitConversations(items);
    return hydrateConversationAssets(limitedItems);
  } catch {
    return [];
  }
}

export async function writeConversations(items: ImageConversation[]) {
  if (typeof window === "undefined") return;
  const serializableItems = await persistConversationAssets(limitConversations(items));
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(serializableItems));
  await pruneUnreferencedAssets(serializableItems);
}

export function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败"));
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
