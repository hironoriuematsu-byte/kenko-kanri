"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { startNavigationProgress } from "@/lib/navigate";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { getFiscalYear } from "@/lib/fiscal";
import { normalizeGradeText, splitValueGrade, splitDistribution } from "@/lib/gradeText";
import { HEADER_RULES_VERSION } from "@/lib/judgment";
import {
  CHECKUP_TYPES,
  DEFAULT_FINDINGS_JUDGMENTS,
  parseCsv,
  readCsvFile,
  normalizeDate,
} from "@/lib/checkups";
import { type PersonCandidate } from "@/lib/personMatch";
import { buildImportRows, guessColumns, type ColumnMode } from "@/lib/importRows";
import { averageBloodPressure, isAverageHeader } from "@/lib/bloodPressure";
import {
  LEGAL_ITEMS,
  findLegalItemByHeader,
  judgeItem,
  overallGrade,
  splitBloodPressure,
  worstGrade,
  type Grade,
  type JudgmentRule,
} from "@/lib/judgment";

const NOT_USED = "__not_used__";

// 事業者担当者から送られたCSV(0135 hm_csv_uploads)。取込画面で開くときに渡す
export type UploadedCsv = {
  id: string;
  fileName: string;
  content: string;
  fiscalYear: number | null;
  checkupType: string | null;
  round: number;
  specialKind: string | null;
  note: string | null;
  createdAt: string;
};

