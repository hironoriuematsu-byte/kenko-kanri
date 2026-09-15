"use client";

import { ChangeEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { getFiscalYear } from "@/lib/fiscal";
import { CHECKUP_TYPES, parseCsv, readCsvFile } from "@/lib/checkups";
import { startNavigationProgress } from "@/lib/navigate";

// 事業者担当者向け: 健診機関のCSVをそのまま産業医事務所に送る。
// どの列をどう取り込むかは産業医事務所(実施者)が取込画面で指定する(0135 hm_csv_uploads)
export default function CsvSubmit({ companyId, backHref }: { companyId: string; backHref: string }) {
  const router = useRouter();
  const [fiscalYear, setFiscalYear] = useState(getFiscalYear());
  const [checkupType, setCheckupType] = useState("regular");
  const [round, setRound] = useState(1);
  const [specialKind, setSpecialKind] = useState("");
  const [note, setNote] = useState("");
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState<string | null>(null);
  const [rowCount, setRowCount] = useState(0);
  const [headers, setHeaders] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const text = await readCsvFile(file);
      const parsed = parseCsv(text);
      if (parsed.length < 2) {
        setError("データ行がありません。1行目に見出し、2行目以降にデータがあるCSVを選択してください。");
        setContent(null);
        return;
      }
      setFileName(file.name);
      setContent(text);
      setRowCount(parsed.length - 1);
      setHeaders(parsed[0]);
    } catch {
      setError("ファイルの読み込みに失敗しました。CSV形式か確認してください。");
      setContent(null);
    }
  };

  const onSubmit = async () => {
    if (!content) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_submit_csv_upload", {
      p_company_id: companyId,
      p_file_name: fileName,
      p_content: content,
      p_row_count: rowCount,
      p_fiscal_year: fiscalYear,
      p_checkup_type: checkupType,
      p_round: round,
      p_special_kind: checkupType === "special" ? specialKind.trim() || null : null,
      p_note: note.trim() || null,
    });
    if (error) {
      setError(`送信に失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
  };

  if (done) {
    return (
      <div>
        <p>
          <strong>{fileName}</strong>（{rowCount}名分）を産業医事務所に送りました。
        </p>
        <p style={{ color: "var(--teal-dark)" }}>
          産業医事務所がCSVの列の割り当てを確認して取り込み、就業判定を行います。
          取り込まれると健康診断管理の一覧に表示されます。
        </p>
        <button className="btn" onClick={() => { startNavigationProgress(); router.push(backHref); }}>
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
          <label>実施回</label>
          <select value={round} onChange={(e) => setRound(Number(e.target.value))}>
            <option value={1}>1回目（年1回の場合はこのまま）</option>
            <option value={2}>2回目</option>
            <option value={3}>3回目</option>
            <option value={4}>4回目</option>
          </select>
        </div>
        {checkupType === "special" && (
          <div>
            <label>特殊健診の種類</label>
            <input
              type="text"
              value={specialKind}
              onChange={(e) => setSpecialKind(e.target.value)}
              placeholder="例: 有機溶剤 / 鉛 / 電離放射線 / じん肺"
              style={{ width: 220 }}
            />
          </div>
        )}
      </div>

      <div className="form-row">
        <label className="btn secondary" style={{ display: "inline-block" }}>
          CSVファイルを選択
          <input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={onFile} />
        </label>
        {fileName && content && (
          <span style={{ marginLeft: 10 }} className="muted">
            {fileName}（データ {rowCount} 行・{headers.length} 列）
          </span>
        )}
      </div>

      {content && (
        <div className="form-row">
          <label>読み取った見出し（確認用）</label>
          <p className="muted" style={{ margin: "4px 0", fontSize: 13 }}>
            {headers.filter((h) => h.trim()).join("、")}
          </p>
        </div>
      )}

      <div className="form-row">
        <label>産業医事務所への連絡事項（任意）</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例: 2名分は再検査の結果を後日送ります"
          style={{ minHeight: 60 }}
        />
      </div>

      {error && <p className="error-message">{error}</p>}
      <button className="btn orange" onClick={onSubmit} disabled={busy || !content}>
        {busy ? "送信中…" : `このCSV（${rowCount}名分）を産業医事務所に送る`}
      </button>
    </div>
  );
}
