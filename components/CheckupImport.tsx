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

const NOT_USED = "__not_used__";

export default function CheckupImport({
  companyId,
  backHref,
}: {
  companyId: string;
  backHref: string;
}) {
  const router = useRouter();
  const [fiscalYear, setFiscalYear] = useState(getFiscalYear());
  const [checkupType, setCheckupType] = useState("regular");
  const [findingsJudgments, setFindingsJudgments] = useState(
    DEFAULT_FINDINGS_JUDGMENTS.join(",")
  );
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  // マッピング: 基本項目 → 列index
  const [nameCol, setNameCol] = useState<number>(-1);
  const [empNoCol, setEmpNoCol] = useState<number>(-1);
  const [dateCol, setDateCol] = useState<number>(-1);
  const [judgmentCol, setJudgmentCol] = useState<number>(-1);
  // 検査項目として取り込む列: index -> "value" | "judgment" | 取り込まない
  const [itemCols, setItemCols] = useState<Record<number, "value" | "judgment" | "off">>({});
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
      // 見出しから自動推定
      const find = (words: string[]) =>
        h.findIndex((c) => words.some((w) => c.replace(/\s/g, "").includes(w)));
      setNameCol(find(["氏名", "名前", "社員名"]));
      setEmpNoCol(find(["社員番号", "社員No", "従業員番号", "職員番号"]));
      setDateCol(find(["健診日", "受診日", "実施日"]));
      setJudgmentCol(find(["総合判定", "総合", "判定区分"]));
      const init: Record<number, "value" | "judgment" | "off"> = {};
      h.forEach((c, i) => {
        init[i] = /判定/.test(c) ? "judgment" : "value";
      });
      setItemCols(init);
    } catch {
      setError("ファイルの読み込みに失敗しました。CSV形式か確認してください。");
    }
  };

  const baseCols = [nameCol, empNoCol, dateCol, judgmentCol];

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

    // 「血圧」(測定値)と「血圧判定」(判定)のような列ペアを1項目にまとめる
    const norm = (s: string) => s.replace(/[\s　]/g, "");
    const payload = dataRows
      .map((r) => {
        const items: { name: string; value?: string; judgment?: string }[] = [];
        // 1周目: 測定値列
        header.forEach((h, i) => {
          if (baseCols.includes(i) || (itemCols[i] ?? "off") !== "value") return;
          const cell = (r[i] ?? "").trim();
          if (!cell) return;
          items.push({ name: h.trim(), value: cell });
        });
        // 2周目: 判定列を同名の測定値項目にマージ(「〇〇判定」→「〇〇」)
        header.forEach((h, i) => {
          if (baseCols.includes(i) || (itemCols[i] ?? "off") !== "judgment") return;
          const cell = (r[i] ?? "").trim();
          if (!cell) return;
          const base = norm(h).replace(/判定$/, "") || h.trim();
          const target =
            items.find((it) => norm(it.name) === base) ??
            items.find((it) => base !== "" && norm(it.name).startsWith(base));
          if (target) {
            target.judgment = cell.toUpperCase();
          } else {
            items.push({ name: base, judgment: cell.toUpperCase() });
          }
        });
        return {
          target_name: (r[nameCol] ?? "").trim(),
          employee_no: empNoCol >= 0 ? (r[empNoCol] ?? "").trim() : "",
          checkup_date: dateCol >= 0 ? normalizeDate(r[dateCol] ?? "") : null,
          overall_judgment:
            judgmentCol >= 0 ? (r[judgmentCol] ?? "").trim().toUpperCase() : "",
          items,
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

      <div className="form-row">
        <label className="btn secondary" style={{ display: "inline-block" }}>
          CSVファイルを選択
          <input
            type="file"
            accept=".csv,.txt"
            style={{ display: "none" }}
            onChange={onFile}
          />
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
                <th>健診日</th>
                <td>{colSelect(dateCol, setDateCol)}</td>
              </tr>
              <tr>
                <th>総合判定</th>
                <td>{colSelect(judgmentCol, setJudgmentCol)}</td>
              </tr>
            </tbody>
          </table>

          <h3 style={{ color: "var(--teal-dark)", fontSize: 15 }}>
            検査項目として取り込む列
          </h3>
          <p className="muted">
            「判定」はA〜E等の判定が入っている列に選択してください（有所見の自動判定に使われます）。
            「血圧」と「血圧判定」のような同名ペアは、自動的に1つの項目（測定値＋判定）にまとめられます。
          </p>
          <table className="list" style={{ marginBottom: 14 }}>
            <thead>
              <tr>
                <th>列（見出し）</th>
                <th>1行目の例</th>
                <th>取込方法</th>
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
                        value={itemCols[i] ?? "off"}
                        onChange={(e) =>
                          setItemCols((p) => ({
                            ...p,
                            [i]: e.target.value as "value" | "judgment" | "off",
                          }))
                        }
                      >
                        <option value="value">測定値として取込</option>
                        <option value="judgment">判定（A〜E等）として取込</option>
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
