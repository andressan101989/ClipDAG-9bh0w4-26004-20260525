const decimalFormatter=new Intl.NumberFormat("en-US",{
  minimumFractionDigits:2,
  maximumFractionDigits:2,
});

const usdFormatter=new Intl.NumberFormat("en-US",{
  style:"currency",
  currency:"USD",
  minimumFractionDigits:2,
  maximumFractionDigits:2,
});

export function formatAdminDecimal(value:unknown){
  const amount=Number(value);
  return decimalFormatter.format(Number.isFinite(amount)?amount:0);
}

export function formatAdminMoney(value:unknown,currency:unknown){
  const code=typeof currency==="string"?currency.trim():"";
  return `${formatAdminDecimal(value)}${code?` ${code}`:""}`;
}

const exactEightDecimalPattern=/^(-?)(0|[1-9][0-9]{0,29})\.([0-9]{8})$/;

export function formatAdminExactMoney(value:unknown,currency:unknown){
  if(typeof value!=="string")throw new Error("Importe sin decimal canónico de ocho posiciones");
  const match=exactEightDecimalPattern.exec(value);
  if(!match)throw new Error("Importe sin decimal canónico de ocho posiciones");
  const code=typeof currency==="string"?currency.trim():"";
  if(!/^[A-Z][A-Z0-9]{1,9}$/.test(code))throw new Error("Moneda inválida");
  const [,rawSign,whole,fraction]=match;
  const groupedWhole=whole.replace(/\B(?=(\d{3})+(?!\d))/g,",");
  const sign=rawSign&&BigInt(`${whole}${fraction}`)!==0n?"-":"";
  return `${sign}${groupedWhole}.${fraction} ${code}`;
}

export function formatAdminUsd(value:unknown){
  return `${usdFormatter.format(Number.isFinite(Number(value))?Number(value):0)} USD`;
}
