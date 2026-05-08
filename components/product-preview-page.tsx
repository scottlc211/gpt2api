"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppTabs } from "@/components/app-tabs";
import { getNodesByType, readProducts, summarizeProduct, type ProductRecord, type WorkflowRunOutputGroup } from "@/lib/workbench";

function splitLines(value: string) {
  return value
    .split(/[\n,，;；|]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function aspectRatioToCss(value: string) {
  return value.replace(":", " / ");
}

function pickPreviewImage(group: WorkflowRunOutputGroup) {
  return group.images.find((image) => image.status === "success" && image.dataUrl)?.dataUrl;
}

function buildPlatformTheme(platform: string) {
  switch (platform) {
    case "天猫":
      return { accent: "#ff0036", accentSoft: "#fff1f4", dark: "#111827", cta: "#22c55e" };
    case "京东":
      return { accent: "#e2231a", accentSoft: "#fff4f4", dark: "#111827", cta: "#22c55e" };
    case "拼多多":
      return { accent: "#e02e24", accentSoft: "#fff4f4", dark: "#111827", cta: "#22c55e" };
    case "抖音小店":
      return { accent: "#fe2c55", accentSoft: "#fff1f5", dark: "#0f172a", cta: "#22c55e" };
    case "小红书":
      return { accent: "#ff2442", accentSoft: "#fff1f4", dark: "#111827", cta: "#22c55e" };
    case "淘宝":
    default:
      return { accent: "#ff5000", accentSoft: "#fff7ed", dark: "#0f172a", cta: "#22c55e" };
  }
}

function ImageStage({
  group,
  fallbackLabel,
}: {
  group: WorkflowRunOutputGroup;
  fallbackLabel: string;
}) {
  const image = pickPreviewImage(group);

  if (image) {
    return <img src={image} alt={group.title} style={{ width: "100%", aspectRatio: aspectRatioToCss(group.size || "1:1"), objectFit: "cover", display: "block" }} />;
  }

  if (group.images.some((item) => item.status === "loading")) {
    return <div style={previewLoadingStyle}>正在生成 {fallbackLabel}</div>;
  }

  return <div style={previewFallbackStyle}>{group.error || `${fallbackLabel} 暂无可预览图片`}</div>;
}

export function ProductPreviewPage({ productId }: { productId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const runId = searchParams.get("runId");

  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [activeMainIndex, setActiveMainIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const items = await readProducts();
      if (cancelled) return;
      setProducts(items);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const product = useMemo(() => products.find((item) => item.id === productId), [products, productId]);
  const productNode = useMemo(() => (product ? getNodesByType(product.workflow, "product")[0] : undefined), [product]);
  const resultRuns = useMemo(
    () =>
      product
        ? getNodesByType(product.workflow, "result").flatMap((node) =>
            node.payload.history.map((run) => ({
              resultNodeId: node.id,
              run,
            })),
          )
        : [],
    [product],
  );

  const activeRun = useMemo(() => {
    if (resultRuns.length === 0) return undefined;
    return resultRuns.find((item) => item.run.id === runId) || resultRuns[0];
  }, [resultRuns, runId]);

  const mainGroups = activeRun?.run.outputs.filter((group) => group.kind === "main") || [];
  const detailGroups = activeRun?.run.outputs.filter((group) => group.kind === "detail") || [];
  const activeMainGroup = mainGroups[activeMainIndex] || mainGroups[0];

  useEffect(() => {
    setActiveMainIndex(0);
  }, [activeRun?.run.id]);

  if (!ready) {
    return <main style={loadingPageStyle}>正在加载电商网页预览...</main>;
  }

  if (!product || !productNode || !activeRun) {
    return (
      <main style={loadingPageStyle}>
        <div style={missingCardStyle}>
          <h1 style={{ margin: 0 }}>没有可预览的商品页面</h1>
          <p style={{ margin: "12px 0 20px", color: "#94a3b8" }}>请先回到商品工作台完成一轮生成，再进入网页预览。</p>
          <button type="button" style={previewBackButtonStyle} onClick={() => router.push(`/products/${productId}`)}>
            返回商品工作台
          </button>
        </div>
      </main>
    );
  }

  const productPayload = productNode.payload;
  const theme = buildPlatformTheme(productPayload.platform);
  const sellingTags = splitLines(productPayload.sellingPoints).slice(0, 4);
  const priceText = productPayload.priceText.trim() || "活动价待补充";

  return (
    <main style={pageStyle}>
      <div style={tabsWrapStyle}>
        <AppTabs activeTab="workbench" />
      </div>

      <header style={heroStyle}>
        <div style={{ minWidth: 0 }}>
          <div style={heroChipRowStyle}>
            <Link href={`/products/${productId}`} style={previewBackLinkStyle}>
              ← 返回工作台
            </Link>
            <div style={{ ...heroPillStyle, background: theme.accentSoft, color: theme.accent }}>{productPayload.platform} 电商网页预览</div>
          </div>
          <h1 style={heroTitleStyle}>{productPayload.productName || product.name}</h1>
          <p style={heroDescStyle}>{summarizeProduct(product)} · 运行于 {formatTime(activeRun.run.createdAt)}</p>
        </div>
        <div style={heroActionsStyle}>
          <label style={selectWrapStyle}>
            <span style={selectLabelStyle}>选择运行记录</span>
            <select
              value={activeRun.run.id}
              onChange={(event) => router.replace(`/products/${productId}/preview?runId=${event.target.value}`)}
              style={selectStyle}
            >
              {resultRuns.map((item) => (
                <option key={item.run.id} value={item.run.id}>
                  {formatTime(item.run.createdAt)} · {item.run.totalImages} 张
                </option>
              ))}
            </select>
          </label>
          <div style={summaryCardStyle}>
            <div style={summaryTitleStyle}>当前运行摘要</div>
            <div style={summaryMetaStyle}>
              主图 {mainGroups.length} 张 · 详情模块 {detailGroups.length} 个 · {activeRun.run.error ? "含失败版块" : "可直接预览"}
            </div>
          </div>
        </div>
      </header>

      <section style={previewGridStyle}>
        <section style={panelStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <div style={panelTitleStyle}>平台流量位模拟</div>
              <div style={panelDescStyle}>把 5 张主图放进列表卡片里，看点击位是不是足够抓眼。</div>
            </div>
          </div>
          <div style={feedGridStyle}>
            {mainGroups.map((group, index) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setActiveMainIndex(index)}
                style={{
                  ...feedCardStyle,
                  borderColor: activeMainGroup?.id === group.id ? theme.accent : "rgba(226,232,240,0.9)",
                  boxShadow: activeMainGroup?.id === group.id ? `0 0 0 2px ${theme.accent}22` : "none",
                }}
              >
                <div style={feedImageWrapStyle}>
                  <ImageStage group={group} fallbackLabel={group.title} />
                </div>
                <div style={feedBodyStyle}>
                  <div style={feedPriceStyle}>{priceText}</div>
                  <div style={feedTitleStyle}>{productPayload.productName || product.name}</div>
                  <div style={feedSubStyle}>{group.title}</div>
                  <div style={feedTagRowStyle}>
                    {sellingTags.slice(0, 2).map((tag) => (
                      <span key={tag} style={{ ...feedTagStyle, color: theme.accent, background: theme.accentSoft }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section style={panelStyle}>
          <div style={panelHeaderStyle}>
            <div>
              <div style={panelTitleStyle}>商品详情页模拟</div>
              <div style={panelDescStyle}>按真实电商移动端详情页结构，把主图与详情模块串起来预览。</div>
            </div>
          </div>
          <div style={phoneStageStyle}>
            <div style={phoneShellStyle}>
              <div style={{ ...phoneTopBarStyle, background: theme.dark }}>
                <div style={phoneDotStyle} />
                <div style={phoneBrandStyle}>{productPayload.platform}</div>
                <div style={phoneTopTextStyle}>商品详情</div>
              </div>

              <div style={phoneBodyStyle}>
                <div style={heroImageCardStyle}>
                  {activeMainGroup ? <ImageStage group={activeMainGroup} fallbackLabel="主图" /> : <div style={previewFallbackStyle}>暂无主图</div>}
                </div>

                <div style={thumbRowStyle}>
                  {mainGroups.map((group, index) => (
                    <button
                      key={group.id}
                      type="button"
                      style={{
                        ...thumbItemStyle,
                        borderColor: activeMainGroup?.id === group.id ? theme.accent : "rgba(226,232,240,0.9)",
                      }}
                      onClick={() => setActiveMainIndex(index)}
                    >
                      <ImageStage group={group} fallbackLabel={group.title} />
                    </button>
                  ))}
                </div>

                <div style={productInfoCardStyle}>
                  <div style={{ ...mobilePriceStyle, color: theme.accent }}>{priceText}</div>
                  <div style={mobileTitleStyle}>{productPayload.productName || product.name}</div>
                  <div style={mobileDescStyle}>{productPayload.category || "类目待补充"} · {productPayload.targetAudience || "目标人群待补充"}</div>
                  <div style={serviceRowStyle}>
                    <span style={serviceItemStyle}>官方保障</span>
                    <span style={serviceItemStyle}>48h 发货</span>
                    <span style={serviceItemStyle}>支持售后</span>
                  </div>
                  <div style={mobileTagRowStyle}>
                    {sellingTags.map((tag) => (
                      <span key={tag} style={{ ...mobileTagStyle, color: theme.accent, background: theme.accentSoft }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={detailStackStyle}>
                  {detailGroups.map((group) => (
                    <section key={group.id} style={detailBlockStyle}>
                      <div style={detailBlockHeaderStyle}>
                        <div style={detailBlockTitleStyle}>{group.title}</div>
                        <div style={detailBlockMetaStyle}>{group.size || activeRun.run.size}</div>
                      </div>
                      <div style={detailImageWrapStyle}>
                        <ImageStage group={group} fallbackLabel={group.title} />
                      </div>
                    </section>
                  ))}
                  {detailGroups.length === 0 ? <div style={previewFallbackStyle}>本次运行没有附加详情模块。</div> : null}
                </div>
              </div>

              <div style={bottomBarStyle}>
                <button type="button" style={secondaryCtaStyle}>
                  客服
                </button>
                <button type="button" style={secondaryCtaStyle}>
                  收藏
                </button>
                <button type="button" style={{ ...primaryCtaStyle, background: theme.cta }}>
                  立即购买
                </button>
              </div>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

const loadingPageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "linear-gradient(180deg, #020617, #0f172a)",
  color: "#f8fafc",
};

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  padding: "20px 18px 32px",
  display: "grid",
  gap: 18,
  background: "linear-gradient(180deg, #020617, #0f172a 40%, #111827)",
  color: "#f8fafc",
};

const tabsWrapStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
};

const heroStyle: CSSProperties = {
  maxWidth: 1600,
  width: "100%",
  margin: "0 auto",
  display: "flex",
  justifyContent: "space-between",
  gap: 18,
  alignItems: "flex-start",
  flexWrap: "wrap",
};

const heroChipRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
  marginBottom: 10,
};

const previewBackLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(148,163,184,0.32)",
  background: "rgba(15,23,42,0.68)",
  color: "#f8fafc",
};

const previewBackButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: 999,
  padding: "12px 18px",
  background: "#22c55e",
  color: "#052e16",
  cursor: "pointer",
  fontWeight: 700,
};

const heroPillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "8px 12px",
  borderRadius: 999,
  fontSize: 13,
  fontWeight: 700,
};

const heroTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 34,
  letterSpacing: "-0.04em",
};

const heroDescStyle: CSSProperties = {
  margin: "10px 0 0",
  color: "#cbd5e1",
  lineHeight: 1.7,
};

const heroActionsStyle: CSSProperties = {
  display: "grid",
  gap: 12,
  minWidth: 320,
};

const selectWrapStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const selectLabelStyle: CSSProperties = {
  fontSize: 12,
  color: "#cbd5e1",
  fontWeight: 700,
};

const selectStyle: CSSProperties = {
  width: "100%",
  borderRadius: 16,
  border: "1px solid rgba(148,163,184,0.28)",
  padding: "12px 14px",
  background: "rgba(15,23,42,0.72)",
  color: "#f8fafc",
};

const summaryCardStyle: CSSProperties = {
  borderRadius: 20,
  border: "1px solid rgba(148,163,184,0.18)",
  background: "rgba(15,23,42,0.68)",
  padding: 14,
  display: "grid",
  gap: 6,
};

const summaryTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
};

const summaryMetaStyle: CSSProperties = {
  fontSize: 13,
  color: "#cbd5e1",
  lineHeight: 1.6,
};

const previewGridStyle: CSSProperties = {
  maxWidth: 1600,
  width: "100%",
  margin: "0 auto",
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(420px, 560px)",
  gap: 18,
  alignItems: "start",
};

const panelStyle: CSSProperties = {
  borderRadius: 28,
  border: "1px solid rgba(148,163,184,0.16)",
  background: "rgba(15,23,42,0.7)",
  padding: 16,
  display: "grid",
  gap: 16,
  boxShadow: "0 24px 60px rgba(2,6,23,0.24)",
};

const panelHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};

const panelTitleStyle: CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
};

const panelDescStyle: CSSProperties = {
  marginTop: 8,
  fontSize: 13,
  color: "#cbd5e1",
  lineHeight: 1.6,
};

const feedGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 14,
};

const feedCardStyle: CSSProperties = {
  borderRadius: 22,
  border: "1px solid rgba(226,232,240,0.9)",
  background: "white",
  overflow: "hidden",
  display: "grid",
  gap: 0,
  cursor: "pointer",
  textAlign: "left",
};

const feedImageWrapStyle: CSSProperties = {
  background: "#f8fafc",
};

const feedBodyStyle: CSSProperties = {
  padding: 14,
  display: "grid",
  gap: 8,
};

const feedPriceStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 800,
  color: "#ef4444",
};

const feedTitleStyle: CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "#0f172a",
  lineHeight: 1.5,
};

const feedSubStyle: CSSProperties = {
  fontSize: 12,
  color: "#64748b",
};

const feedTagRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const feedTagStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "4px 8px",
  fontSize: 11,
  fontWeight: 700,
};

const phoneStageStyle: CSSProperties = {
  display: "grid",
  placeItems: "center",
};

const phoneShellStyle: CSSProperties = {
  width: "100%",
  maxWidth: 430,
  borderRadius: 34,
  background: "#f8fafc",
  overflow: "hidden",
  border: "10px solid #111827",
  boxShadow: "0 30px 80px rgba(2,6,23,0.42)",
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr) auto",
};

