import type { MarketplaceShippingErrorCode } from "./marketplaceShippingService";

const ISO_COUNTRY_CODES =
  "AD,AE,AF,AG,AI,AL,AM,AO,AQ,AR,AS,AT,AU,AW,AX,AZ,BA,BB,BD,BE,BF,BG,BH,BI,BJ,BL,BM,BN,BO,BQ,BR,BS,BT,BV,BW,BY,BZ,CA,CC,CD,CF,CG,CH,CI,CK,CL,CM,CN,CO,CR,CU,CV,CW,CX,CY,CZ,DE,DJ,DK,DM,DO,DZ,EC,EE,EG,EH,ER,ES,ET,FI,FJ,FK,FM,FO,FR,GA,GB,GD,GE,GF,GG,GH,GI,GL,GM,GN,GP,GQ,GR,GS,GT,GU,GW,GY,HK,HM,HN,HR,HT,HU,ID,IE,IL,IM,IN,IO,IQ,IR,IS,IT,JE,JM,JO,JP,KE,KG,KH,KI,KM,KN,KP,KR,KW,KY,KZ,LA,LB,LC,LI,LK,LR,LS,LT,LU,LV,LY,MA,MC,MD,ME,MF,MG,MH,MK,ML,MM,MN,MO,MP,MQ,MR,MS,MT,MU,MV,MW,MX,MY,MZ,NA,NC,NE,NF,NG,NI,NL,NO,NP,NR,NU,NZ,OM,PA,PE,PF,PG,PH,PK,PL,PM,PN,PR,PS,PT,PW,PY,QA,RE,RO,RS,RU,RW,SA,SB,SC,SD,SE,SG,SH,SI,SJ,SK,SL,SM,SN,SO,SR,SS,ST,SV,SX,SY,SZ,TC,TD,TF,TG,TH,TJ,TK,TL,TM,TN,TO,TR,TT,TV,TW,TZ,UA,UG,UM,US,UY,UZ,VA,VC,VE,VG,VI,VN,VU,WF,WS,YE,YT,ZA,ZM,ZW".split(
    ",",
  );
const SPANISH_FALLBACK: Record<string, string> = {
  AR: "Argentina",
  BR: "Brasil",
  CA: "Canadá",
  CL: "Chile",
  CO: "Colombia",
  ES: "España",
  FR: "Francia",
  GB: "Reino Unido",
  IT: "Italia",
  MX: "México",
  US: "Estados Unidos",
  VE: "Venezuela",
};
const displayNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["es"], { type: "region" })
    : null;
export const MARKETPLACE_SHIPPING_COUNTRIES = ISO_COUNTRY_CODES.map((code) => ({
  code,
  label: SPANISH_FALLBACK[code] ?? displayNames?.of(code) ?? code,
  requiresCanonicalRegion: code === "US" || code === "CA",
})).sort((a, b) => a.label.localeCompare(b.label, "es"));
export const shippingCountryLabel = (code: string) =>
  MARKETPLACE_SHIPPING_COUNTRIES.find((item) => item.code === code)?.label ??
  code;
export const searchShippingCountries = (query: string) =>
  MARKETPLACE_SHIPPING_COUNTRIES.filter((item) =>
    item.label
      .toLocaleLowerCase("es")
      .includes(query.trim().toLocaleLowerCase("es")),
  );

export const US_STATES = [
  ["AL", "Alabama"],
  ["AK", "Alaska"],
  ["AZ", "Arizona"],
  ["AR", "Arkansas"],
  ["CA", "California"],
  ["CO", "Colorado"],
  ["CT", "Connecticut"],
  ["DE", "Delaware"],
  ["FL", "Florida"],
  ["GA", "Georgia"],
  ["HI", "Hawái"],
  ["ID", "Idaho"],
  ["IL", "Illinois"],
  ["IN", "Indiana"],
  ["IA", "Iowa"],
  ["KS", "Kansas"],
  ["KY", "Kentucky"],
  ["LA", "Luisiana"],
  ["ME", "Maine"],
  ["MD", "Maryland"],
  ["MA", "Massachusetts"],
  ["MI", "Michigan"],
  ["MN", "Minnesota"],
  ["MS", "Misisipi"],
  ["MO", "Misuri"],
  ["MT", "Montana"],
  ["NE", "Nebraska"],
  ["NV", "Nevada"],
  ["NH", "Nuevo Hampshire"],
  ["NJ", "Nueva Jersey"],
  ["NM", "Nuevo México"],
  ["NY", "Nueva York"],
  ["NC", "Carolina del Norte"],
  ["ND", "Dakota del Norte"],
  ["OH", "Ohio"],
  ["OK", "Oklahoma"],
  ["OR", "Oregón"],
  ["PA", "Pensilvania"],
  ["RI", "Rhode Island"],
  ["SC", "Carolina del Sur"],
  ["SD", "Dakota del Sur"],
  ["TN", "Tennessee"],
  ["TX", "Texas"],
  ["UT", "Utah"],
  ["VT", "Vermont"],
  ["VA", "Virginia"],
  ["WA", "Washington"],
  ["WV", "Virginia Occidental"],
  ["WI", "Wisconsin"],
  ["WY", "Wyoming"],
  ["DC", "Washington D. C."],
] as const;

