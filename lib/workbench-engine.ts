import { editImage, generateImage } from "@/lib/api";
import { base64ToDataUrl, normalizeImageDataUrl } from "@/lib/image-tools";
import { dataUrlToFile, makeId } from "@/lib/storage";
import {
  createWorkflowNode,
  getNodeById,
  getNodesByType,
  normalizeProductRecord,
  type AspectRatio,
  type GeneratedImageAsset,
  type ProcessNodePayload,
  type ProductImageAsset,
  type ProductNodePayload,
  type ProductRecord,
  type VisualPlanCard,
  type VisualSellingReason,
  type WorkflowNode,
  type WorkflowNodeType,
  type WorkflowRunOutputGroup,
  type WorkflowRunRecord,
} from "@/lib/workbench";

const MAX_TASKS_PER_RUN = 20;

type OutputPlan = {
  planId: string;
  code: string;
  kind: "main" | "detail";
  title: string;
  size: AspectRatio;
  prompt: string;
};

function splitLines(value: string) {
  return value
    .split(/[\n,，;；|]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function shortText(value: string, length: number) {
  return value.trim().length <= length ? value.trim() : `${value.trim().slice(0, length)}…`;
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items));
}

function updateNode<T extends WorkflowNodeType>(
  product: ProductRecord,
  nodeId: string,
  updater: (node: WorkflowNode<T>) => WorkflowNode<T>,
) {
  return normalizeProductRecord({
    ...product,
    updatedAt: new Date().toISOString(),
    workflow: {
      ...product.workflow,
      nodes: product.workflow.nodes.map((node) => (node.id === nodeId ? updater(node as WorkflowNode<T>) : node)),
    },
  });
}

function reverseFindByType<T extends WorkflowNodeType>(nodes: WorkflowNode[], type: T) {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (nodes[index]?.type === type) return nodes[index] as WorkflowNode<T>;
  }
  return undefined;
}

function resolveUpstreamNodes(product: ProductRecord, resultNodeId: string) {
  const nodeMap = new Map(product.workflow.nodes.map((node) => [node.id, node]));
  const incomingMap = new Map<string, string[]>();

  for (const edge of product.workflow.edges) {
    const current = incomingMap.get(edge.target) || [];
    current.push(edge.source);
    incomingMap.set(edge.target, current);
  }

  const visited = new Set<string>();
  const ordered: WorkflowNode[] = [];

  function walk(nodeId: string) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const sources = incomingMap.get(nodeId) || [];
    for (const sourceId of sources) {
      walk(sourceId);
    }
    const node = nodeMap.get(nodeId);
    if (node) ordered.push(node);
  }

  walk(resultNodeId);
  return ordered;
}

function buildSellingReasons(productPayload: ProductNodePayload): VisualSellingReason[] {
  const sellingPoints = unique(splitLines(productPayload.sellingPoints));
  const evidences = splitLines(productPayload.trustEvidence);
  const audience = productPayload.targetAudience.trim() || "目标人群";
  const category = productPayload.category.trim() || "商品";
  const fallbackFeatures = [`${category}核心卖点`, `${category}使用体验`, `${category}细节亮点`];
  const sourceFeatures = sellingPoints.length > 0 ? sellingPoints : fallbackFeatures;

  return sourceFeatures.slice(0, 5).map((feature, index) => ({
    id: makeId(),
    audience,
    painPoint:
      index === 0
        ? `${audience}在选购 ${category} 时最担心信息复杂、卖点不够直观。`
        : index === 1
          ? `${audience}需要更快理解这款 ${category} 和普通款的区别。`
          : `${audience}想在短时间内确认这款 ${category} 是否值得购买。`,
    solution: feature,
    translatedBenefit:
      index === 0
        ? "首屏 3 秒讲清楚“为什么值得买”。"
        : index === 1
          ? "让用户快速看到差异化与购买理由。"
          : "帮助用户更轻松完成下单判断。",
    evidence: evidences[index] || evidences[0] || `${productPayload.brand || category} 的基础信息与商品细节`,
    priority: index === 0 ? 5 : index === 1 ? 4 : 3,
    modules:
      index === 0
        ? ["主图首屏", "详情首屏"]
        : index === 1
          ? ["差异化优势", "参数对比"]
          : ["场景图", "FAQ", "补充说明"],
  }));
}

