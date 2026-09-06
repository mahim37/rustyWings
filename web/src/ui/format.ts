const intFormat = new Intl.NumberFormat('en-US');

export function fmtInt(n: number): string {
  return intFormat.format(Math.round(n));
}

/** 1234 → "1,234"; 12345 → "12.3K"; 1234567 → "1.2M". */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'K';
  return fmtInt(n);
}

export function degOf(radians: number): number {
  return Math.round((radians * 180) / Math.PI);
}

export function ticksAgo(ticks: number): string {
  if (ticks <= 0) return 'now';
  return compact(ticks) + ' ticks ago';
}

export function bytes(n: number): string {
  if (n <= 0) return '—';
  return (n / 1024).toFixed(0) + ' KB';
}

export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export const wrap01 = (x: number): number => ((x % 1) + 1) % 1;
