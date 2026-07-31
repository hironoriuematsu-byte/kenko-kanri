// 旧形式(巡視場所・所見・指導・改善状況が別欄)の記録を1つのテキストに結合する
export function combinePatrolText(p: {
  areas: string | null;
  findings: string | null;
  advice: string | null;
  note: string | null;
}): string {
  const others = [p.areas, p.advice, p.note].filter(Boolean);
  if (others.length === 0) return p.findings ?? "";
  const parts: string[] = [];
  if (p.areas) parts.push(`【巡視場所】\n${p.areas}`);
  if (p.findings) parts.push(`【指摘事項・所見】\n${p.findings}`);
  if (p.advice) parts.push(`【指導・助言】\n${p.advice}`);
  if (p.note) parts.push(`【改善状況・備考】\n${p.note}`);
  return parts.join("\n\n");
}