function buildVisualCards(productPayload: ProductNodePayload, reasons: VisualSellingReason[], tone: string): VisualPlanCard[] {
  const name = productPayload.productName.trim() || productPayload.category.trim() || "商品";
  const brand = productPayload.brand.trim();
  const priceLine = productPayload.priceText.trim() ? `到手参考 ${productPayload.priceText.trim()}` : "价格利益点按平台活动补充";
  const topReasons = reasons.length > 0 ? reasons : buildSellingReasons(productPayload);
  const [reason1, reason2, reason3] = [topReasons[0], topReasons[1] || topReasons[0], topReasons[2] || topReasons[1] || topReasons[0]];

  return [
    {
      id: makeId(),
      code: "main-01",
      kind: "main",
      slot: "图1 首图・点击率核心",
      scene: `${name} 居中大图，干净背景，突出主体质感与重点卖点，适合 ${productPayload.platform} 首图浏览。`,
      overlay: `${shortText(name, 10)}\n${shortText(reason1.solution, 14)}\n${shortText(reason1.translatedBenefit, 16)}`,
      designNotes: `标题控制在 4 行以内，${brand ? `保留 ${brand} 品牌识别，` : ""}整体语气 ${tone}，重点做点击率钩子。`,
      includePrice: false,
    },
    {
      id: makeId(),
      code: "main-02",
      kind: "main",
      slot: "图2 痛点共鸣・用户代入",
      scene: `通过“使用前 vs 使用后”或“旧方案 vs 新方案”的场景对比，放大 ${reason1.audience} 的真实痛点。`,
      overlay: `你也在纠结 ${shortText(productPayload.category || "选品", 8)} 吗\n${shortText(reason1.painPoint, 16)}\n${shortText(reason1.solution, 12)}\n${shortText(reason1.translatedBenefit, 14)}`,
      designNotes: "问句开头，强化代入感；避免夸大承诺，不做疗效化表述。",
      includePrice: false,
    },
    {
      id: makeId(),
      code: "main-03",
      kind: "main",
      slot: "图3 差异化优势・竞品区隔",
      scene: `用细节特写、成分/材质对比或三列表格，突出 ${reason2.solution} 的差异化价值。`,
      overlay: `${shortText(reason2.solution, 12)}\n对比更清楚\n${shortText(reason2.evidence, 14)}\n${shortText(reason2.translatedBenefit, 14)}`,
      designNotes: "建议保留 1 处证据位，适合放认证、工艺、材质或检测说明。",
      includePrice: false,
    },
    {
      id: makeId(),
      code: "main-04",
      kind: "main",
      slot: "图4 场景适配・使用价值",
      scene: `组合 2-3 个典型使用场景，展示 ${name} 在不同环境下的适配度与购买价值。`,
      overlay: `居家 / 通勤 / 出行\n${shortText(reason3.solution, 12)}\n${shortText(reason3.translatedBenefit, 16)}\n${shortText(productPayload.skuText || "规格信息待补充", 14)}`,
      designNotes: "适合三宫格或场景拼贴，保持生活化但不杂乱。",
      includePrice: false,
    },
    {
      id: makeId(),
      code: "main-05",
      kind: "main",
      slot: "图5 CTA 行动号召",
      scene: "产品全家福或主图强化版，保留活动价位、优惠信息和 CTA 区域。",
      overlay: `${shortText(name, 10)}\n${shortText(priceLine, 14)}\n${shortText(reason1.evidence, 14)}\n立即查看详情`,
      designNotes: "CTA 区做高对比跳色，价格和信任背书靠近按钮区域。",
      includePrice: true,
    },
  ];
}

