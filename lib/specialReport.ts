// 特殊健康診断の労基署報告(有機溶剤等健康診断結果報告書 様式第3号の2 / 特定化学物質健康診断結果報告書 様式第3号)に
// 転記するための集計。取り込んだ特殊健診(checkup_type = 'special')の検査項目から人数を数える。
//
//   有機溶剤: 検査区分(他覚所見・腎機能・貧血・肝機能・眼底・神経内科)ごとの実施者数と有所見者数、
//             作業条件の調査人数、所見のあった者の人数(他覚所見のみを除く)、医師の指示人数、
//             代謝物の検査(有機溶剤コード・検査内容コードごとの実施者数と分布1〜3の人数)、有機溶剤業務コード
//   特定化学物質: 特定化学物質業務コードごとの受診労働者数・有所見者数・疾病にかかっていると診断された者の数
//
// 有所見は C 以上(定期健診の集計と同じ)。代謝物の分布は 1〜3(分布3は C 扱い)。
// 健診機関の判定(A・B1・B2・C・R・T)のうち、医師の指示人数は B2・C・R・T(および D・E)を数える
// (B1 は「医師が第二次健康診断を必要としないと判断」したものなので含めない)。

import { splitDistribution } from "@/lib/gradeText";
import { isFindingJudgment } from "@/lib/checkups";
import { isNormalFinding } from "@/lib/textJudgment";
import { createClient } from "@/lib/supabase/server";
import { fetchCheckupItems } from "@/lib/checkupItems";
import type { ReportItem } from "@/lib/checkupReport";

export type SpecialRow = {
  id: string;
  target_name: string;
  special_kind: string | null;
  checkup_date: string | null;
  overall_judgment: string | null;
  round?: number | null; // 実施回
};

export function isOrganicKind(kind: string | null | undefined): boolean {
  return /有機/.test(kind ?? "");
}
export function isChemicalKind(kind: string | null | undefined): boolean {
  return /特定化学|特化/.test(kind ?? "");
}

const norm = (s: string | null | undefined) => (s ?? "").normalize("NFKC").toLowerCase().replace(/[\s　]/g, "");

// 「医師の指示」に当たる総合判定か(B2・C・R・T、または D・E)
export function isInstructedJudgment(j: string | null | undefined): boolean {
  const t = norm(j).toUpperCase();
  if (!t) return false;
  if (/^B2/.test(t)) return true;
  return /^[CDERT]/.test(t);
}

// 判定が「有所見」(A 以外)か。特殊健診の B1 も有所見として数える(様式第3号の有所見者数)
function isAbnormalJudgment(j: string | null | undefined): boolean {
  const t = norm(j).toUpperCase();
  return !!t && !/^A/.test(t);
}

// ------------------------------------------------------------
// 有機溶剤
// ------------------------------------------------------------
export type OrganicCategory = { key: string; label: string; examined: number; findings: number };
export type MetaboliteSummary = {
  key: string;
  label: string; // 検査名(尿中馬尿酸 など)
  solventCode: string; // 有機溶剤コード(別表2)
  solventName: string;
  testCode: string; // 検査内容コード(別表2)
  examined: number;
  dist: [number, number, number]; // 分布1・2・3 の人数
  unknown: number; // 値はあるが分布が読めなかった人数
};
export type OrganicReport = {
  count: number; // 受診労働者数
  lastCheckupDate: string | undefined;
  workCodes: string[]; // 有機溶剤業務コード(2桁)
  categories: OrganicCategory[];
  workConditionCount: number; // 作業条件の調査人数
  findingsCount: number; // 所見のあった者の人数(他覚所見のみを除く)
  instructedCount: number; // 医師の指示人数
  instructedBreakdown: Record<string, number>; // 総合判定ごとの人数
  metabolites: MetaboliteSummary[];
};

const ORGANIC_CATEGORIES: { key: string; label: string; test: (n: string) => boolean }[] = [
  { key: "other", label: "他覚所見", test: (n) => /他覚/.test(n) },
  { key: "kidney", label: "腎機能検査（尿蛋白）", test: (n) => /尿蛋白|尿たんぱく|尿タンパク|蛋白/.test(n) && !/分布/.test(n) },
  { key: "anemia", label: "貧血検査", test: (n) => /赤血球|血色素|ヘモグロビン|^hb$|ヘマトクリット/.test(n) },
  { key: "liver", label: "肝機能検査", test: (n) => /^ast|^alt|gtp|got|gpt|γ-?gt/.test(n) },
  { key: "fundus", label: "眼底検査", test: (n) => /眼底/.test(n) },
  { key: "neuro", label: "神経内科学的検査", test: (n) => /神経/.test(n) },
];

