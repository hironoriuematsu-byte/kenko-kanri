"use client";

import { CHECKUP_TYPES, CHECKUP_WORK_JUDGMENTS, isFindingJudgment, isRestrictionJudgment, isSevereJudgment } from "@/lib/checkups";
import { downloadCsv } from "@/lib/checkupReport";
import type { OfficeInfo } from "@/components/CheckupReportPanel";
import type { CheckupRow } from "@/components/CheckupsTable";

// 就業判定結果報告書: 事業者が就業上の措置を検討するための一覧をCSVで出す
export default function WorkJudgmentReportButton({
  companyName,
  fiscalYear,
  rows,
  officeInfo,
}: {
  companyName: string;
  fiscalYear: number;
  rows: CheckupRow[];
  officeInfo?: OfficeInfo | null;
}) {
  const names = (r: CheckupRow, pick: (j: string | null) => boolean) =>
    (r.findingItems ?? [])
      .filter((it) => pick(it.judgment))
      .map((it) => it.item_name)
      .join("、");

  const count = (v: string | null) => rows.filter((r) => (r.work_judgment ?? null) === v).length;
  const restrictionCount = rows.filter((r) => names(r, isRestrictionJudgment) !== "").length;

  const onDownload = () => {
    const csv: (string | number | null)[][] = [
      ["就業判定結果報告書"],
      ["事業場名", companyName],
      ["対象年度", `${fiscalYear}年度`],
      ["作成日", new Date().toLocaleDateString("ja-JP")],
      ["産業医氏名", officeInfo?.physician_name ?? "上松弘典"],
      ["産業医所属機関の名称", officeInfo?.office_name ?? "うえまつ産業医事務所"],
      ["産業医所属機関の所在地", officeInfo?.address ?? ""],
      ...(officeInfo?.tel ? [["産業医所属機関の電話番号", officeInfo.tel]] : []),
      [],
      ["受診者数", rows.length],
      ["通常勤務可", count("normal")],
      ["就業制限が必要", count("restricted")],
      ["要休業", count("leave")],
      ["判定保留", count("pending")],
      ["未判定", count(null)],
      ["就業制限項目(R)に該当", restrictionCount],
      [],
      [
        "社員番号",
        "氏名",
        "健診種別",
        "健診日",
        "総合判定",
        "有所見項目(C)",
        "有所見項目(D)",
        "就業制限項目(R)",
        "就業判定",
        "判定日",
        "医師の意見",
      ],
      ...rows.map((r) => [
        r.employee_no ?? "",
        r.target_name,
        CHECKUP_TYPES[r.checkup_type] ?? r.checkup_type,
        r.checkup_date ?? "",
        r.overall_judgment ?? "",
        names(r, (j) => isFindingJudgment(j) && !isSevereJudgment(j)),
        names(r, (j) => isSevereJudgment(j) && !isRestrictionJudgment(j)),
        names(r, isRestrictionJudgment),
        r.work_judgment ? CHECKUP_WORK_JUDGMENTS[r.work_judgment] : "未判定",
        r.work_judgment_date ?? "",
        r.work_judgment_note ?? "",
      ]),
      [],
      [
        "※ 就業判定と医師の意見は、健康診断の結果に基づき産業医が述べたものです。事業者はこの意見を勘案し、必要な就業上の措置をご検討ください(労働安全衛生法第66条の4・第66条の5)。",
      ],
    ];
    downloadCsv(`就業判定結果報告書_${companyName}_${fiscalYear}年度.csv`, csv);
  };

  return (
    <button className="btn" onClick={onDownload}>
      就業判定結果報告書のCSV出力
    </button>
  );
}
