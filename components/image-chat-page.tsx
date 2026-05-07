"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AppTabs } from "@/components/app-tabs";
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
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function ImageChatPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatThreadRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"generate" | "edit">("generate");
  const [prompt, setPrompt] = useState("");
  const [count, setCount] = useState("1");
  const [size, setSize] = useState("");
  const [referenceImages, setReferenceImages] = useState<StoredReferenceImage[]>([]);
  const [conversations, setConversations] = useState<ImageConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  const parsedCount = useMemo(() => Math.max(1, Math.min(10, Number(count) || 1)), [count]);
  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const items = await readConversations();
      if (cancelled) return;

      const storedSelectedId = window.localStorage.getItem(storageKeys.ACTIVE_KEY);
      const nextSelectedId = items.some((item) => item.id === storedSelectedId) ? storedSelectedId : items[0]?.id || null;

      setConversations(items);
      setSelectedId(nextSelectedId);
      setSize(window.localStorage.getItem(storageKeys.SIZE_KEY) || "");
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void writeConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    if (selectedId) window.localStorage.setItem(storageKeys.ACTIVE_KEY, selectedId);
    else window.localStorage.removeItem(storageKeys.ACTIVE_KEY);
  }, [selectedId]);

  useEffect(() => {
    if (size) window.localStorage.setItem(storageKeys.SIZE_KEY, size);
    else window.localStorage.removeItem(storageKeys.SIZE_KEY);
  }, [size]);

  useEffect(() => {
    if (!selectedConversation) return;

    const frameId = window.requestAnimationFrame(() => {
      const container = chatThreadRef.current;
      if (!container) return;
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [selectedConversation]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (previewImage) setPreviewImage(null);
      if (historyDrawerOpen) setHistoryDrawerOpen(false);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [historyDrawerOpen, previewImage]);

  async function appendFiles(files: File[]) {
    const next = await Promise.all(
      files.map(async (file) => ({
        name: file.name,
        type: file.type || "image/png",
        dataUrl: await readAsDataUrl(file),
      })),
    );
    setReferenceImages((current) => [...current, ...next]);
    setMode("edit");
  }

  function updateConversation(nextConversation: ImageConversation) {
    setConversations((current) =>
      sortConversations([nextConversation, ...current.filter((item) => item.id !== nextConversation.id)]),
    );
  }

  function resetComposer() {
    setPrompt("");
    setReferenceImages([]);
    setMode("generate");
    setError("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function openPreview(src: string, alt: string) {
    setPreviewImage({ src, alt });
  }

  function selectConversation(id: string) {
    setSelectedId(id);
    setHistoryDrawerOpen(false);
  }

  function deleteConversation(id: string) {
    setConversations((current) => {
      const next = current.filter((item) => item.id !== id);
      if (selectedId === id) {
        setSelectedId(next[0]?.id || null);
      }
      return next;
    });
  }

  function clearHistory() {
    setConversations([]);
    setSelectedId(null);
    setHistoryDrawerOpen(false);
    resetComposer();
  }

  async function handleSubmit() {
    setError("");
    const trimmedPrompt = prompt.trim();
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
      images: Array.from({ length: parsedCount }, (_, index) => ({
        id: `${turnId}-${index}`,
        status: "loading" as const,
      })),
      status: "queued",
    };

    const draftConversation: ImageConversation = selectedConversation
      ? { ...selectedConversation, updatedAt: now, turns: [...selectedConversation.turns, turn] }
      : {
          id: conversationId,
          title: buildTitle(trimmedPrompt),
          createdAt: now,
          updatedAt: now,
          turns: [turn],
        };

    setSelectedId(conversationId);
    updateConversation(draftConversation);
    setPrompt("");
    setCount("1");
    setSubmitting(true);

    try {
      const files = referenceImages.map((image, index) => {
        if (!image.dataUrl) throw new Error("参考图缓存丢失，请重新上传后再试");
        return dataUrlToFile(image.dataUrl, image.name || `reference-${index + 1}.png`, image.type);
      });

      const tasks = Array.from({ length: parsedCount }, async (_, index) => {
        const response =
          mode === "edit"
            ? await editImage(files, { prompt: trimmedPrompt, model: "gpt-image-2", size, n: 1 })
            : await generateImage({
                prompt: trimmedPrompt,
                model: "gpt-image-2",
                size,
                n: 1,
                response_format: "b64_json",
              });

        const first = response.data?.[0];
        if (!first?.b64_json) throw new Error("接口没有返回 b64_json");
        return { id: `${turnId}-${index}`, status: "success" as const, b64_json: first.b64_json };
      });

      const settled = await Promise.allSettled(tasks);
      const nextImages = settled.map((item, index) =>
        item.status === "fulfilled"
          ? item.value
          : {
              id: `${turnId}-${index}`,
              status: "error" as const,
              error: item.reason instanceof Error ? item.reason.message : "生成失败",
            },
      );
      const failedCount = nextImages.filter((item) => item.status === "error").length;

      const nextConversation: ImageConversation = {
        ...draftConversation,
        updatedAt: new Date().toISOString(),
        turns: draftConversation.turns.map((item) =>
          item.id === turnId
            ? {
                ...item,
                status: failedCount > 0 ? "error" : "success",
                error: failedCount > 0 ? `其中 ${failedCount} 张生成失败` : undefined,
                images: nextImages,
              }
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
    <div style={chatPageStyle}>
      <div style={chatTabsBarStyle}>
        <AppTabs activeTab="chat" />
      </div>
      <div style={chatPageBodyStyle}>
      {!historyDrawerOpen ? (
        <button type="button" className="history-trigger" onClick={() => setHistoryDrawerOpen(true)} aria-label="打开历史对话">
          历史
        </button>
      ) : null}

      {historyDrawerOpen ? (
        <button type="button" className="history-backdrop" onClick={() => setHistoryDrawerOpen(false)} aria-label="关闭历史对话" />
      ) : null}

      <main className="page-shell">
        <aside className={`sidebar-panel drawer-panel${historyDrawerOpen ? " is-open" : ""}`}>
          <div style={panelHeaderStyle}>
            <h2 style={{ margin: 0, fontSize: 18 }}>历史对话</h2>
            <div style={sidebarActionsStyle}>
              <button
                onClick={() => {
                  setSelectedId(null);
                  resetComposer();
                  setHistoryDrawerOpen(false);
                }}
                style={buttonStyle}
              >
                新建
              </button>
              <button onClick={clearHistory} style={buttonStyle}>
                清空
              </button>
              <button type="button" className="drawer-close-button" onClick={() => setHistoryDrawerOpen(false)} aria-label="关闭历史对话">
                ×
              </button>
            </div>
          </div>

          <div className="history-list">
            {conversations.length === 0 ? <div style={emptyTextStyle}>还没有记录</div> : null}
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                style={{
                  ...historyCardStyle,
                  borderColor: selectedId === conversation.id ? "#1c1917" : "#e7e5e4",
                  background: selectedId === conversation.id ? "#fafaf9" : "white",
                }}
              >
                <button type="button" onClick={() => selectConversation(conversation.id)} style={historySelectButtonStyle}>
                  <div
                    style={{
                      fontWeight: 600,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {conversation.title}
                  </div>
                  <div style={{ fontSize: 12, color: "#78716c", marginTop: 4 }}>{formatTime(conversation.updatedAt)}</div>
                </button>
                <button type="button" onClick={() => deleteConversation(conversation.id)} style={historyDeleteButtonStyle} aria-label={`删除 ${conversation.title}`}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </aside>

        <section className="chat-panel">
          <div ref={chatThreadRef} className="chat-thread">
            {!selectedConversation ? <div style={emptyTextStyle}>Turn ideas into images。左侧会保留本地历史。</div> : null}

            <div style={turnListStyle}>
              {selectedConversation?.turns.map((turn, turnIndex) => (
                <div
                  key={turn.id}
                  style={{
                    borderTop: turnIndex === 0 ? "none" : "1px solid #f5f5f4",
                    paddingTop: turnIndex === 0 ? 0 : 16,
                  }}
                >
                  <div style={turnHeaderStyle}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{turn.mode === "edit" ? "图生图" : "文生图"}</div>
                      <div style={{ fontSize: 12, color: "#78716c" }}>
                        {formatTime(turn.createdAt)} · 第 {turnIndex + 1} 轮 · {turn.count} 张
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: turn.status === "error" ? "#b91c1c" : "#78716c" }}>{turn.status}</div>
                  </div>

                  <p style={promptTextStyle}>{turn.prompt}</p>

                  {turn.referenceImages.length > 0 ? (
                    <div style={thumbnailListStyle}>
                      {turn.referenceImages.map((image, index) =>
                        image.dataUrl ? (
                          <button
                            key={`${turn.id}-${index}`}
                            type="button"
                            onClick={() => openPreview(image.dataUrl!, image.name || `参考图 ${index + 1}`)}
                            style={thumbnailButtonStyle}
                          >
                            <img src={image.dataUrl} alt={image.name || `参考图 ${index + 1}`} style={thumbnailImageStyle} />
                          </button>
                        ) : (
                          <div key={`${turn.id}-${index}`} style={missingThumbStyle}>
                            参考图未加载
                          </div>
                        ),
                      )}
                    </div>
                  ) : null}

                  <div style={resultGridStyle}>
                    {turn.images.map((image) => {
                      const imageSrc = image.b64_json ? `data:image/png;base64,${image.b64_json}` : "";

                      return (
                        <div key={image.id} style={resultCardStyle}>
                          {image.status === "success" && image.b64_json ? (
                            <button type="button" onClick={() => openPreview(imageSrc, image.id)} style={resultPreviewButtonStyle}>
                              <img src={imageSrc} alt={image.id} style={resultImageStyle} />
                            </button>
                          ) : (
                            <div
                              style={{
                                ...resultFallbackStyle,
                                color: image.status === "error" ? "#b91c1c" : "#78716c",
                              }}
                            >
                              {image.status === "loading" ? "处理中..." : image.error || "生成失败"}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {turn.error ? <div style={errorTextStyle}>{turn.error}</div> : null}
                </div>
              ))}
            </div>
          </div>

          <div className="composer-panel">
            <div style={composerInnerStyle}>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={mode === "edit" ? "描述你要如何修改参考图" : "输入想生成的画面"}
                rows={2}
                style={{ ...inputStyle, minHeight: "calc(1.5em * 2 + 24px)", resize: "vertical" }}
              />

              <div style={toolbarStyle}>
                <button
                  onClick={() => setMode("generate")}
                  style={{
                    ...buttonStyle,
                    background: mode === "generate" ? "#1c1917" : "white",
                    color: mode === "generate" ? "white" : "#1c1917",
                  }}
                >
                  文生图
                </button>
                <button
                  onClick={() => setMode("edit")}
                  style={{
                    ...buttonStyle,
                    background: mode === "edit" ? "#1c1917" : "white",
                    color: mode === "edit" ? "white" : "#1c1917",
                  }}
                >
                  图生图
                </button>
                <label style={labelInlineStyle}>
                  张数
                  <input value={count} onChange={(event) => setCount(event.target.value)} type="number" min={1} max={10} style={{ ...inputStyle, width: 72 }} />
                </label>
                <label style={labelInlineStyle}>
                  比例
                  <select value={size} onChange={(event) => setSize(event.target.value)} style={{ ...inputStyle, width: 120 }}>
                    {sizeOptions.map((option) => (
                      <option key={option || "default"} value={option}>
                        {option || "未指定"}
                      </option>
                    ))}
                  </select>
                </label>
                <button onClick={() => fileInputRef.current?.click()} style={buttonStyle}>
                  上传参考图
                </button>
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
                <div style={thumbnailListStyle}>
                  {referenceImages.map((image, index) => (
                    <div key={`${image.name}-${index}`} style={{ position: "relative" }}>
                      <button
                        type="button"
                        onClick={() => image.dataUrl && openPreview(image.dataUrl, image.name || `上传图片 ${index + 1}`)}
                        style={thumbnailButtonStyle}
                      >
                        {image.dataUrl ? (
                          <img src={image.dataUrl} alt={image.name || `上传图片 ${index + 1}`} style={uploadThumbnailStyle} />
                        ) : (
                          <div style={missingThumbStyle}>预览不可用</div>
                        )}
                      </button>
                      <button
                        onClick={() => setReferenceImages((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                        style={{ ...dangerButtonStyle, position: "absolute", top: -8, right: -8 }}
                        aria-label={`移除 ${image.name || `图片 ${index + 1}`}`}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              {error ? <div style={errorTextStyle}>{error}</div> : null}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{
                  ...buttonStyle,
                  background: "#1c1917",
                  color: "white",
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? "提交中..." : "开始生成"}
              </button>
            </div>
          </div>
        </section>
      </main>

      {previewImage ? (
        <div className="image-preview-overlay" onClick={() => setPreviewImage(null)} role="presentation">
          <div className="image-preview-dialog" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <button type="button" onClick={() => setPreviewImage(null)} className="image-preview-close" aria-label="关闭预览">
              ×
            </button>
            <img className="image-preview-image" src={previewImage.src} alt={previewImage.alt} />
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  marginBottom: 12,
};

const sidebarActionsStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const emptyTextStyle: CSSProperties = {
  color: "#57534e",
  fontSize: 14,
};

const turnListStyle: CSSProperties = {
  display: "grid",
  gap: 24,
  alignContent: "start",
};

const turnHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "baseline",
};

const promptTextStyle: CSSProperties = {
  whiteSpace: "pre-wrap",
  lineHeight: 1.6,
};

const thumbnailListStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 16,
};

const thumbnailButtonStyle: CSSProperties = {
  padding: 0,
  border: "none",
  background: "transparent",
  cursor: "zoom-in",
  borderRadius: 16,
  overflow: "hidden",
};

const thumbnailImageStyle: CSSProperties = {
  width: 96,
  height: 96,
  objectFit: "cover",
  borderRadius: 16,
  border: "1px solid #e7e5e4",
};

const uploadThumbnailStyle: CSSProperties = {
  width: 80,
  height: 80,
  objectFit: "cover",
  borderRadius: 14,
  border: "1px solid #e7e5e4",
};

const missingThumbStyle: CSSProperties = {
  width: 96,
  height: 96,
  display: "grid",
  placeItems: "center",
  borderRadius: 16,
  border: "1px solid #e7e5e4",
  color: "#78716c",
  fontSize: 12,
  background: "#fafaf9",
  textAlign: "center",
  padding: 8,
};

const resultGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: 16,
};

const resultCardStyle: CSSProperties = {
  border: "1px solid #e7e5e4",
  borderRadius: 20,
  overflow: "hidden",
  background: "#fafaf9",
  minWidth: 0,
};

const resultPreviewButtonStyle: CSSProperties = {
  width: "100%",
  border: "none",
  background: "transparent",
  padding: 0,
  cursor: "zoom-in",
};

const resultImageStyle: CSSProperties = {
  width: "100%",
  height: "auto",
};

const resultFallbackStyle: CSSProperties = {
  minHeight: 220,
  display: "grid",
  placeItems: "center",
  padding: 16,
  textAlign: "center",
};

const composerInnerStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
};

const errorTextStyle: CSSProperties = {
  marginTop: 12,
  color: "#b91c1c",
  fontSize: 14,
};

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid #d6d3d1",
  borderRadius: 14,
  padding: "12px 14px",
  background: "white",
};

const labelInlineStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 14,
  color: "#44403c",
};

const buttonStyle: CSSProperties = {
  border: "1px solid #d6d3d1",
  borderRadius: 999,
  padding: "10px 16px",
  background: "white",
  cursor: "pointer",
};

const dangerButtonStyle: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: 999,
  border: "1px solid #d6d3d1",
  background: "white",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  lineHeight: 1,
};

const historyCardStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 8,
  alignItems: "start",
  border: "1px solid #e7e5e4",
  borderRadius: 18,
  padding: 12,
  minHeight: 72,
  overflow: "hidden",
};

const historySelectButtonStyle: CSSProperties = {
  border: "none",
  background: "transparent",
  padding: 0,
  textAlign: "left",
  cursor: "pointer",
  minWidth: 0,
};

const historyDeleteButtonStyle: CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 999,
  border: "1px solid #d6d3d1",
  background: "white",
  cursor: "pointer",
  display: "grid",
  placeItems: "center",
  lineHeight: 1,
  flexShrink: 0,
};


const chatPageStyle: CSSProperties = {
  height: "100vh",
  minHeight: "100vh",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 12,
  padding: 12,
  overflow: "hidden",
};

const chatTabsBarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  paddingTop: 4,
};

const chatPageBodyStyle: CSSProperties = {
  minHeight: 0,
  overflow: "hidden",
};
