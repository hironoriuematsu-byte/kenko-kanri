"use client";

import { useMemo, useState } from "react";
import {
  CHECKUP_TYPES,
  CHECKUP_WORK_JUDGMENTS,
  isFindingJudgment,
  isRestrictionJudgment,
  isSevereJudgment,
} from "@/lib/checkups";
import { gradeFromValue } from "@/lib/gradeFromValue";
import type { JudgmentRule } from "@/lib/judgment";
import {
  downloadCsv,
  summarizeByCategory,
  type ReportItem,
} from "@/lib/checkupReport";

export type ReportCheckup = {
  id: string;
  target_name: string;
  employee_no: string | null;
  birth_date: string | null;
  sex: string | null;
  checkup_type: string;
  checkup_date: string | null;
  overall_judgment: string | null;
  has_findings: boolean;
  work_judgment: string | null;
  work_judgment_date: string | null;
  work_judgment_note: string | null;
};

// 定期健康診断結果報告書(様式第6号)の記入用サマリと、健診結果一覧のCSV出力
export type OfficeInfo = {
  office_name: string;
  address: string | null;
  tel: string | null;
  physician_name: string;
};

export default function CheckupReportPanel({
  companyName,
  fiscalYear,
  checkups,
  items,
  officeInfo,
  rules,
}: {
  companyName: string;
  fiscalYear: number;
  checkups: ReportCheckup[];
  items: ReportItem[];
  officeInfo?: OfficeInfo | null;
  rules?: JudgmentRule[]; // 就業制限(R)を測定値から確かめるために使う
}) {
  const [headcount, setHeadcount] = useState("");
  const sexOf = (c: ReportCheckup) => (c.sex as "male" | "female" | null) ?? null;

  const regular = useMemo(
    () => checkups.filter((c) => c.checkup_type === "regular"),
    [checkups]
  );
  const regularIds = useMemo(() => new Set(regular.map((c) => c.id)), [regular]);
  const regularItems = useMemo(
    () => items.filter((i) => regularIds.has(i.checkup_id)),
    [items, regularIds]
  );

  const summary = useMemo(() => summarizeByCategory(regularItems), [regularItems]);

  const examinedCount = regular.length;
  // 所見のあった者: 総合判定 B・C・D
  const gradeOf = (c: ReportCheckup) =>
    (c.overall_judgment ?? "").trim().charAt(0).toUpperCase();
  const findingsCount = regular.filter((c) => ["B", "C", "D"].includes(gradeOf(c))).length;
  // 医師の指示人数: 総合判定 D
  const instructedCount = regular.filter((c) => gradeOf(c) === "D").length;
  const lastDate = regular
    .map((c) => c.checkup_date)
    .filter(Boolean)
    .sort()
    .slice(-1)[0];

  const onDownloadSummary = () => {
    const rows: (string | number | null)[][] = [
      ["定期健康診断結果報告書 記入用サマリ"],
      ["事業場名", companyName],
      ["対象年度", `${fiscalYear}年度`],
      ["健診種別", "定期健診のみを集計"],
      [],
      ["在籍労働者数", headcount || "（未入力）"],
      ["受診労働者数", examinedCount],
      ["健診年月日（最終実施日）", lastDate ?? ""],
      [],
      ["健診項目", "受診者数", "有所見者数"],
      ...summary.map((s) => [s.label, s.examined, s.findings]),
      [],
      ["所見のあった者の数（総合判定B・C・D）", findingsCount],
      ["医師の指示人数（総合判定D）", instructedCount],
      [],
      ["産業医氏名", officeInfo?.physician_name ?? "上松弘典"],
      ["産業医所属機関の名称", officeInfo?.office_name ?? "うえまつ産業医事務所"],
      ["産業医所属機関の所在地", officeInfo?.address ?? ""],
      ...(officeInfo?.tel ? [["産業医所属機関の電話番号", officeInfo.tel]] : []),
    ];
    downloadCsv(`定期健診結果報告書_サマリ_${companyName}_${fiscalYear}年度.csv`, rows);
  };

  // 就業判定結果報告書: 事業者が就業上の措置を検討するための一覧
  const onDownloadWorkJudgment = () => {
    const byCheckup = new Map<string, ReportItem[]>();
    for (const it of items) {
      byCheckup.set(it.checkup_id, [...(byCheckup.get(it.checkup_id) ?? []), it]);
    }
    // 就業制限(R)は測定値で決まるため、判定基準があれば値からも確かめる
    const gradeOfItem = (c: ReportCheckup, it: ReportItem): string | null => {
      const g = rules ? gradeFromValue(it.item_name, it.value, sexOf(c), rules) : null;
      if (isRestrictionJudgment(g)) return "R";
      return it.judgment ?? g ?? null;
    };
    const names = (c: ReportCheckup, pick: (j: string | null) => boolean) =>
      (byCheckup.get(c.id) ?? [])
        .filter((it) => pick(gradeOfItem(c, it)))
        .map((it) => it.item_name)
        .join("、");

    const count = (v: string | null) =>
      checkups.filter((c) => (c.work_judgment ?? null) === v).length;
    const restrictionCount = checkups.filter((c) => names(c, isRestrictionJudgment) !== "").length;

    const rows: (string | number | null)[][] = [
      ["就業判定結果報告書"],
      ["事業場名", companyName],
      ["対象年度", `${fiscalYear}年度`],
      ["作成日", new Date().toLocaleDateString("ja-JP")],
      ["産業医氏名", officeInfo?.physician_name ?? "上松弘典"],
      ["産業医所属機関の名称", officeInfo?.office_name ?? "うえまつ産業医事務所"],
      ["産業医所属機関の所在地", officeInfo?.address ?? ""],
      ...(officeInfo?.tel ? [["産業医所属機関の電話番号", officeInfo.tel]] : []),
      [],
      ["受診者数", checkups.length],
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
      ...checkups.map((c) => [
        c.employee_no ?? "",
        c.target_name,
        CHECKUP_TYPES[c.checkup_type] ?? c.checkup_type,
        c.checkup_date ?? "",
        c.overall_judgment ?? "",
        names(c, (j) => isFindingJudgment(j) && !isSevereJudgment(j)),
        names(c, (j) => isSevereJudgment(j) && !isRestrictionJudgment(j)),
        names(c, isRestrictionJudgment),
        c.work_judgment ? CHECKUP_WORK_JUDGMENTS[c.work_judgment] : "未判定",
        c.work_judgment_date ?? "",
        c.work_judgment_note ?? "",
      ]),
      [],
      [
        "※ 就業判定と医師の意見は、健康診断の結果に基づき産業医が述べたものです。事業者はこの意見を勘案し、必要な就業上の措置をご検討ください(労働安全衛生法第66条の4・第66条の5)。",
      ],
    ];
    downloadCsv(`就業判定結果報告書_${companyName}_${fiscalYear}年度.csv`, rows);
  };

  const onDownloadList = () => {
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
      "生年月日",
      "性別",
      "健診種別",
      "健診日",
      "総合判定",
      "有所見",
      "就業判定",
      "判定日",
      "医師の意見",
      ...itemNames.flatMap((n) => [n, `${n} 判定`]),
    ];

    const rows: (string | number | null)[][] = [
      [
        `${companyName} ${fiscalYear}年度 健康診断結果一覧`,
        `産業医: ${officeInfo?.physician_name ?? "上松弘典"}`,
        `${officeInfo?.office_name ?? "うえまつ産業医事務所"}`,
        `${officeInfo?.address ?? ""}`,
      ],
      [],
      header,
      ...checkups.map((c) => {
        const map = byCheckup.get(c.id);
        return [
          c.employee_no ?? "",
          c.target_name,
          c.birth_date ?? "",
          c.sex === "male" ? "男" : c.sex === "female" ? "女" : "",
          CHECKUP_TYPES[c.checkup_type] ?? c.checkup_type,
          c.checkup_date ?? "",
          c.overall_judgment ?? "",
          c.has_findings ? "有" : "",
          c.work_judgment ? CHECKUP_WORK_JUDGMENTS[c.work_judgment] : "未判定",
          c.work_judgment_date ?? "",
          c.work_judgment_note ?? "",
          ...itemNames.flatMap((n) => {
            const it = map?.get(n);
            return [it?.value ?? "", it?.judgment ?? ""];
          }),
        ];
      }),
    ];
    downloadCsv(`健康診断結果一覧_${companyName}_${fiscalYear}年度.csv`, rows);
  };

  return (
    <div>
      <p className="muted">
        厚生労働省の入力支援サービス（定期健康診断結果報告書・様式第6号）に転記しやすい形で、
        {fiscalYear}年度の<strong>定期健診</strong>を集計しています。
        受診者数・有所見者数は、各区分の検査項目が記録されている方を1名として数えています
        （C以上の判定を有所見としています）。
      </p>

      <div
        style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end", margin: "12px 0" }}
      >
        <div>
          <label className="muted" style={{ display: "block", fontSize: 12 }}>
            在籍労働者数（報告書の記入用・任意）
          </label>
          <input
            type="number"
            value={headcount}
            onChange={(e) => setHeadcount(e.target.value)}
            style={{ width: 140 }}
            placeholder="例: 120"
          />
        </div>
        <button className="btn orange" onClick={onDownloadSummary}>
          報告書サマリをCSVでダウンロード
        </button>
        <button className="btn" onClick={onDownloadWorkJudgment}>
          就業判定結果報告書をCSVでダウンロード
        </button>
        <button className="btn secondary" onClick={onDownloadList}>
          健康診断結果一覧をCSVでダウンロード
        </button>
      </div>

      <table className="list" style={{ maxWidth: 560, marginBottom: 14 }}>
        <tbody>
          <tr>
            <th style={{ width: 220 }}>在籍労働者数</th>
            <td>{headcount || <span className="muted">未入力</span>}</td>
          </tr>
          <tr>
            <th>受診労働者数（定期健診）</th>
            <td>
              <strong>{examinedCount}</strong>名
            </td>
          </tr>
          <tr>
            <th>健診年月日（最終実施日）</th>
            <td>{lastDate ?? "—"}</td>
          </tr>
        </tbody>
      </table>

      <table className="list" style={{ maxWidth: 560, marginBottom: 14 }}>
        <thead>
          <tr>
            <th>健診項目</th>
            <th style={{ width: 110 }}>受診者数</th>
            <th style={{ width: 110 }}>有所見者数</th>
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => (
            <tr key={s.key}>
              <td>{s.label}</td>
              <td>{s.examined > 0 ? s.examined : <span className="muted">0</span>}</td>
              <td>
                {s.findings > 0 ? (
                  <strong style={{ color: "var(--danger)" }}>{s.findings}</strong>
                ) : (
                  <span className="muted">0</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="list" style={{ maxWidth: 560 }}>
        <tbody>
          <tr>
            <th style={{ width: 220 }}>所見のあった者の数</th>
            <td>
              <strong>{findingsCount}</strong>名
              <span className="muted" style={{ marginLeft: 8 }}>
                （総合判定 B・C・D）
              </span>
            </td>
          </tr>
          <tr>
            <th>医師の指示人数</th>
            <td>
              <strong>{instructedCount}</strong>名
              <span className="muted" style={{ marginLeft: 8 }}>
                （総合判定 D）
              </span>
            </td>
          </tr>
          <tr>
            <th>産業医</th>
            <td>
              {officeInfo?.physician_name ?? "上松弘典"}（
              {officeInfo?.office_name ?? "うえまつ産業医事務所"}）
              <div className="muted">
                {officeInfo?.address || "所在地が未登録です（事務所の設定から登録できます）"}
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