// 作業条件の調査人数: 「作業時間」に記載があり 0 時間を超えている方を数える
// (「~1」「1~4」「4~8」「8~」のような区分表記は 0 を超える扱い。「0」「0時間」「なし」「-」は数えない)
const WORK_TIME = (n: string) => /作業時間|作業時間\(時間\/日\)|時間\/日/.test(n);
export function isPositiveWorkTime(value: string | null | undefined): boolean {
  const t = (value ?? "").normalize("NFKC").trim().replace(/\s/g, "");
  if (!t) return false;
  if (/^(0+(\.0+)?(時間|h|hr)?|なし|無し|無|ない|-|−|—|―|ー|※)$/i.test(t)) return false;
  const nums = t.match(/\d+(\.\d+)?/g);
  if (nums && nums.some((x) => Number(x) > 0)) return true;
  // 数字が無くても「~」「〜」「未満」「以上」などの区分表記があれば 0 を超える扱い
  return /[~〜～]|未満|以上|以下|超/.test(t);
}
const WORK_CODE = (n: string) => /業務名番号|業務コード|業務名\(番号\)|業務番号/.test(n) || n === "業務名";

// 別表2: 代謝物の検査(名称の表記ゆれを吸収する)
const METABOLITES: { key: string; label: string; solventCode: string; solventName: string; testCode: string; test: (n: string) => boolean }[] = [
  { key: "mha", label: "尿中メチル馬尿酸", solventCode: "11", solventName: "キシレン", testCode: "1", test: (n) => /メチル馬尿酸/.test(n) },
  { key: "nmf", label: "尿中N-メチルホルムアミド", solventCode: "30", solventName: "N,N-ジメチルホルムアミド", testCode: "1", test: (n) => /メチルホルムアミド|nmf/.test(n) },
  { key: "tca", label: "尿中トリクロル酢酸", solventCode: "35", solventName: "1,1,1-トリクロルエタン", testCode: "1", test: (n) => /トリクロ.?酢酸|トリクロロ酢酸/.test(n) },
  { key: "ttc", label: "尿中総三塩化物", solventCode: "35", solventName: "1,1,1-トリクロルエタン", testCode: "2", test: (n) => /総三塩化物|総3塩化物/.test(n) },
  { key: "ha", label: "尿中馬尿酸", solventCode: "37", solventName: "トルエン", testCode: "1", test: (n) => /馬尿酸/.test(n) && !/メチル/.test(n) },
  { key: "hd", label: "尿中2,5-ヘキサンジオン", solventCode: "39", solventName: "ノルマルヘキサン", testCode: "1", test: (n) => /ヘキサンジオン/.test(n) },
];

// 分布区分(1〜3)を項目の値・判定から読む
function distributionOf(it: ReportItem): string | null {
  const d = splitDistribution(it.value);
  if (d.dist) return d.dist;
  const m = (it.value ?? "").match(/分布\s*([123])/);
  if (m) return m[1];
  const j = norm(it.judgment).toUpperCase();
  if (j === "A") return "1";
  if (j === "B") return "2";
  if (j === "C") return "3";
  return null;
}

