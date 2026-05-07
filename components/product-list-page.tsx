"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { AppTabs } from "@/components/app-tabs";
import {
  countGeneratedImages,
  createDefaultProduct,
  readProducts,
  summarizeProduct,
  writeProducts,
  type ProductRecord,
} from "@/lib/workbench";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function ProductListPage() {
  const router = useRouter();
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [draftName, setDraftName] = useState("");
  const [ready, setReady] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pageMessage, setPageMessage] = useState("商品会保存在浏览器本地，可直接进入工作台继续编辑。");

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

  useEffect(() => {
    if (!ready) return;
    void writeProducts(products);
  }, [products, ready]);

  const stats = useMemo(() => {
    const imageCount = products.reduce((total, item) => total + countGeneratedImages(item), 0);
    return {
      productCount: products.length,
      imageCount,
    };
  }, [products]);

  async function createProduct() {
    if (creating) return;

    const product = createDefaultProduct(draftName.trim() || `电商商品 ${products.length + 1}`);
    const nextProducts = [product, ...products];
    setCreating(true);
    setPageMessage("正在创建商品并初始化默认工作流...");
    setProducts(nextProducts);
    setDraftName("");

    try {
      await writeProducts(nextProducts);
      setPageMessage(`已创建「${product.name}」，即将进入工作台。`);
      router.push(`/products/${product.id}`);
    } catch (error) {
      setPageMessage(error instanceof Error ? error.message : "创建商品失败，请稍后重试。");
      setProducts(products);
    } finally {
      setCreating(false);
    }
  }

  function deleteProduct(productId: string) {
    const target = products.find((item) => item.id === productId);
    if (!target) return;
    if (!window.confirm(`确认删除「${target.name}」吗？`)) return;
    setProducts((current) => current.filter((item) => item.id !== productId));
  }

  return (
    <main style={shellStyle}>
      <div style={tabsWrapStyle}>
        <AppTabs activeTab="workbench" />
      </div>
      <section style={heroStyle}>
        <div>
          <div style={badgeStyle}>商品工作台 MVP</div>
          <h1 style={titleStyle}>把电商设计 Skill 导入商品工作流</h1>
          <p style={descStyle}>这里会把商品信息、参考图、视觉文案、图片处理和最终生图统一到同一个本地工作台里。</p>
          <div style={benefitRowStyle}>
            <div style={benefitChipStyle}>本地持久化</div>
            <div style={benefitChipStyle}>可视化节点编辑</div>
            <div style={benefitChipStyle}>电商视觉 SOP 驱动</div>
          </div>
        </div>
        <div style={statsGridStyle}>
          <StatCard label="商品数" value={String(stats.productCount)} />
          <StatCard label="已产出候选图" value={String(stats.imageCount)} />
          <StatCard label="数据位置" value="localStorage + IndexedDB" />
        </div>
      </section>

      <section style={{ ...panelStyle, ...createPanelStyle }}>
        <div style={toolbarStyle}>
          <div>
            <div style={panelTitleStyle}>新建商品</div>
            <div style={{ ...panelDescStyle, color: "rgba(255,255,255,0.72)" }}>
              默认会创建一条包含 5 类节点的商品工作流，并立即落盘后进入详情工作台。
            </div>
          </div>
          <div style={createRowStyle}>
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="输入商品名，例如：高蛋白坚果燕麦杯"
              style={{ ...inputStyle, ...heroInputStyle }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void createProduct();
                }
              }}
            />
            <button
              type="button"
              onClick={() => void createProduct()}
              style={{ ...primaryButtonStyle, opacity: creating ? 0.72 : 1, cursor: creating ? "wait" : "pointer" }}
              disabled={creating}
            >
              {creating ? "创建中..." : "创建并进入工作台"}
            </button>
          </div>
        </div>
        <div style={statusInlineStyle}>{pageMessage}</div>
      </section>

      <section style={panelStyle}>
        <div style={listHeaderStyle}>
          <div>
            <div style={panelTitleStyle}>商品列表</div>
            <div style={panelDescStyle}>当前仓库已从单页生图 demo 升级为本地商品工作台。</div>
          </div>
          <Link href="https://github.com/yuqie6/ProductFlow" target="_blank" rel="noreferrer" style={ghostLinkStyle}>
            参考 ProductFlow
          </Link>
        </div>

        {!ready ? <div style={emptyStyle}>加载本地商品中...</div> : null}
        {ready && products.length === 0 ? <div style={emptyStyle}>还没有商品，先新建一个工作台吧。</div> : null}

        <div style={productGridStyle}>
          {products.map((product) => (
            <article key={product.id} style={cardStyle}>
              <div style={cardTopStyle}>
                <div>
                  <div style={cardTitleStyle}>{product.name}</div>
                  <div style={mutedTextStyle}>{summarizeProduct(product)}</div>
                </div>
                <button type="button" onClick={() => deleteProduct(product.id)} style={dangerButtonStyle}>
                  删除
                </button>
              </div>

              <div style={metaGridStyle}>
                <MetaItem label="节点数" value={String(product.workflow.nodes.length)} />
                <MetaItem label="连线数" value={String(product.workflow.edges.length)} />
                <MetaItem label="候选图" value={String(countGeneratedImages(product))} />
                <MetaItem label="最近更新" value={formatTime(product.updatedAt)} />
              </div>

              <div style={cardBottomStyle}>
                <Link href={`/products/${product.id}`} style={primaryLinkStyle}>
                  打开工作台
                </Link>
                <div style={hintStyle}>支持新增/编辑节点、连线、候选图回填</div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div style={statCardStyle}>
      <div style={statLabelStyle}>{label}</div>
      <div style={statValueStyle}>{value}</div>
    </div>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={metaItemStyle}>
      <div style={metaLabelStyle}>{label}</div>
      <div style={metaValueStyle}>{value}</div>
    </div>
  );
}

const shellStyle: CSSProperties = {
  minHeight: "100vh",
  padding: "24px 24px 48px",
  display: "grid",
  gap: 24,
  maxWidth: 1320,
  margin: "0 auto",
};

const tabsWrapStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
};

const heroStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.3fr) minmax(280px, 0.7fr)",
  gap: 20,
  alignItems: "stretch",
};

const badgeStyle: CSSProperties = {
  display: "inline-flex",
  padding: "6px 12px",
  borderRadius: 999,
  background: "rgba(212, 175, 55, 0.14)",
  color: "#8a6914",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 12,
  border: "1px solid rgba(212, 175, 55, 0.28)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 44,
  lineHeight: 1.02,
  letterSpacing: "-0.04em",
  maxWidth: 760,
};

const descStyle: CSSProperties = {
  margin: "14px 0 0",
  color: "#44403c",
  fontSize: 16,
  lineHeight: 1.7,
  maxWidth: 720,
};

const benefitRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  marginTop: 18,
};

const benefitChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "10px 14px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.86)",
  border: "1px solid rgba(231,229,228,0.95)",
  boxShadow: "0 8px 20px rgba(41, 37, 36, 0.05)",
  color: "#44403c",
  fontSize: 13,
  fontWeight: 600,
};

const statsGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const statCardStyle: CSSProperties = {
  border: "1px solid rgba(231, 229, 228, 0.9)",
  borderRadius: 24,
  padding: 20,
  background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(252,251,249,0.92))",
  boxShadow: "0 14px 30px rgba(41, 37, 36, 0.08)",
  position: "relative",
  overflow: "hidden",
};

const statLabelStyle: CSSProperties = { color: "#78716c", fontSize: 13 };
const statValueStyle: CSSProperties = { marginTop: 8, fontSize: 22, fontWeight: 700, color: "#171717" };

const panelStyle: CSSProperties = {
  border: "1px solid rgba(231, 229, 228, 0.9)",
  borderRadius: 28,
  background: "rgba(255, 255, 255, 0.94)",
  padding: 24,
  boxShadow: "0 14px 36px rgba(41, 37, 36, 0.07)",
  display: "grid",
  gap: 20,
};

