export function calculateMarketplaceProductQualityCore(input) {
  let score = 0;
  const suggestions = [];
  if (input.titleConfigured && input.title.trim().length >= 3) score += 15;
  else suggestions.push("Completa el nombre del producto");
  if (input.description.trim().length >= 120) score += 15;
  else if (input.description.trim().length >= 30) score += 8;
  else suggestions.push("Amplia la descripcion");
  if (input.categoryConfigured && input.categoryId) score += 10;
  else suggestions.push("Selecciona una categoria");
  score +=
    input.imageCount >= 5
      ? 25
      : input.imageCount >= 3
        ? 18
        : input.imageCount >= 1
          ? 10
          : 0;
  if (input.imageCount < 3) suggestions.push("Agrega mas fotos");
  if (input.hasValidVideo) score += 10;
  else suggestions.push("Agrega un video");
  if (input.priceConfigured && Number.isFinite(input.price) && input.price > 0)
    score += 10;
  else suggestions.push("Configura el precio");
  if (input.inventory > 0 && input.variantsReady) score += 5;
  else suggestions.push("Agrega inventario");
  if (input.productType === "digital" || input.shippingReady) score += 10;
  else suggestions.push("Configura el envio");
  score = Math.max(0, Math.min(100, score));
  return {
    score,
    level:
      score >= 90
        ? "Excelente"
        : score >= 70
          ? "Muy bueno"
          : score >= 40
            ? "Bueno"
            : "Necesita mejorar",
    suggestions,
  };
}
