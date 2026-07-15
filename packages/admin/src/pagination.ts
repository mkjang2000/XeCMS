export function parsePageParameter(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return 1;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

export function calculateLastPage(total: number, pageSize: number): number {
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1) {
    throw new RangeError("Pagination totals must be non-negative and pageSize must be positive.");
  }
  return Math.max(1, Math.ceil(total / pageSize));
}
