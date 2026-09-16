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

export function formatAdminUsd(value:unknown){
  return `${usdFormatter.format(Number.isFinite(Number(value))?Number(value):0)} USD`;
}
