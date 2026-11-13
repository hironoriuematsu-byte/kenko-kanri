// じん肺健康管理台帳と、じん肺健康管理実施状況報告(じん肺法施行規則 様式第8号)の集計。
// 報告は暦年(1月〜12月)で、12月末現在の状況を翌年2月末までに労基署へ出す(健診を行わない年も報告する)。
// 数え方は京都労働局「じん肺健康管理実施状況報告(様式第8号)の記入方法」(R5.6)に合わせる。

export type Kanri = "1" | "2" | "3i" | "3ro" | "4";
export type KanriDetail = "PR3" | "PR4AB" | "PR4C" | "F++" | "other";
export type DustStatus = "current" | "past";
export type ExamKind = "hiring" | "periodic" | "extra" | "leaving";

export type PneumoWorker = {
  id: string;
  company_id: string;
  person_id: string | null;
  full_name: string;
  dust_status: DustStatus;
  dust_work_code: string | null;
  kanri: Kanri;
  kanri_detail: KanriDetail | null;
  kanri_decided_on: string | null;
  kanri_previous: Kanri | null;
  transferred_on: string | null;
  complication: number | null;
  complication_started_on: string | null;
  left_on: string | null;
  note: string | null;
  kanri_pending?: boolean; // 所見あり(第1型以上)で管理区分の決定待ち(SQL 0154)
};

export type PneumoExam = {
  id: string;
  worker_id: string;
  exam_date: string;
  exam_kind: ExamKind;
  lung_cancer: boolean;
  xray: string | null;
  note: string | null;
  checkup_id?: string | null; // 健康診断管理から写した記録(SQL 0154)
  lung_function?: string | null; // 肺機能(F(-)・F(+)・F(++))
};

export const KANRI_LABEL: Record<Kanri, string> = {
  "1": "管理1",
  "2": "管理2",
  "3i": "管理3イ",
  "3ro": "管理3ロ",
  "4": "管理4",
};
export const KANRI_DETAIL_LABEL: Record<KanriDetail, string> = {
  PR3: "PR3(第3型)",
  PR4AB: "PR4(A,B)(第4型・大陰影が一側肺野の1/3以下)",
  PR4C: "PR4(C)(第4型・大陰影が一側肺野の1/3超)",
  "F++": "F(++)(著しい肺機能障害)",
  other: "その他",
};
// 管理3ロ・管理4のときに選ぶ内訳
export const KANRI_DETAILS_FOR: Partial<Record<Kanri, KanriDetail[]>> = {
  "3ro": ["PR3", "PR4AB"],
  "4": ["PR4C", "F++", "other"],
};
export const DUST_STATUS_LABEL: Record<DustStatus, string> = {
  current: "現在、粉じん作業に従事",
  past: "過去に従事(現在は粉じん作業以外)",
};
export const EXAM_KIND_LABEL: Record<ExamKind, string> = {
  hiring: "就業時",
  periodic: "定期",
  extra: "定期外",
  leaving: "離職時",
};
// じん肺法施行規則第1条の合併症
export const COMPLICATION_LABEL: Record<number, string> = {
  1: "1号 肺結核",
  2: "2号 結核性胸膜炎",
  3: "3号 続発性気管支炎",
  4: "4号 続発性気管支拡張症",
  5: "5号 続発性気胸",
  6: "6号 原発性肺がん",
};

const inYear = (d: string | null | undefined, year: number) => !!d && d.slice(0, 4) === String(year);
const yearEnd = (year: number) => `${year}-12-31`;
// 12月末に在籍している(退職日がないか、12月31日より後)
export const enrolledAtYearEnd = (w: PneumoWorker, year: number) => !w.left_on || w.left_on > yearEnd(year);
const isKanri2or3 = (k: Kanri) => k === "2" || k === "3i" || k === "3ro";

// 定期健診の第1号〜第4号(じん肺法第8条第1項)
//   第1号: 現在粉じん作業に従事・管理1 / 第2号: 現在従事・管理2又は3
//   第3号: 過去に従事・管理2 / 第4号: 過去に従事・管理3
export function periodicClass(w: Pick<PneumoWorker, "dust_status" | "kanri" | "kanri_pending">): 1 | 2 | 3 | 4 | null {
  if (w.kanri_pending) return null; // 管理区分の決定待ちは号が決まらない
  if (w.dust_status === "current") {
    if (w.kanri === "1") return 1;
    if (isKanri2or3(w.kanri)) return 2;
    return null;
  }
  if (w.kanri === "2") return 3;
  if (w.kanri === "3i" || w.kanri === "3ro") return 4;
  return null;
}

export type PneumoReport = {
  year: number;
  lastExamDate: string | null; // 健診年月日(最終の実施日)
  workCodes: { code: string; count: number }[]; // 粉じん作業従事労働者数(12月末現在)。コードのない人は "" にまとめる
  exams: {
    total: number; // 計(イ)〜(ニ)
    hiring: number; // (イ)就業時
    periodic: number; // (ロ)定期 小計
    periodicByClass: [number, number, number, number]; // 第1号〜第4号
    periodicUnclassified: number; // 号に当てはまらない定期健診(管理4 など)
    extra: number; // (ハ)定期外 小計
    extraLungCancer: number; // うち肺がんに関する検査
    leaving: number; // (ニ)離職時
  };
  kanri: {
    pending: number; // 所見あり・管理区分の決定待ち(どの区分にも数えない)
    total: number; // 計(イ)〜(ホ)
    k1: number; // (イ)管理1
    findings: number; // 有所見者数小計(ロ)〜(ホ)
    k2: number;
    k3i: number;
    k3ro: { PR3: number; PR4AB: number; unknown: number };
    k4: { PR4C: number; "F++": number; other: number };
  };
  newlyFrom1: number; // 従来管理1で、本年中に新たに管理2・3・4と決定された数
  transferred: { total: number; k2: number; k3i: number; k3ro: number }; // 本年中に粉じん作業から他の作業へ転換
  pastNonDust: number; // 過去に粉じん作業に従事し、12月末に非粉じん作業で管理2又は3の総数
  complications: { total: number; byNo: [number, number, number, number, number, number] }; // 管理2・3で本年中に合併症の療養を開始
  workers: number; // 12月末に在籍している台帳の人数
};

