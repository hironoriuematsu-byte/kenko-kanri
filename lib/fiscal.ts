// 年度は4月始まり(既存ストレスチェックWebと同じ)
export function getFiscalYear(date: Date = new Date()): number {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  return m >= 4 ? y : y - 1;
}

export function formatDateJa(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  const d = new Date(dateStr + (dateStr.length === 10 ? "T00:00:00" : ""));
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
