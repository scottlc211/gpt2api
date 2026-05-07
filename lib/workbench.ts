import { assetScopes, makeId, pruneAssets, readAsset, writeAsset } from "@/lib/storage";

export const productStorageKey = "productflow-mvp:products";
export const aspectRatioOptions = ["1:1", "4:3", "16:9", "3:4", "9:16"] as const;
export const platformOptions = ["淘宝", "天猫", "京东", "拼多多", "抖音小店", "小红书", "其他"] as const;
export const complianceOptions = ["通用", "普通食品", "运动器材", "保健食品", "其他"] as const;
export const backgroundOptions = ["white", "transparent", "studio", "lifestyle"] as const;
export const fitOptions = ["contain", "cover"] as const;
export const referenceRoleOptions = ["hero", "detail", "scene"] as const;

export type AspectRatio = (typeof aspectRatioOptions)[number];
export type PlatformName = (typeof platformOptions)[number];
export type ComplianceLevel = (typeof complianceOptions)[number];
export type BackgroundStyle = (typeof backgroundOptions)[number];
export type ImageFitMode = (typeof fitOptions)[number];
export type ReferenceRole = (typeof referenceRoleOptions)[number];
export type WorkflowNodeType = "product" | "reference" | "copy" | "process" | "result";

export type Point = {
  x: number;
  y: number;
};

export type WorkflowEdge = {
  id: string;
  source: string;
  target: string;
};

export type ProductImageAsset = {
  id: string;
  name: string;
  type: string;
  assetId?: string;
  dataUrl?: string;
  width?: number;
  height?: number;
  role: ReferenceRole;
  notes: string;
};

export type VisualSellingReason = {
  id: string;
  audience: string;
  painPoint: string;
  solution: string;
  translatedBenefit: string;
  evidence: string;
  priority: 3 | 4 | 5;
  modules: string[];
};

export type VisualPlanCard = {
  id: string;
  code: string;
  kind: "main" | "detail";
  slot: string;
  scene: string;
  overlay: string;
  designNotes: string;
  aspectRatio?: AspectRatio;
  includePrice?: boolean;
  optional?: boolean;
};

export type WorkflowRunOutputGroup = {
  id: string;
  planId: string;
  code: string;
  kind: "main" | "detail";
  title: string;
  prompt: string;
  size?: AspectRatio;
  images: GeneratedImageAsset[];
  error?: string;
};

export type GeneratedImageAsset = {
  id: string;
  name: string;
  type: string;
  assetId?: string;
  dataUrl?: string;
  status: "success" | "error" | "loading";
  createdAt: string;
  error?: string;
};

export type WorkflowRunRecord = {
  id: string;
  createdAt: string;
  mode: "generate" | "edit";
  count: number;
  size: AspectRatio;
  prompt: string;
  processSummary: string;
  sourceNodeIds: string[];
  outputs: WorkflowRunOutputGroup[];
  totalImages: number;
  error?: string;
};

export type ProductNodePayload = {
  productName: string;
  category: string;
  brand: string;
  company: string;
  platform: PlatformName;
  skuText: string;
  priceText: string;
  targetAudience: string;
  sellingPoints: string;
  trustEvidence: string;
  complianceNotes: string;
  extraContext: string;
};

export type ReferenceNodePayload = {
  images: ProductImageAsset[];
  primaryImageId?: string;
  uploadNotes: string;
  mergeStrategy: "hero-first" | "scene-first" | "detail-first";
};

export type CopyNodePayload = {
  tone: string;
  priorityNotes: string;
  complianceLevel: ComplianceLevel;
  reasons: VisualSellingReason[];
  cards: VisualPlanCard[];
  detailModules: VisualPlanCard[];
  summary: string;
  riskNotes: string[];
  lastGeneratedAt?: string;
};

export type ProcessNodePayload = {
  aspectRatio: AspectRatio;
  outputCount: number;
  background: BackgroundStyle;
  fit: ImageFitMode;
  cropFocus: string;
  maskHint: string;
  retouchNotes: string;
  promptNotes: string;
  maxSide: number;
};

export type ResultNodePayload = {
  preferredCardId?: string;
  selectedDetailModuleIds: string[];
  autoReferenceNodeId?: string;
  history: WorkflowRunRecord[];
};

