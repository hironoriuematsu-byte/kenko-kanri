"use client";

import {
  CHECKUP_TYPES,
  isFindingJudgment,
  isRestrictionJudgment,
  isSevereJudgment,
} from "@/lib/checkups";
import { downloadCsv } from "@/lib/checkupReport";
import { createClient } from "@/lib/supabase/browser";
import type { OfficeInfo } from "@/lib/officeInfo";
import type { CheckupRow } from "@/components/CheckupsTable";
import { LEGAL_NOTE, conditionText, consultLabel, interviewNeeded, judgmentLabel, summarize } from "@/lib/workJudgmentReport";

// 就業判定・事後措置報告書のCSV(PDFは印刷画面 WorkJudgmentSheet。内容は lib/workJudgmentReport で共通)
export default function WorkJudgmentReportButton({
  companyName,
  fiscalYear,
  round,
  groupLabel,
  rows,
  officeInfo,
}: {
  companyName: string;
  fiscalYear: number;
  round?: number; // 年に複数回の定期健診がある場合の実施回
  groupLabel?: string; // 健診の区分(定期健診 / 特殊健診（有機溶剤） など)
  rows: CheckupRow[];
  officeInfo?: OfficeInfo | null;
}) {
  const names = (r: CheckupRow, pick: (j: string | null) => boolean) =>
    (r.findingItems ?? [])
      .filter((it) => pick(it.judgment))
      .map((it) => it.item_name)
      .join("、");

  const onDownload = () => {
    const sum = summarize(rows);
    const csv: (string | number | null)[][] = [
      ["健康診断結果に基づく就業判定・事後措置報告書"],
      ["事業場名", companyName],
      ["対象年度", `${fiscalYear}年度${round ? `（第${round}回）` : ""}${groupLabel ? ` ${groupLabel}` : ""}`],
      ["作成日", new Date().toLocaleDateString("ja-JP")],
      ["作成", officeInfo?.office_name ?? "うえまつ産業医事務所"],
      ["所在地", officeInfo?.address ?? ""],
      ...(officeInfo?.tel ? [["電話番号", officeInfo.tel]] : []),
      ["産業医", officeInfo?.physician_name ?? "上松弘典"],
      [],
      ["【就業判定】"],
      ["受診者数", sum.total],
      ["通常勤務可", sum.normal],
      ["　うち受診が条件", sum.normalWithCondition],
      ["要就業制限", sum.restricted],
      ["要休業", sum.leave],
      ["判定保留", sum.pending],
      ["未判定", sum.unjudged],
      ["【事後措置】"],
      ["受診勧奨", sum.consult],
      ["　うち受診済", sum.consultDone],
      ["産業医面談", sum.interview],
      [],
      [
        "社員番号",
        "氏名",
        "フリガナ",
        "生年月日",
        "性別",
        "所属",
        "健診種別",
        "健診日",
        "総合判定",
        "有所見項目(C)",
        "要医療項目(D)",
        "就業制限項目(R)",
        "【就業判定】就業判定",
        "【就業判定】判定条件",
        "【就業判定】判定日",
        "【就業判定】医師の意見",
        "【事後措置】受診勧奨",
        "【事後措置】受診日(本人の受診報告)",
        "【事後措置】産業医面談",
      ],
      ...rows.map((r) => [
        r.employee_no ?? "",
        r.target_name,
        // フリガナ・生年月日・性別・所属: 同姓同名の区別と、他機関の様式に合わせるため
        r.target_name_kana ?? "",
        r.birth_date ?? "",
        r.sex === "male" ? "男" : r.sex === "female" ? "女" : "",
        r.department ?? "",
        CHECKUP_TYPES[r.checkup_type] ?? r.checkup_type,
        r.checkup_date ?? "",
        r.overall_judgment ?? "",
        names(r, (j) => isFindingJudgment(j) && !isSevereJudgment(j)),
        names(r, (j) => isSevereJudgment(j) && !isRestrictionJudgment(j)),
        names(r, isRestrictionJudgment),
        judgmentLabel(r),
        // 判定条件: 要医療項目(D)・就業制限項目(R)があるのに通常勤務可とした場合の「受診が条件」
        conditionText(r),
        r.work_judgment_date ?? "",
        r.work_judgment_note ?? "",
        consultLabel(r),
        r.report?.visit_date ?? "",
        interviewNeeded(r) ? "要" : "不要",
      ]),
      [],
      [`※ ${LEGAL_NOTE}`],
    ];
    downloadCsv(`就業判定・事後措置_${companyName}_${fiscalYear}年度${round ? `_第${round}回` : ""}${groupLabel ? `_${groupLabel}` : ""}.csv`, csv);
    // 健康情報の出力としてアクセスログに残す
    createClient()
      .rpc("hm_log_access", {
        p_action: "export_work_judgment",
        p_target_table: "hm_checkups",
        p_target_id: null,
        p_detail: { company_name: companyName, fiscal_year: fiscalYear, round: round ?? null, format: "csv", rows: rows.length },
      })
      .then(() => undefined, () => undefined);
  };

  return (
    <button className="btn secondary" onClick={onDownload}>
      就業判定・事後措置（CSV）
    </button>
  );
}
