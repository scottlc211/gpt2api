import { ProductPreviewPage } from "@/components/product-preview-page";

export default async function ProductPreviewRoute({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <ProductPreviewPage productId={productId} />;
}
