import { calculateMarketplaceProductQualityCore } from "./marketplaceProductQualityCore.mjs";
export interface MarketplaceProductQualityInput {
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
export interface MarketplaceProductQuality {
  score: number;
  level: "Necesita mejorar" | "Bueno" | "Muy bueno" | "Excelente";
  suggestions: string[];
}
export const calculateMarketplaceProductQuality = (
  input: MarketplaceProductQualityInput,
): MarketplaceProductQuality =>
  calculateMarketplaceProductQualityCore(input) as MarketplaceProductQuality;