function buildDetailModules(productPayload: ProductNodePayload, reasons: VisualSellingReason[], tone: string): VisualPlanCard[] {
  const name = productPayload.productName.trim() || productPayload.category.trim() || "商品";
  const brand = productPayload.brand.trim() || "品牌信息待补充";
  const topReasons = reasons.length > 0 ? reasons : buildSellingReasons(productPayload);
  const [reason1, reason2, reason3] = [topReasons[0], topReasons[1] || topReasons[0], topReasons[2] || topReasons[1] || topReasons[0]];
  const evidenceLine = shortText(productPayload.trustEvidence || reason1.evidence || "补充检测、认证、工艺或材质说明", 22);
  const skuLine = shortText(productPayload.skuText || "规格参数待补充", 18);
  const complianceLine = shortText(productPayload.complianceNotes || "补充免责声明与适用说明", 20);

  return [
    {
      id: makeId(),
      code: "detail-m1",
      kind: "detail",
      slot: "M1 首屏痛点共鸣",
      scene: `详情页首屏以用户痛点切入，突出 ${name} 为什么值得继续看下去，适合大标题 + 场景人物/局部特写。`,
      overlay: `${shortText(reason1.audience, 10)}在意什么\n${shortText(reason1.painPoint, 18)}\n${shortText(reason1.solution, 14)}\n${shortText(reason1.translatedBenefit, 16)}`,
      designNotes: `目标是 3 秒抓人，整体语气 ${tone}，避免过多解释。`,
      aspectRatio: "9:16",
      includePrice: false,
    },
    {
      id: makeId(),
      code: "detail-m2",
      kind: "detail",
      slot: "M2 核心优势展开",
      scene: "把 Top2-3 必卖理由拆成分栏或卡片，形成“痛点 → 方案 → 证据”的连续说明。",
      overlay: `${shortText(reason1.solution, 10)}\n${shortText(reason2.solution, 10)}\n${shortText(reason3.solution, 10)}\n证据位：${evidenceLine}`,
      designNotes: "适合横向卡片、纵向对比条或三列表达，突出核心利益点。",
      aspectRatio: "9:16",
      includePrice: false,
    },
    {
      id: makeId(),
      code: "detail-m3",
      kind: "detail",
      slot: "M3 配方/工艺深度",
      scene: `展示 ${name} 的成分、工艺、材质或制作流程，适合图解式详情模块。`,
      overlay: `工艺 / 材质 / 成分\n${shortText(evidenceLine, 18)}\n${shortText(reason2.evidence, 18)}\n${skuLine}`,
      designNotes: "以信息图或流程图方式呈现，强调可信、专业、易读。",
      aspectRatio: "9:16",
      includePrice: false,
    },
    {
      id: makeId(),
      code: "detail-m4",
      kind: "detail",
      slot: "M4 使用场景",
      scene: `展示 2-3 个典型使用场景，让用户代入 ${name} 在生活中的真实应用方式。`,
      overlay: `通勤 / 居家 / 出行\n${shortText(reason3.solution, 12)}\n${shortText(reason3.translatedBenefit, 16)}\n${shortText(productPayload.targetAudience || "适用人群待补充", 14)}`,
      designNotes: "场景图建议统一光线与色调，保证生活感但不过度杂乱。",
      aspectRatio: "9:16",
      includePrice: false,
    },
    {
      id: makeId(),
      code: "detail-m5",
      kind: "detail",
      slot: "M5 品牌/资质信任",
      scene: "用品牌故事、资质证书、工厂/研发环境等元素建立信任，适合中后段详情页。",
      overlay: `${shortText(brand, 10)}\n资质 / 证书 / 背书\n${evidenceLine}\n${shortText(reason1.evidence, 16)}`,
      designNotes: "建议保留证书缩略位、品牌介绍区和法律署名信息。",
      aspectRatio: "9:16",
      includePrice: false,
      optional: true,
    },
    {
      id: makeId(),
      code: "detail-m6",
      kind: "detail",
      slot: "M6 规格参数+竞品对比",
      scene: "用参数表格与对比信息帮助用户快速判断规格、属性差异与购买价值。",
      overlay: `规格参数\n${skuLine}\n${shortText(reason2.solution, 14)}\n${shortText(reason2.translatedBenefit, 16)}`,
      designNotes: "适合表格型排版，参数区与差异化说明建议左右分栏。",
      aspectRatio: "9:16",
      includePrice: false,
    },
    {
      id: makeId(),
      code: "detail-m7",
      kind: "detail",
      slot: "M7 FAQ",
      scene: "从必卖理由反推用户顾虑，用 FAQ 形式解释常见问题与使用边界。",
      overlay: `Q1 ${shortText(reason1.solution, 10)}?\nQ2 ${shortText(reason2.solution, 10)}?\nQ3 ${shortText(reason3.solution, 10)}?\n${complianceLine}`,
      designNotes: "问题数量建议 4-6 条，最后一条保留属性界定与免责声明。",
      aspectRatio: "9:16",
      includePrice: false,
    },
    {
      id: makeId(),
      code: "detail-m8",
      kind: "detail",
      slot: "M8 购买引导+法律声明",
      scene: "在详情页尾部收口，展示 CTA、价格利益点与必要免责声明。",
      overlay: `${shortText(name, 10)}\n${shortText(productPayload.priceText || "价格信息待补充", 14)}\n立即购买 / 立即咨询\n${complianceLine}`,
      designNotes: "CTA 区域应醒目，法律声明保持简洁但完整。",
      aspectRatio: "9:16",
      includePrice: true,
      optional: true,
    },
  ];
}

