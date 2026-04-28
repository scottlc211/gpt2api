"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { editImage, generateImage } from "@/lib/api";
import {
  dataUrlToFile,
  makeId,
  readAsDataUrl,
  readConversations,
  sortConversations,
  storageKeys,
  type ImageConversation,
  type ImageTurn,
  type StoredReferenceImage,
  writeConversations,
} from "@/lib/storage";

const sizeOptions = ["", "1:1", "16:9", "4:3", "3:4", "9:16"];

function buildTitle(prompt: string) {
  return prompt.trim().length <= 18 ? prompt.trim() : `${prompt.trim().slice(0, 18)}...`;
}

function formatTime(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function Page() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [authKey, setAuthKey] = useState("");
  const [mode, setMode] = useState<"generate" | "edit">("generate");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState("1");
  const [size, setSize] = useState("");
  const [referenceImages, setReferenceImages] = useState<StoredReferenceImage[]>([]);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>("");

  const parsedCount = useMemo(() => Math.max(1, Math.min(10, Number(count) || 1)), [count]);
  const selectedConversation = useMemo(() => conversations.find((item) => item.id === selectedId) ?? null, [conversations, selectedId]);

  useEffect(() => {
    const items = readConversations();
    setConversations(items);
    setSelectedId(window.localStorage.getItem(storageKeys.ACTIVE_KEY) || items[0]?.id || null);
    setAuthKey(window.localStorage.getItem(storageKeys.AUTH_KEY) || "");
    setSize(window.localStorage.getItem(storageKeys.SIZE_KEY) || "");
  }, []);

  useEffect(() => {
    writeConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    if (authKey) window.localStorage.setItem(storageKeys.AUTH_KEY, authKey);
    else window.localStorage.removeItem(storageKeys.AUTH_KEY);
  }, [authKey]);

  useEffect(() => {
    if (selectedId) window.localStorage.setItem(storageKeys.ACTIVE_KEY, selectedId);
    else window.localStorage.removeItem(storageKeys.ACTIVE_KEY);
  }, [selectedId]);

  useEffect(() => {
    if (size) window.localStorage.setItem(storageKeys.SIZE_KEY, size);
    else window.localStorage.removeItem(storageKeys.SIZE_KEY);
  }, [size]);

  async function appendFiles(files: File[]) {
    const next = await Promise.all(files.map(async (file) => ({ name: file.name, type: file.type || "image/png", dataUrl: await readAsDataUrl(file) })));
    setReferenceImages((current) => [...current, ...next]);
    setMode("edit");
  }

  function updateConversation(nextConversation: ImageConversation) {
    setConversations((current) => sortConversations([nextConversation, ...current.filter((item) => item.id !== nextConversation.id)]));
  }

  async function handleSubmit() {
    setError("");
    const trimmedAuthKey = authKey.trim();
    const trimmedPrompt = prompt.trim();
    if (!trimmedAuthKey) {
      setError("请输入 auth-key");
      return;
    }
    if (!trimmedPrompt) {
      setError("请输入提示词");
      return;
    }
    if (mode === "edit" && referenceImages.length === 0) {
      setError("图生图至少要有一张参考图");
      return;
    }

    const now = new Date().toISOString();
    const turnId = makeId();
    const conversationId = selectedConversation?.id || makeId();
    const turn: ImageTurn = {
      id: turnId,
      prompt: trimmedPrompt,
      mode,
      count: parsedCount,
      size,
      model: "gpt-image-2",
      createdAt: now,
      referenceImages: mode === "edit" ? referenceImages : [],
      images: Array.from({ length: parsedCount }, (_, index) => ({ id: `${turnId}-${index}`, status: "loading" as const })),
      status: "queued",
    };

    const draftConversation: ImageConversation = selectedConversation
      ? { ...selectedConversation, updatedAt: now, turns: [...selectedConversation.turns, turn] }
      : { id: conversationId, title: buildTitle(trimmedPrompt), createdAt: now, updatedAt: now, turns: [turn] };

    setSelectedId(conversationId);
    updateConversation(draftConversation);
    setPrompt("");
    setCount("1");
    setSubmitting(true);
    try {
      const files = referenceImages.map((image, index) => dataUrlToFile(image.dataUrl, image.name || `reference-${index + 1}.png`, image.type));
      const tasks = Array.from({ length: parsedCount }, async (_, index) => {
        const response =
          mode === "edit"
            ? await editImage(trimmedAuthKey, files, { prompt: trimmedPrompt, model: "gpt-image-2", size, n: 1 })
            : await generateImage(trimmedAuthKey, { prompt: trimmedPrompt, model: "gpt-image-2", size, n: 1, response_format: "b64_json" });
        const first = response.data?.[0];
        if (!first?.b64_json) throw new Error("接口没有返回 b64_json");
        return { id: `${turnId}-${index}`, status: "success" as const, b64_json: first.b64_json };
      });
      const settled = await Promise.allSettled(tasks);
      const successImages = settled.map((item, index) =>
        item.status === "fulfilled"
          ? item.value
          : { id: `${turnId}-${index}`, status: "error" as const, error: item.reason instanceof Error ? item.reason.message : "生成失败" },
      );
      const failedCount = successImages.filter((item) => item.status === "error").length;
      const nextConversation: ImageConversation = {
        ...draftConversation,
        updatedAt: new Date().toISOString(),
        turns: draftConversation.turns.map((item) =>
          item.id === turnId
            ? { ...item, status: failedCount > 0 ? "error" : "success", error: failedCount > 0 ? `其中 ${failedCount} 张生成失败` : undefined, images: successImages }
            : item,
        ),
      };
      updateConversation(nextConversation);
      if (mode === "edit") {
        setReferenceImages([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "提交失败";
      const failedConversation: ImageConversation = {
        ...draftConversation,
        updatedAt: new Date().toISOString(),
        turns: draftConversation.turns.map((item) =>
          item.id === turnId
            ? {
                ...item,
                status: "error",
                error: message,
                images: item.images.map((image) => ({ ...image, status: "error", error: message })),
              }
            : item,
        ),
      };
      updateConversation(failedConversation);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, minHeight: "100vh", padding: 16 }}>
      <aside style={{ background: "white", border: "1px solid #e7e5e4", borderRadius: 24, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>历史会话</h2>
          <button onClick={() => { setSelectedId(null); setPrompt(""); setReferenceImages([]); setMode("generate"); }} style={buttonStyle}>新建</button>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          {conversations.length === 0 ? <div style={{ color: "#78716c", fontSize: 14 }}>还没有记录</div> : null}
          {conversations.map((conversation) => (
            <button
              key={conversation.id}
              onClick={() => setSelectedId(conversation.id)}
              style={{
                ...cardButtonStyle,
                borderColor: selectedId === conversation.id ? "#1c1917" : "#e7e5e4",
                background: selectedId === conversation.id ? "#fafaf9" : "white",
              }}
            >
              <div style={{ fontWeight: 600, textAlign: "left" }}>{conversation.title}</div>
              <div style={{ fontSize: 12, color: "#78716c", marginTop: 4 }}>{formatTime(conversation.updatedAt)}</div>
            </button>
          ))}
        </div>
      </aside>

      <section style={{ display: "grid", gridTemplateRows: "1fr auto", gap: 16 }}>
        <div style={{ background: "white", border: "1px solid #e7e5e4", borderRadius: 24, padding: 20, overflow: "auto" }}>
          {!selectedConversation ? <div style={{ color: "#57534e" }}>Turn ideas into images。左边会保留本地历史。</div> : null}
          <div style={{ display: "grid", gap: 24 }}>
            {selectedConversation?.turns.map((turn, turnIndex) => (
              <div key={turn.id} style={{ borderTop: turnIndex === 0 ? "none" : "1px solid #f5f5f4", paddingTop: turnIndex === 0 ? 0 : 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{turn.mode === "edit" ? "图生图" : "文生图"}</div>
                    <div style={{ fontSize: 12, color: "#78716c" }}>{formatTime(turn.createdAt)} · 第 {turnIndex + 1} 轮 · {turn.count} 张</div>
                  </div>
                  <div style={{ fontSize: 12, color: turn.status === "error" ? "#b91c1c" : "#78716c" }}>{turn.status}</div>
                </div>
                <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{turn.prompt}</p>
                {turn.referenceImages.length > 0 ? (
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                    {turn.referenceImages.map((image, index) => (
                      <img key={`${turn.id}-${index}`} src={image.dataUrl} alt={image.name} style={{ width: 96, height: 96, objectFit: "cover", borderRadius: 16, border: "1px solid #e7e5e4" }} />
                    ))}
                  </div>
                ) : null}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 16 }}>
                  {turn.images.map((image) => (
                    <div key={image.id} style={{ border: "1px solid #e7e5e4", borderRadius: 20, overflow: "hidden", background: "#fafaf9" }}>
                      {image.status === "success" && image.b64_json ? (
                        <img src={`data:image/png;base64,${image.b64_json}`} alt={image.id} />
                      ) : (
                        <div style={{ minHeight: 220, display: "grid", placeItems: "center", padding: 16, color: image.status === "error" ? "#b91c1c" : "#78716c", textAlign: "center" }}>
                          {image.status === "loading" ? "处理中..." : image.error || "生成失败"}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {turn.error ? <div style={{ marginTop: 12, color: "#b91c1c", fontSize: 14 }}>{turn.error}</div> : null}
              </div>
            ))}
          </div>
        </div>

        <div style={{ background: "white", border: "1px solid #e7e5e4", borderRadius: 24, padding: 20 }}>
          <div style={{ display: "grid", gap: 12 }}>
            <label style={labelStyle}>
              Auth Key
              <input value={authKey} onChange={(event) => setAuthKey(event.target.value)} style={inputStyle} placeholder="输入部署时配置的 AUTH_KEY" />
            </label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={mode === "edit" ? "描述你要如何修改参考图" : "输入想生成的画面"}
              style={{ ...inputStyle, minHeight: 140, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button onClick={() => setMode("generate")} style={{ ...buttonStyle, background: mode === "generate" ? "#1c1917" : "white", color: mode === "generate" ? "white" : "#1c1917" }}>文生图</button>
              <button onClick={() => setMode("edit")} style={{ ...buttonStyle, background: mode === "edit" ? "#1c1917" : "white", color: mode === "edit" ? "white" : "#1c1917" }}>图生图</button>
              <label style={labelInlineStyle}>
                张数
                <input value={count} onChange={(event) => setCount(event.target.value)} type="number" min={1} max={10} style={{ ...inputStyle, width: 72 }} />
              </label>
              <label style={labelInlineStyle}>
                比例
                <select value={size} onChange={(event) => setSize(event.target.value)} style={{ ...inputStyle, width: 120 }}>
                  {sizeOptions.map((option) => <option key={option || "default"} value={option}>{option || "未指定"}</option>)}
                </select>
              </label>
              <button onClick={() => fileInputRef.current?.click()} style={buttonStyle}>上传参考图</button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*"
                hidden
                onChange={async (event) => {
                  const files = Array.from(event.target.files || []);
                  if (files.length > 0) await appendFiles(files);
                }}
              />
            </div>
            {referenceImages.length > 0 ? (
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                {referenceImages.map((image, index) => (
                  <div key={`${image.name}-${index}`} style={{ position: "relative" }}>
                    <img src={image.dataUrl} alt={image.name} style={{ width: 80, height: 80, objectFit: "cover", borderRadius: 14, border: "1px solid #e7e5e4" }} />
                    <button
                      onClick={() => setReferenceImages((current) => current.filter((_, currentIndex) => currentIndex != index))}
                      style={{ ...dangerButtonStyle, position: "absolute", top: -8, right: -8 }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            {error ? <div style={{ color: "#b91c1c", fontSize: 14 }}>{error}</div> : null}
            <button onClick={handleSubmit} disabled={submitting} style={{ ...buttonStyle, background: "#1c1917", color: "white", opacity: submitting ? 0.7 : 1 }}>
              {submitting ? "提交中..." : "开始生成"}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  border: "1px solid #d6d3d1",
  borderRadius: 14,
  padding: "12px 14px",
  background: "white",
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  fontSize: 14,
  color: "#44403c",
};

const labelInlineStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 14,
  color: "#44403c",
};

const buttonStyle: React.CSSProperties = {
  border: "1px solid #d6d3d1",
  borderRadius: 999,
  padding: "10px 16px",
  background: "white",
  cursor: "pointer",
};

const dangerButtonStyle: React.CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 999,
  border: "1px solid #d6d3d1",
  background: "white",
  cursor: "pointer",
};

const cardButtonStyle: React.CSSProperties = {
  border: "1px solid #e7e5e4",
  borderRadius: 18,
  padding: 12,
  background: "white",
  cursor: "pointer",
};
