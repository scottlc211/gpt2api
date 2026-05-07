import { ProductWorkbenchPage } from "@/components/product-workbench-page";

export default async function ProductWorkbenchRoute({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  return <ProductWorkbenchPage productId={productId} />;
}