export function generateCopyForNode(product: ProductRecord, copyNodeId: string) {
  const copyNode = getNodeById(product.workflow, copyNodeId) as WorkflowNode<"copy"> | undefined;
  if (!copyNode) {
    throw new Error("未找到视觉文案节点");
  }

  const upstreamNodes = resolveUpstreamNodes(product, copyNodeId);
  const productNode = reverseFindByType(upstreamNodes, "product") || getNodesByType(product.workflow, "product")[0];
  if (!productNode) {
    throw new Error("请先创建商品信息节点");
  }

  const reasons = buildSellingReasons(productNode.payload);
  const cards = buildVisualCards(productNode.payload, reasons, copyNode.payload.tone);
  const detailModules = buildDetailModules(productNode.payload, reasons, copyNode.payload.tone);
  const riskNotes = unique([
    "避免使用“最、第一、顶级、治愈”等绝对化或医疗化表述。",
    productNode.payload.complianceNotes.trim() || "卖点应基于可验证事实。",
    reasons[0]?.evidence ? `首图建议保留证据位：${reason1Text(reasons[0].evidence)}` : "补充资质、工艺、材质等证据位。",
  ]);

  return updateNode(product, copyNodeId, (node) => ({
    ...(node as WorkflowNode<"copy">),
    payload: {
      ...(node as WorkflowNode<"copy">).payload,
      reasons,
      cards,
      detailModules,
      summary: `已生成 ${cards.length} 张主图执行卡与 ${detailModules.length} 个详情模块，可按需组合运行。`,
      riskNotes,
      lastGeneratedAt: new Date().toISOString(),
    },
  }));
}

function reason1Text(value: string) {
  return shortText(value, 18);
}

function sortReferenceImages(images: ProductImageAsset[], primaryImageId?: string) {
  return [...images].sort((left, right) => {
    if (left.id === primaryImageId) return -1;
    if (right.id === primaryImageId) return 1;
    const roleRank = { hero: 0, detail: 1, scene: 2 } as const;
    return roleRank[left.role] - roleRank[right.role];
  });
}

function describeBackground(background: ProcessNodePayload["background"]) {
  switch (background) {
    case "transparent":
      return "透明底或后期便于抠图的纯净背景";
    case "studio":
      return "轻棚拍背景，强调商业摄影打光";
    case "lifestyle":
      return "浅生活化背景，兼顾真实感与转化氛围";
    case "white":
    default:
      return "纯白或电商白底背景";
  }
}

