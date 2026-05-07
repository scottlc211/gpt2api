"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { AppTabs } from "@/components/app-tabs";
import { measureImageDataUrl } from "@/lib/image-tools";
import {
  appendGeneratedImageToReference,
  buildPromptPreview,
  executeResultNode,
  generateCopyForNode,
} from "@/lib/workbench-engine";
import { downloadDataUrl, makeId, readAsDataUrl } from "@/lib/storage";
import {
  aspectRatioOptions,
  backgroundOptions,
  complianceOptions,
  createWorkflowNode,
  fitOptions,
  getLatestRun,
  getNodeById,
  getNodesByType,
  nodeTypeDescriptions,
  nodeTypeLabels,
  normalizeProductRecord,
  platformOptions,
  readProducts,
  referenceRoleOptions,
  sortProducts,
  summarizeProduct,
  writeProducts,
  type AspectRatio,
  type CopyNodePayload,
  type ProductImageAsset,
  type ProductRecord,
  type ResultNodePayload,
  type VisualPlanCard,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeType,
} from "@/lib/workbench";

const CANVAS_WIDTH = 1480;
const CANVAS_HEIGHT = 960;
const NODE_WIDTH = 236;
const NODE_HEIGHT = 136;

const connectionRules: Record<WorkflowNodeType, WorkflowNodeType[]> = {
  product: ["copy", "process"],
  reference: ["process", "result"],
  copy: ["process", "result"],
  process: ["result"],
  result: [],
};