export type WorkflowNodeMap = {
  product: ProductNodePayload;
  reference: ReferenceNodePayload;
  copy: CopyNodePayload;
  process: ProcessNodePayload;
  result: ResultNodePayload;
};

export type WorkflowNode<T extends WorkflowNodeType = WorkflowNodeType> = {
  id: string;
  type: T;
  title: string;
  position: Point;
  payload: WorkflowNodeMap[T];
};

export type WorkflowGraph = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport: {
    zoom: number;
  };
};

export type ProductRecord = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  workflow: WorkflowGraph;
};

export const nodeTypeLabels: Record<WorkflowNodeType, string> = {
  product: "商品信息",
  reference: "参考图",
  copy: "视觉文案",
  process: "图片处理",
  result: "生图结果",
};

export const nodeTypeDescriptions: Record<WorkflowNodeType, string> = {
  product: "维护商品基础信息、价格、平台、人群与卖点。",
  reference: "上传主图、细节图、场景图，指定主参考图。",
  copy: "根据电商视觉文案 SOP 生成卖点卡片和画面执行稿。",
  process: "标准化参考图尺寸、背景、裁切与补充处理指令。",
  result: "汇总上游节点，触发最终生图并保留候选结果。",
};

function defaultProductPayload(name = "未命名商品"): ProductNodePayload {
  return {
    productName: name,
    category: "",
    brand: "",
    company: "",
    platform: "淘宝",
    skuText: "",
    priceText: "",
    targetAudience: "",
    sellingPoints: "",
    trustEvidence: "",
    complianceNotes: "避免绝对化表述，卖点尽量落在可验证信息。",
    extraContext: "",
  };
}

function defaultReferencePayload(): ReferenceNodePayload {
  return {
    images: [],
    primaryImageId: undefined,
    uploadNotes: "建议至少上传 1 张商品主图，必要时补充细节图或场景图。",
    mergeStrategy: "hero-first",
  };
}

function defaultCopyPayload(): CopyNodePayload {
  return {
    tone: "专业、简洁、转化导向",
    priorityNotes: "突出核心卖点、价格利益点和信任证据。",
    complianceLevel: "通用",
    reasons: [],
    cards: [],
    detailModules: [],
    summary: "",
    riskNotes: [],
    lastGeneratedAt: undefined,
  };
}

function defaultProcessPayload(): ProcessNodePayload {
  return {
    aspectRatio: "1:1",
    outputCount: 1,
    background: "white",
    fit: "contain",
    cropFocus: "商品主体完整露出，避免裁掉品牌识别点。",
    maskHint: "无特殊遮罩时保持主体完整边缘。",
    retouchNotes: "提升质感与清晰度，统一背景与打光。",
    promptNotes: "参考电商主图风格，强调高转化、干净、利落。",
    maxSide: 1600,
  };
}

function defaultResultPayload(referenceNodeId?: string): ResultNodePayload {
  return {
    preferredCardId: undefined,
    selectedDetailModuleIds: [],
    autoReferenceNodeId: referenceNodeId,
    history: [],
  };
}

function edge(source: string, target: string): WorkflowEdge {
  return { id: makeId(), source, target };
}

export function createWorkflowNode(type: WorkflowNodeType, position: Point, labelIndex = 1): WorkflowNode {
  switch (type) {
    case "product":
      return {
        id: makeId(),
        type,
        title: labelIndex > 1 ? `${nodeTypeLabels[type]} ${labelIndex}` : nodeTypeLabels[type],
        position,
        payload: defaultProductPayload(),
      };
    case "reference":
      return {
        id: makeId(),
        type,
        title: labelIndex > 1 ? `${nodeTypeLabels[type]} ${labelIndex}` : nodeTypeLabels[type],
        position,
        payload: defaultReferencePayload(),
      };
    case "copy":
      return {
        id: makeId(),
        type,
        title: labelIndex > 1 ? `${nodeTypeLabels[type]} ${labelIndex}` : nodeTypeLabels[type],
        position,
        payload: defaultCopyPayload(),
      };
    case "process":
      return {
        id: makeId(),
        type,
        title: labelIndex > 1 ? `${nodeTypeLabels[type]} ${labelIndex}` : nodeTypeLabels[type],
        position,
        payload: defaultProcessPayload(),
      };
    case "result":
      return {
        id: makeId(),
        type,
        title: labelIndex > 1 ? `${nodeTypeLabels[type]} ${labelIndex}` : nodeTypeLabels[type],
        position,
        payload: defaultResultPayload(),
      };
  }
}

