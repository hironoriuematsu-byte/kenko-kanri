"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { getFiscalYear } from "@/lib/fiscal";
import { CHECKUP_TYPES, DEFAULT_FINDINGS_JUDGMENTS } from "@/lib/checkups";
import { matchPerson, type PersonCandidate } from "@/lib/personMatch";
import DateTextInput from "@/components/DateTextInput";
import {
  LEGAL_ITEMS,
  judgeItem,
  overallGrade,
  splitBloodPressure,
  worstGrade,
  type Grade,
  type JudgmentRule,
} from "@/lib/judgment";

type ItemRow = { itemKey: string; name: string; value: string; judgment: string };

// 健診結果の個別(手)入力。法定項目は事務所基準で自動判定する
export default function CheckupForm({
  companyId,
  backHref,
  rules,
  persons = [],
}: {
  companyId: string;
  backHref: string;
  rules: JudgmentRule[];
  persons?: PersonCandidate[];
}) {
  const router = useRouter();
  const [targetName, setTargetName] = useState("");
  const [employeeNo, setEmployeeNo] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState<"" | "male" | "female">("");
  const [fiscalYear, setFiscalYear] = useState(getFiscalYear());
  const [checkupType, setCheckupType] = useState("regular");
  const [checkupDate, setCheckupDate] = useState("");
  const [autoJudge, setAutoJudge] = useState(true);
  const [overall, setOverall] = useState("");
  const [items, setItems] = useState<ItemRow[]>([
    { itemKey: "", name: "", value: "", judgment: "" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const setItem = (i: number, patch: Partial<ItemRow>) =>
    setItems((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));

  const judgeRow = (row: ItemRow): Grade | null => {
    if (!autoJudge || !row.itemKey || !row.value.trim()) return null;
    if (row.itemKey === "sbp" || row.itemKey === "dbp") {
      const bp = splitBloodPressure(row.value);
      if (bp.sbp != null && bp.dbp != null) {
        return worstGrade([
          judgeItem("sbp", String(bp.sbp), sex || null, rules),
          judgeItem("dbp", String(bp.dbp), sex || null, rules),
        ]);
      }
    }
    return judgeItem(row.itemKey, row.value, sex || null, rules);
  };

  // Rは就業制限の検討を表す印のため、総合判定としてはDに読み替える
  const autoOverall = autoJudge ? overallGrade(worstGrade(items.map(judgeRow))) : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createClient();
    // 社員番号・生年月日・氏名で個人カルテに突合する
    const person = matchPerson(persons, {
      name: targetName,
      employeeNo,
      birthDate: birthDate || null,
    });
    const { error } = await supabase.rpc("hm_import_checkups", {
      p_company_id: companyId,
      p_fiscal_year: fiscalYear,
      p_checkup_type: checkupType,
      p_findings_judgments: DEFAULT_FINDINGS_JUDGMENTS,
      p_rows: [
        {
          target_name: targetName,
          employee_no: employeeNo,
          birth_date: birthDate,
          person_id: person?.id ?? "",
          target_user_id: person?.user_id ?? "",
          sex,
          checkup_date: checkupDate || null,
          overall_judgment: autoOverall ?? overall.trim().toUpperCase(),
          items: items
            .filter((r) => r.name.trim() || r.itemKey)
            .map((r) => {
              const auto = judgeRow(r);
              const label =
                r.name.trim() ||
                LEGAL_ITEMS.find((it) => it.key === r.itemKey)?.label ||
                "";
              return {
                name: label,
                value: r.value.trim() || undefined,
                judgment: (auto ?? r.judgment.trim().toUpperCase()) || undefined,
              };
            }),
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
        <div>
          <label>生年月日（本人特定に使用）</label>
          <DateTextInput value={birthDate} onChange={setBirthDate} />
        </div>
        <div>
          <label>性別（自動判定に使用）</label>
          <select value={sex} onChange={(e) => setSex(e.target.value as any)}>
            <option value="">未設定</option>
            <option value="male">男性</option>
            <option value="female">女性</option>
          </select>
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
          {autoJudge ? (
            <p style={{ margin: "6px 0 0", fontSize: 16 }}>
              <strong>{autoOverall ?? "—"}</strong>
              <span className="muted" style={{ marginLeft: 6 }}>（自動判定）</span>
            </p>
          ) : (
            <input
              type="text"
              value={overall}
              onChange={(e) => setOverall(e.target.value)}
              placeholder="A〜E"
              style={{ width: 90 }}
            />
          )}
        </div>
      </div>

      <div className="form-row checkbox-row">
        <input
          id="autojudge"
          type="checkbox"
          checked={autoJudge}
          onChange={(e) => setAutoJudge(e.target.checked)}
        />
        <label htmlFor="autojudge" style={{ margin: 0 }}>
          事務所基準で自動判定する（最も重い項目判定を総合判定にします）
        </label>
      </div>

      <h3 style={{ color: "var(--teal-dark)", fontSize: 15 }}>検査項目</h3>
      <table className="list" style={{ marginBottom: 10 }}>
        <thead>
          <tr>
            <th style={{ width: 200 }}>法定項目</th>
            <th>項目名</th>
            <th>測定値</th>
            <th style={{ width: 110 }}>判定</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row, i) => {
            const auto = judgeRow(row);
            return (
              <tr key={i}>
                <td>
                  <select
                    value={row.itemKey}
                    onChange={(e) => {
                      const key = e.target.value;
                      const label = LEGAL_ITEMS.find((it) => it.key === key)?.label ?? "";
                      setItem(i, { itemKey: key, name: row.name || label });
                    }}
                  >
                    <option value="">（法定項目以外）</option>
                    {LEGAL_ITEMS.map((it) => (
                      <option key={it.key} value={it.key}>
                        {it.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => setItem(i, { name: e.target.value })}
                    placeholder="項目名"
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={row.value}
                    onChange={(e) => setItem(i, { value: e.target.value })}
                    placeholder="例: 142/90、8.5"
                  />
                </td>
                <td>
                  {autoJudge && row.itemKey ? (
                    <strong style={{ color: auto && auto !== "A" ? "var(--danger)" : undefined }}>
                      {auto ?? "—"}
                    </strong>
                  ) : (
                    <input
                      type="text"
                      value={row.judgment}
                      onChange={(e) => setItem(i, { judgment: e.target.value })}
                      placeholder="A〜E"
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button
        type="button"
        className="btn secondary"
        onClick={() =>
          setItems((p) => [...p, { itemKey: "", name: "", value: "", judgment: "" }])
        }
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
