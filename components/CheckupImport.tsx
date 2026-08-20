"use client";

import { ChangeEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { getFiscalYear } from "@/lib/fiscal";
import {
  CHECKUP_TYPES,
  DEFAULT_FINDINGS_JUDGMENTS,
  parseCsv,
  readCsvFile,
  normalizeDate,
} from "@/lib/checkups";
import { matchPerson, type PersonCandidate } from "@/lib/personMatch";
import {
  LEGAL_ITEMS,
  findLegalItemByHeader,
  judgeItem,
  splitBloodPressure,
  worstGrade,
  type Grade,
  type JudgmentRule,
} from "@/lib/judgment";

const NOT_USED = "__not_used__";

// 列の扱い: 法定項目(自動判定) / 値のみ / 判定として取込 / 取り込まない
type ColumnMode = { kind: "legal"; itemKey: string } | { kind: "value" } | { kind: "judgment" } | { kind: "off" };

export default function CheckupImport({
  companyId,
  backHref,
  rules,
  autoJudgeDefault,
  persons = [],
}: {
  companyId: string;
  backHref: string;
  rules: JudgmentRule[];
  autoJudgeDefault: boolean;
  persons?: PersonCandidate[];
}) {
  const router = useRouter();
  const [fiscalYear, setFiscalYear] = useState(getFiscalYear());
  const [checkupType, setCheckupType] = useState("regular");
  const [autoJudge, setAutoJudge] = useState(autoJudgeDefault);
  const [findingsJudgments, setFindingsJudgments] = useState(
    DEFAULT_FINDINGS_JUDGMENTS.join(",")
  );
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [nameCol, setNameCol] = useState<number>(-1);
  const [empNoCol, setEmpNoCol] = useState<number>(-1);
  const [sexCol, setSexCol] = useState<number>(-1);
  const [birthCol, setBirthCol] = useState<number>(-1);
  const [dateCol, setDateCol] = useState<number>(-1);
  const [judgmentCol, setJudgmentCol] = useState<number>(-1);
  const [colModes, setColModes] = useState<Record<number, ColumnMode>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  const header = rows?.[0] ?? [];
  const dataRows = useMemo(() => (rows ? rows.slice(1) : []), [rows]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setDone(null);
    try {
      const text = await readCsvFile(file);
      const parsed = parseCsv(text);
      if (parsed.length < 2) {
        setError("データ行がありません。1行目に見出し、2行目以降にデータがあるCSVを選択してください。");
        return;
      }
      setRows(parsed);
      setFileName(file.name);
      const h = parsed[0];
      const find = (words: string[]) =>
        h.findIndex((c) => words.some((w) => c.replace(/\s/g, "").includes(w)));
      setNameCol(find(["氏名", "名前", "社員名"]));
      setEmpNoCol(find(["社員番号", "社員No", "従業員番号", "職員番号"]));
      setSexCol(find(["性別", "性"]));
      setBirthCol(find(["生年月日", "生年"]));
      setDateCol(find(["健診日", "受診日", "実施日"]));
      setJudgmentCol(find(["総合判定", "総合", "判定区分"]));
      // 見出しから法定項目を自動推定
      const init: Record<number, ColumnMode> = {};
      h.forEach((c, i) => {
        const key = findLegalItemByHeader(c);
        if (/判定/.test(c)) init[i] = { kind: "judgment" };
        else if (key) init[i] = { kind: "legal", itemKey: key };
        else init[i] = { kind: "value" };
      });
      setColModes(init);
    } catch {
      setError("ファイルの読み込みに失敗しました。CSV形式か確認してください。");
    }
  };

  const baseCols = [nameCol, empNoCol, sexCol, birthCol, dateCol, judgmentCol];

  const readSex = (r: string[]): "male" | "female" | null => {
    if (sexCol < 0) return null;
    const v = (r[sexCol] ?? "").trim();
    if (/^(男|男性|M|male|1)$/i.test(v)) return "male";
    if (/^(女|女性|F|female|2)$/i.test(v)) return "female";
    return null;
  };

  const onImport = async () => {
    if (nameCol < 0) {
      setError("氏名の列を選択してください。");
      return;
    }
    setBusy(true);
    setError(null);
    const judgments = findingsJudgments
      .split(/[,、\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);

    const norm = (s: string) => s.replace(/[\s　]/g, "");
    const payload = dataRows
      .map((r) => {
        const sex = readSex(r);
        const items: { name: string; value?: string; judgment?: string }[] = [];
        const autoGrades: (Grade | null)[] = [];

        header.forEach((h, i) => {
          if (baseCols.includes(i)) return;
          const mode = colModes[i] ?? { kind: "off" as const };
          if (mode.kind === "off") return;
          const cell = (r[i] ?? "").trim();
          if (!cell) return;

          if (mode.kind === "legal" && autoJudge) {
            // 「142/90」形式の血圧は収縮期・拡張期に分けて判定
            if (mode.itemKey === "sbp" || mode.itemKey === "dbp") {
              const bp = splitBloodPressure(cell);
              if (bp.sbp != null && bp.dbp != null) {
                const gs = judgeItem("sbp", String(bp.sbp), sex, rules);
                const gd = judgeItem("dbp", String(bp.dbp), sex, rules);
                const g = worstGrade([gs, gd]);
                autoGrades.push(g);
                items.push({ name: h.trim(), value: cell, judgment: g ?? undefined });
                return;
              }
            }
            const g = judgeItem(mode.itemKey, cell, sex, rules);
            autoGrades.push(g);
            items.push({ name: h.trim(), value: cell, judgment: g ?? undefined });
            return;
          }
          if (mode.kind === "judgment") {
            items.push({ name: h.trim(), judgment: cell.toUpperCase() });
            return;
          }
          items.push({ name: h.trim(), value: cell });
        });

        // 「〇〇判定」列を同名の測定値項目にマージ
        const merged: typeof items = [];
        for (const it of items) {
          if (it.judgment && !it.value) {
            const base = norm(it.name).replace(/判定$/, "");
            const target = merged.find((m) => norm(m.name) === base);
            if (target && !target.judgment) {
              target.judgment = it.judgment;
              continue;
            }
            merged.push({ ...it, name: base || it.name });
            continue;
          }
          merged.push(it);
        }

        const csvOverall =
          judgmentCol >= 0 ? (r[judgmentCol] ?? "").trim().toUpperCase() : "";
        // 自動判定ONのときは、最も重い項目判定を総合判定とする
        const autoOverall = autoJudge ? worstGrade(autoGrades) : null;

        const targetName = (r[nameCol] ?? "").trim();
        const employeeNo = empNoCol >= 0 ? (r[empNoCol] ?? "").trim() : "";
        const birthDate = birthCol >= 0 ? normalizeDate(r[birthCol] ?? "") : null;
        // 社員番号・生年月日・氏名で個人カルテに突合する
        const person = matchPerson(persons, {
          name: targetName,
          employeeNo,
          birthDate,
        });

        return {
          target_name: targetName,
          employee_no: employeeNo,
          sex: sex ?? "",
          birth_date: birthDate ?? "",
          person_id: person?.id ?? "",
          target_user_id: person?.user_id ?? "",
          checkup_date: dateCol >= 0 ? normalizeDate(r[dateCol] ?? "") : null,
          overall_judgment: autoOverall ?? csvOverall,
          items: merged,
        };
      })
      .filter((r) => r.target_name);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_import_checkups", {
      p_company_id: companyId,
      p_fiscal_year: fiscalYear,
      p_checkup_type: checkupType,
      p_findings_judgments: judgments,
      p_rows: payload,
    });
    if (error) {
      setError(`取込に失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    setDone(data as number);
    setBusy(false);
  };

  const colSelect = (value: number, onChange: (n: number) => void) => (
    <select
      value={value >= 0 ? String(value) : NOT_USED}
      onChange={(e) => onChange(e.target.value === NOT_USED ? -1 : Number(e.target.value))}
    >
      <option value={NOT_USED}>（使用しない）</option>
      {header.map((h, i) => (
        <option key={i} value={i}>
          {h || `列${i + 1}`}
        </option>
      ))}
    </select>
  );

  if (done !== null) {
    return (
      <div>
        <p>
          <strong>{done}名分</strong>の健診結果を取り込みました。
          {autoJudge && "（総合判定は事務所基準で自動判定しました）"}
        </p>
        <button className="btn" onClick={() => router.push(backHref)}>
          健診一覧へ戻る
        </button>
      </div>
    );
  }

  return (
    <div>
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
          <label>有所見とみなす判定（カンマ区切り）</label>
          <input
            type="text"
            value={findingsJudgments}
            onChange={(e) => setFindingsJudgments(e.target.value)}
            style={{ width: 160 }}
          />
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
          事務所基準で自動判定する（法定項目をA〜Dで判定し、最も重い判定を総合判定にする）
        </label>
      </div>
      {autoJudge && rules.length === 0 && (
        <p className="error-message">
          判定基準が未登録です。SQL(0115)の実行と「判定基準の設定」をご確認ください。
        </p>
      )}

      <div className="form-row">
        <label className="btn secondary" style={{ display: "inline-block" }}>
          CSVファイルを選択
          <input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={onFile} />
        </label>
        {fileName && (
          <span style={{ marginLeft: 10 }} className="muted">
            {fileName}（データ {dataRows.length} 行）
          </span>
        )}
      </div>

      {rows && (
        <>
          <h3 style={{ color: "var(--teal-dark)", fontSize: 15 }}>基本項目の列を指定</h3>
          <table className="list" style={{ marginBottom: 14 }}>
            <tbody>
              <tr>
                <th style={{ width: 180 }}>氏名（必須）</th>
                <td>{colSelect(nameCol, setNameCol)}</td>
              </tr>
              <tr>
                <th>社員番号</th>
                <td>{colSelect(empNoCol, setEmpNoCol)}</td>
              </tr>
              <tr>
                <th>性別（自動判定に使用）</th>
                <td>{colSelect(sexCol, setSexCol)}</td>
              </tr>
              <tr>
                <th>生年月日（本人特定に使用）</th>
                <td>
                  {colSelect(birthCol, setBirthCol)}
                  <span className="muted" style={{ marginLeft: 8 }}>
                    同姓同名の方がいる場合に、社員番号とあわせて本人を特定します
                  </span>
                </td>
              </tr>
              <tr>
                <th>健診日</th>
                <td>{colSelect(dateCol, setDateCol)}</td>
              </tr>
              <tr>
                <th>総合判定（健診機関の判定）</th>
                <td>
                  {colSelect(judgmentCol, setJudgmentCol)}
                  {autoJudge && (
                    <span className="muted" style={{ marginLeft: 8 }}>
                      自動判定ONのため、総合判定は自動計算値が優先されます
                    </span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>

          <h3 style={{ color: "var(--teal-dark)", fontSize: 15 }}>検査項目の割り当て</h3>
          <p className="muted">
            法定項目に割り当てた列は、事務所基準で自動判定されます（「値のみ」は保存だけ、「判定として取込」は健診機関の判定をそのまま使用）。
          </p>
          <table className="list" style={{ marginBottom: 14 }}>
            <thead>
              <tr>
                <th>列（見出し）</th>
                <th>1行目の例</th>
                <th style={{ width: 260 }}>取込方法</th>
              </tr>
            </thead>
            <tbody>
              {header.map((h, i) =>
                baseCols.includes(i) ? null : (
                  <tr key={i}>
                    <td>{h || `列${i + 1}`}</td>
                    <td className="muted">{dataRows[0]?.[i] ?? ""}</td>
                    <td>
                      <select
                        value={
                          colModes[i]?.kind === "legal"
                            ? `legal:${(colModes[i] as any).itemKey}`
                            : (colModes[i]?.kind ?? "off")
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          const mode: ColumnMode = v.startsWith("legal:")
                            ? { kind: "legal", itemKey: v.slice(6) }
                            : ({ kind: v } as ColumnMode);
                          setColModes((p) => ({ ...p, [i]: mode }));
                        }}
                      >
                        <optgroup label="法定項目（自動判定）">
                          {LEGAL_ITEMS.map((it) => (
                            <option key={it.key} value={`legal:${it.key}`}>
                              {it.label}
                            </option>
                          ))}
                        </optgroup>
                        <option value="value">値のみ取込（判定しない）</option>
                        <option value="judgment">判定（A〜E）として取込</option>
                        <option value="off">取り込まない</option>
                      </select>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>

          {error && <p className="error-message">{error}</p>}
          <button className="btn orange" onClick={onImport} disabled={busy}>
            {busy ? "取込中…" : `この内容で ${dataRows.length} 行を取り込む`}
          </button>
        </>
      )}
      {!rows && error && <p className="error-message">{error}</p>}
    </div>
  );
}