export function createDefaultProduct(name = "未命名商品"): ProductRecord {
  const productNode = {
    id: makeId(),
    type: "product",
    title: nodeTypeLabels.product,
    position: { x: 48, y: 140 },
    payload: defaultProductPayload(name),
  } satisfies WorkflowNode<"product">;

  const referenceNode = {
    id: makeId(),
    type: "reference",
    title: nodeTypeLabels.reference,
    position: { x: 360, y: 60 },
    payload: defaultReferencePayload(),
  } satisfies WorkflowNode<"reference">;

  const copyNode = {
    id: makeId(),
    type: "copy",
    title: nodeTypeLabels.copy,
    position: { x: 360, y: 300 },
    payload: defaultCopyPayload(),
  } satisfies WorkflowNode<"copy">;

  const processNode = {
    id: makeId(),
    type: "process",
    title: nodeTypeLabels.process,
    position: { x: 720, y: 180 },
    payload: defaultProcessPayload(),
  } satisfies WorkflowNode<"process">;

  const resultNode = {
    id: makeId(),
    type: "result",
    title: nodeTypeLabels.result,
    position: { x: 1080, y: 180 },
    payload: defaultResultPayload(referenceNode.id),
  } satisfies WorkflowNode<"result">;

  const now = new Date().toISOString();

  return {
    id: makeId(),
    name,
    createdAt: now,
    updatedAt: now,
    workflow: {
      nodes: [productNode, referenceNode, copyNode, processNode, resultNode],
      edges: [
        edge(productNode.id, copyNode.id),
        edge(productNode.id, processNode.id),
        edge(referenceNode.id, processNode.id),
        edge(copyNode.id, processNode.id),
        edge(processNode.id, resultNode.id),
        edge(copyNode.id, resultNode.id),
      ],
      viewport: { zoom: 1 },
    },
  };
}

