// 議事録を年度(4月始まり)で扱うためのヘルパー
export function fiscalYearOf(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00");
  const y = d.getFullYear();
  return d.getMonth() + 1 >= 4 ? y : y - 1;
}

export function groupYears<T extends { meeting_date: string }>(
  minutes: T[]
): { years: number[]; byYear: Map<number, T[]> } {
  const byYear = new Map<number, T[]>();
  for (const m of minutes) {
    const fy = fiscalYearOf(m.meeting_date);
    if (!byYear.has(fy)) byYear.set(fy, []);
    byYear.get(fy)!.push(m);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => b - a);
  return { years, byYear };
}
