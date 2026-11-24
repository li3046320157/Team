/** 稳定 ID 生成。 */

let counter = 0;

export function makeId(prefix: string): string {
  counter += 1;
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now().toString(36)}_${rand}${counter % 1000}`;
}

export function nowISOString(): string {
  return new Date().toISOString();
}

export function normalizeMerchantKey(merchant: string | undefined): string {
  if (!merchant) return '';
  return merchant
    .toLowerCase()
    .replace(/[\s，,。.、·\-—_()（）【】\[\]「」"'"']/g, '')
    .trim();
}