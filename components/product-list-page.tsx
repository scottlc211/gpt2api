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

  function createProduct() {
    const product = createDefaultProduct(draftName.trim() || `电商商品 ${products.length + 1}`);
    setProducts((current) => [product, ...current]);
    setDraftName("");
    router.push(`/products/${product.id}`);
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
        </div>
        <div style={statsGridStyle}>
          <StatCard label="商品数" value={String(stats.productCount)} />
          <StatCard label="已产出候选图" value={String(stats.imageCount)} />
          <StatCard label="数据位置" value="localStorage + IndexedDB" />
        </div>
      </section>

      <section style={panelStyle}>
        <div style={toolbarStyle}>
          <div>
            <div style={panelTitleStyle}>新建商品</div>
            <div style={panelDescStyle}>默认会创建一条包含 5 类节点的商品工作流。</div>
          </div>
          <div style={createRowStyle}>
            <input
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="输入商品名，例如：高蛋白坚果燕麦杯"
              style={inputStyle}
            />
            <button type="button" onClick={createProduct} style={primaryButtonStyle}>
              创建并进入工作台
            </button>
          </div>
        </div>
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
  padding: "32px 24px 48px",
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
  background: "rgba(28, 25, 23, 0.08)",
  color: "#1c1917",
  fontSize: 13,
  fontWeight: 600,
  marginBottom: 12,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 40,
  lineHeight: 1.05,
  letterSpacing: "-0.04em",
};

const descStyle: CSSProperties = {
  margin: "14px 0 0",
  color: "#57534e",
  fontSize: 16,
  lineHeight: 1.7,
  maxWidth: 720,
};

const statsGridStyle: CSSProperties = {
  display: "grid",
  gap: 12,
};

const statCardStyle: CSSProperties = {
  border: "1px solid rgba(231, 229, 228, 0.9)",
  borderRadius: 24,
  padding: 20,
  background: "rgba(255, 255, 255, 0.9)",
  boxShadow: "0 10px 30px rgba(41, 37, 36, 0.06)",
};

const statLabelStyle: CSSProperties = { color: "#78716c", fontSize: 13 };
const statValueStyle: CSSProperties = { marginTop: 8, fontSize: 22, fontWeight: 700 };

const panelStyle: CSSProperties = {
  border: "1px solid rgba(231, 229, 228, 0.9)",
  borderRadius: 28,
  background: "rgba(255, 255, 255, 0.94)",
  padding: 24,
  boxShadow: "0 12px 36px rgba(41, 37, 36, 0.06)",
  display: "grid",
  gap: 20,
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

const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: 999,
  padding: "14px 20px",
  background: "#1c1917",
  color: "white",
  cursor: "pointer",
  fontWeight: 600,
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
  border: "1px solid #d6d3d1",
  borderRadius: 999,
  padding: "10px 14px",
  background: "white",
  fontSize: 14,
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
  background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(248,247,244,0.98))",
  padding: 18,
  display: "grid",
  gap: 16,
};

const cardTopStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};

const cardTitleStyle: CSSProperties = { fontSize: 18, fontWeight: 700 };
const mutedTextStyle: CSSProperties = { marginTop: 6, fontSize: 13, color: "#78716c", lineHeight: 1.6 };

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
  background: "rgba(255, 255, 255, 0.75)",
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