export function computePneumoReport(workers: PneumoWorker[], exams: PneumoExam[], year: number): PneumoReport {
  const byId = new Map(workers.map((w) => [w.id, w]));
  const enrolled = workers.filter((w) => enrolledAtYearEnd(w, year));

  // 粉じん作業従事労働者数(12月末現在): 現在従事している在籍者を作業コードごとに
  const codeCount = new Map<string, number>();
  for (const w of enrolled.filter((x) => x.dust_status === "current")) {
    const c = w.dust_work_code ?? "";
    codeCount.set(c, (codeCount.get(c) ?? 0) + 1);
  }
  const workCodes = Array.from(codeCount.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));

  // 本年中に実施したじん肺健康診断の延数(本年の受診記録をそのまま数える)
  const yearExams = exams.filter((e) => inYear(e.exam_date, year) && byId.has(e.worker_id));
  const periodicByClass: [number, number, number, number] = [0, 0, 0, 0];
  let periodicUnclassified = 0;
  for (const e of yearExams.filter((x) => x.exam_kind === "periodic")) {
    const c = periodicClass(byId.get(e.worker_id)!);
    if (c) periodicByClass[c - 1] += 1;
    else periodicUnclassified += 1;
  }
  const count = (k: ExamKind) => yearExams.filter((e) => e.exam_kind === k).length;
  const examsSummary = {
    total: yearExams.length,
    hiring: count("hiring"),
    periodic: count("periodic"),
    periodicByClass,
    periodicUnclassified,
    extra: count("extra"),
    extraLungCancer: yearExams.filter((e) => e.exam_kind === "extra" && e.lung_cancer).length,
    leaving: count("leaving"),
  };
  const dates = yearExams.map((e) => e.exam_date).sort();

  // じん肺管理区分別の内訳(12月末現在、現在従事+過去に従事の在籍者)
  const k = {
    pending: 0,
    total: 0,
    k1: 0,
    findings: 0,
    k2: 0,
    k3i: 0,
    k3ro: { PR3: 0, PR4AB: 0, unknown: 0 },
    k4: { PR4C: 0, "F++": 0, other: 0 },
  };
  for (const w of enrolled) {
    if (w.kanri_pending) {
      k.pending += 1;
      continue;
    }
    k.total += 1;
    if (w.kanri === "1") {
      k.k1 += 1;
      continue;
    }
    k.findings += 1;
    if (w.kanri === "2") k.k2 += 1;
    else if (w.kanri === "3i") k.k3i += 1;
    else if (w.kanri === "3ro") {
      if (w.kanri_detail === "PR3") k.k3ro.PR3 += 1;
      else if (w.kanri_detail === "PR4AB") k.k3ro.PR4AB += 1;
      else k.k3ro.unknown += 1;
    } else if (w.kanri === "4") {
      if (w.kanri_detail === "PR4C") k.k4.PR4C += 1;
      else if (w.kanri_detail === "F++") k.k4["F++"] += 1;
      else k.k4.other += 1;
    }
  }

  // 従来管理1で、本年中に新たに管理2〜4と決定されたもの
  const newlyFrom1 = workers.filter((w) => w.kanri !== "1" && w.kanri_previous === "1" && inYear(w.kanri_decided_on, year)).length;

  // 本年中に粉じん作業から他の作業へ転換(管理1も計に含める)
  const moved = workers.filter((w) => inYear(w.transferred_on, year));
  const transferred = {
    total: moved.length,
    k2: moved.filter((w) => w.kanri === "2").length,
    k3i: moved.filter((w) => w.kanri === "3i").length,
    k3ro: moved.filter((w) => w.kanri === "3ro").length,
  };

  // 過去に粉じん作業に従事し、12月末現在 非粉じん作業で管理2又は3
  const pastNonDust = enrolled.filter((w) => w.dust_status === "past" && isKanri2or3(w.kanri)).length;

  // 管理2又は3で、本年中に合併症の療養を開始
  const byNo: [number, number, number, number, number, number] = [0, 0, 0, 0, 0, 0];
  for (const w of workers) {
    if (!isKanri2or3(w.kanri) || !w.complication || !inYear(w.complication_started_on, year)) continue;
    byNo[w.complication - 1] += 1;
  }

  return {
    year,
    lastExamDate: dates[dates.length - 1] ?? null,
    workCodes,
    exams: examsSummary,
    kanri: k,
    newlyFrom1,
    transferred,
    pastNonDust,
    complications: { total: byNo.reduce((a, b) => a + b, 0), byNo },
    workers: enrolled.length,
  };
}

// 報告の対象年の既定: 1〜3月は前年分(2月末が提出期限)、それ以降はその年
export function defaultPneumoYear(now: Date = new Date()): number {
  const jst = new Date(now.getTime() + 9 * 3600_000);
  return jst.getUTCMonth() < 3 ? jst.getUTCFullYear() - 1 : jst.getUTCFullYear();
}
