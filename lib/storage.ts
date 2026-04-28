export type StoredReferenceImage = {
  name: string;
  type: string;
  dataUrl: string;
};

export type StoredResultImage = {
  id: string;
  status: "loading" | "success" | "error";
  b64_json?: string;
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

const STORAGE_KEY = "gpt-img:conversations";
const ACTIVE_KEY = "gpt-img:active-id";
const PROXY_AUTH_STORAGE_KEY = "gpt-img:auth-key";
const SIZE_KEY = "gpt-img:last-size";

export const storageKeys = { STORAGE_KEY, ACTIVE_KEY, AUTH_KEY: PROXY_AUTH_STORAGE_KEY, SIZE_KEY };

export function readConversations(): ImageConversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ImageConversation[]) : [];
  } catch {
    return [];
  }
}

export function writeConversations(items: ImageConversation[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
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
