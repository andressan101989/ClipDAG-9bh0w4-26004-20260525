export interface QualityCoreInput {
  title: string;
  titleConfigured: boolean;
  description: string;
  categoryId: string | null;
  categoryConfigured: boolean;
  imageCount: number;
  hasValidVideo: boolean;
  price: number;
  priceConfigured: boolean;
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