function buildPrompt(
  productPayload: ProductNodePayload,
  card: VisualPlanCard,
  reasons: VisualSellingReason[],
  processPayload: ProcessNodePayload,
  options: {
    size: AspectRatio;
    includePrice: boolean;
    includeSpecs: boolean;
    compositionGuidance: string;
  },
) {
  const reasonLines = reasons
    .slice(0, 3)
    .map((reason, index) => `${index + 1}. ${reason.solution}｜${reason.translatedBenefit}｜证据：${reason.evidence}`)
    .join("\n");

  return [
    `请为 ${productPayload.platform} 电商场景生成高转化商品图片。`,
    `商品：${productPayload.productName || productPayload.category || "未命名商品"}`,
    `品牌：${productPayload.brand || "未提供"}`,
    `类目：${productPayload.category || "未提供"}`,
    `目标人群：${productPayload.targetAudience || "泛用户"}`,
    options.includePrice
      ? productPayload.priceText
        ? `价格信息：${productPayload.priceText}`
        : "价格信息：可预留活动价位，但不要硬塞价格文案"
      : "价格信息：本版块默认不展示价格，除非图内文案已明确要求",
    options.includeSpecs
      ? productPayload.skuText
        ? `规格信息：${productPayload.skuText}`
        : "规格信息：保留参数或规格信息展示区"
      : "规格信息：非重点，不必强制出现完整参数区",
    `核心卖点：\n${reasonLines}`,
    `版块类型：${card.kind === "main" ? "主图" : "详情模块"}`,
    `版块名称：${card.slot}`,
    `画面内容：${card.scene}`,
    `图内文案：${card.overlay}`,
    `设计说明：${card.designNotes}`,
    `构图重点：${options.compositionGuidance}`,
    `图片处理要求：背景为 ${describeBackground(processPayload.background)}；构图以 ${processPayload.cropFocus} 为准；修图要求：${processPayload.retouchNotes}`,
    `额外处理说明：${processPayload.maskHint}`,
    `输出比例：${options.size}；构图策略：${processPayload.fit === "cover" ? "优先铺满画面" : "优先完整展示主体"}`,
    `补充提示：${processPayload.promptNotes}`,
    productPayload.extraContext ? `补充业务上下文：${productPayload.extraContext}` : "",
    `合规提醒：${productPayload.complianceNotes || "避免绝对化与医疗化表达"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildProcessSummary(processPayload: ProcessNodePayload) {
  return [
    `比例 ${processPayload.aspectRatio}`,
    `背景 ${describeBackground(processPayload.background)}`,
    processPayload.fit === "cover" ? "主体可适度铺满" : "主体完整呈现",
    `裁切：${processPayload.cropFocus}`,
  ].join(" · ");
}

function ensureCopyAssets(product: ProductRecord, copyNode: WorkflowNode<"copy">) {
  let nextProduct = product;
  let nextCopyNode = copyNode;

  if (copyNode.payload.cards.length === 0 || copyNode.payload.reasons.length === 0 || copyNode.payload.detailModules.length === 0) {
    nextProduct = generateCopyForNode(nextProduct, copyNode.id);
    nextCopyNode = getNodeById(nextProduct.workflow, copyNode.id) as WorkflowNode<"copy">;
  }

  return { product: nextProduct, copyNode: nextCopyNode };
}

function resolvePlanAspectRatio(card: VisualPlanCard, fallback: AspectRatio) {
  return card.aspectRatio || fallback;
}

function resolvePlanPrice(card: VisualPlanCard) {
  if (typeof card.includePrice === "boolean") return card.includePrice;
  return card.code === "main-05" || card.code === "detail-m8";
}

function shouldShowSpecs(card: VisualPlanCard) {
  return ["main-04", "detail-m3", "detail-m6"].includes(card.code);
}

function buildCompositionGuidance(card: VisualPlanCard) {
  switch (card.code) {
    case "main-01":
      return "以完整商品主体为主，但不要把价格、规格、优惠全部塞满首屏，重点突出点击率钩子。";
    case "main-02":
      return "以人物、手部、使用前后或情绪化场景为主，商品可以只露出局部，不强制完整商品铺满。";
    case "main-03":
      return "以材质细节、结构拆解、成分/工艺对比为主，优先局部特写和信息图，不要做完整商品大图。";
    case "main-04":
      return "以场景拼贴或环境化陈列为主，商品作为场景元素自然出现，不要总是正中白底。";
    case "main-05":
      return "允许完整商品、利益点、CTA 同屏，用于收口促单。";
    case "detail-m1":
      return "以痛点场景和用户代入为主，商品作为辅助元素即可，不要求完整露出。";
    case "detail-m2":
      return "以卖点卡片、对比条、信息分栏为主，视觉重点是内容结构，不必放完整商品。";
    case "detail-m3":
      return "以工艺、成分、材质、细节放大和流程说明为主，优先信息图与局部特写。";
    case "detail-m4":
      return "以真实使用场景为主，商品融入场景即可，不强制居中单品陈列。";
    case "detail-m5":
      return "以品牌、证书、工厂、研发环境等信任素材为主，商品可以少量露出。";
    case "detail-m6":
      return "以参数表、规格对比、尺寸示意为主，商品只做辅助说明。";
    case "detail-m7":
      return "以 FAQ 信息排版模块为主，商品可以不出现或只做弱化背景元素。";
    case "detail-m8":
      return "以 CTA、价格利益点和购买引导为主，可加入完整商品或组合图。";
    default:
      return "根据版块目标调整构图，避免所有画面都使用同一种完整商品居中构图。";
  }
}

function buildReferencePolicyTextForPlan(referenceCount: number, card: VisualPlanCard) {
  if (referenceCount === 0) {
    return "无参考图，按商业摄影与电商详情页模块风格自主生成。";
  }

  switch (card.code) {
    case "main-02":
    case "detail-m1":
    case "detail-m4":
      return "参考图只用于锁定商品外观、包装与品牌识别，场景、人物和环境需要重新创作，不要复制原主图背景。";
    case "main-03":
    case "detail-m3":
    case "detail-m6":
      return "参考图只用于提取材质、结构和包装细节，优先局部特写、拆解说明或参数信息，不要整张完整商品平铺。";
    case "detail-m5":
    case "detail-m7":
      return "参考图仅作为品牌与商品识别锚点，主体可以弱化，优先展示证书、品牌、问答或说明模块。";
    default:
      return "参考图仅用于主体外观、材质与比例锚定，不要机械复制背景或每一张都做成同一构图。";
  }
}

function buildExecutionPlans(product: ProductRecord, resultNodeId: string) {
  const resultNode = getNodeById(product.workflow, resultNodeId) as WorkflowNode<"result"> | undefined;
  if (!resultNode) {
    throw new Error("未找到生图结果节点");
  }

  const upstreamNodes = resolveUpstreamNodes(product, resultNodeId);
  const productNode = reverseFindByType(upstreamNodes, "product") || getNodesByType(product.workflow, "product")[0];
  const copyNode = reverseFindByType(upstreamNodes, "copy") || getNodesByType(product.workflow, "copy")[0];
  const processNode = reverseFindByType(upstreamNodes, "process") || getNodesByType(product.workflow, "process")[0];
  const referenceNodes = upstreamNodes.filter((node) => node.type === "reference") as WorkflowNode<"reference">[];

  if (!productNode || !copyNode || !processNode) {
    throw new Error("请确保商品信息、视觉文案、图片处理节点已存在并接入当前结果节点");
  }

  const prepared = ensureCopyAssets(product, copyNode);
  const nextResultNode = getNodeById(prepared.product.workflow, resultNodeId) as WorkflowNode<"result">;
  const selectedDetailIds = new Set(nextResultNode.payload.selectedDetailModuleIds);
  const selectedDetailModules = prepared.copyNode.payload.detailModules.filter((module) => selectedDetailIds.has(module.id));
  const referenceCount = referenceNodes.flatMap((node) => node.payload.images).length;
  const outputPlans: OutputPlan[] = [...prepared.copyNode.payload.cards, ...selectedDetailModules].map((plan) => {
    const size = resolvePlanAspectRatio(plan, processNode.payload.aspectRatio);
    return {
      planId: plan.id,
      code: plan.code,
      kind: plan.kind,
      title: plan.slot,
      size,
      prompt: `${buildPrompt(productNode.payload, plan, prepared.copyNode.payload.reasons, processNode.payload, {
        size,
        includePrice: resolvePlanPrice(plan),
        includeSpecs: shouldShowSpecs(plan),
        compositionGuidance: buildCompositionGuidance(plan),
      })}\n${buildReferencePolicyTextForPlan(referenceCount, plan)}`,
    };
  });

  if (outputPlans.length === 0) {
    throw new Error("当前没有可运行的主图或详情模块，请先生成视觉文案。");
  }

  return {
    product: prepared.product,
    resultNode: nextResultNode,
    copyNode: prepared.copyNode,
    processNode,
    referenceNodes,
    upstreamNodes,
    outputPlans,
  };
}

export function buildPromptPreview(product: ProductRecord, resultNodeId: string) {
  const prepared = buildExecutionPlans(product, resultNodeId);
  const combinedPrompt = prepared.outputPlans
    .map((plan, index) => `### ${index + 1}. ${plan.title}（${plan.size}）\n${plan.prompt}`)
    .join("\n\n---\n\n");

  return {
    prompt: combinedPrompt,
    outputPlanCount: prepared.outputPlans.length,
    processSummary: buildProcessSummary(prepared.processNode.payload),
    outputCount: prepared.processNode.payload.outputCount,
    size: prepared.processNode.payload.aspectRatio,
    referenceCount: prepared.referenceNodes.flatMap((node) => node.payload.images).filter((image) => image.dataUrl).length,
    product: prepared.product,
    mainCardCount: prepared.copyNode.payload.cards.length,
    detailModuleCount: prepared.outputPlans.filter((plan) => plan.kind === "detail").length,
  };
}

export async function executeResultNode(product: ProductRecord, resultNodeId: string) {
  const prepared = buildExecutionPlans(product, resultNodeId);

  const referenceImages = prepared.referenceNodes
    .flatMap((node) => sortReferenceImages(node.payload.images, node.payload.primaryImageId))
    .filter((image) => image.dataUrl)
    .slice(0, 3);

  const count = prepared.processNode.payload.outputCount;
  const totalTasks = prepared.outputPlans.length * count;
  if (totalTasks > MAX_TASKS_PER_RUN) {
    throw new Error(`当前配置会生成 ${totalTasks} 张图，超过单次上限 ${MAX_TASKS_PER_RUN} 张，请减少详情模块或每个版块候选数。`);
  }

  const mode = referenceImages.length > 0 ? "edit" : "generate";
  const runId = makeId();
  const createdAt = new Date().toISOString();
  const outputs: WorkflowRunOutputGroup[] = [];
  const fileCache = new Map<AspectRatio, File[]>();

  async function getReferenceFilesForSize(size: AspectRatio) {
    if (fileCache.has(size)) {
      return fileCache.get(size)!;
    }

    const optimizedReferences = await Promise.all(
      referenceImages.map(async (image) => ({
        original: image,
        dataUrl: await normalizeImageDataUrl(image.dataUrl!, {
          aspectRatio: size,
          background: prepared.processNode.payload.background,
          fit: prepared.processNode.payload.fit,
          maxSide: prepared.processNode.payload.maxSide,
        }),
      })),
    );

    const files = optimizedReferences.map((item, index) =>
      dataUrlToFile(item.dataUrl, item.original.name || `reference-${index + 1}.png`, item.original.type || "image/png"),
    );

    fileCache.set(size, files);
    return files;
  }

  for (const plan of prepared.outputPlans) {
    const files = mode === "edit" ? await getReferenceFilesForSize(plan.size) : [];
    const tasks = Array.from({ length: count }, async (_, index) => {
      const response =
        mode === "edit"
          ? await editImage(files, {
              prompt: plan.prompt,
              model: "gpt-image-2",
              size: plan.size,
              n: 1,
            })
          : await generateImage({
              prompt: plan.prompt,
              model: "gpt-image-2",
              size: plan.size,
              n: 1,
              response_format: "b64_json",
            });

      const first = response.data?.[0];
      if (!first?.b64_json) {
        throw new Error("接口没有返回 b64_json");
      }

      return {
        id: `${runId}-${plan.code}-${index}`,
        name: `${plan.title.replace(/\s+/g, "-")}-${index + 1}.png`,
        type: "image/png",
        dataUrl: base64ToDataUrl(first.b64_json),
        status: "success" as const,
        createdAt,
      } satisfies GeneratedImageAsset;
    });

    const settled = await Promise.allSettled(tasks);
    const images = settled.map((item, index) =>
      item.status === "fulfilled"
        ? item.value
        : {
            id: `${runId}-${plan.code}-${index}`,
            name: `${plan.title.replace(/\s+/g, "-")}-${index + 1}.png`,
            type: "image/png",
            status: "error" as const,
            createdAt,
            error: item.reason instanceof Error ? item.reason.message : "生成失败",
          },
    );

    outputs.push({
      id: makeId(),
      planId: plan.planId,
      code: plan.code,
      kind: plan.kind,
      title: plan.title,
      prompt: plan.prompt,
      size: plan.size,
      images,
      error: images.every((image) => image.status === "error") ? "该版块全部生成失败" : undefined,
    });
  }

  const failedCount = outputs.flatMap((group) => group.images).filter((image) => image.status === "error").length;
  const totalImages = outputs.reduce((total, group) => total + group.images.length, 0);
  const runRecord: WorkflowRunRecord = {
    id: runId,
    createdAt,
    mode,
    count,
    size: prepared.processNode.payload.aspectRatio,
    prompt: prepared.outputPlans.map((plan, index) => `### ${index + 1}. ${plan.title}（${plan.size}）\n${plan.prompt}`).join("\n\n---\n\n"),
    processSummary: buildProcessSummary(prepared.processNode.payload),
    sourceNodeIds: unique(prepared.upstreamNodes.map((node) => node.id)),
    outputs,
    totalImages,
    error: failedCount > 0 ? `其中 ${failedCount} 张生成失败` : undefined,
  };

  const nextProduct = updateNode(prepared.product, prepared.resultNode.id, (node) => ({
    ...(node as WorkflowNode<"result">),
    payload: {
      ...(node as WorkflowNode<"result">).payload,
      history: [runRecord, ...(node as WorkflowNode<"result">).payload.history].slice(0, 12),
    },
  }));

  return {
    product: nextProduct,
    run: runRecord,
    prompt: runRecord.prompt,
  };
}

export function appendGeneratedImageToReference(
  product: ProductRecord,
  options: {
    resultNodeId: string;
    runId: string;
    imageId: string;
    referenceNodeId?: string;
  },
) {
  const resultNode = getNodeById(product.workflow, options.resultNodeId) as WorkflowNode<"result"> | undefined;
  if (!resultNode) throw new Error("未找到结果节点");

  const run = resultNode.payload.history.find((item) => item.id === options.runId);
  const matchedOutput = run?.outputs.find((group) => group.images.some((image) => image.id === options.imageId));
  const image = matchedOutput?.images.find((item) => item.id === options.imageId);
  if (!run || !matchedOutput || !image || image.status !== "success" || !image.dataUrl) {
    throw new Error("未找到可回填的生成结果");
  }

  const targetNodeId =
    options.referenceNodeId || resultNode.payload.autoReferenceNodeId || getNodesByType(product.workflow, "reference")[0]?.id;
  if (!targetNodeId) {
    throw new Error("当前工作流没有可回填的参考图节点");
  }

  return updateNode(product, targetNodeId, (node) => {
    const referenceNode = node as WorkflowNode<"reference">;
    const newImage: ProductImageAsset = {
      id: makeId(),
      name: image.name,
      type: image.type,
      dataUrl: image.dataUrl,
      role: matchedOutput.kind === "detail" ? "detail" : "hero",
      notes: `来自 ${matchedOutput.title} · ${new Date(run.createdAt).toLocaleString("zh-CN")}`,
    };

    return {
      ...referenceNode,
      payload: {
        ...referenceNode.payload,
        primaryImageId: referenceNode.payload.primaryImageId || newImage.id,
        images: [newImage, ...referenceNode.payload.images],
      },
    };
  });
}

export function getSuggestedReferenceNodeId(product: ProductRecord, resultNodeId: string) {
  const resultNode = getNodeById(product.workflow, resultNodeId) as WorkflowNode<"result"> | undefined;
  return resultNode?.payload.autoReferenceNodeId || getNodesByType(product.workflow, "reference")[0]?.id;
}

export function createDefaultPayloadForType(type: WorkflowNodeType) {
  return createWorkflowNode(type, { x: 0, y: 0 }).payload;
}