export function sortProducts(items: ProductRecord[]) {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getNodeById<T extends WorkflowNodeType = WorkflowNodeType>(graph: WorkflowGraph, nodeId: string) {
  return graph.nodes.find((item) => item.id === nodeId) as WorkflowNode<T> | undefined;
}

export function getNodesByType<T extends WorkflowNodeType>(graph: WorkflowGraph, type: T) {
  return graph.nodes.filter((item) => item.type === type) as WorkflowNode<T>[];
}

export function getPrimaryProductNode(product: ProductRecord) {
  return getNodesByType(product.workflow, "product")[0];
}

export function deriveProductName(product: ProductRecord) {
  const productNode = getPrimaryProductNode(product);
  const explicitName = productNode?.payload.productName?.trim();
  return explicitName || product.name || "未命名商品";
}

export function normalizeProductRecord(product: ProductRecord): ProductRecord {
  return {
    ...product,
    name: deriveProductName(product),
  };
}

function coerceAspectRatio(value: string | undefined): AspectRatio {
  if (aspectRatioOptions.includes(value as AspectRatio)) {
    return value as AspectRatio;
  }
  return "1:1";
}

function coercePlatform(value: string | undefined): PlatformName {
  if (platformOptions.includes(value as PlatformName)) {
    return value as PlatformName;
  }
  return "淘宝";
}

function coerceCompliance(value: string | undefined): ComplianceLevel {
  if (complianceOptions.includes(value as ComplianceLevel)) {
    return value as ComplianceLevel;
  }
  return "通用";
}

function coerceBackground(value: string | undefined): BackgroundStyle {
  if (backgroundOptions.includes(value as BackgroundStyle)) {
    return value as BackgroundStyle;
  }
  return "white";
}

function coerceFit(value: string | undefined): ImageFitMode {
  if (fitOptions.includes(value as ImageFitMode)) {
    return value as ImageFitMode;
  }
  return "contain";
}

function coerceReferenceRole(value: string | undefined): ReferenceRole {
  if (referenceRoleOptions.includes(value as ReferenceRole)) {
    return value as ReferenceRole;
  }
  return "hero";
}

function sanitizeProductPayload(payload: Partial<ProductNodePayload> | undefined, fallbackName: string): ProductNodePayload {
  return {
    productName: payload?.productName?.trim() || fallbackName,
    category: payload?.category || "",
    brand: payload?.brand || "",
    company: payload?.company || "",
    platform: coercePlatform(payload?.platform),
    skuText: payload?.skuText || "",
    priceText: payload?.priceText || "",
    targetAudience: payload?.targetAudience || "",
    sellingPoints: payload?.sellingPoints || "",
    trustEvidence: payload?.trustEvidence || "",
    complianceNotes: payload?.complianceNotes || defaultProductPayload(fallbackName).complianceNotes,
    extraContext: payload?.extraContext || "",
  };
}

function sanitizeReferenceImages(images: Partial<ProductImageAsset>[] | undefined) {
  return (images || []).map((image) => ({
    id: image.id || makeId(),
    name: image.name || "reference.png",
    type: image.type || "image/png",
    assetId: image.assetId,
    dataUrl: image.dataUrl,
    width: typeof image.width === "number" ? image.width : undefined,
    height: typeof image.height === "number" ? image.height : undefined,
    role: coerceReferenceRole(image.role),
    notes: image.notes || "",
  } satisfies ProductImageAsset));
}

function sanitizeCopyReasons(reasons: Partial<VisualSellingReason>[] | undefined) {
  return (reasons || []).map((reason) => ({
    id: reason.id || makeId(),
    audience: reason.audience || "",
    painPoint: reason.painPoint || "",
    solution: reason.solution || "",
    translatedBenefit: reason.translatedBenefit || "",
    evidence: reason.evidence || "",
    priority: reason.priority === 3 || reason.priority === 4 || reason.priority === 5 ? reason.priority : 4,
    modules: Array.isArray(reason.modules) ? reason.modules.filter(Boolean) : [],
  } satisfies VisualSellingReason));
}

function sanitizeCopyCards(cards: Partial<VisualPlanCard>[] | undefined) {
  return (cards || []).map((card) => ({
    id: card.id || makeId(),
    code: card.code || "custom",
    kind: card.kind === "detail" ? "detail" : "main",
    slot: card.slot || "图1",
    scene: card.scene || "",
    overlay: card.overlay || "",
    designNotes: card.designNotes || "",
    aspectRatio: card.aspectRatio ? coerceAspectRatio(card.aspectRatio) : undefined,
    includePrice: typeof card.includePrice === "boolean" ? card.includePrice : undefined,
    optional: Boolean(card.optional),
  } satisfies VisualPlanCard));
}

function sanitizeGeneratedImages(images: Partial<GeneratedImageAsset>[] | undefined) {
  return (images || []).map((image) => ({
    id: image.id || makeId(),
    name: image.name || "generated.png",
    type: image.type || "image/png",
    assetId: image.assetId,
    dataUrl: image.dataUrl,
    status: image.status === "error" || image.status === "loading" ? image.status : "success",
    createdAt: image.createdAt || new Date().toISOString(),
    error: image.error,
  } satisfies GeneratedImageAsset));
}

function sanitizeRunOutputGroups(groups: Partial<WorkflowRunOutputGroup>[] | undefined, legacyRun?: Partial<WorkflowRunRecord>) {
  if (groups && groups.length > 0) {
    return groups.map((group) => ({
      id: group.id || makeId(),
      planId: group.planId || group.id || makeId(),
      code: group.code || "custom",
      kind: group.kind === "detail" ? "detail" : "main",
      title: group.title || "未命名版块",
      prompt: group.prompt || "",
      size: group.size ? coerceAspectRatio(group.size) : legacyRun?.size ? coerceAspectRatio(legacyRun.size) : undefined,
      images: sanitizeGeneratedImages(group.images),
      error: group.error,
    } satisfies WorkflowRunOutputGroup));
  }

  const legacyCompat = legacyRun as (Partial<WorkflowRunRecord> & { images?: Partial<GeneratedImageAsset>[]; cardTitle?: string }) | undefined;
  const legacyImages = legacyCompat?.images;
  if (!legacyImages || legacyImages.length === 0) {
    return [] as WorkflowRunOutputGroup[];
  }

  return [
    {
      id: makeId(),
      planId: makeId(),
      code: "legacy-main",
      kind: "main",
      title: legacyCompat?.cardTitle || "未命名画面卡",
      prompt: legacyCompat?.prompt || "",
      size: legacyCompat?.size ? coerceAspectRatio(legacyCompat.size) : undefined,
      images: sanitizeGeneratedImages(legacyImages),
      error: legacyCompat?.error,
    } satisfies WorkflowRunOutputGroup,
  ];
}

function sanitizeRunHistory(history: Partial<WorkflowRunRecord>[] | undefined) {
  return (history || []).map((run) => {
    const outputs = sanitizeRunOutputGroups(run.outputs, run);
    return {
      id: run.id || makeId(),
      createdAt: run.createdAt || new Date().toISOString(),
      mode: run.mode === "generate" ? "generate" : "edit",
      count: Math.max(1, Math.min(4, Number(run.count) || 1)),
      size: coerceAspectRatio(run.size),
      prompt: run.prompt || "",
      processSummary: run.processSummary || "",
      sourceNodeIds: Array.isArray(run.sourceNodeIds) ? run.sourceNodeIds.filter(Boolean) : [],
      outputs,
      totalImages: typeof run.totalImages === "number" ? run.totalImages : outputs.reduce((total, group) => total + group.images.length, 0),
      error: run.error,
    } satisfies WorkflowRunRecord;
  });
}

function sanitizeNode(node: Partial<WorkflowNode>, fallbackName: string): WorkflowNode {
  const type = (node.type || "product") as WorkflowNodeType;
  const base = {
    id: node.id || makeId(),
    type,
    title: node.title || nodeTypeLabels[type],
    position: {
      x: typeof node.position?.x === "number" ? node.position.x : 0,
      y: typeof node.position?.y === "number" ? node.position.y : 0,
    },
  } as const;

  switch (type) {
    case "product":
      return {
        ...base,
        payload: sanitizeProductPayload(node.payload as Partial<ProductNodePayload> | undefined, fallbackName),
      };
    case "reference":
      return {
        ...base,
        payload: {
          images: sanitizeReferenceImages((node.payload as Partial<ReferenceNodePayload> | undefined)?.images),
          primaryImageId: (node.payload as Partial<ReferenceNodePayload> | undefined)?.primaryImageId,
          uploadNotes:
            (node.payload as Partial<ReferenceNodePayload> | undefined)?.uploadNotes || defaultReferencePayload().uploadNotes,
          mergeStrategy:
            (node.payload as Partial<ReferenceNodePayload> | undefined)?.mergeStrategy === "scene-first"
              ? "scene-first"
              : (node.payload as Partial<ReferenceNodePayload> | undefined)?.mergeStrategy === "detail-first"
                ? "detail-first"
                : "hero-first",
        },
      };
    case "copy":
      return {
        ...base,
        payload: {
          tone: (node.payload as Partial<CopyNodePayload> | undefined)?.tone || defaultCopyPayload().tone,
          priorityNotes:
            (node.payload as Partial<CopyNodePayload> | undefined)?.priorityNotes || defaultCopyPayload().priorityNotes,
          complianceLevel: coerceCompliance((node.payload as Partial<CopyNodePayload> | undefined)?.complianceLevel),
          reasons: sanitizeCopyReasons((node.payload as Partial<CopyNodePayload> | undefined)?.reasons),
          cards: sanitizeCopyCards((node.payload as Partial<CopyNodePayload> | undefined)?.cards),
          detailModules: sanitizeCopyCards((node.payload as Partial<CopyNodePayload> | undefined)?.detailModules),
          summary: (node.payload as Partial<CopyNodePayload> | undefined)?.summary || "",
          riskNotes: Array.isArray((node.payload as Partial<CopyNodePayload> | undefined)?.riskNotes)
            ? ((node.payload as Partial<CopyNodePayload> | undefined)?.riskNotes || []).filter(Boolean)
            : [],
          lastGeneratedAt: (node.payload as Partial<CopyNodePayload> | undefined)?.lastGeneratedAt,
        },
      };
    case "process":
      return {
        ...base,
        payload: {
          aspectRatio: coerceAspectRatio((node.payload as Partial<ProcessNodePayload> | undefined)?.aspectRatio),
          outputCount: Math.max(1, Math.min(4, Number((node.payload as Partial<ProcessNodePayload> | undefined)?.outputCount) || 1)),
          background: coerceBackground((node.payload as Partial<ProcessNodePayload> | undefined)?.background),
          fit: coerceFit((node.payload as Partial<ProcessNodePayload> | undefined)?.fit),
          cropFocus:
            (node.payload as Partial<ProcessNodePayload> | undefined)?.cropFocus || defaultProcessPayload().cropFocus,
          maskHint:
            (node.payload as Partial<ProcessNodePayload> | undefined)?.maskHint || defaultProcessPayload().maskHint,
          retouchNotes:
            (node.payload as Partial<ProcessNodePayload> | undefined)?.retouchNotes || defaultProcessPayload().retouchNotes,
          promptNotes:
            (node.payload as Partial<ProcessNodePayload> | undefined)?.promptNotes || defaultProcessPayload().promptNotes,
          maxSide: Math.max(960, Math.min(2400, Number((node.payload as Partial<ProcessNodePayload> | undefined)?.maxSide) || 1600)),
        },
      };
    case "result":
      return {
        ...base,
        payload: {
          preferredCardId: (node.payload as Partial<ResultNodePayload> | undefined)?.preferredCardId,
          selectedDetailModuleIds: Array.isArray((node.payload as Partial<ResultNodePayload> | undefined)?.selectedDetailModuleIds)
            ? ((node.payload as Partial<ResultNodePayload> | undefined)?.selectedDetailModuleIds || []).filter(Boolean)
            : [],
          autoReferenceNodeId: (node.payload as Partial<ResultNodePayload> | undefined)?.autoReferenceNodeId,
          history: sanitizeRunHistory((node.payload as Partial<ResultNodePayload> | undefined)?.history),
        },
      };
  }
}

function sanitizeProductRecord(raw: Partial<ProductRecord>): ProductRecord {
  const fallbackName = raw.name || "未命名商品";
  const workflow = raw.workflow || { nodes: [], edges: [], viewport: { zoom: 1 } };
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes.map((node) => sanitizeNode(node, fallbackName)) : [];
  const edges = Array.isArray(workflow.edges)
    ? workflow.edges
        .filter((edge) => edge && typeof edge.source === "string" && typeof edge.target === "string")
        .map((edge) => ({ id: edge.id || makeId(), source: edge.source, target: edge.target }))
    : [];

  const now = new Date().toISOString();
  const product: ProductRecord = {
    id: raw.id || makeId(),
    name: fallbackName,
    createdAt: raw.createdAt || now,
    updatedAt: raw.updatedAt || now,
    workflow: {
      nodes,
      edges,
      viewport: {
        zoom: Math.max(0.6, Math.min(1.6, Number(workflow.viewport?.zoom) || 1)),
      },
    },
  };

  return normalizeProductRecord(product);
}

async function persistReferenceNode(node: WorkflowNode<"reference">) {
  const images = await Promise.all(
    node.payload.images.map(async (image) => {
      const assetId = image.assetId || `reference:${node.id}:${image.id}`;
      if (image.dataUrl) {
        await writeAsset(assetId, image.dataUrl);
      }
      return {
        ...image,
        assetId,
        dataUrl: undefined,
      } satisfies ProductImageAsset;
    }),
  );

  return {
    ...node,
    payload: {
      ...node.payload,
      images,
    },
  } satisfies WorkflowNode<"reference">;
}

async function persistResultNode(node: WorkflowNode<"result">) {
  const history = await Promise.all(
    node.payload.history.map(async (run) => ({
      ...run,
      outputs: await Promise.all(
        run.outputs.map(async (group) => ({
          ...group,
          images: await Promise.all(
            group.images.map(async (image) => {
              if (!image.dataUrl && !image.assetId) return image;
              const assetId = image.assetId || `result:${run.id}:${group.id}:${image.id}`;
              if (image.dataUrl) {
                await writeAsset(assetId, image.dataUrl);
              }
              return {
                ...image,
                assetId,
                dataUrl: undefined,
              } satisfies GeneratedImageAsset;
            }),
          ),
        })),
      ),
    })),
  );

  return {
    ...node,
    payload: {
      ...node.payload,
      history,
    },
  } satisfies WorkflowNode<"result">;
}

async function persistNode(node: WorkflowNode) {
  if (node.type === "reference") {
    return persistReferenceNode(node as WorkflowNode<"reference">);
  }
  if (node.type === "result") {
    return persistResultNode(node as WorkflowNode<"result">);
  }
  return node;
}

async function hydrateReferenceNode(node: WorkflowNode<"reference">) {
  const images = await Promise.all(
    node.payload.images.map(async (image) => ({
      ...image,
      dataUrl: image.dataUrl ?? (image.assetId ? await readAsset(image.assetId) : undefined),
    })),
  );

  return {
    ...node,
    payload: {
      ...node.payload,
      images,
    },
  } satisfies WorkflowNode<"reference">;
}

async function hydrateResultNode(node: WorkflowNode<"result">) {
  const history = await Promise.all(
    node.payload.history.map(async (run) => ({
      ...run,
      outputs: await Promise.all(
        run.outputs.map(async (group) => ({
          ...group,
          images: await Promise.all(
            group.images.map(async (image) => ({
              ...image,
              dataUrl: image.dataUrl ?? (image.assetId ? await readAsset(image.assetId) : undefined),
            })),
          ),
        })),
      ),
    })),
  );

  return {
    ...node,
    payload: {
      ...node.payload,
      history,
    },
  } satisfies WorkflowNode<"result">;
}

async function hydrateNode(node: WorkflowNode) {
  if (node.type === "reference") {
    return hydrateReferenceNode(node as WorkflowNode<"reference">);
  }
  if (node.type === "result") {
    return hydrateResultNode(node as WorkflowNode<"result">);
  }
  return node;
}

function collectAssetIds(products: ProductRecord[]) {
  const ids = new Set<string>();

  for (const product of products) {
    for (const node of product.workflow.nodes) {
      if (node.type === "reference") {
        for (const image of (node as WorkflowNode<"reference">).payload.images) {
          if (image.assetId) ids.add(image.assetId);
        }
      }
      if (node.type === "result") {
        for (const run of (node as WorkflowNode<"result">).payload.history) {
          for (const group of run.outputs) {
            for (const image of group.images) {
              if (image.assetId) ids.add(image.assetId);
            }
          }
        }
      }
    }
  }

  return ids;
}

export async function readProducts(): Promise<ProductRecord[]> {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(productStorageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<ProductRecord>[]) : [];
    const products = Array.isArray(parsed) ? parsed.map((item) => sanitizeProductRecord(item)) : [];
    const hydrated = await Promise.all(
      products.map(async (product) => ({
        ...product,
        workflow: {
          ...product.workflow,
          nodes: await Promise.all(product.workflow.nodes.map((node) => hydrateNode(node))),
        },
      })),
    );
    return sortProducts(hydrated.map((item) => normalizeProductRecord(item)));
  } catch {
    return [];
  }
}