export function computeOrganicReport(rows: SpecialRow[], items: ReportItem[]): OrganicReport {
  const ids = new Set(rows.map((r) => r.id));
  const byPerson = new Map<string, ReportItem[]>();
  for (const it of items) {
    if (!ids.has(it.checkup_id)) continue;
    const arr = byPerson.get(it.checkup_id) ?? [];
    arr.push(it);
    byPerson.set(it.checkup_id, arr);
  }
  const hasValue = (it: ReportItem) => (it.value ?? "").trim() !== "" || (it.judgment ?? "").trim() !== "";

  const categories: OrganicCategory[] = ORGANIC_CATEGORIES.map((c) => ({ key: c.key, label: c.label, examined: 0, findings: 0 }));
  let workConditionCount = 0;
  let findingsCount = 0;
  let instructedCount = 0;
  const instructedBreakdown: Record<string, number> = {};
  const workCodes = new Set<string>();
  const metabolites: MetaboliteSummary[] = METABOLITES.map((m) => ({
    key: m.key, label: m.label, solventCode: m.solventCode, solventName: m.solventName, testCode: m.testCode,
    examined: 0, dist: [0, 0, 0], unknown: 0,
  }));

  for (const r of rows) {
    const its = byPerson.get(r.id) ?? [];
    const named = its.map((it) => ({ it, n: norm(it.item_name) }));

    // 検査区分ごと: 値のある項目が1つでもあれば実施、C以上の判定が1つでもあれば有所見
    ORGANIC_CATEGORIES.forEach((c, idx) => {
      const mine = named.filter(({ n }) => c.test(n));
      if (c.key === "other") {
        // 他覚所見は全員に行われる。番号・所見の記載があれば有所見
        categories[idx].examined += 1;
        if (mine.some(({ it }) => isFindingJudgment(it.judgment) || ((it.value ?? "").trim() !== "" && !isNormalFinding(it.value ?? ""))))
          categories[idx].findings += 1;
        return;
      }
      if (mine.some(({ it }) => hasValue(it))) categories[idx].examined += 1;
      if (mine.some(({ it }) => isFindingJudgment(it.judgment) || /^\+|\(\+\)|（\+）/.test((it.value ?? "").trim()))) categories[idx].findings += 1;
    });

    if (named.some(({ it, n }) => WORK_TIME(n) && isPositiveWorkTime(it.value))) workConditionCount += 1;

    // 所見のあった者: 他覚所見以外の項目に C 以上の判定がある(代謝物の分布3 を含む)。
    // 分布の読み取りは代謝物の項目に限る(「業務名番号 3」のような値を分布と誤認しないため)
    const isMetabolite = (n: string) => METABOLITES.some((m) => m.test(n));
    const anyFinding = named.some(
      ({ it, n }) => !/他覚/.test(n) && (isFindingJudgment(it.judgment) || (isMetabolite(n) && distributionOf(it) === "3"))
    );
    if (anyFinding) findingsCount += 1;

    if (isInstructedJudgment(r.overall_judgment)) {
      instructedCount += 1;
      const key = norm(r.overall_judgment).toUpperCase();
      instructedBreakdown[key] = (instructedBreakdown[key] ?? 0) + 1;
    }

    for (const { it, n } of named) {
      if (WORK_CODE(n) && it.value) {
        for (const code of it.value.split(/[,、;；/／\s]+/)) {
          const c = code.replace(/[^0-9]/g, "");
          if (c) workCodes.add(c.padStart(2, "0"));
        }
      }
    }

    // 代謝物: 本体の項目(値)と「○○分布」の項目を合わせて分布を決める
    METABOLITES.forEach((m, idx) => {
      const mine = named.filter(({ n }) => m.test(n));
      if (mine.length === 0) return;
      const main = mine.find(({ n }) => !/分布/.test(n));
      const distItem = mine.find(({ n }) => /分布/.test(n));
      const examined = (main && hasValue(main.it)) || (distItem && hasValue(distItem.it));
      if (!examined) return;
      metabolites[idx].examined += 1;
      const d = (distItem && distributionOf(distItem.it)) || (main && distributionOf(main.it)) || null;
      if (d === "1" || d === "2" || d === "3") metabolites[idx].dist[Number(d) - 1] += 1;
      else metabolites[idx].unknown += 1;
    });
  }

  const dates = rows.map((r) => r.checkup_date).filter((d): d is string => !!d).sort();
  return {
    count: rows.length,
    lastCheckupDate: dates[dates.length - 1],
    workCodes: Array.from(workCodes).sort(),
    categories,
    workConditionCount,
    findingsCount,
    instructedCount,
    instructedBreakdown,
    metabolites: metabolites.filter((m) => m.examined > 0),
  };
}

// ------------------------------------------------------------
// 特定化学物質
// ------------------------------------------------------------
export type ChemicalCodeSummary = {
  code: string; // 特定化学物質業務コード(3桁)
  names: string[]; // 物質名
  works: string[]; // 業務内容(製造・取扱い・試験 など)
  examined: number; // 受診労働者数
  findings: number; // 有所見者数(判定が A 以外)
  disease: number; // 疾病にかかっていると診断された者の数(判定 C)
  secondary: number; // 第二次健康診断を要するとされた者の数(判定 B2)
  judgments: Record<string, number>;
};
export type ChemicalReport = {
  count: number;
  lastCheckupDate: string | undefined;
  codes: ChemicalCodeSummary[];
  noCodeCount: number; // 物質コードの項目が無い受診者
  instructedCount: number;
};

const split = (v: string | null | undefined) => (v ?? "").split(/[;；]/).map((s) => s.trim());