const phoneTopBarStyle: CSSProperties = {
  padding: "12px 16px",
  display: "flex",
  alignItems: "center",
  gap: 10,
  color: "white",
};

const phoneDotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: 999,
  background: "#22c55e",
};

const phoneBrandStyle: CSSProperties = {
  fontWeight: 800,
  letterSpacing: "0.04em",
};

const phoneTopTextStyle: CSSProperties = {
  marginLeft: "auto",
  fontSize: 13,
  opacity: 0.9,
};

const phoneBodyStyle: CSSProperties = {
  padding: 14,
  display: "grid",
  gap: 14,
  maxHeight: "76vh",
  overflow: "auto",
  background: "#f8fafc",
};

const heroImageCardStyle: CSSProperties = {
  borderRadius: 24,
  overflow: "hidden",
  background: "white",
  border: "1px solid #e2e8f0",
};

const thumbRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
  gap: 8,
};

const thumbItemStyle: CSSProperties = {
  borderRadius: 14,
  overflow: "hidden",
  border: "2px solid rgba(226,232,240,0.9)",
  padding: 0,
  background: "white",
  cursor: "pointer",
};

const productInfoCardStyle: CSSProperties = {
  borderRadius: 22,
  border: "1px solid #e2e8f0",
  background: "white",
  padding: 14,
  display: "grid",
  gap: 8,
};

