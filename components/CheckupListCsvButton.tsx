"use client";

import { CHECKUP_TYPES, CHECKUP_WORK_JUDGMENTS, FOLLOWUP_STATUS, conditionLabel } from "@/lib/checkups";
import { downloadCsv, type ReportItem } from "@/lib/checkupReport";
import { createClient } from "@/lib/supabase/browser";
import type { OfficeInfo } from "@/lib/officeInfo";
import type { CheckupRow } from "@/components/CheckupsTable";

// 健康診断結果一覧(検査値付き)のCSV出力。健康診断管理の一覧に表示中の年度・実施回が対象
export default function CheckupListCsvButton({
  companyName,
  fiscalYear,
  round,
  groupLabel,
  rows,
  items,
  officeInfo,
}: {
  companyName: string;
  fiscalYear: number;
  round?: number;
  groupLabel?: string; // 健診の区分(定期健診 / 特殊健診（有機溶剤） など)
  rows: CheckupRow[];
  items: ReportItem[];
  officeInfo?: OfficeInfo | null;
}) {
  const onDownload = () => {
    // 検査項目を列にした横持ちの一覧を作る
    const itemNames = Array.from(new Set(items.map((i) => i.item_name)));
    const byCheckup = new Map<string, Map<string, ReportItem>>();
    for (const it of items) {
      if (!byCheckup.has(it.checkup_id)) byCheckup.set(it.checkup_id, new Map());
      byCheckup.get(it.checkup_id)!.set(it.item_name, it);
    }

    const header = [
      "社員番号",
      "氏名",
      "フリガナ",
      "生年月日",
      "性別",
      "所属",
      "健診種別",
      "健診日",
      "総合判定",
      "有所見",
      "就業判定",
      "判定条件",
      "判定日",
      "医師の意見",
      "受診勧奨",
      ...itemNames.flatMap((n) => [n, `${n} 判定`]),
    ];

    const csv: (string | number | null)[][] = [
      [
        `${companyName} ${fiscalYear}年度${round ? `（第${round}回）` : ""}${groupLabel ? ` ${groupLabel}` : ""} 健康診断結果一覧`,
        `産業医: ${officeInfo?.physician_name ?? "上松弘典"}`,
        `${officeInfo?.office_name ?? "うえまつ産業医事務所"}`,
        `${officeInfo?.address ?? ""}`,
      ],
      [],
      header,
      ...rows.map((c) => {
        const map = byCheckup.get(c.id);
        return [
          c.employee_no ?? "",
          c.target_name,
          c.target_name_kana ?? "",
          c.birth_date ?? "",
          c.sex === "male" ? "男" : c.sex === "female" ? "女" : "",
          c.department ?? "",
          CHECKUP_TYPES[c.checkup_type] ?? c.checkup_type,
          c.checkup_date ?? "",
          c.overall_judgment ?? "",
          c.has_findings ? "有" : "",
          c.work_judgment ? CHECKUP_WORK_JUDGMENTS[c.work_judgment] : "未判定",
          conditionLabel(c.work_judgment_condition),
          c.work_judgment_date ?? "",
          c.work_judgment_note ?? "",
          FOLLOWUP_STATUS[c.followup_status ?? "none"] ?? "",
          ...itemNames.flatMap((n) => {
            const it = map?.get(n);
            return [it?.value ?? "", it?.judgment ?? ""];
          }),
        ];
      }),
    ];
    downloadCsv(`健康診断結果_${companyName}_${fiscalYear}年度${round ? `_第${round}回` : ""}${groupLabel ? `_${groupLabel}` : ""}.csv`, csv);
    // 健康情報の出力としてアクセスログに残す
    createClient()
      .rpc("hm_log_access", {
        p_action: "export_checkup_list",
        p_target_table: "hm_checkups",
        p_target_id: null,
        p_detail: { company_name: companyName, fiscal_year: fiscalYear, round: round ?? null, rows: rows.length },
      })
      .then(() => undefined, () => undefined);
  };

  return (
    <button className="btn secondary" onClick={onDownload}>
      健康診断結果出力
    </button>
  );
}