const nodeAccent: Record<WorkflowNodeType, { bg: string; border: string; chip: string }> = {
  product: { bg: "#eef6ff", border: "#bfdbfe", chip: "#1d4ed8" },
  reference: { bg: "#f7f1ff", border: "#ddd6fe", chip: "#7c3aed" },
  copy: { bg: "#fff7ed", border: "#fed7aa", chip: "#c2410c" },
  process: { bg: "#ecfdf5", border: "#bbf7d0", chip: "#15803d" },
  result: { bg: "#fef2f2", border: "#fecaca", chip: "#b91c1c" },
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function describeNode(node: WorkflowNode) {
  switch (node.type) {
    case "product": {
      const payload = node.payload as WorkflowNode<"product">["payload"];
      return [payload.productName, payload.category].filter(Boolean).join(" / ") || "待补充商品信息";
    }
    case "reference": {
      const payload = node.payload as WorkflowNode<"reference">["payload"];
      return `${payload.images.length} 张参考图`;
    }
    case "copy": {
      const payload = node.payload as WorkflowNode<"copy">["payload"];
      return payload.cards.length > 0 ? `${payload.cards.length} 张主图卡 + ${payload.detailModules.length} 个详情模块` : "待生成视觉文案";
    }
    case "process": {
      const payload = node.payload as WorkflowNode<"process">["payload"];
      return `默认 ${payload.aspectRatio} · ${payload.outputCount} 张候选图`;
    }
    case "result": {
      const payload = node.payload as WorkflowNode<"result">["payload"];
      return payload.history.length > 0 ? `最近运行：${formatTime(payload.history[0].createdAt)} · ${payload.history[0].totalImages} 张` : "尚未运行";
    }
  }
}

function getNextNodePosition(product: ProductRecord, type: WorkflowNodeType) {
  const count = product.workflow.nodes.filter((node) => node.type === type).length;
  const xBase: Record<WorkflowNodeType, number> = {
    product: 72,
    reference: 360,
    copy: 360,
    process: 720,
    result: 1080,
  };
  return {
    x: xBase[type],
    y: 64 + count * 180,
  };
}

function canConnect(source: WorkflowNode, target: WorkflowNode) {
  if (source.id === target.id) return false;
  return connectionRules[source.type].includes(target.type);
}

function edgeExists(edges: WorkflowEdge[], sourceId: string, targetId: string) {
  return edges.some((edge) => edge.source === sourceId && edge.target === targetId);
}

function getNodeCenter(node: WorkflowNode) {
  return {
    x: node.position.x + NODE_WIDTH / 2,
    y: node.position.y + NODE_HEIGHT / 2,
  };
}

function parseTextLines(value: string) {
  return value
    .split(/\n/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function dedupeStrings(items: string[]) {
  return Array.from(new Set(items));
}

function aspectRatioToCss(value: string) {
  return value.replace(":", " / ");
}

function ProductField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={fieldStyle}>
      <span style={fieldLabelStyle}>{label}</span>
      {children}
    </label>
  );
}

function TwoColumn({ children }: { children: ReactNode }) {
  return <div style={twoColumnStyle}>{children}</div>;
}

export function ProductWorkbenchPage({ productId }: { productId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{
    nodeId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [uploadTargetNodeId, setUploadTargetNodeId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null);
  const [statusText, setStatusText] = useState("工作流节点变更会自动保存在浏览器本地。");
  const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
  const [promptPreview, setPromptPreview] = useState("");

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

  const product = useMemo(() => products.find((item) => item.id === productId), [products, productId]);
  const selectedNode = useMemo(
    () => (product && selectedNodeId ? product.workflow.nodes.find((node) => node.id === selectedNodeId) || null : null),
    [product, selectedNodeId],
  );

  useEffect(() => {
    if (!product) return;
    if (!selectedNodeId || !product.workflow.nodes.some((node) => node.id === selectedNodeId)) {
      const preferred = product.workflow.nodes.find((node) => node.type === "result") || product.workflow.nodes[0] || null;
      setSelectedNodeId(preferred?.id || null);
    }
  }, [product, selectedNodeId]);

  function patchProduct(updater: (current: ProductRecord) => ProductRecord) {
    setProducts((current) =>
      sortProducts(
        current.map((item) => {
          if (item.id !== productId) return item;
          return normalizeProductRecord(updater(item));
        }),
      ),
    );
  }

  useEffect(() => {
    function handleMove(event: PointerEvent) {
      if (!dragRef.current || !product) return;
      const zoom = product.workflow.viewport.zoom || 1;
      const deltaX = (event.clientX - dragRef.current.startX) / zoom;
      const deltaY = (event.clientY - dragRef.current.startY) / zoom;
      const nextPoint = {
        x: Math.max(16, Math.min(CANVAS_WIDTH - NODE_WIDTH - 16, dragRef.current.originX + deltaX)),
        y: Math.max(16, Math.min(CANVAS_HEIGHT - NODE_HEIGHT - 16, dragRef.current.originY + deltaY)),
      };
      patchProduct((current) => ({
        ...current,
        updatedAt: new Date().toISOString(),
        workflow: {
          ...current.workflow,
          nodes: current.workflow.nodes.map((node) =>
            node.id === dragRef.current?.nodeId ? { ...node, position: nextPoint } : node,
          ),
        },
      }));
    }

    function handleUp() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [product]);

  async function handleUpload(files: FileList | null) {
    if (!files || !uploadTargetNodeId || !product) return;
    const referenceNode = getNodeById(product.workflow, uploadTargetNodeId) as WorkflowNode<"reference"> | undefined;
    if (!referenceNode) return;

    const nextImages = await Promise.all(
      Array.from(files).map(async (file) => {
        const dataUrl = await readAsDataUrl(file);
        const size = await measureImageDataUrl(dataUrl).catch(() => ({ width: undefined, height: undefined }));
        return {
          id: makeId(),
          name: file.name,
          type: file.type || "image/png",
          dataUrl,
          width: size.width,
          height: size.height,
          role: "hero" as const,
          notes: "",
        } satisfies ProductImageAsset;
      }),
    );

    patchProduct((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      workflow: {
        ...current.workflow,
        nodes: current.workflow.nodes.map((node) => {
          if (node.id === uploadTargetNodeId && node.type === "reference") {
            const referencePayload = (node as WorkflowNode<"reference">).payload;
            return {
              ...node,
              payload: {
                ...referencePayload,
                primaryImageId: referencePayload.primaryImageId || nextImages[0]?.id,
                images: [...referencePayload.images, ...nextImages],
              },
            };
          }
          return node;
        }),
      },
    }));
    setStatusText(`已向「${referenceNode.title}」追加 ${nextImages.length} 张参考图。`);
    setUploadTargetNodeId(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function addNode(type: WorkflowNodeType) {
    if (!product) return;
    if (type === "product" && product.workflow.nodes.some((node) => node.type === "product")) {
      setStatusText("第一版只保留一个商品信息节点，直接编辑现有节点即可。");
      return;
    }

    const position = getNextNodePosition(product, type);
    const labelIndex = product.workflow.nodes.filter((node) => node.type === type).length + 1;
    const node = createWorkflowNode(type, position, labelIndex);

    patchProduct((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      workflow: {
        ...current.workflow,
        nodes: [...current.workflow.nodes, node],
      },
    }));
    setSelectedNodeId(node.id);
    setStatusText(`已新增 ${nodeTypeLabels[type]} 节点。`);
  }

  function removeSelectedNode() {
    if (!product || !selectedNode) return;
    if (!window.confirm(`确认删除节点「${selectedNode.title}」吗？`)) return;
    patchProduct((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      workflow: {
        ...current.workflow,
        nodes: current.workflow.nodes.filter((node) => node.id !== selectedNode.id),
        edges: current.workflow.edges.filter((edge) => edge.source !== selectedNode.id && edge.target !== selectedNode.id),
      },
    }));
    setStatusText(`已删除节点「${selectedNode.title}」。`);
    setSelectedNodeId(null);
    if (connectSourceId === selectedNode.id) {
      setConnectSourceId(null);
    }
  }

  function handleNodeClick(node: WorkflowNode) {
    if (!product) return;
    setSelectedNodeId(node.id);
    if (connectSourceId && connectSourceId !== node.id) {
      const sourceNode = product.workflow.nodes.find((item) => item.id === connectSourceId);
      if (!sourceNode) {
        setConnectSourceId(null);
        return;
      }
      if (!canConnect(sourceNode, node)) {
        setStatusText(`不能从 ${nodeTypeLabels[sourceNode.type]} 连接到 ${nodeTypeLabels[node.type]}。`);
        return;
      }
      if (edgeExists(product.workflow.edges, sourceNode.id, node.id)) {
        setStatusText("这条连线已经存在了。");
        setConnectSourceId(null);
        return;
      }
      patchProduct((current) => ({
        ...current,
        updatedAt: new Date().toISOString(),
        workflow: {
          ...current.workflow,
          edges: [...current.workflow.edges, { id: makeId(), source: sourceNode.id, target: node.id }],
        },
      }));
      setStatusText(`已创建连线：${sourceNode.title} → ${node.title}`);
      setConnectSourceId(null);
    }
  }

  function startConnecting(nodeId: string) {
    setConnectSourceId(nodeId);
    const node = product?.workflow.nodes.find((item) => item.id === nodeId);
    setStatusText(node ? `正在从「${node.title}」发起连线，请点击目标节点。` : "请选择目标节点。");
  }

  function removeEdge(edgeId: string) {
    patchProduct((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      workflow: {
        ...current.workflow,
        edges: current.workflow.edges.filter((edge) => edge.id !== edgeId),
      },
    }));
    setStatusText("已删除连线。");
  }

  async function runResultNode(nodeId: string) {
    if (!product) return;
    setRunningNodeId(nodeId);
    setStatusText("正在生成图片，请稍候...");
    try {
      const execution = await executeResultNode(product, nodeId);
      patchProduct(() => execution.product);
      setSelectedNodeId(nodeId);
      setPromptPreview(execution.prompt);
      setStatusText(`生成完成：已产出 ${execution.run.outputs.length} 个版块，共 ${execution.run.totalImages} 张图片。`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "运行失败");
    } finally {
      setRunningNodeId(null);
    }
  }

  function runCopyNode(nodeId: string) {
    if (!product) return;
    try {
      const nextProduct = generateCopyForNode(product, nodeId);
      patchProduct(() => nextProduct);
      const copyNode = getNodeById(nextProduct.workflow, nodeId) as WorkflowNode<"copy"> | undefined;
      setStatusText(
        copyNode
          ? `已生成 ${copyNode.payload.cards.length} 张主图卡与 ${copyNode.payload.detailModules.length} 个详情模块。`
          : "已根据电商视觉文案 SOP 生成新的画面卡片。",
      );
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "生成视觉文案失败");
    }
  }

  function previewResultPrompt(nodeId: string) {
    if (!product) return;
    try {
      const preview = buildPromptPreview(product, nodeId);
      if (preview.product.updatedAt !== product.updatedAt) {
        patchProduct(() => preview.product);
      }
      setPromptPreview(preview.prompt);
      setStatusText(
        `预览已更新：主图 ${preview.mainCardCount} 张 + 详情模块 ${preview.detailModuleCount} 个，每个版块 ${preview.outputCount} 张候选。`,
      );
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "预览失败");
    }
  }

  function setZoom(nextZoom: number) {
    patchProduct((current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      workflow: {
        ...current.workflow,
        viewport: {
          zoom: Math.max(0.65, Math.min(1.5, Number(nextZoom.toFixed(2)))),
        },
      },
    }));
  }

  if (!ready) {
    return <main style={centerStyle}>正在加载本地商品工作台...</main>;
  }

  if (!product) {
    return (
      <main style={centerStyle}>
        <div style={missingPanelStyle}>
          <h1 style={{ margin: 0 }}>找不到这个商品工作台</h1>
          <p style={{ margin: "12px 0 20px", color: "#78716c" }}>该商品可能已被删除，或者浏览器本地数据已清空。</p>
          <button type="button" onClick={() => router.push("/products")} style={primaryButtonStyle}>
            返回商品列表
          </button>
        </div>
      </main>
    );
  }

  const zoom = product.workflow.viewport.zoom || 1;
  const edges = product.workflow.edges
    .map((edge) => {
      const source = product.workflow.nodes.find((node) => node.id === edge.source);
      const target = product.workflow.nodes.find((node) => node.id === edge.target);
      if (!source || !target) return null;
      return { edge, source, target };
    })
    .filter(Boolean) as Array<{ edge: WorkflowEdge; source: WorkflowNode; target: WorkflowNode }>;

  const referenceNodes = getNodesByType(product.workflow, "reference");
  const copyNodes = getNodesByType(product.workflow, "copy");

  return (
    <>
      <main style={workbenchShellStyle}>
        <div style={tabsWrapStyle}>
          <AppTabs activeTab="workbench" />
        </div>
        <header style={headerStyle}>
          <div style={{ minWidth: 0 }}>
            <div style={headerRowStyle}>
              <Link href="/products" style={backLinkStyle}>
                ← 返回商品列表
              </Link>
              <div style={pillStyle}>{product.name}</div>
            </div>
            <h1 style={pageTitleStyle}>{product.name}</h1>
            <p style={pageDescStyle}>{summarizeProduct(product)}</p>
          </div>
          <div style={headerActionsStyle}>
            <button type="button" style={ghostButtonStyle} onClick={() => setZoom(zoom - 0.1)}>
              缩小
            </button>
            <button type="button" style={ghostButtonStyle} onClick={() => setZoom(1)}>
              重置缩放 {Math.round(zoom * 100)}%
            </button>
            <button type="button" style={ghostButtonStyle} onClick={() => setZoom(zoom + 0.1)}>
              放大
            </button>
          </div>
        </header>

        <section style={statusBarStyle}>
          <span>{statusText}</span>
          {connectSourceId ? (
            <button type="button" style={ghostButtonStyle} onClick={() => setConnectSourceId(null)}>
              取消连线
            </button>
          ) : null}
        </section>

        <section style={contentGridStyle}>
          <div style={canvasPanelStyle}>
            <div style={canvasToolbarStyle}>
              <div>
                <div style={sectionTitleStyle}>工作流画布</div>
                <div style={sectionDescStyle}>支持新增/编辑节点、拖动位置、连线和结果回填。</div>
              </div>
              <div style={toolbarChipRowStyle}>
                {(["product", "reference", "copy", "process", "result"] as WorkflowNodeType[]).map((type) => (
                  <button key={type} type="button" style={chipButtonStyle} onClick={() => addNode(type)}>
                    + {nodeTypeLabels[type]}
                  </button>
                ))}
              </div>
            </div>

            <div style={canvasScrollerStyle}>
              <div style={{ ...workspaceStyle, width: CANVAS_WIDTH * zoom, height: CANVAS_HEIGHT * zoom }}>
                <div style={{ ...workspaceInnerStyle, transform: `scale(${zoom})`, transformOrigin: "top left" }}>
                  <svg width={CANVAS_WIDTH} height={CANVAS_HEIGHT} style={edgeLayerStyle}>
                    {edges.map(({ edge, source, target }) => {
                      const sourcePoint = getNodeCenter(source);
                      const targetPoint = getNodeCenter(target);
                      const curveOffset = Math.max(80, Math.abs(targetPoint.x - sourcePoint.x) / 2);
                      const path = `M ${sourcePoint.x} ${sourcePoint.y} C ${sourcePoint.x + curveOffset} ${sourcePoint.y}, ${targetPoint.x - curveOffset} ${targetPoint.y}, ${targetPoint.x} ${targetPoint.y}`;
                      return (
                        <g key={edge.id}>
                          <path
                            d={path}
                            fill="none"
                            stroke="#a8a29e"
                            strokeWidth={2.5}
                            strokeDasharray={selectedNodeId && (edge.source === selectedNodeId || edge.target === selectedNodeId) ? "0" : "6 5"}
                          />
                          <circle cx={targetPoint.x} cy={targetPoint.y} r={5} fill="#1c1917" />
                        </g>
                      );
                    })}
                  </svg>

                  {product.workflow.nodes.map((node) => {
                    const accent = nodeAccent[node.type];
                    const isSelected = selectedNodeId === node.id;
                    const isConnecting = connectSourceId === node.id;
                    return (
                      <article
                        key={node.id}
                        style={{
                          ...nodeCardStyle,
                          width: NODE_WIDTH,
                          minHeight: NODE_HEIGHT,
                          left: node.position.x,
                          top: node.position.y,
                          background: accent.bg,
                          borderColor: isSelected ? accent.chip : accent.border,
                          boxShadow: isSelected
                            ? `0 0 0 2px ${accent.chip}22, 0 18px 40px rgba(28, 25, 23, 0.12)`
                            : "0 10px 24px rgba(28, 25, 23, 0.08)",
                        }}
                        onClick={() => handleNodeClick(node)}
                      >
                        <div
                          style={nodeHeaderStyle}
                          onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
                            event.stopPropagation();
                            dragRef.current = {
                              nodeId: node.id,
                              startX: event.clientX,
                              startY: event.clientY,
                              originX: node.position.x,
                              originY: node.position.y,
                            };
                          }}
                        >
                          <div>
                            <div style={{ ...nodeTypeChipStyle, color: accent.chip }}>{nodeTypeLabels[node.type]}</div>
                            <div style={nodeTitleStyle}>{node.title}</div>
                          </div>
                          <div style={{ ...tinyDotStyle, background: isConnecting ? accent.chip : "#d6d3d1" }} />
                        </div>
                        <div style={nodeBodyStyle}>
                          <div style={nodeDescStyle}>{nodeTypeDescriptions[node.type]}</div>
                          <div style={nodeMetaStyle}>{describeNode(node)}</div>
                          <div style={nodeActionRowStyle}>
                            <button
                              type="button"
                              style={smallButtonStyle}
                              onClick={(event) => {
                                event.stopPropagation();
                                setSelectedNodeId(node.id);
                              }}
                            >
                              编辑
                            </button>
                            {connectionRules[node.type].length > 0 ? (
                              <button
                                type="button"
                                style={smallButtonStyle}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  startConnecting(node.id);
                                }}
                              >
                                连线
                              </button>
                            ) : null}
                            {node.type === "copy" ? (
                              <button
                                type="button"
                                style={smallButtonStyle}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  runCopyNode(node.id);
                                }}
                              >
                                生成文案
                              </button>
                            ) : null}
                            {node.type === "result" ? (
                              <button
                                type="button"
                                style={smallPrimaryStyle}
                                disabled={runningNodeId === node.id}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void runResultNode(node.id);
                                }}
                              >
                                {runningNodeId === node.id ? "运行中" : "运行"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <aside style={sidePanelStyle}>
            <div style={inspectorHeaderStyle}>
              <div>
                <div style={sectionTitleStyle}>节点配置</div>
                <div style={sectionDescStyle}>选中节点后在右侧编辑，修改会自动保存。</div>
              </div>
              <button type="button" style={dangerPillStyle} disabled={!selectedNode} onClick={removeSelectedNode}>
                删除节点
              </button>
            </div>

            {!selectedNode ? <div style={emptyInspectorStyle}>请选择一个节点开始编辑。</div> : null}

            {selectedNode ? (
              <div style={inspectorBodyStyle}>
                <ProductField label="节点名称">
                  <input
                    value={selectedNode.title}
                    onChange={(event) =>
                      patchProduct((current) => ({
                        ...current,
                        updatedAt: new Date().toISOString(),
                        workflow: {
                          ...current.workflow,
                          nodes: current.workflow.nodes.map((node) =>
                            node.id === selectedNode.id ? { ...node, title: event.target.value } : node,
                          ),
                        },
                      }))
                    }
                    style={inputStyle}
                  />
                </ProductField>

                {selectedNode.type === "product" ? (
                  <ProductNodeInspector
                    node={selectedNode as WorkflowNode<"product">}
                    onChange={(payload) =>
                      patchProduct((current) => ({
                        ...current,
                        updatedAt: new Date().toISOString(),
                        workflow: {
                          ...current.workflow,
                          nodes: current.workflow.nodes.map((item) =>
                            item.id === selectedNode.id ? { ...item, payload } : item,
                          ),
                        },
                      }))
                    }
                  />
                ) : null}

                {selectedNode.type === "reference" ? (
                  <ReferenceNodeInspector
                    node={selectedNode as WorkflowNode<"reference">}
                    onChange={(payload) =>
                      patchProduct((current) => ({
                        ...current,
                        updatedAt: new Date().toISOString(),
                        workflow: {
                          ...current.workflow,
                          nodes: current.workflow.nodes.map((item) =>
                            item.id === selectedNode.id ? { ...item, payload } : item,
                          ),
                        },
                      }))
                    }
                    onUpload={() => {
                      setUploadTargetNodeId(selectedNode.id);
                      fileInputRef.current?.click();
                    }}
                    onPreview={(src, title) => setPreviewImage({ src, title })}
                  />
                ) : null}

                {selectedNode.type === "copy" ? (
                  <CopyNodeInspector
                    node={selectedNode as WorkflowNode<"copy">}
                    onGenerate={() => runCopyNode(selectedNode.id)}
                    onChange={(payload) =>
                      patchProduct((current) => ({
                        ...current,
                        updatedAt: new Date().toISOString(),
                        workflow: {
                          ...current.workflow,
                          nodes: current.workflow.nodes.map((item) =>
                            item.id === selectedNode.id ? { ...item, payload } : item,
                          ),
                        },
                      }))
                    }
                  />
                ) : null}

                {selectedNode.type === "process" ? (
                  <ProcessNodeInspector
                    node={selectedNode as WorkflowNode<"process">}
                    onChange={(payload) =>
                      patchProduct((current) => ({
                        ...current,
                        updatedAt: new Date().toISOString(),
                        workflow: {
                          ...current.workflow,
                          nodes: current.workflow.nodes.map((item) =>
                            item.id === selectedNode.id ? { ...item, payload } : item,
                          ),
                        },
                      }))
                    }
                  />
                ) : null}

                {selectedNode.type === "result" ? (
                  <ResultNodeInspector
                    node={selectedNode as WorkflowNode<"result">}
                    product={product}
                    promptPreview={promptPreview}
                    referenceNodes={referenceNodes}
                    copyNodes={copyNodes}
                    running={runningNodeId === selectedNode.id}
                    onRun={() => void runResultNode(selectedNode.id)}
                    onPreviewPrompt={() => previewResultPrompt(selectedNode.id)}
                    onFillReference={(runId, imageId, referenceNodeId) => {
                      try {
                        const nextProduct = appendGeneratedImageToReference(product, {
                          resultNodeId: selectedNode.id,
                          runId,
                          imageId,
                          referenceNodeId,
                        });
                        patchProduct(() => nextProduct);
                        setStatusText("已将候选图回填到参考图节点。");
                      } catch (error) {
                        setStatusText(error instanceof Error ? error.message : "回填失败");
                      }
                    }}
                    onChange={(payload) =>
                      patchProduct((current) => ({
                        ...current,
                        updatedAt: new Date().toISOString(),
                        workflow: {
                          ...current.workflow,
                          nodes: current.workflow.nodes.map((item) =>
                            item.id === selectedNode.id ? { ...item, payload } : item,
                          ),
                        },
                      }))
                    }
                    onPreviewImage={(src, title) => setPreviewImage({ src, title })}
                  />
                ) : null}

                <div style={edgePanelStyle}>
                  <div style={subTitleStyle}>相关连线</div>
                  <div style={{ display: "grid", gap: 8 }}>
                    {product.workflow.edges
                      .filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id)
                      .map((edge) => {
                        const source = product.workflow.nodes.find((node) => node.id === edge.source);
                        const target = product.workflow.nodes.find((node) => node.id === edge.target);
                        return (
                          <div key={edge.id} style={edgeItemStyle}>
                            <div style={{ minWidth: 0 }}>
                              <div style={{ fontWeight: 600 }}>{source?.title || "未知节点"}</div>
                              <div style={edgeMetaStyle}>→ {target?.title || "未知节点"}</div>
                            </div>
                            <button type="button" style={dangerMiniStyle} onClick={() => removeEdge(edge.id)}>
                              删除
                            </button>
                          </div>
                        );
                      })}
                    {product.workflow.edges.filter((edge) => edge.source === selectedNode.id || edge.target === selectedNode.id).length ===
                    0 ? (
                      <div style={miniHintStyle}>这个节点还没有关联连线。</div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </aside>
        </section>
      </main>

      <input ref={fileInputRef} hidden type="file" multiple accept="image/*" onChange={(event) => void handleUpload(event.target.files)} />

      {previewImage ? (
        <div style={previewOverlayStyle} onClick={() => setPreviewImage(null)} role="presentation">
          <div style={previewDialogStyle} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
            <button type="button" style={previewCloseStyle} onClick={() => setPreviewImage(null)}>
              ×
            </button>
            <div style={previewTitleStyle}>{previewImage.title}</div>
            <img src={previewImage.src} alt={previewImage.title} style={previewImageStyle} />
          </div>
        </div>
      ) : null}
    </>
  );
}

function ProductNodeInspector({
  node,
  onChange,
}: {
  node: WorkflowNode<"product">;
  onChange: (payload: WorkflowNode<"product">["payload"]) => void;
}) {
  const payload = node.payload;
  return (
    <div style={inspectorGroupStyle}>
      <ProductField label="商品名">
        <input value={payload.productName} onChange={(event) => onChange({ ...payload, productName: event.target.value })} style={inputStyle} />
      </ProductField>
      <TwoColumn>
        <ProductField label="类目">
          <input value={payload.category} onChange={(event) => onChange({ ...payload, category: event.target.value })} style={inputStyle} />
        </ProductField>
        <ProductField label="平台">
          <select value={payload.platform} onChange={(event) => onChange({ ...payload, platform: event.target.value as typeof payload.platform })} style={inputStyle}>
            {platformOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </ProductField>
      </TwoColumn>
      <TwoColumn>
        <ProductField label="品牌名">
          <input value={payload.brand} onChange={(event) => onChange({ ...payload, brand: event.target.value })} style={inputStyle} />
        </ProductField>
        <ProductField label="公司全称">
          <input value={payload.company} onChange={(event) => onChange({ ...payload, company: event.target.value })} style={inputStyle} />
        </ProductField>
      </TwoColumn>
      <TwoColumn>
        <ProductField label="价格信息">
          <input
            value={payload.priceText}
            onChange={(event) => onChange({ ...payload, priceText: event.target.value })}
            style={inputStyle}
            placeholder="例如：券后 59 元 / 第二件 9 折"
          />
        </ProductField>
        <ProductField label="目标人群">
          <input
            value={payload.targetAudience}
            onChange={(event) => onChange({ ...payload, targetAudience: event.target.value })}
            style={inputStyle}
            placeholder="例如：办公室轻食人群"
          />
        </ProductField>
      </TwoColumn>
      <ProductField label="SKU / 规格">
        <textarea
          value={payload.skuText}
          onChange={(event) => onChange({ ...payload, skuText: event.target.value })}
          style={textareaStyle}
          placeholder={"按行写规格与价格，例如：\n380g / 原味 / 59 元"}
        />
      </ProductField>
      <ProductField label="核心卖点">
        <textarea
          value={payload.sellingPoints}
          onChange={(event) => onChange({ ...payload, sellingPoints: event.target.value })}
          style={textareaStyle}
          placeholder={"按行填写 3-5 条卖点，例如：\n高蛋白\n独立小包装\n0 反式脂肪酸"}
        />
      </ProductField>
      <ProductField label="信任证据">
        <textarea
          value={payload.trustEvidence}
          onChange={(event) => onChange({ ...payload, trustEvidence: event.target.value })}
          style={textareaStyle}
          placeholder="例如：认证、专利、材质、工艺、报告、资质"
        />
      </ProductField>
      <ProductField label="合规提醒">
        <textarea value={payload.complianceNotes} onChange={(event) => onChange({ ...payload, complianceNotes: event.target.value })} style={textareaStyle} />
      </ProductField>
      <ProductField label="补充上下文">
        <textarea
          value={payload.extraContext}
          onChange={(event) => onChange({ ...payload, extraContext: event.target.value })}
          style={textareaStyle}
          placeholder="目标场景、竞品差异、活动节点等"
        />
      </ProductField>
    </div>
  );
}

function ReferenceNodeInspector({
  node,
  onChange,
  onUpload,
  onPreview,
}: {
  node: WorkflowNode<"reference">;
  onChange: (payload: WorkflowNode<"reference">["payload"]) => void;
  onUpload: () => void;
  onPreview: (src: string, title: string) => void;
}) {
  const payload = node.payload;
  return (
    <div style={inspectorGroupStyle}>
      <div style={actionBarStyle}>
        <button type="button" style={primaryButtonStyle} onClick={onUpload}>
          上传参考图
        </button>
        <div style={miniHintStyle}>已上传 {payload.images.length} 张</div>
      </div>

      <ProductField label="合图策略">
        <select
          value={payload.mergeStrategy}
          onChange={(event) => onChange({ ...payload, mergeStrategy: event.target.value as typeof payload.mergeStrategy })}
          style={inputStyle}
        >
          <option value="hero-first">主图优先</option>
          <option value="scene-first">场景优先</option>
          <option value="detail-first">细节优先</option>
        </select>
      </ProductField>
      <ProductField label="上传说明">
        <textarea value={payload.uploadNotes} onChange={(event) => onChange({ ...payload, uploadNotes: event.target.value })} style={textareaStyle} />
      </ProductField>

      <div style={{ display: "grid", gap: 12 }}>
        {payload.images.map((image) => (
          <div key={image.id} style={imageItemStyle}>
            <div style={{ display: "flex", gap: 12 }}>
              <button type="button" style={thumbButtonStyle} onClick={() => image.dataUrl && onPreview(image.dataUrl, image.name)}>
                {image.dataUrl ? <img src={image.dataUrl} alt={image.name} style={thumbStyle} /> : <div style={thumbFallbackStyle}>无预览</div>}
              </button>
              <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 8 }}>
                <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{image.name}</div>
                <TwoColumn>
                  <ProductField label="角色">
                    <select
                      value={image.role}
                      onChange={(event) =>
                        onChange({
                          ...payload,
                          images: payload.images.map((item) =>
                            item.id === image.id ? { ...item, role: event.target.value as typeof image.role } : item,
                          ),
                        })
                      }
                      style={inputStyle}
                    >
                      {referenceRoleOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </ProductField>
                  <ProductField label="主参考图">
                    <button
                      type="button"
                      style={payload.primaryImageId === image.id ? smallPrimaryStyle : smallButtonStyle}
                      onClick={() => onChange({ ...payload, primaryImageId: image.id })}
                    >
                      {payload.primaryImageId === image.id ? "当前主图" : "设为主图"}
                    </button>
                  </ProductField>
                </TwoColumn>
                <ProductField label="备注">
                  <textarea
                    value={image.notes}
                    onChange={(event) =>
                      onChange({
                        ...payload,
                        images: payload.images.map((item) =>
                          item.id === image.id ? { ...item, notes: event.target.value } : item,
                        ),
                      })
                    }
                    style={textareaStyle}
                    placeholder="例如：保留包装正面 logo、重点使用瓶身角度"
                  />
                </ProductField>
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
              <div style={miniHintStyle}>{image.width && image.height ? `${image.width} × ${image.height}` : "未记录尺寸"}</div>
              <button
                type="button"
                style={dangerMiniStyle}
                onClick={() =>
                  onChange({
                    ...payload,
                    primaryImageId:
                      payload.primaryImageId === image.id ? payload.images.find((item) => item.id !== image.id)?.id : payload.primaryImageId,
                    images: payload.images.filter((item) => item.id !== image.id),
                  })
                }
              >
                删除图片
              </button>
            </div>
          </div>
        ))}
        {payload.images.length === 0 ? <div style={miniHintStyle}>还没有参考图，建议至少上传 1 张商品主图。</div> : null}
      </div>
    </div>
  );
}

function CopyNodeInspector({
  node,
  onGenerate,
  onChange,
}: {
  node: WorkflowNode<"copy">;
  onGenerate: () => void;
  onChange: (payload: CopyNodePayload) => void;
}) {
  const payload = node.payload;
  const updateMainCard = (cardId: string, patch: Partial<VisualPlanCard>) => {
    onChange({
      ...payload,
      cards: payload.cards.map((item) => (item.id === cardId ? { ...item, ...patch } : item)),
    });
  };

  const updateDetailModule = (cardId: string, patch: Partial<VisualPlanCard>) => {
    onChange({
      ...payload,
      detailModules: payload.detailModules.map((item) => (item.id === cardId ? { ...item, ...patch } : item)),
    });
  };

  const renderPlanEditor = (
    card: VisualPlanCard,
    index: number,
    options: {
      onPatch: (patch: Partial<VisualPlanCard>) => void;
      titleFallback: string;
    },
  ) => (
    <div key={card.id} style={cardEditorStyle}>
      <div style={cardEditorTitleStyle}>
        {card.slot || `${options.titleFallback} ${index + 1}`}
        {card.optional ? <span style={optionalBadgeStyle}>可选</span> : null}
      </div>
      <ProductField label={card.kind === "main" ? "画面标题" : "模块标题"}>
        <input value={card.slot} onChange={(event) => options.onPatch({ slot: event.target.value })} style={inputStyle} />
      </ProductField>
      <TwoColumn>
        <ProductField label="单独输出比例">
          <div style={{ display: "grid", gap: 6 }}>
            <select
              value={card.aspectRatio || ""}
              onChange={(event) => options.onPatch({ aspectRatio: (event.target.value || undefined) as AspectRatio | undefined })}
              style={inputStyle}
            >
              <option value="">继承图片处理节点默认比例</option>
              {aspectRatioOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            <div style={miniHintStyle}>{card.kind === "detail" ? "详情模块默认建议用 9:16，也可以改成任意可选比例。" : "留空时跟随图片处理节点的默认比例。"}</div>
          </div>
        </ProductField>
        <ProductField label="价格展示">
          <label style={checkboxLineStyle}>
            <input type="checkbox" checked={Boolean(card.includePrice)} onChange={(event) => options.onPatch({ includePrice: event.target.checked })} />
            <span>本版块展示价格 / 优惠信息</span>
          </label>
        </ProductField>
      </TwoColumn>
      <ProductField label="画面内容">
        <textarea value={card.scene} onChange={(event) => options.onPatch({ scene: event.target.value })} style={textareaStyle} />
      </ProductField>
      <ProductField label="图内文案">
        <textarea value={card.overlay} onChange={(event) => options.onPatch({ overlay: event.target.value })} style={textareaStyle} />
      </ProductField>
      <ProductField label="设计说明">
        <textarea value={card.designNotes} onChange={(event) => options.onPatch({ designNotes: event.target.value })} style={textareaStyle} />
      </ProductField>
    </div>
  );

  return (
    <div style={inspectorGroupStyle}>
      <div style={actionBarStyle}>
        <button type="button" style={primaryButtonStyle} onClick={onGenerate}>
          基于商品信息生成 SOP
        </button>
        <div style={miniHintStyle}>
          {payload.cards.length > 0 ? `上次生成：${payload.lastGeneratedAt ? formatTime(payload.lastGeneratedAt) : "刚刚"}` : "尚未生成"}
        </div>
      </div>
      <TwoColumn>
        <ProductField label="文案语气">
          <input value={payload.tone} onChange={(event) => onChange({ ...payload, tone: event.target.value })} style={inputStyle} />
        </ProductField>
        <ProductField label="合规类型">
          <select
            value={payload.complianceLevel}
            onChange={(event) => onChange({ ...payload, complianceLevel: event.target.value as typeof payload.complianceLevel })}
            style={inputStyle}
          >
            {complianceOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </ProductField>
      </TwoColumn>
      <ProductField label="优先策略">
        <textarea value={payload.priorityNotes} onChange={(event) => onChange({ ...payload, priorityNotes: event.target.value })} style={textareaStyle} />
      </ProductField>
      <ProductField label="执行摘要">
        <textarea value={payload.summary} onChange={(event) => onChange({ ...payload, summary: event.target.value })} style={textareaStyle} />
      </ProductField>

      <div style={subSectionStyle}>
        <div style={subTitleStyle}>必卖理由</div>
        {payload.reasons.map((reason, index) => (
          <div key={reason.id} style={cardEditorStyle}>
            <div style={cardEditorTitleStyle}>理由 {index + 1}</div>
            <TwoColumn>
              <ProductField label="目标人群">
                <input
                  value={reason.audience}
                  onChange={(event) =>
                    onChange({
                      ...payload,
                      reasons: payload.reasons.map((item) =>
                        item.id === reason.id ? { ...item, audience: event.target.value } : item,
                      ),
                    })
                  }
                  style={inputStyle}
                />
              </ProductField>
              <ProductField label="优先级">
                <select
                  value={String(reason.priority)}
                  onChange={(event) =>
                    onChange({
                      ...payload,
                      reasons: payload.reasons.map((item) =>
                        item.id === reason.id ? { ...item, priority: Number(event.target.value) as typeof item.priority } : item,
                      ),
                    })
                  }
                  style={inputStyle}
                >
                  <option value="5">★★★★★</option>
                  <option value="4">★★★★</option>
                  <option value="3">★★★</option>
                </select>
              </ProductField>
            </TwoColumn>
            <ProductField label="痛点">
              <textarea
                value={reason.painPoint}
                onChange={(event) =>
                  onChange({
                    ...payload,
                    reasons: payload.reasons.map((item) =>
                      item.id === reason.id ? { ...item, painPoint: event.target.value } : item,
                    ),
                  })
                }
                style={textareaStyle}
              />
            </ProductField>
            <ProductField label="解决方案">
              <textarea
                value={reason.solution}
                onChange={(event) =>
                  onChange({
                    ...payload,
                    reasons: payload.reasons.map((item) =>
                      item.id === reason.id ? { ...item, solution: event.target.value } : item,
                    ),
                  })
                }
                style={textareaStyle}
              />
            </ProductField>
            <ProductField label="利益翻译">
              <textarea
                value={reason.translatedBenefit}
                onChange={(event) =>
                  onChange({
                    ...payload,
                    reasons: payload.reasons.map((item) =>
                      item.id === reason.id ? { ...item, translatedBenefit: event.target.value } : item,
                    ),
                  })
                }
                style={textareaStyle}
              />
            </ProductField>
            <ProductField label="信任证据">
              <textarea
                value={reason.evidence}
                onChange={(event) =>
                  onChange({
                    ...payload,
                    reasons: payload.reasons.map((item) =>
                      item.id === reason.id ? { ...item, evidence: event.target.value } : item,
                    ),
                  })
                }
                style={textareaStyle}
              />
            </ProductField>
          </div>
        ))}
        {payload.reasons.length === 0 ? <div style={miniHintStyle}>点击“基于商品信息生成 SOP”后，这里会出现 3-5 条必卖理由。</div> : null}
      </div>

      <div style={subSectionStyle}>
        <div style={subTitleStyle}>5 张视觉执行卡</div>
        <div style={miniHintStyle}>每张主图都可以单独改比例，也可以决定是否展示价格，避免 5 张图长得太像。</div>
        {payload.cards.map((card, index) =>
          renderPlanEditor(card, index, {
            onPatch: (patch) => updateMainCard(card.id, patch),
            titleFallback: "图",
          }),
        )}
      </div>

      <div style={subSectionStyle}>
        <div style={{ ...actionBarStyle, alignItems: "center" }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={subTitleStyle}>详情页模块（按需取舍）</div>
            <div style={miniHintStyle}>详情模块已支持单独尺寸，比如统一改成 9:16。</div>
          </div>
          <button
            type="button"
            style={ghostButtonStyle}
            onClick={() =>
              onChange({
                ...payload,
                detailModules: payload.detailModules.map((item) => ({ ...item, aspectRatio: "9:16" })),
              })
            }
          >
            详情模块全部改为 9:16
          </button>
        </div>
        {payload.detailModules.map((card, index) =>
          renderPlanEditor(card, index, {
            onPatch: (patch) => updateDetailModule(card.id, patch),
            titleFallback: "模块",
          }),
        )}
        {payload.detailModules.length === 0 ? <div style={miniHintStyle}>生成 SOP 后，这里会出现可选详情模块。</div> : null}
      </div>

      <ProductField label="风险提醒（每行一条）">
        <textarea value={payload.riskNotes.join("\n")} onChange={(event) => onChange({ ...payload, riskNotes: parseTextLines(event.target.value) })} style={textareaStyle} />
      </ProductField>
    </div>
  );
}

function ProcessNodeInspector({
  node,
  onChange,
}: {
  node: WorkflowNode<"process">;
  onChange: (payload: WorkflowNode<"process">["payload"]) => void;
}) {
  const payload = node.payload;
  return (
    <div style={inspectorGroupStyle}>
      <TwoColumn>
        <ProductField label="默认输出比例">
          <select
            value={payload.aspectRatio}
            onChange={(event) => onChange({ ...payload, aspectRatio: event.target.value as AspectRatio })}
            style={inputStyle}
          >
            {aspectRatioOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </ProductField>
        <ProductField label="每个版块候选数">
          <input
            type="number"
            min={1}
            max={4}
            value={payload.outputCount}
            onChange={(event) => onChange({ ...payload, outputCount: Math.max(1, Math.min(4, Number(event.target.value) || 1)) })}
            style={inputStyle}
          />
        </ProductField>
      </TwoColumn>
      <TwoColumn>
        <ProductField label="背景风格">
          <select
            value={payload.background}
            onChange={(event) => onChange({ ...payload, background: event.target.value as typeof payload.background })}
            style={inputStyle}
          >
            {backgroundOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </ProductField>
        <ProductField label="缩放策略">
          <select value={payload.fit} onChange={(event) => onChange({ ...payload, fit: event.target.value as typeof payload.fit })} style={inputStyle}>
            {fitOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </ProductField>
      </TwoColumn>
      <TwoColumn>
        <ProductField label="标准化像素边长">
          <input
            type="number"
            min={960}
            max={2400}
            step={80}
            value={payload.maxSide}
            onChange={(event) => onChange({ ...payload, maxSide: Math.max(960, Math.min(2400, Number(event.target.value) || 1600)) })}
            style={inputStyle}
          />
        </ProductField>
        <ProductField label="裁切焦点">
          <input value={payload.cropFocus} onChange={(event) => onChange({ ...payload, cropFocus: event.target.value })} style={inputStyle} />
        </ProductField>
      </TwoColumn>
      <ProductField label="遮罩/保留说明">
        <textarea value={payload.maskHint} onChange={(event) => onChange({ ...payload, maskHint: event.target.value })} style={textareaStyle} />
      </ProductField>
      <ProductField label="修图要求">
        <textarea value={payload.retouchNotes} onChange={(event) => onChange({ ...payload, retouchNotes: event.target.value })} style={textareaStyle} />
      </ProductField>
      <ProductField label="补充 Prompt 指令">
        <textarea value={payload.promptNotes} onChange={(event) => onChange({ ...payload, promptNotes: event.target.value })} style={textareaStyle} />
      </ProductField>
    </div>
  );
}

function ResultNodeInspector({
  node,
  promptPreview,
  referenceNodes,
  copyNodes,
  running,
  onRun,
  onPreviewPrompt,
  onFillReference,
  onChange,
  onPreviewImage,
}: {
  node: WorkflowNode<"result">;
  product: ProductRecord;
  promptPreview: string;
  referenceNodes: WorkflowNode<"reference">[];
  copyNodes: WorkflowNode<"copy">[];
  running: boolean;
  onRun: () => void;
  onPreviewPrompt: () => void;
  onFillReference: (runId: string, imageId: string, referenceNodeId?: string) => void;
  onChange: (payload: ResultNodePayload) => void;
  onPreviewImage: (src: string, title: string) => void;
}) {
  const payload = node.payload;
  const latestRun = getLatestRun(node);
  const mainCards = copyNodes.flatMap((copyNode) => copyNode.payload.cards);
  const detailModules = copyNodes.flatMap((copyNode) => copyNode.payload.detailModules);
  const selectedDetailIds = new Set(payload.selectedDetailModuleIds);

  return (
    <div style={inspectorGroupStyle}>
      <div style={actionBarStyle}>
        <button type="button" style={primaryButtonStyle} onClick={onRun} disabled={running}>
          {running ? "运行中..." : "运行整套主图 / 详情模块"}
        </button>
        <button type="button" style={ghostButtonStyle} onClick={onPreviewPrompt}>
          预览最终 Prompt
        </button>
      </div>
      <TwoColumn>
        <ProductField label="本次固定生成">
          <div style={resultInfoCardStyle}>
            <div style={resultInfoTitleStyle}>主图 5 张全套</div>
            <div style={miniHintStyle}>图1 点击率核心、图2 痛点共鸣、图3 差异化、图4 场景适配、图5 CTA 会一起生成。</div>
            <div style={miniHintStyle}>当前主图卡数量：{mainCards.length}</div>
            <div style={miniHintStyle}>每个版块可在“视觉文案”节点单独设置比例和是否展示价格。</div>
          </div>
        </ProductField>
        <ProductField label="默认回填到">
          <select
            value={payload.autoReferenceNodeId || ""}
            onChange={(event) => onChange({ ...payload, autoReferenceNodeId: event.target.value || undefined })}
            style={inputStyle}
          >
            <option value="">不默认指定</option>
            {referenceNodes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        </ProductField>
      </TwoColumn>
      <ProductField label="附加详情页模块">
        <div style={selectionGridStyle}>
          {detailModules.map((module) => {
            const checked = selectedDetailIds.has(module.id);
            return (
              <label key={module.id} style={{ ...selectionCardStyle, borderColor: checked ? "#8a6914" : "#e7e5e4", background: checked ? "#fffaf0" : "white" }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    const nextIds = event.target.checked
                      ? [...payload.selectedDetailModuleIds, module.id]
                      : payload.selectedDetailModuleIds.filter((id) => id !== module.id);
                    onChange({ ...payload, selectedDetailModuleIds: dedupeStrings(nextIds) });
                  }}
                />
                <div style={{ display: "grid", gap: 4 }}>
                  <div style={{ fontWeight: 700, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span>{module.slot}</span>
                    {module.optional ? <span style={optionalBadgeStyle}>可选</span> : null}
                    {module.aspectRatio ? <span style={optionalBadgeStyle}>{module.aspectRatio}</span> : null}
                  </div>
                  <div style={miniHintStyle}>{module.designNotes}</div>
                </div>
              </label>
            );
          })}
          {detailModules.length === 0 ? <div style={miniHintStyle}>请先在视觉文案节点生成 SOP，这里会出现可选详情模块。</div> : null}
        </div>
      </ProductField>
      <ProductField label="Prompt 预览">
        <textarea
          value={
            promptPreview ||
            latestRun?.prompt ||
            "点击“预览最终 Prompt”后，这里会显示将要送入图片模型的完整提示词。"
          }
          readOnly
          style={{ ...textareaStyle, minHeight: 220 }}
        />
      </ProductField>

      <div style={subSectionStyle}>
        <div style={subTitleStyle}>运行历史</div>
        {payload.history.map((run) => (
          <div key={run.id} style={runCardStyle}>
            <div style={runHeaderStyle}>
              <div>
                <div style={{ fontWeight: 700 }}>主图 + 详情模块批量运行</div>
                <div style={miniHintStyle}>
                  {formatTime(run.createdAt)} · {run.mode === "edit" ? "图生图" : "文生图"} · {run.size} · 共 {run.totalImages} 张
                </div>
              </div>
              {run.error ? <div style={errorBadgeStyle}>{run.error}</div> : <div style={successBadgeStyle}>成功</div>}
            </div>
            <div style={miniHintStyle}>{run.processSummary}</div>
            <div style={moduleRunListStyle}>
              {run.outputs.map((group) => (
                <div key={group.id} style={moduleRunCardStyle}>
                  <div style={moduleRunHeaderStyle}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{group.title}</div>
                      <div style={miniHintStyle}>
                        {group.kind === "main" ? "主图版块" : "详情模块"} · {group.size || run.size} · {group.images.length} 张
                      </div>
                    </div>
                    {group.error ? <div style={errorBadgeStyle}>{group.error}</div> : null}
                  </div>
                  <div style={resultGridStyle}>
                    {group.images.map((image) => (
                      <div key={image.id} style={resultItemStyle}>
                        {image.status === "success" && image.dataUrl ? (
                          <>
                            <button type="button" style={resultThumbButtonStyle} onClick={() => onPreviewImage(image.dataUrl!, image.name)}>
                              <img src={image.dataUrl} alt={image.name} style={{ ...resultThumbStyle, aspectRatio: aspectRatioToCss(group.size || run.size) }} />
                            </button>
                            <div style={resultActionStyle}>
                              <button type="button" style={smallButtonStyle} onClick={() => downloadDataUrl(image.dataUrl!, image.name)}>
                                下载
                              </button>
                              <button
                                type="button"
                                style={smallPrimaryStyle}
                                onClick={() => onFillReference(run.id, image.id, payload.autoReferenceNodeId)}
                              >
                                设为参考图
                              </button>
                            </div>
                          </>
                        ) : (
                          <div style={resultFallbackStyle}>{image.error || "生成失败"}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
        {payload.history.length === 0 ? <div style={miniHintStyle}>这个结果节点还没有运行过。</div> : null}
      </div>
    </div>
  );
}

const centerStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  padding: 24,
};

const missingPanelStyle: CSSProperties = {
  maxWidth: 480,
  borderRadius: 24,
  border: "1px solid #e7e5e4",
  background: "rgba(255,255,255,0.94)",
  padding: 28,
  textAlign: "center",
};

const workbenchShellStyle: CSSProperties = {
  minHeight: "100vh",
  padding: "20px 18px 28px",
  display: "grid",
  gap: 16,
  maxWidth: 1720,
  margin: "0 auto",
};

const tabsWrapStyle: CSSProperties = {
  display: "flex",
  justifyContent: "center",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  flexWrap: "wrap",
  alignItems: "flex-start",
};

const headerRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
  marginBottom: 8,
};

const backLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  border: "1px solid #d6d3d1",
  padding: "10px 14px",
  background: "rgba(255,255,255,0.9)",
};

const pillStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "6px 12px",
  background: "rgba(28, 25, 23, 0.08)",
  fontSize: 13,
  fontWeight: 600,
};

const pageTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 34,
  letterSpacing: "-0.04em",
};

const pageDescStyle: CSSProperties = {
  margin: "8px 0 0",
  color: "#57534e",
  fontSize: 14,
  lineHeight: 1.65,
};

const headerActionsStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  alignItems: "center",
  flexWrap: "wrap",
};

const statusBarStyle: CSSProperties = {
  borderRadius: 18,
  border: "1px solid rgba(231,229,228,0.9)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(251,250,247,0.92))",
  padding: "12px 16px",
  display: "flex",
  gap: 12,
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
};

const contentGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 380px",
  gap: 16,
  minHeight: "calc(100vh - 180px)",
};

const canvasPanelStyle: CSSProperties = {
  minWidth: 0,
  borderRadius: 28,
  border: "1px solid rgba(231,229,228,0.9)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(252,251,249,0.94))",
  padding: 16,
  display: "grid",
  gridTemplateRows: "auto minmax(0, 1fr)",
  gap: 14,
  boxShadow: "0 14px 36px rgba(41, 37, 36, 0.07)",
};

const canvasToolbarStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
  flexWrap: "wrap",
};

const sectionTitleStyle: CSSProperties = { fontSize: 20, fontWeight: 700 };
const sectionDescStyle: CSSProperties = { marginTop: 8, fontSize: 13, color: "#78716c" };

const toolbarChipRowStyle: CSSProperties = {
  display: "flex",
  gap: 10,
  flexWrap: "wrap",
  justifyContent: "flex-end",
};

const chipButtonStyle: CSSProperties = {
  border: "1px solid rgba(212,175,55,0.24)",
  borderRadius: 999,
  padding: "10px 14px",
  background: "rgba(255,250,237,0.88)",
  cursor: "pointer",
  fontSize: 13,
  color: "#8a6914",
  fontWeight: 600,
};

const canvasScrollerStyle: CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  borderRadius: 22,
  background: "#f8f7f4",
  border: "1px solid #ece7df",
  padding: 12,
};

const workspaceStyle: CSSProperties = {
  position: "relative",
};

const workspaceInnerStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  borderRadius: 24,
  backgroundImage:
    "linear-gradient(rgba(231,229,228,0.8) 1px, transparent 1px), linear-gradient(90deg, rgba(231,229,228,0.8) 1px, transparent 1px)",
  backgroundSize: "28px 28px",
  backgroundColor: "#fcfbf9",
  overflow: "hidden",
};

const edgeLayerStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
};

const nodeCardStyle: CSSProperties = {
  position: "absolute",
  borderRadius: 24,
  border: "1px solid",
  padding: 14,
  cursor: "pointer",
  userSelect: "none",
  display: "grid",
  gap: 12,
  backdropFilter: "blur(10px)",
};

const nodeHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
  cursor: "grab",
};

const nodeTypeChipStyle: CSSProperties = {
  display: "inline-flex",
  borderRadius: 999,
  background: "rgba(255,255,255,0.8)",
  padding: "4px 8px",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 8,
};

const nodeTitleStyle: CSSProperties = { fontSize: 18, fontWeight: 700, lineHeight: 1.2 };
const tinyDotStyle: CSSProperties = { width: 12, height: 12, borderRadius: 999, flexShrink: 0, marginTop: 6 };
const nodeBodyStyle: CSSProperties = { display: "grid", gap: 10 };
const nodeDescStyle: CSSProperties = { fontSize: 12, color: "#57534e", lineHeight: 1.55 };
const nodeMetaStyle: CSSProperties = { fontSize: 13, fontWeight: 600 };
const nodeActionRowStyle: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap" };

const smallButtonStyle: CSSProperties = {
  border: "1px solid rgba(120,113,108,0.24)",
  borderRadius: 999,
  padding: "8px 10px",
  background: "rgba(255,255,255,0.88)",
  cursor: "pointer",
  fontSize: 12,
};

const smallPrimaryStyle: CSSProperties = {
  ...smallButtonStyle,
  background: "#1c1917",
  color: "white",
  borderColor: "#1c1917",
};

const sidePanelStyle: CSSProperties = {
  minWidth: 0,
  borderRadius: 28,
  border: "1px solid rgba(231,229,228,0.9)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.98), rgba(250,249,246,0.96))",
  padding: 18,
  display: "grid",
  gap: 16,
  alignContent: "start",
  maxHeight: "calc(100vh - 120px)",
  overflow: "auto",
  boxShadow: "0 14px 36px rgba(41, 37, 36, 0.07)",
};

const inspectorHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};

const dangerPillStyle: CSSProperties = {
  border: "1px solid #fecaca",
  borderRadius: 999,
  padding: "10px 14px",
  background: "#fff5f5",
  color: "#b91c1c",
  cursor: "pointer",
};

const emptyInspectorStyle: CSSProperties = {
  minHeight: 160,
  display: "grid",
  placeItems: "center",
  color: "#78716c",
  background: "#fafaf9",
  borderRadius: 20,
};

const inspectorBodyStyle: CSSProperties = { display: "grid", gap: 16 };
const inspectorGroupStyle: CSSProperties = { display: "grid", gap: 14 };
const fieldStyle: CSSProperties = { display: "grid", gap: 8 };
const fieldLabelStyle: CSSProperties = { fontSize: 13, color: "#57534e", fontWeight: 600 };
const checkboxLineStyle: CSSProperties = { display: "flex", gap: 10, alignItems: "center", minHeight: 48, color: "#292524" };

const inputStyle: CSSProperties = {
  width: "100%",
  border: "1px solid #d6d3d1",
  borderRadius: 16,
  padding: "12px 14px",
  background: "white",
};

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 100,
  resize: "vertical",
  fontFamily: "inherit",
  lineHeight: 1.6,
};

const twoColumnStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
};

const edgePanelStyle: CSSProperties = {
  borderTop: "1px solid #f1efeb",
  paddingTop: 14,
  display: "grid",
  gap: 10,
};

const subTitleStyle: CSSProperties = { fontSize: 16, fontWeight: 700 };
const edgeItemStyle: CSSProperties = {
  border: "1px solid #ece7df",
  borderRadius: 16,
  padding: 12,
  display: "flex",
  justifyContent: "space-between",
  gap: 10,
  alignItems: "center",
};

const edgeMetaStyle: CSSProperties = { fontSize: 12, color: "#78716c", marginTop: 4 };
const miniHintStyle: CSSProperties = { fontSize: 12, color: "#78716c", lineHeight: 1.6 };
const actionBarStyle: CSSProperties = { display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" };
const primaryButtonStyle: CSSProperties = {
  border: "none",
  borderRadius: 999,
  padding: "12px 16px",
  background: "linear-gradient(135deg, #171717, #2b2b2b)",
  color: "white",
  cursor: "pointer",
  fontWeight: 600,
  boxShadow: "0 10px 20px rgba(23, 23, 23, 0.18)",
};
const ghostButtonStyle: CSSProperties = {
  border: "1px solid #d6d3d1",
  borderRadius: 999,
  padding: "10px 14px",
  background: "rgba(255,255,255,0.9)",
  cursor: "pointer",
};
const dangerMiniStyle: CSSProperties = {
  border: "1px solid #fecaca",
  borderRadius: 999,
  padding: "8px 10px",
  background: "#fff5f5",
  color: "#b91c1c",
  cursor: "pointer",
  fontSize: 12,
};
const subSectionStyle: CSSProperties = { display: "grid", gap: 12 };
const cardEditorStyle: CSSProperties = {
  border: "1px solid #ece7df",
  borderRadius: 18,
  padding: 14,
  background: "#fcfbf9",
  display: "grid",
  gap: 10,
};
const cardEditorTitleStyle: CSSProperties = { fontWeight: 700 };
const optionalBadgeStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  borderRadius: 999,
  padding: "3px 8px",
  background: "#fff7ed",
  color: "#c2410c",
  fontSize: 11,
  fontWeight: 700,
};
const imageItemStyle: CSSProperties = {
  border: "1px solid #ece7df",
  borderRadius: 18,
  padding: 12,
  background: "#fcfbf9",
  display: "grid",
  gap: 10,
};
const thumbButtonStyle: CSSProperties = {
  width: 92,
  height: 92,
  padding: 0,
  border: "none",
  background: "transparent",
  borderRadius: 16,
  overflow: "hidden",
  cursor: "zoom-in",
  flexShrink: 0,
};
const thumbStyle: CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };
const thumbFallbackStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  display: "grid",
  placeItems: "center",
  background: "#f5f5f4",
  color: "#78716c",
  fontSize: 12,
};
const runCardStyle: CSSProperties = {
  border: "1px solid #ece7df",
  borderRadius: 18,
  padding: 14,
  background: "#fcfbf9",
  display: "grid",
  gap: 12,
};
const resultInfoCardStyle: CSSProperties = {
  border: "1px solid #ece7df",
  borderRadius: 16,
  padding: 14,
  background: "#fcfbf9",
  display: "grid",
  gap: 6,
};
const resultInfoTitleStyle: CSSProperties = {
  fontWeight: 700,
  fontSize: 14,
};
const selectionGridStyle: CSSProperties = {
  display: "grid",
  gap: 10,
};
const selectionCardStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "auto minmax(0, 1fr)",
  gap: 10,
  alignItems: "start",
  padding: 12,
  borderRadius: 16,
  border: "1px solid #e7e5e4",
};
const runHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};
const successBadgeStyle: CSSProperties = {
  borderRadius: 999,
  padding: "6px 10px",
  background: "#ecfdf5",
  color: "#15803d",
  fontSize: 12,
  fontWeight: 700,
};
const errorBadgeStyle: CSSProperties = {
  borderRadius: 999,
  padding: "6px 10px",
  background: "#fff1f2",
  color: "#b91c1c",
  fontSize: 12,
  fontWeight: 700,
};
const resultGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 10,
};
const moduleRunListStyle: CSSProperties = {
  display: "grid",
  gap: 14,
};
const moduleRunCardStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid #ece7df",
  padding: 12,
  background: "rgba(255,255,255,0.7)",
  display: "grid",
  gap: 10,
};
const moduleRunHeaderStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "flex-start",
};
const resultItemStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid #e7e5e4",
  background: "white",
  overflow: "hidden",
  display: "grid",
  gap: 8,
};
const resultThumbButtonStyle: CSSProperties = { border: "none", background: "transparent", padding: 0, cursor: "zoom-in" };
const resultThumbStyle: CSSProperties = { width: "100%", aspectRatio: "1 / 1", objectFit: "cover" };
const resultActionStyle: CSSProperties = { display: "grid", gap: 8, padding: "0 8px 8px" };
const resultFallbackStyle: CSSProperties = {
  minHeight: 120,
  display: "grid",
  placeItems: "center",
  color: "#b91c1c",
  fontSize: 12,
  padding: 12,
  textAlign: "center",
};
const previewOverlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1200,
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "rgba(28,25,23,0.78)",
  backdropFilter: "blur(5px)",
};
const previewDialogStyle: CSSProperties = {
  position: "relative",
  maxWidth: "min(1200px, 100%)",
  maxHeight: "100%",
  display: "grid",
  gap: 12,
};
const previewCloseStyle: CSSProperties = {
  position: "absolute",
  top: 12,
  right: 12,
  width: 40,
  height: 40,
  borderRadius: 999,
  border: "none",
  background: "rgba(28,25,23,0.75)",
  color: "white",
  cursor: "pointer",
  fontSize: 24,
};
const previewTitleStyle: CSSProperties = { color: "white", fontSize: 16, fontWeight: 600 };
const previewImageStyle: CSSProperties = {
  maxWidth: "100%",
  maxHeight: "calc(100vh - 96px)",
  borderRadius: 24,
  boxShadow: "0 24px 72px rgba(0,0,0,0.38)",
};