export async function writeProducts(products: ProductRecord[]) {
  if (typeof window === "undefined") return;
  const normalized = sortProducts(products.map((item) => normalizeProductRecord(item)));
  const serializable = await Promise.all(
    normalized.map(async (product) => ({
      ...product,
      workflow: {
        ...product.workflow,
        nodes: await Promise.all(product.workflow.nodes.map((node) => persistNode(node))),
      },
    })),
  );
  window.localStorage.setItem(productStorageKey, JSON.stringify(serializable));
  await pruneAssets(collectAssetIds(serializable), { prefixes: assetScopes.productPrefixes });
}

export function countGeneratedImages(product: ProductRecord) {
  return product.workflow.nodes
    .filter((node) => node.type === "result")
    .flatMap((node) => (node as WorkflowNode<"result">).payload.history)
    .flatMap((run) => run.outputs)
    .flatMap((group) => group.images)
    .filter((image) => image.status === "success").length;
}

export function getLatestRun(node: WorkflowNode<"result">) {
  return node.payload.history[0];
}

export function summarizeProduct(product: ProductRecord) {
  const productNode = getPrimaryProductNode(product)?.payload;
  if (!productNode) return "未配置商品信息";

  const parts = [productNode.brand, productNode.category, productNode.targetAudience].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "待补充类目、品牌和人群";
}
