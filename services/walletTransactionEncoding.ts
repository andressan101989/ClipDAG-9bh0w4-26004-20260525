const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function isValidEvmAddress(value: string): boolean {
  return EVM_ADDRESS.test(value);
}

export function decimalToUnits(value: string | number, decimals: number): bigint {
  const normalized = typeof value === 'number' ? String(value) : value.trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error('Cantidad de decimales inválida');
  }
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    throw new Error('Monto inválido');
  }
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) {
    throw new Error(`El monto admite como máximo ${decimals} decimales`);
  }
  const units = BigInt(whole) * (10n ** BigInt(decimals))
    + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
  if (units <= 0n) throw new Error('El monto debe ser mayor a cero');
  return units;
}

export function unitsToHex(units: bigint): string {
  if (units < 0n) throw new Error('Las unidades no pueden ser negativas');
  return `0x${units.toString(16)}`;
}

export function encodeErc20Transfer(recipient: string, units: bigint): string {
  if (!isValidEvmAddress(recipient)) throw new Error('Dirección de destino inválida');
  const addressWord = recipient.slice(2).toLowerCase().padStart(64, '0');
  const amountWord = units.toString(16).padStart(64, '0');
  if (amountWord.length > 64) throw new Error('Monto ERC-20 fuera de rango');
  return `0xa9059cbb${addressWord}${amountWord}`;
}

export function utf8ToHex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  return `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function isUserRejectedWalletRequest(error: unknown): boolean {
  const candidate = error as { code?: number | string; message?: string } | null;
  return candidate?.code === 4001
    || /cancel(?:led|ado|ada)?|user rejected|rechazad[ao]/i.test(candidate?.message ?? '');
}

