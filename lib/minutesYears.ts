// 議事録を年度(4月始まり)で扱うためのヘルパー
export function fiscalYearOf(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00");
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 4 ? y : y - 1;
}

export function groupYearsBy<T>(
  items: T[],
  getDate: (item: T) => string
): { years: number[]; byYear: Map<number, T[]> } {
  const byYear = new Map<number, T[]>();
  for (const item of items) {
    const fy = fiscalYearOf(getDate(item));
    if (!byYear.has(fy)) byYear.set(fy, []);
    byYear.get(fy)!.push(item);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => b - a);
  return { years, byYear };
}

export function groupYears<T extends { meeting_date: string }>(
  minutes: T[]
): { years: number[]; byYear: Map<number, T[]> } {
  return groupYearsBy(minutes, (m) => m.meeting_date);
}
