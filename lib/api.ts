export type ImageMode = "generate" | "edit";

export type ImageApiResponse = {
  created?: number;
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
    url?: string;
  }>;
};

export type GeneratePayload = {
  prompt: string;
  model?: string;
  size?: string;
  n?: number;
  response_format?: "b64_json";
};

export async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.detail?.error?.message ||
      data?.detail?.error ||
      data?.detail ||
      data?.error?.message ||
      data?.error ||
      data?.message ||
      `请求失败 (${response.status})`;
    throw new Error(String(message));
  }
  return data as T;
}

function authHeaders(authKey: string, extraHeaders?: HeadersInit): HeadersInit {
  return {
    Authorization: `Bearer ${authKey}`,
    ...(extraHeaders || {}),
  };
}

export async function generateImage(authKey: string, payload: GeneratePayload) {
  return requestJson<ImageApiResponse>("/api/images/generations", {
    method: "POST",
    headers: authHeaders(authKey, {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      prompt: payload.prompt,
      ...(payload.model ? { model: payload.model } : {}),
      ...(payload.size ? { size: payload.size } : {}),
      n: payload.n ?? 1,
      response_format: payload.response_format ?? "b64_json",
    }),
  });
}

export async function editImage(authKey: string, files: File[], payload: GeneratePayload) {
  const formData = new FormData();
  for (const file of files) {
    formData.append("image", file);
  }
  formData.append("prompt", payload.prompt);
  if (payload.model) formData.append("model", payload.model);
  if (payload.size) formData.append("size", payload.size);
  formData.append("n", String(payload.n ?? 1));

  return requestJson<ImageApiResponse>("/api/images/edits", {
    method: "POST",
    headers: authHeaders(authKey),
    body: formData,
  });
}
