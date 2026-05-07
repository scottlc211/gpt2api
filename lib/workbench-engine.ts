import { editImage, generateImage } from "@/lib/api";
import { base64ToDataUrl, normalizeImageDataUrl } from "@/lib/image-tools";
import { dataUrlToFile, makeId } from "@/lib/storage";
import {
  createWorkflowNode,
  getNodeById,
  getNodesByType,
  normalizeProductRecord,
  type CopyNodePayload,
  type GeneratedImageAsset,
  type ProcessNodePayload,
  type ProductImageAsset,
  type ProductNodePayload,
  type ProductRecord,
  type ResultNodePayload,
  type VisualPlanCard,
  type VisualSellingReason,
  type WorkflowNode,
  type WorkflowNodeType,
  type WorkflowRunRecord,
} from "@/lib/workbench";

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

function updateNode<T extends WorkflowNodeType>(product: ProductRecord, nodeId: string, updater: (node: WorkflowNode<T>) => WorkflowNode<T>) {
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
        ? `首屏 3 秒讲清楚“为什么值得买”。`
        : index === 1
          ? `让用户快速看到差异化与购买理由。`
          : `帮助用户更轻松完成下单判断。`,
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
      slot: "图1 首图・点击率核心",
      scene: `${name} 居中大图，干净背景，突出主体质感与重点卖点，适合 ${productPayload.platform} 首图浏览。`,
      overlay: `${shortText(name, 10)}\n${shortText(reason1.solution, 14)}\n${shortText(reason1.translatedBenefit, 16)}\n${shortText(priceLine, 14)}`,
      designNotes: `标题控制在 4 行以内，${brand ? `保留 ${brand} 品牌识别，` : ""}整体语气 ${tone}，重点做点击率钩子。`,
    },
    {
      id: makeId(),
      slot: "图2 痛点共鸣・用户代入",
      scene: `通过“使用前 vs 使用后”或“旧方案 vs 新方案”的场景对比，放大 ${reason1.audience} 的真实痛点。`,
      overlay: `你也在纠结 ${shortText(productPayload.category || "选品", 8)} 吗\n${shortText(reason1.painPoint, 16)}\n${shortText(reason1.solution, 12)}\n${shortText(reason1.translatedBenefit, 14)}`,
      designNotes: "问句开头，强化代入感；避免夸大承诺，不做疗效化表述。",
    },
    {
      id: makeId(),
      slot: "图3 差异化优势・竞品区隔",
      scene: `用细节特写、成分/材质对比或三列表格，突出 ${reason2.solution} 的差异化价值。`,
      overlay: `${shortText(reason2.solution, 12)}\n对比更清楚\n${shortText(reason2.evidence, 14)}\n${shortText(reason2.translatedBenefit, 14)}`,
      designNotes: "建议保留 1 处证据位，适合放认证、工艺、材质或检测说明。",
    },
    {
      id: makeId(),
      slot: "图4 场景适配・使用价值",
      scene: `组合 2-3 个典型使用场景，展示 ${name} 在不同环境下的适配度与购买价值。`,
      overlay: `居家 / 通勤 / 出行\n${shortText(reason3.solution, 12)}\n${shortText(reason3.translatedBenefit, 16)}\n${shortText(productPayload.skuText || "规格信息待补充", 14)}`,
      designNotes: "适合三宫格或场景拼贴，保持生活化但不杂乱。",
    },
    {
      id: makeId(),
      slot: "图5 CTA 行动号召",
      scene: `产品全家福或主图强化版，保留活动价位、优惠信息和 CTA 区域。`,
      overlay: `${shortText(name, 10)}\n${shortText(priceLine, 14)}\n${shortText(reason1.evidence, 14)}\n立即查看详情`,
      designNotes: "CTA 区做高对比跳色，价格和信任背书靠近按钮区域。",
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
      summary: `已生成 ${cards.length} 张电商视觉执行卡，建议先确认图1与图3的主卖点表达。`,
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

function buildPrompt(productPayload: ProductNodePayload, card: VisualPlanCard, reasons: VisualSellingReason[], processPayload: ProcessNodePayload) {
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
    productPayload.priceText ? `价格信息：${productPayload.priceText}` : "价格信息：按活动位留白处理",
    productPayload.skuText ? `规格信息：${productPayload.skuText}` : "规格信息：保留参数展示区",
    `核心卖点：\n${reasonLines}`,
    `画面卡片：${card.slot}`,
    `画面内容：${card.scene}`,
    `图内文案：${card.overlay}`,
    `设计说明：${card.designNotes}`,
    `图片处理要求：背景为 ${describeBackground(processPayload.background)}；构图以 ${processPayload.cropFocus} 为准；修图要求：${processPayload.retouchNotes}`,
    `额外处理说明：${processPayload.maskHint}`,
    `输出比例：${processPayload.aspectRatio}；构图策略：${processPayload.fit === "cover" ? "优先铺满画面" : "优先完整展示主体"}`,
    `补充提示：${processPayload.promptNotes}`,
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

function ensureCopyAndCard(product: ProductRecord, copyNode: WorkflowNode<"copy">, resultNode: WorkflowNode<"result">) {
  let nextProduct = product;
  let nextCopyNode = copyNode;
  let nextResultNode = resultNode;

  if (copyNode.payload.cards.length === 0 || copyNode.payload.reasons.length === 0) {
    nextProduct = generateCopyForNode(nextProduct, copyNode.id);
    nextCopyNode = getNodeById(nextProduct.workflow, copyNode.id) as WorkflowNode<"copy">;
    nextResultNode = getNodeById(nextProduct.workflow, resultNode.id) as WorkflowNode<"result">;
  }

  const preferredCardId = nextResultNode.payload.preferredCardId || nextCopyNode.payload.cards[0]?.id;
  const selectedCard = nextCopyNode.payload.cards.find((card) => card.id === preferredCardId) || nextCopyNode.payload.cards[0];
  if (!selectedCard) {
    throw new Error("视觉文案节点还没有可用的画面卡片");
  }

  if (preferredCardId && preferredCardId !== nextResultNode.payload.preferredCardId) {
    nextProduct = updateNode(nextProduct, nextResultNode.id, (node) => ({
      ...(node as WorkflowNode<"result">),
      payload: {
        ...(node as WorkflowNode<"result">).payload,
        preferredCardId,
      },
    }));
    nextResultNode = getNodeById(nextProduct.workflow, resultNode.id) as WorkflowNode<"result">;
  }

  return { product: nextProduct, copyNode: nextCopyNode, resultNode: nextResultNode, selectedCard };
}

function buildReferencePolicyText(referenceCount: number) {
  return referenceCount > 0 ? "参考图仅用于主体外观、材质与比例锚定，不要机械复制背景。" : "无参考图，按商业棚拍商品图风格自主生成。";
}

export function buildPromptPreview(product: ProductRecord, resultNodeId: string) {
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

  const prepared = ensureCopyAndCard(product, copyNode, resultNode);
  const prompt = buildPrompt(productNode.payload, prepared.selectedCard, prepared.copyNode.payload.reasons, processNode.payload);
  return {
    prompt: `${prompt}\n${buildReferencePolicyText(referenceNodes.flatMap((node) => node.payload.images).length)}`,
    selectedCard: prepared.selectedCard,
    processSummary: buildProcessSummary(processNode.payload),
    outputCount: processNode.payload.outputCount,
    size: processNode.payload.aspectRatio,
    referenceCount: referenceNodes.flatMap((node) => node.payload.images).filter((image) => image.dataUrl).length,
    product: prepared.product,
  };
}

export async function executeResultNode(product: ProductRecord, resultNodeId: string) {
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
    throw new Error("运行前请至少连接商品信息、视觉文案、图片处理节点");
  }

  const prepared = ensureCopyAndCard(product, copyNode, resultNode);
  const prompt = `${buildPrompt(
    productNode.payload,
    prepared.selectedCard,
    prepared.copyNode.payload.reasons,
    processNode.payload,
  )}\n${buildReferencePolicyText(referenceNodes.flatMap((node) => node.payload.images).length)}`;

  const referenceImages = referenceNodes
    .flatMap((node) => sortReferenceImages(node.payload.images, node.payload.primaryImageId))
    .filter((image) => image.dataUrl)
    .slice(0, 3);

  const optimizedReferences = await Promise.all(
    referenceImages.map(async (image) => ({
      original: image,
      dataUrl: await normalizeImageDataUrl(image.dataUrl!, {
        aspectRatio: processNode.payload.aspectRatio,
        background: processNode.payload.background,
        fit: processNode.payload.fit,
        maxSide: processNode.payload.maxSide,
      }),
    })),
  );

  const files = optimizedReferences.map((item, index) =>
    dataUrlToFile(item.dataUrl, item.original.name || `reference-${index + 1}.png`, item.original.type || "image/png"),
  );

  const count = processNode.payload.outputCount;
  const mode = files.length > 0 ? "edit" : "generate";
  const runId = makeId();
  const createdAt = new Date().toISOString();

  const tasks = Array.from({ length: count }, async (_, index) => {
    const response =
      mode === "edit"
        ? await editImage(files, {
            prompt,
            model: "gpt-image-2",
            size: processNode.payload.aspectRatio,
            n: 1,
          })
        : await generateImage({
            prompt,
            model: "gpt-image-2",
            size: processNode.payload.aspectRatio,
            n: 1,
            response_format: "b64_json",
          });

    const first = response.data?.[0];
    if (!first?.b64_json) {
      throw new Error("接口没有返回 b64_json");
    }

    return {
      id: `${runId}-${index}`,
      name: `${prepared.selectedCard.slot.replace(/\s+/g, "-")}-${index + 1}.png`,
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
          id: `${runId}-${index}`,
          name: `${prepared.selectedCard.slot.replace(/\s+/g, "-")}-${index + 1}.png`,
          type: "image/png",
          status: "error" as const,
          createdAt,
          error: item.reason instanceof Error ? item.reason.message : "生成失败",
        },
  );

  const failedCount = images.filter((image) => image.status === "error").length;
  const runRecord: WorkflowRunRecord = {
    id: runId,
    createdAt,
    mode,
    count,
    size: processNode.payload.aspectRatio,
    prompt,
    cardTitle: prepared.selectedCard.slot,
    processSummary: buildProcessSummary(processNode.payload),
    sourceNodeIds: unique(upstreamNodes.map((node) => node.id)),
    images,
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
    prompt,
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
  const image = run?.images.find((item) => item.id === options.imageId);
  if (!run || !image || image.status !== "success" || !image.dataUrl) {
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
      role: "hero",
      notes: `来自 ${run.cardTitle} · ${new Date(run.createdAt).toLocaleString("zh-CN")}`,
    };

    return {
      ...referenceNode,
      payload: {
        ...referenceNode.payload,
        primaryImageId: newImage.id,
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
