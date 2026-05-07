import type { AspectRatio, BackgroundStyle, ImageFitMode } from "@/lib/workbench";

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片加载失败"));
    image.src = src;
  });
}

export async function measureImageDataUrl(dataUrl: string) {
  const image = await loadImage(dataUrl);
  return { width: image.naturalWidth, height: image.naturalHeight };
}

function aspectRatioToSize(aspectRatio: AspectRatio, maxSide: number) {
  switch (aspectRatio) {
    case "4:3":
      return { width: maxSide, height: Math.round((maxSide * 3) / 4) };
    case "16:9":
      return { width: maxSide, height: Math.round((maxSide * 9) / 16) };
    case "3:4":
      return { width: Math.round((maxSide * 3) / 4), height: maxSide };
    case "9:16":
      return { width: Math.round((maxSide * 9) / 16), height: maxSide };
    case "1:1":
    default:
      return { width: maxSide, height: maxSide };
  }
}

export function base64ToDataUrl(b64: string, mimeType = "image/png") {
  return `data:${mimeType};base64,${b64}`;
}

export async function normalizeImageDataUrl(
  dataUrl: string,
  options: {
    aspectRatio: AspectRatio;
    background: BackgroundStyle;
    fit: ImageFitMode;
    maxSide: number;
  },
) {
  if (typeof document === "undefined") {
    return dataUrl;
  }

  const sourceImage = await loadImage(dataUrl);
  const { width, height } = aspectRatioToSize(options.aspectRatio, options.maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return dataUrl;
  }

  if (options.background === "transparent") {
    context.clearRect(0, 0, width, height);
  } else {
    const fillStyle =
      options.background === "studio"
        ? "#f5f3ef"
        : options.background === "lifestyle"
          ? "#f2efe7"
          : "#ffffff";
    context.fillStyle = fillStyle;
    context.fillRect(0, 0, width, height);
  }

  const sourceRatio = sourceImage.naturalWidth / sourceImage.naturalHeight;
  const targetRatio = width / height;

  let drawWidth = width;
  let drawHeight = height;

  if (options.fit === "contain") {
    if (sourceRatio > targetRatio) {
      drawHeight = Math.round(width / sourceRatio);
    } else {
      drawWidth = Math.round(height * sourceRatio);
    }
  } else if (sourceRatio > targetRatio) {
    drawWidth = Math.round(height * sourceRatio);
  } else {
    drawHeight = Math.round(width / sourceRatio);
  }

  const drawX = Math.round((width - drawWidth) / 2);
  const drawY = Math.round((height - drawHeight) / 2);
  context.drawImage(sourceImage, drawX, drawY, drawWidth, drawHeight);

  return canvas.toDataURL("image/png");
}