const mobilePriceStyle: CSSProperties = {
  fontSize: 26,
  fontWeight: 900,
};

const mobileTitleStyle: CSSProperties = {
  fontSize: 18,
  color: "#0f172a",
  fontWeight: 800,
  lineHeight: 1.5,
};

const mobileDescStyle: CSSProperties = {
  fontSize: 13,
  color: "#64748b",
};

const serviceRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const serviceItemStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "4px 8px",
  background: "#f1f5f9",
  color: "#334155",
  fontSize: 11,
  fontWeight: 700,
};

const mobileTagRowStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const mobileTagStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 700,
};

const detailStackStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const detailBlockStyle: CSSProperties = {
  borderRadius: 22,
  border: "1px solid #e2e8f0",
  background: "white",
  overflow: "hidden",
  display: "grid",
  gap: 0,
};

const detailBlockHeaderStyle: CSSProperties = {
  padding: "12px 14px",
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "center",
};

const detailBlockTitleStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 800,
  color: "#0f172a",
};

const detailBlockMetaStyle: CSSProperties = {
  fontSize: 11,
  color: "#64748b",
  fontWeight: 700,
};

const detailImageWrapStyle: CSSProperties = {
  background: "#f8fafc",
};

const bottomBarStyle: CSSProperties = {
  padding: 12,
  borderTop: "1px solid #e2e8f0",
  background: "white",
  display: "grid",
  gridTemplateColumns: "80px 80px minmax(0, 1fr)",
  gap: 10,
};

const secondaryCtaStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid #cbd5e1",
  background: "#f8fafc",
  cursor: "pointer",
  fontWeight: 700,
  color: "#334155",
  minHeight: 48,
};

const primaryCtaStyle: CSSProperties = {
  borderRadius: 16,
  border: "none",
  cursor: "pointer",
  fontWeight: 900,
  color: "#052e16",
  minHeight: 48,
};

const previewLoadingStyle: CSSProperties = {
  minHeight: 180,
  display: "grid",
  placeItems: "center",
  color: "#1d4ed8",
  fontSize: 12,
  fontWeight: 700,
  background: "linear-gradient(135deg, #eff6ff, #f8fafc)",
};

const previewFallbackStyle: CSSProperties = {
  minHeight: 180,
  display: "grid",
  placeItems: "center",
  color: "#64748b",
  fontSize: 12,
  textAlign: "center",
  padding: 16,
  background: "#f8fafc",
};

const missingCardStyle: CSSProperties = {
  maxWidth: 520,
  borderRadius: 28,
  border: "1px solid rgba(148,163,184,0.16)",
  background: "rgba(15,23,42,0.78)",
  padding: 28,
  textAlign: "center",
};
