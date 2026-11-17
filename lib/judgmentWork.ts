import { CHECKUP_TYPES, isSevereJudgment, roundLabel } from "@/lib/checkups";

// 産業医事務所ダッシュボードの最初に出す「就業判定のお仕事」。
// 就業判定が未入力・判定保留の健診結果を、企業ごと・健診(年度×区分×実施回)ごとに数える

export type JudgmentWorkRow = {
  company_id: string;
  fiscal_year: number;
  round: number | null;
  checkup_type: string;
  special_kind: string | null;
  overall_judgment: string | null;
  work_judgment: string | null; // null = 未判定 / "pending" = 判定保留
};

export type JudgmentWorkPart = {
  label: string; // 例: 2026年度 定期健診 第2回
  href: string; // その健診の一覧
  unjudged: number; // 就業判定が未入力
  severe: number; // 未入力のうち総合判定D(個別に判定する方)
  held: number; // 判定保留
};
export type JudgmentWorkCompany = {
  companyId: string;
  name: string;
  unjudged: number;
  severe: number;
  held: number;
  parts: JudgmentWorkPart[];
};
export type JudgmentWork = { unjudged: number; severe: number; held: number; companies: JudgmentWorkCompany[] };

// 健康診断管理の区分のキー(lib/checkupList.ts の groupKeyOf と同じ形)
const groupKey = (type: string, kind: string | null) => (type === "special" ? `special:${(kind ?? "").trim()}` : type);

export function summarizeJudgmentWork(rows: JudgmentWorkRow[], companies: { id: string; name: string }[]): JudgmentWork {
  const names = new Map(companies.map((c) => [c.id, c.name]));
  const byCompany = new Map<string, Map<string, JudgmentWorkPart & { year: number; round: number }>>();
  for (const r of rows) {
    if (!names.has(r.company_id)) continue; // 健康管理Webを使っていない企業は出さない
    const held = r.work_judgment === "pending";
    if (r.work_judgment && !held) continue; // 判定済み
    const round = r.round ?? 1;
    const key = `${r.fiscal_year}|${groupKey(r.checkup_type, r.special_kind)}|${round}`;
    const parts = byCompany.get(r.company_id) ?? new Map();
    byCompany.set(r.company_id, parts);
    let p = parts.get(key);
    if (!p) {
      const kind = r.checkup_type === "special" && r.special_kind ? `(${r.special_kind.trim()})` : "";
      p = {
        year: r.fiscal_year,
        round,
        label: `${r.fiscal_year}年度 ${CHECKUP_TYPES[r.checkup_type] ?? r.checkup_type}${kind}${roundLabel(round) ? ` ${roundLabel(round)}` : ""}`,
        href: `/office/${r.company_id}/checkups?year=${r.fiscal_year}&round=${round}&group=${encodeURIComponent(groupKey(r.checkup_type, r.special_kind))}`,
        unjudged: 0,
        severe: 0,
        held: 0,
      };
      parts.set(key, p);
    }
    if (held) p.held++;
    else {
      p.unjudged++;
      if (isSevereJudgment(r.overall_judgment)) p.severe++;
    }
  }
  const list: JudgmentWorkCompany[] = Array.from(byCompany.entries()).map(([companyId, parts]) => {
    const ps = Array.from(parts.values()).sort((a, b) => b.year - a.year || a.label.localeCompare(b.label, "ja") || a.round - b.round);
    return {
      companyId,
      name: names.get(companyId) ?? "",
      unjudged: ps.reduce((s, p) => s + p.unjudged, 0),
      severe: ps.reduce((s, p) => s + p.severe, 0),
      held: ps.reduce((s, p) => s + p.held, 0),
      parts: ps.map(({ label, href, unjudged, severe, held }) => ({ label, href, unjudged, severe, held })),
    };
  });
  // 個別に判定する方(総合判定D)が多い企業から並べる
  list.sort((a, b) => b.severe - a.severe || b.unjudged + b.held - (a.unjudged + a.held) || a.name.localeCompare(b.name, "ja"));
  return {
    unjudged: list.reduce((s, c) => s + c.unjudged, 0),
    severe: list.reduce((s, c) => s + c.severe, 0),
    held: list.reduce((s, c) => s + c.held, 0),
    companies: list,
  };
}