const createPanelStyle: CSSProperties = {
  background: "linear-gradient(135deg, rgba(23,23,23,0.96), rgba(43,43,43,0.94))",
  borderColor: "rgba(64,64,64,0.55)",
  color: "white",
};

const toolbarStyle: CSSProperties = {
  display: "flex",
  gap: 16,
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
};

const createRowStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
  width: "min(100%, 680px)",
  justifyContent: "flex-end",
};

const panelTitleStyle: CSSProperties = { fontSize: 22, fontWeight: 700 };
const panelDescStyle: CSSProperties = { marginTop: 8, fontSize: 14, color: "#78716c" };
const inputStyle: CSSProperties = {
  minWidth: 320,
  flex: "1 1 320px",
  border: "1px solid #d6d3d1",
  borderRadius: 16,
  padding: "14px 16px",
  background: "white",
};

const heroInputStyle: CSSProperties = {
  background: "rgba(255,255,255,0.98)",
  borderColor: "rgba(212,175,55,0.28)",
  boxShadow: "0 0 0 4px rgba(212,175,55,0.06)",
};

const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: 999,
  padding: "14px 20px",
  background: "linear-gradient(135deg, #171717, #2b2b2b)",
  color: "white",
  cursor: "pointer",
  fontWeight: 600,
  boxShadow: "0 12px 24px rgba(23, 23, 23, 0.24)",
};

const statusInlineStyle: CSSProperties = {
  color: "rgba(255,255,255,0.82)",
  fontSize: 13,
  lineHeight: 1.7,
  borderTop: "1px solid rgba(255,255,255,0.08)",
  paddingTop: 14,
};

const listHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
};

const ghostLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid rgba(212,175,55,0.28)",
  borderRadius: 999,
  padding: "10px 14px",
  background: "rgba(255,250,237,0.9)",
  fontSize: 14,
  color: "#8a6914",
  fontWeight: 600,
};

const emptyStyle: CSSProperties = {
  minHeight: 120,
  borderRadius: 20,
  display: "grid",
  placeItems: "center",
  background: "#fafaf9",
  color: "#78716c",
  fontSize: 15,
};

const productGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
  gap: 18,
};

const cardStyle: CSSProperties = {
  border: "1px solid #ece7df",
  borderRadius: 24,
  background: "linear-gradient(180deg, rgba(255,255,255,0.99), rgba(250,249,246,0.96))",
  padding: 18,
  display: "grid",
  gap: 16,
  boxShadow: "0 10px 24px rgba(41, 37, 36, 0.05)",
};

const cardTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};

const cardTitleStyle: CSSProperties = { fontSize: 18, fontWeight: 700 };
const mutedTextStyle: CSSProperties = { marginTop: 6, fontSize: 13, color: "#57534e", lineHeight: 1.6 };

const dangerButtonStyle: CSSProperties = {
  border: "1px solid #fecaca",
  borderRadius: 999,
  padding: "8px 12px",
  background: "#fff5f5",
  color: "#b91c1c",
  cursor: "pointer",
  fontSize: 13,
};

const metaGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};

const metaItemStyle: CSSProperties = {
  borderRadius: 18,
  background: "rgba(255, 255, 255, 0.82)",
  border: "1px solid rgba(231, 229, 228, 0.9)",
  padding: 12,
};

const metaLabelStyle: CSSProperties = { fontSize: 12, color: "#78716c" };
const metaValueStyle: CSSProperties = { marginTop: 6, fontSize: 14, fontWeight: 600 };

const cardBottomStyle: CSSProperties = {
  display: "grid",
  gap: 10,
};

const primaryLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 16,
  background: "#1c1917",
  color: "white",
  padding: "12px 16px",
  fontWeight: 600,
};

const hintStyle: CSSProperties = { fontSize: 12, color: "#78716c" };