export default function CheckupImport({
  companyId,
  backHref,
  rules,
  autoJudgeDefault,
  persons = [],
  simple = false,
  upload = null,
}: {
  companyId: string;
  backHref: string;
  rules: JudgmentRule[];
  autoJudgeDefault: boolean;
  persons?: PersonCandidate[];
  // 簡易画面: 判定や列の割り当ての設定を見せず、見出しから自動で割り当ててそのまま取り込む
  simple?: boolean;
  // 事業者担当者から送られたCSVを開いて取り込むとき(実施者)
  upload?: UploadedCsv | null;
}) {
  const router = useRouter();
  const [fiscalYear, setFiscalYear] = useState(upload?.fiscalYear ?? getFiscalYear());
  const [checkupType, setCheckupType] = useState(upload?.checkupType ?? "regular");
  const [specialKind, setSpecialKind] = useState(upload?.specialKind ?? ""); // 特殊健診の種類(有機溶剤・鉛 など)
  // 同じ方の記録が同年度・同種別にすでにあれば、検査項目を追加して1つの記録にまとめる
  // (健診機関ごとに項目の異なるCSVが複数ある場合のため)
  const [merge, setMerge] = useState(true);
  // 実施回。年に2回(半年に1回)定期健診を行う事業場では、回ごとに分けて取り込む
  const [round, setRound] = useState(upload?.round ?? 1);
  const [merged, setMerged] = useState(0);
  const [autoJudge, setAutoJudge] = useState(autoJudgeDefault);
  const [findingsJudgments, setFindingsJudgments] = useState(
    DEFAULT_FINDINGS_JUDGMENTS.join(",")
  );
  const [rows, setRows] = useState<string[][] | null>(null);
  const [fileName, setFileName] = useState("");
  const [nameCol, setNameCol] = useState<number>(-1);
  const [kanaCol, setKanaCol] = useState<number>(-1); // フリガナ
  const [deptCol, setDeptCol] = useState<number>(-1); // 所属(部署)
  const [empNoCol, setEmpNoCol] = useState<number>(-1);
  const [sexCol, setSexCol] = useState<number>(-1);
  const [birthCol, setBirthCol] = useState<number>(-1);
  const [dateCol, setDateCol] = useState<number>(-1);
  // CSVに健診日の列が無い(または空欄・読み取れない)ときに全員へ適用する健診日
  const [commonDate, setCommonDate] = useState("");
  const [judgmentCol, setJudgmentCol] = useState<number>(-1);
  const [colModes, setColModes] = useState<Record<number, ColumnMode>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null); // 取込の取り消しに使う
  const [undone, setUndone] = useState(false);
  const [originalPurged, setOriginalPurged] = useState(false); // 送られたCSVの原本を削除したか

  // 取込後に、事業者担当者から送られたCSVの原本を削除する(取り込んだデータは残る)
  const purgeOriginal = async () => {
    if (!upload) return;
    const ok = window.confirm(
      `送られたCSV「${upload.fileName}」の原本を削除します（取り込んだ健診データは残ります）。\n` +
        `この操作は元に戻せません。よろしいですか？`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_csv_upload_purge", { p_id: upload.id });
    if (error) setError(`原本を削除できませんでした: ${error.message}`);
    else setOriginalPurged(true);
    setBusy(false);
  };

  const header = rows?.[0] ?? [];
  const dataRows = useMemo(() => (rows ? rows.slice(1) : []), [rows]);

  // CSVの健診日から見た年度(4月〜翌3月)。指定した年度と食い違っていれば注意を出す
  // (2023年の健診を、既定の今年度のまま取り込んでしまう誤りを防ぐ)
  const csvFiscalYear = useMemo(() => {
    if (dateCol >= 0) {
      for (const r of dataRows) {
        const d = normalizeDate(r[dateCol] ?? "");
        if (d) return getFiscalYear(new Date(d + "T00:00:00"));
      }
    }
    const common = normalizeDate(commonDate);
    if (common) return getFiscalYear(new Date(common + "T00:00:00"));
    return null;
  }, [dataRows, dateCol, commonDate]);
  const yearMismatch = csvFiscalYear != null && csvFiscalYear !== fiscalYear;

  // 生年月日・健診日の列に、日付として読み取れない値がある行(表記の確認用に最初の例を出す)
  const unreadableDates = (col: number) => {
    if (col < 0) return { count: 0, example: "" };
    let count = 0;
    let example = "";
    for (const r of dataRows) {
      const raw = (r[col] ?? "").trim();
      if (!raw || normalizeDate(raw)) continue;
      count += 1;
      if (!example) example = raw;
    }
    return { count, example };
  };
  const badBirth = unreadableDates(birthCol);
  const badDate = unreadableDates(dateCol);
  const dateWarning =
    badBirth.count + badDate.count > 0 ? (
      <p className="error-message">
        日付として読み取れない値があります
        {badBirth.count > 0 && (
          <>
            ：生年月日 {badBirth.count}行（例「{badBirth.example}」）
          </>
        )}
        {badDate.count > 0 && (
          <>
            ：健診日 {badDate.count}行（例「{badDate.example}」）
          </>
        )}
        。この行は生年月日・健診日が空のまま取り込まれます
        {badDate.count > 0 && !normalizeDate(commonDate) && "(「全員共通の健診日」を入れるとその日付が使われます)"}
        。表記(例: 2026/9/1、昭和45年3月12日、S45.3.12、20260901)をご確認ください。
      </p>
    ) : null;
  // 健診日の列が見つからず、共通の健診日も未入力なら注意を出す(健診日が空のまま取り込まれてしまう)
  const noDateWarning =
    rows && dateCol < 0 && !normalizeDate(commonDate) ? (
      <p className="error-message">
        健診日の列が見つかりません。下の「健診日」で列を選ぶか、「全員共通の健診日」を入力してください。
        そのまま取り込むと健診日が空のまま登録されます。
      </p>
    ) : null;

  // CSVの文字列を読み込み、見出しから列を自動で割り当てる
  const loadCsv = (text: string, name: string) => {
    setError(null);
    setDone(null);
    try {
      const parsed = parseCsv(text);
      if (parsed.length < 2) {
        setError("データ行がありません。1行目に見出し、2行目以降にデータがあるCSVを選択してください。");
        return;
      }
      setRows(parsed);
      setFileName(name);
      const g = guessColumns(parsed[0]);
      setNameCol(g.base.nameCol);
      setKanaCol(g.base.kanaCol);
      setDeptCol(g.base.deptCol);
      setEmpNoCol(g.base.empNoCol);
      setSexCol(g.base.sexCol);
      setBirthCol(g.base.birthCol);
      setDateCol(g.base.dateCol);
      setJudgmentCol(g.base.judgmentCol);
      setColModes(g.colModes);
    } catch {
      setError("ファイルの読み込みに失敗しました。CSV形式か確認してください。");
    }
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await readCsvFile(file);
      loadCsv(text, file.name);
    } catch {
      setError("ファイルの読み込みに失敗しました。CSV形式か確認してください。");
    }
  };

  // 事業者担当者から送られたCSVを開いたときは、その内容を最初から読み込んでおく
  useEffect(() => {
    if (upload) loadCsv(upload.content, upload.fileName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upload?.id]);

  const baseCols = [nameCol, kanaCol, deptCol, empNoCol, sexCol, birthCol, dateCol, judgmentCol];

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

    const payload = buildImportRows({
      header,
      dataRows,
      base: { nameCol, kanaCol, deptCol, empNoCol, sexCol, birthCol, dateCol, judgmentCol },
      colModes,
      autoJudge,
      rules,
      checkupType,
      commonDate,
      persons,
    });

    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_import_checkups", {
      p_company_id: companyId,
      p_fiscal_year: fiscalYear,
      p_checkup_type: checkupType,
      p_findings_judgments: judgments,
      p_rows: payload,
      p_special_kind: checkupType === "special" ? specialKind.trim() || null : null,
      p_merge: merge,
      p_round: round,
    });
    if (error) {
      setError(`取込に失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    // 取込RPCは件数・統合した件数・取込ID(取り消しに使う)を返す
    const result = (data ?? {}) as { count?: number; merged?: number; batch_id?: string };
    setDone(result.count ?? 0);
    setMerged(result.merged ?? 0);
    setBatchId(result.batch_id ?? null);
    // 事業者担当者から送られたCSVは「取込済み」にして、送られた内容を消す
    if (upload) {
      await supabase.rpc("hm_csv_upload_finish", {
        p_id: upload.id,
        p_status: "imported",
        p_batch: result.batch_id ?? null,
      });
    }
    setBusy(false);
  };

  // 直前の取込をまとめて取り消す(列の選び違い・年度の誤りなどの修正用)
  const undoImport = async () => {
    if (!batchId) return;
    const ok = window.confirm(
      `いま取り込んだ ${done}名分の健診記録を削除します。\n` +
        `この操作は元に戻せません。よろしいですか？`
    );
    if (!ok) return;
    const reason = window.prompt("取り消す理由を入力してください（監査ログに記録されます）:", "取込内容の誤り");
    if (!reason) return;

    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hm_delete_import_batch", {
      p_batch: batchId,
      p_reason: reason,
    });
    if (error) {
      setError(`取り消しに失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    setUndone(true);
    setBusy(false);
    router.refresh();
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
          {merged > 0 && (
            <>
              うち<strong>{merged}名</strong>は同年度の既存の記録に検査項目を統合しました。
            </>
          )}
          {autoJudge && !simple && "（総合判定は事務所基準で自動判定しました）"}
        </p>
        {simple && !undone && (
          <p style={{ color: "var(--teal-dark)" }}>
            産業医事務所に取込完了をお知らせしました。産業医が内容を確認して就業判定を行います。
          </p>
        )}
        {undone ? (
          <p className="muted">この取込を取り消しました。</p>
        ) : (
          <p className="muted">
            {simple
              ? "ファイルや年度を誤った場合は、この取込をまとめて取り消せます。"
              : "列の選び方や年度を誤った場合は、この取込をまとめて取り消せます（健診一覧の「最近の取込」からも取り消せます）。"}
          </p>
        )}
        {upload && !undone && (
          <p className="muted">
            {originalPurged
              ? "送られたCSVの原本は削除しました。"
              : "送られたCSVの原本は保管されています（健診一覧の「送られたファイルの原本」からもダウンロード・削除できます）。"}
          </p>
        )}
        {error && <p className="error-message">{error}</p>}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => { startNavigationProgress(); router.push(backHref); }}>
            健診一覧へ戻る
          </button>
          {upload && !undone && !originalPurged && (
            <button className="btn secondary" onClick={purgeOriginal} disabled={busy}>
              {busy ? "処理中…" : "送られたCSVの原本を削除する"}
            </button>
          )}
          {batchId && !undone && (
            <button className="btn danger" onClick={undoImport} disabled={busy}>
              {busy ? "処理中…" : "この取込を取り消す"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div>
      {upload && (
        <div
          className="card"
          style={{ background: "var(--orange-light)", borderColor: "var(--orange)", padding: "10px 16px" }}
        >
          <strong style={{ fontSize: 14 }}>事業者担当者から送られたCSVを開いています</strong>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            {upload.fileName}（{dataRows.length}行）
            {upload.note && (
              <>
                <br />
                連絡事項: {upload.note}
              </>
            )}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
            年度・種別は担当者の指定を初期値にしています。列の割り当てを確認して取り込んでください。
            取り込むとダッシュボードの「取込待ち」から消えます。
          </div>
        </div>
      )}
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
        {!simple && (
          <div>
            <label>有所見とみなす判定（カンマ区切り）</label>
            <input
              type="text"
              value={findingsJudgments}
              onChange={(e) => setFindingsJudgments(e.target.value)}
              style={{ width: 160 }}
            />
          </div>
        )}
      </div>

      {/* 判定・統合の設定は実施者の画面だけに出す(事業者担当者は既定のまま) */}
      {!simple && (
        <>
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
          <div className="form-row checkbox-row">
            <input id="merge" type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
            <label htmlFor="merge" style={{ margin: 0 }}>
              同じ方の記録が同年度・同種別にすでにある場合は、検査項目を追加して1つの記録にまとめる
              （健診機関ごとに項目の異なるCSVが複数あるとき）
            </label>
          </div>
          {autoJudge && rules.length === 0 && (
            <p className="error-message">
              判定基準が未登録です。SQL(0115)の実行と「判定基準の設定」をご確認ください。
            </p>
          )}
        </>
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
        {/* 列の自動割り当ての版。画面が最新かどうかをここで確かめられる */}
        <span className="muted" style={{ marginLeft: 10, fontSize: 11 }}>
          自動割り当て {HEADER_RULES_VERSION}
        </span>
      </div>

      {/* 事業者担当者向け: 見出しから自動で割り当てた結果を確認して、そのまま取り込む */}
      {rows && simple && (
        <>
          <h3 style={{ color: "var(--teal-dark)", fontSize: 15 }}>読み取った内容</h3>
          <table className="list" style={{ marginBottom: 14, maxWidth: 560 }}>
            <tbody>
              {(
                [
                  ["氏名（必須）", nameCol],
                  ["フリガナ", kanaCol],
                  ["所属（部署）", deptCol],
                  ["社員番号", empNoCol],
                  ["性別", sexCol],
                  ["生年月日", birthCol],
                  ["健診日", dateCol],
                  ["総合判定", judgmentCol],
                ] as [string, number][]
              ).map(([label, idx]) => (
                <tr key={label}>
                  <th style={{ width: 160 }}>{label}</th>
                  <td>
                    {idx >= 0 ? (
                      <>
                        列「{header[idx] || `列${idx + 1}`}」
                        <span className="muted" style={{ marginLeft: 8 }}>
                          例: {dataRows[0]?.[idx] ?? ""}
                        </span>
                      </>
                    ) : (
                      <span className="muted">見つかりません</span>
                    )}
                  </td>
                </tr>
              ))}
              <tr>
                <th>検査項目</th>
                <td>
                  {header.filter((_, i) => !baseCols.includes(i) && (header[i] ?? "").trim() !== "").length}列
                  <span className="muted" style={{ marginLeft: 8 }}>
                    （法定項目は産業医事務所の基準で自動判定されます）
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          {nameCol < 0 && (
            <p className="error-message">
              氏名の列が見つかりません。CSVの1行目に「氏名」の見出しがあるかご確認ください。
              解決しない場合は産業医事務所にご連絡ください。
            </p>
          )}
          {yearMismatch && (
            <p className="error-message">
              CSVの健診日は<strong>{csvFiscalYear}年度</strong>ですが、年度の指定が
              <strong>{fiscalYear}年度</strong>になっています。上の「年度」を {csvFiscalYear} に
              直してから取り込んでください（このままでも取り込めますが、{fiscalYear}年度として登録されます）。
            </p>
          )}
          {dateWarning}
          {noDateWarning}
          {error && <p className="error-message">{error}</p>}
          <button className="btn orange" onClick={onImport} disabled={busy || nameCol < 0}>
            {busy ? "取込中…" : `${dataRows.length}名分を${fiscalYear}年度として取り込む`}
          </button>
        </>
      )}

      {rows && !simple && (
        <>
          <h3 style={{ color: "var(--teal-dark)", fontSize: 15 }}>基本項目の列を指定</h3>
          <table className="list" style={{ marginBottom: 14 }}>
            <tbody>
              <tr>
                <th style={{ width: 180 }}>氏名（必須）</th>
                <td>
                  {colSelect(nameCol, setNameCol)}
                  <span className="muted" style={{ marginLeft: 8 }}>
                    漢字の氏名の列を選んでください（カナしか無い場合はカナの列でも可）
                  </span>
                </td>
              </tr>
              <tr>
                <th>フリガナ</th>
                <td>
                  {colSelect(kanaCol, setKanaCol)}
                  <span className="muted" style={{ marginLeft: 8 }}>
                    報告書に氏名と並べて出力します
                  </span>
                </td>
              </tr>
              <tr>
                <th>所属（部署）</th>
                <td>{colSelect(deptCol, setDeptCol)}</td>
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
                <td>
                  {colSelect(dateCol, setDateCol)}
                  <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <label htmlFor="common-checkup-date" style={{ margin: 0 }}>
                      全員共通の健診日
                    </label>
                    <input
                      id="common-checkup-date"
                      type="date"
                      value={commonDate}
                      onChange={(e) => setCommonDate(e.target.value)}
                      style={{ width: 170 }}
                    />
                    <span className="muted">
                      CSVに健診日の列が無い場合や、列の値が空欄・読み取れない行に使います
                    </span>
                  </div>
                </td>
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
            法定項目に割り当てた列は、事務所基準で自動判定されます（「値のみ」は保存だけ、「判定として取込」は健診機関の判定をそのまま使用。「17 A」のように数値の右に判定が付いた列もそのまま読めます。「分布区分」は有機溶剤健診の生物学的モニタリングの 1〜3 を A〜C として判定に入れます）。
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
                        <option value="distribution">分布区分（1→A・2→B・3→C）として取込</option>
                        <option value="off">取り込まない</option>
                      </select>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>

          {yearMismatch && (
            <p className="error-message">
              CSVの健診日は<strong>{csvFiscalYear}年度</strong>ですが、年度の指定が
              <strong>{fiscalYear}年度</strong>になっています。上の「年度」をご確認ください。
            </p>
          )}
          {dateWarning}
          {noDateWarning}
          {error && <p className="error-message">{error}</p>}
          <button className="btn orange" onClick={onImport} disabled={busy}>
            {busy ? "取込中…" : `この内容で ${dataRows.length} 行を${fiscalYear}年度として取り込む`}
          </button>
        </>
      )}
      {!rows && error && <p className="error-message">{error}</p>}
    </div>
  );
}
