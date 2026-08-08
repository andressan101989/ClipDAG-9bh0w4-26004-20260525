export interface QualityCoreInput {
  title: string;
  description: string;
  categoryId: string | null;
  imageCount: number;
  hasValidVideo: boolean;
  price: number;
  inventory: number;
  variantsReady: boolean;
  shippingReady: boolean;
  productType: "physical" | "digital";
}
export interface QualityCoreResult {
  score: number;
  level: "Necesita mejorar" | "Bueno" | "Muy bueno" | "Excelente";
  suggestions: string[];
}
export function calculateMarketplaceProductQualityCore(
  input: QualityCoreInput,
): QualityCoreResult;
