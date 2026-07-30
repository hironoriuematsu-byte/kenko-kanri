"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { getFiscalYear } from "@/lib/fiscal";
import { CHECKUP_TYPES, DEFAULT_FINDINGS_JUDGMENTS } from "@/lib/checkups";

type ItemRow = { name: string; value: string; judgment: string };

// 健診結果の個別(手)入力
export default function CheckupForm({
  companyId,
  backHref,
}: {
  companyId: string;
  backHref: string;
}) {
  const router = useRouter();
  const [targetName, setTargetName] = useState("");
  const [employeeNo, setEmployeeNo] = useState("");
  const [fiscalYear, setFiscalYear] = useState(getFiscalYear());
  const [checkupType, setCheckupType] = useState("regular");
  const [checkupDate, setCheckupDate] = useState("");
  const [overall, setOverall] = useState("");
  const [items, setItems] = useState<ItemRow[]>([{ name: "", value: "", judgment: "" }]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setItem = (i: number, k: keyof ItemRow, v: string) =>
    setItems((prev) => prev.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_import_checkups", {
      p_company_id: companyId,
      p_fiscal_year: fiscalYear,
      p_checkup_type: checkupType,
      p_findings_judgments: DEFAULT_FINDINGS_JUDGMENTS,
      p_rows: [
        {
          target_name: targetName,
          employee_no: employeeNo,
          checkup_date: checkupDate || null,
          overall_judgment: overall.trim().toUpperCase(),
          items: items
            .filter((r) => r.name.trim())
            .map((r) => ({
              name: r.name.trim(),
              value: r.value.trim() || undefined,
              judgment: r.judgment.trim().toUpperCase() || undefined,
            })),
        },
      ],
    });
    if (error) {
      setError(`登録に失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    router.replace(backHref);
    router.refresh();
  };

  return (
    <form onSubmit={onSubmit}>
      <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <label>氏名 *</label>
          <input
            type="text"
            value={targetName}
            onChange={(e) => setTargetName(e.target.value)}
            required
          />
        </div>
        <div>
          <label>社員番号</label>
          <input
            type="text"
            value={employeeNo}
            onChange={(e) => setEmployeeNo(e.target.value)}
            style={{ width: 140 }}
          />
        </div>
      </div>
      <div className="form-row" style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div>
          <label>年度</label>
          <input
            type="number"
            value={fiscalYear}
            onChange={(e) => setFiscalYear(Number(e.target.value))}
            style={{ width: 120 }}
          />
        </div>
        <div>
          <label>健診種別</label>
          <select value={checkupType} onChange={(e) => setCheckupType(e.target.value)}>
            {Object.entries(CHECKUP_TYPES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label>健診日</label>
          <input
            type="date"
            value={checkupDate}
            onChange={(e) => setCheckupDate(e.target.value)}
          />
        </div>
        <div>
          <label>総合判定</label>
          <input
            type="text"
            value={overall}
            onChange={(e) => setOverall(e.target.value)}
            placeholder="A〜E"
            style={{ width: 90 }}
          />
        </div>
      </div>

      <h3 style={{ color: "var(--teal-dark)", fontSize: 15 }}>検査項目</h3>
      <table className="list" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th>項目名</th>
            <th>測定値</th>
            <th style={{ width: 110 }}>判定</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => (
            <tr key={i}>
              <td>
                <input
                  type="text"
                  value={row.name}
                  onChange={(e) => setItem(i, "name", e.target.value)}
                  placeholder="血圧、BMI など"
                />
              </td>
              <td>
                <input
                  type="text"
                  value={row.value}
                  onChange={(e) => setItem(i, "value", e.target.value)}
                />
              </td>
              <td>
                <input
                  type="text"
                  value={row.judgment}
                  onChange={(e) => setItem(i, "judgment", e.target.value)}
                  placeholder="A〜E"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        className="btn secondary"
        onClick={() => setItems((p) => [...p, { name: "", value: "", judgment: "" }])}
      >
        ＋ 項目を追加
      </button>

      {error && <p className="error-message">{error}</p>}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "登録中…" : "登録する"}
        </button>
        <button type="button" className="btn secondary" onClick={() => router.push(backHref)}>
          キャンセル
        </button>
      </div>
    </form>
  );
}