export function computeChemicalReport(rows: SpecialRow[], items: ReportItem[]): ChemicalReport {
  const ids = new Set(rows.map((r) => r.id));
  const byPerson = new Map<string, ReportItem[]>();
  for (const it of items) {
    if (!ids.has(it.checkup_id)) continue;
    const arr = byPerson.get(it.checkup_id) ?? [];
    arr.push(it);
    byPerson.set(it.checkup_id, arr);
  }
  const codes = new Map<string, ChemicalCodeSummary>();
  let noCodeCount = 0;
  let instructedCount = 0;
  const find = (its: ReportItem[], re: RegExp) => its.find((it) => re.test(norm(it.item_name)));

  for (const r of rows) {
    const its = byPerson.get(r.id) ?? [];
    const codeItem = find(its, /^物質コード|業務コード|特定化学物質コード/);
    if (!codeItem || !(codeItem.value ?? "").trim()) {
      noCodeCount += 1;
    } else {
      const codeList = split(codeItem.value);
      const names = split(find(its, /^特定化学物質$|物質名/)?.value);
      const works = split(find(its, /業務内容/)?.value);
      // 物質ごとの判定: 「判定」の項目(;区切り)。無ければ総合判定を全物質に使う
      const judgItem = find(its, /^判定$/);
      const judgList = judgItem ? split(judgItem.value ?? judgItem.judgment) : [];
      codeList.forEach((raw, i) => {
        const code = raw.replace(/[^0-9]/g, "");
        if (!code) return;
        const key = code.padStart(3, "0");
        const s = codes.get(key) ?? { code: key, names: [], works: [], examined: 0, findings: 0, disease: 0, secondary: 0, judgments: {} };
        const j = (judgList[i] ?? judgList[0] ?? r.overall_judgment ?? "").trim();
        s.examined += 1;
        if (isAbnormalJudgment(j)) s.findings += 1;
        if (/^C/i.test(j)) s.disease += 1;
        if (/^B2/i.test(j)) s.secondary += 1;
        if (j) s.judgments[j.toUpperCase()] = (s.judgments[j.toUpperCase()] ?? 0) + 1;
        if (names[i] && !s.names.includes(names[i])) s.names.push(names[i]);
        if (works[i] && !s.works.includes(works[i])) s.works.push(works[i]);
        codes.set(key, s);
      });
    }
    if (isInstructedJudgment(r.overall_judgment)) instructedCount += 1;
  }
  const dates = rows.map((r) => r.checkup_date).filter((d): d is string => !!d).sort();
  return {
    count: rows.length,
    lastCheckupDate: dates[dates.length - 1],
    codes: Array.from(codes.values()).sort((a, b) => a.code.localeCompare(b.code)),
    noCodeCount,
    instructedCount,
  };
}

// ------------------------------------------------------------
// 読み込み(企業×年度の特殊健診。実施回は問わない)
// ------------------------------------------------------------
export type SpecialReportData = {
  organicRows: SpecialRow[]; // 選択した実施回の受診者
  chemicalRows: SpecialRow[];
  organicTotal: number; // 年度全体(全実施回)の受診者数
  chemicalTotal: number;
  organicRounds: number[]; // その年度に存在する実施回
  chemicalRounds: number[];
  organicRound: number; // 選択中の実施回
  chemicalRound: number;
  otherKinds: string[]; // 有機溶剤・特定化学物質以外の特殊健診の種類
  organic: OrganicReport;
  chemical: ChemicalReport;
};

// 実施回(第1回・第2回)ごとに分けて集計する。round を省略すると、その種類の最初の実施回
export async function loadSpecialReport(companyId: string, year: number, round?: number): Promise<SpecialReportData> {
  const supabase = createClient();
  const { data } = await supabase
    .from("hm_checkups")
    .select("id, target_name, special_kind, checkup_date, overall_judgment, round")
    .eq("company_id", companyId)
    .eq("fiscal_year", year)
    .eq("checkup_type", "special")
    .order("target_name");
  const rows = (data ?? []) as SpecialRow[];
  const roundsOf = (rs: SpecialRow[]) => Array.from(new Set(rs.map((r) => r.round ?? 1))).sort((a, b) => a - b);
  const pick = (rs: SpecialRow[]) => {
    const rounds = roundsOf(rs);
    const sel = round != null && rounds.includes(round) ? round : rounds[0] ?? 1;
    return { rounds, round: sel, rows: rs.filter((r) => (r.round ?? 1) === sel) };
  };
  const organicAll = rows.filter((r) => isOrganicKind(r.special_kind));
  const chemicalAll = rows.filter((r) => isChemicalKind(r.special_kind));
  const organic = pick(organicAll);
  const chemical = pick(chemicalAll);
  const otherKinds = Array.from(
    new Set(rows.filter((r) => !isOrganicKind(r.special_kind) && !isChemicalKind(r.special_kind)).map((r) => r.special_kind || "（種類未設定）"))
  );
  const items = (await fetchCheckupItems([...organic.rows, ...chemical.rows].map((r) => r.id))) as ReportItem[];
  return {
    organicRows: organic.rows,
    chemicalRows: chemical.rows,
    organicTotal: organicAll.length,
    chemicalTotal: chemicalAll.length,
    organicRounds: organic.rounds,
    chemicalRounds: chemical.rounds,
    organicRound: organic.round,
    chemicalRound: chemical.round,
    otherKinds,
    organic: computeOrganicReport(organic.rows, items),
    chemical: computeChemicalReport(chemical.rows, items),
  };
}