export const CA_PROVINCES = [
  ["AB", "Alberta"],
  ["BC", "Columbia Británica"],
  ["MB", "Manitoba"],
  ["NB", "Nuevo Brunswick"],
  ["NL", "Terranova y Labrador"],
  ["NS", "Nueva Escocia"],
  ["NT", "Territorios del Noroeste"],
  ["NU", "Nunavut"],
  ["ON", "Ontario"],
  ["PE", "Isla del Príncipe Eduardo"],
  ["QC", "Quebec"],
  ["SK", "Saskatchewan"],
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

export function validateShippingSetup(
  input: ShippingSetupValidationInput,
): string[] {
  const errors: string[] = [];
  const processingMin = Number(input.processingDaysMin);
  const processingMax = Number(input.processingDaysMax);
  if (input.name.trim().length < 2)
    errors.push("Escribe un nombre para esta configuración.");
  if (
    !MARKETPLACE_SHIPPING_COUNTRIES.some(
      (x) => x.code === input.shipsFromCountry,
    )
  )
    errors.push("Selecciona el país desde donde envías.");
  if (!Number.isInteger(processingMin) || processingMin < 0)
    errors.push("Completa el tiempo para preparar el pedido.");
  else if (!Number.isInteger(processingMax) || processingMax < processingMin)
    errors.push(
      "El tiempo máximo de preparación debe ser igual o mayor al mínimo.",
    );
  if (input.returnPolicy.trim().length < 10)
    errors.push("Completa la política de devoluciones.");
  if (!input.rules.length && !input.allowEmptyRules)
    errors.push("Selecciona un destino.");
  input.rules.forEach((rule, index) => {
    const label = `Destino ${index + 1}`;
    if (
      !MARKETPLACE_SHIPPING_COUNTRIES.some((x) => x.code === rule.countryCode)
    )
      errors.push(`${label}: selecciona un país válido.`);
    const price = Number(rule.shippingPrice);
    if (!Number.isFinite(price) || price < 0)
      errors.push(`${label}: el costo de envío no puede ser negativo.`);
    const min = Number(rule.transitDaysMin),
      max = Number(rule.transitDaysMax);
    if (!Number.isInteger(min) || min < 1)
      errors.push(`${label}: completa el tiempo de entrega.`);
    else if (!Number.isInteger(max) || max < min)
      errors.push(
        `${label}: el tiempo máximo debe ser igual o mayor al mínimo.`,
      );
  });
  return errors;
}

const ERROR_MESSAGES: Partial<
  Record<MarketplaceShippingErrorCode | string, string>
> = {
  marketplace_shipping_country_invalid: "Selecciona un país válido.",
  marketplace_shipping_region_invalid:
    "Selecciona un estado o provincia válido.",
  marketplace_invalid_shipping_profile:
    "Revisa los campos marcados antes de guardar.",
  marketplace_shipping_rule_not_owned:
    "Este destino ya no pertenece a este perfil. Recarga e inténtalo nuevamente.",
  marketplace_shipping_profile_not_owned:
    "No tienes permiso para editar este perfil.",
  marketplace_store_inactive: "Activa tu tienda antes de configurar envíos.",
};

export function shippingSetupError(error: unknown) {
  const row =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const haystack = [row.message, row.details, row.hint]
    .filter((x) => typeof x === "string")
    .join(" ");
  const token =
    Object.keys(ERROR_MESSAGES).find((code) => haystack.includes(code)) ?? null;
  return {
    token,
    postgresCode: typeof row.code === "string" ? row.code : null,
    message: token
      ? ERROR_MESSAGES[token]!
      : "No pudimos guardar la configuración. Revisa los datos e inténtalo nuevamente.",
  };
}
