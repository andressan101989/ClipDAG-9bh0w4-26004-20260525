import type { MarketplaceShippingErrorCode } from "./marketplaceShippingService";

export const MARKETPLACE_SHIPPING_COUNTRIES = [
  { code: "US", label: "Estados Unidos", requiresCanonicalRegion: true },
  { code: "CA", label: "Canadá", requiresCanonicalRegion: true },
  { code: "GB", label: "Reino Unido", requiresCanonicalRegion: false },
] as const;

export const US_STATES = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawái"], ["ID", "Idaho"],
  ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"],
  ["KY", "Kentucky"], ["LA", "Luisiana"], ["ME", "Maine"], ["MD", "Maryland"],
  ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"], ["MS", "Misisipi"],
  ["MO", "Misuri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "Nuevo Hampshire"], ["NJ", "Nueva Jersey"], ["NM", "Nuevo México"], ["NY", "Nueva York"],
  ["NC", "Carolina del Norte"], ["ND", "Dakota del Norte"], ["OH", "Ohio"], ["OK", "Oklahoma"],
  ["OR", "Oregón"], ["PA", "Pensilvania"], ["RI", "Rhode Island"], ["SC", "Carolina del Sur"],
  ["SD", "Dakota del Sur"], ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"],
  ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"], ["WV", "Virginia Occidental"],
  ["WI", "Wisconsin"], ["WY", "Wyoming"], ["DC", "Washington D. C."],
] as const;

export const CA_PROVINCES = [
  ["AB", "Alberta"], ["BC", "Columbia Británica"], ["MB", "Manitoba"],
  ["NB", "Nuevo Brunswick"], ["NL", "Terranova y Labrador"], ["NS", "Nueva Escocia"],
  ["NT", "Territorios del Noroeste"], ["NU", "Nunavut"], ["ON", "Ontario"],
  ["PE", "Isla del Príncipe Eduardo"], ["QC", "Quebec"], ["SK", "Saskatchewan"],
  ["YT", "Yukón"],
] as const;

export const shippingRegionsForCountry = (countryCode: string) =>
  countryCode === "US" ? US_STATES : countryCode === "CA" ? CA_PROVINCES : [];

export interface ShippingSetupRuleDraft {
  countryCode: string;
  regionCode: string | null;
  shippingPrice: string;
  transitDaysMin: string;
  transitDaysMax: string;
}

export interface ShippingSetupValidationInput {
  name: string;
  shipsFromCountry: string;
  processingDaysMin: string;
  processingDaysMax: string;
  returnPolicy: string;
  rules: ShippingSetupRuleDraft[];
  allowEmptyRules?: boolean;
}

export function validateShippingSetup(input: ShippingSetupValidationInput): string[] {
  const errors: string[] = [];
  const processingMin = Number(input.processingDaysMin);
  const processingMax = Number(input.processingDaysMax);
  if (input.name.trim().length < 2) errors.push("Escribe un nombre para esta configuración.");
  if (!MARKETPLACE_SHIPPING_COUNTRIES.some((x) => x.code === input.shipsFromCountry))
    errors.push("Selecciona el país desde donde envías.");
  if (!Number.isInteger(processingMin) || processingMin < 0)
    errors.push("Completa el tiempo para preparar el pedido.");
  else if (!Number.isInteger(processingMax) || processingMax < processingMin)
    errors.push("El tiempo máximo de preparación debe ser igual o mayor al mínimo.");
  if (input.returnPolicy.trim().length < 10)
    errors.push("Completa la política de devoluciones.");
  if (!input.rules.length && !input.allowEmptyRules)
    errors.push("Selecciona un destino.");
  input.rules.forEach((rule, index) => {
    const label = `Destino ${index + 1}`;
    if (!MARKETPLACE_SHIPPING_COUNTRIES.some((x) => x.code === rule.countryCode))
      errors.push(`${label}: selecciona un país válido.`);
    const price = Number(rule.shippingPrice);
    if (!Number.isFinite(price) || price < 0)
      errors.push(`${label}: el costo de envío no puede ser negativo.`);
    const min = Number(rule.transitDaysMin), max = Number(rule.transitDaysMax);
    if (!Number.isInteger(min) || min < 1)
      errors.push(`${label}: completa el tiempo de entrega.`);
    else if (!Number.isInteger(max) || max < min)
      errors.push(`${label}: el tiempo máximo debe ser igual o mayor al mínimo.`);
  });
  return errors;
}

const ERROR_MESSAGES: Partial<Record<MarketplaceShippingErrorCode | string, string>> = {
  marketplace_shipping_country_invalid: "Selecciona un país válido.",
  marketplace_shipping_region_invalid: "Selecciona un estado o provincia válido.",
  marketplace_invalid_shipping_profile: "Revisa los campos marcados antes de guardar.",
  marketplace_shipping_rule_not_owned: "Este destino ya no pertenece a este perfil. Recarga e inténtalo nuevamente.",
  marketplace_shipping_profile_not_owned: "No tienes permiso para editar este perfil.",
  marketplace_store_inactive: "Activa tu tienda antes de configurar envíos.",
};

export function shippingSetupError(error: unknown) {
  const row = error && typeof error === "object" ? (error as Record<string, unknown>) : {};
  const haystack = [row.message, row.details, row.hint].filter((x) => typeof x === "string").join(" ");
  const token = Object.keys(ERROR_MESSAGES).find((code) => haystack.includes(code)) ?? null;
  return {
    token,
    postgresCode: typeof row.code === "string" ? row.code : null,
    message: token ? ERROR_MESSAGES[token]! : "No pudimos guardar la configuración. Revisa los datos e inténtalo nuevamente.",
  };
}
