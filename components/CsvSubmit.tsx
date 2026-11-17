"use client";

import { ChangeEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { getFiscalYear } from "@/lib/fiscal";
import { CHECKUP_TYPES, parseCsv, readCsvFile } from "@/lib/checkups";
import { startNavigationProgress } from "@/lib/navigate";
import AutoReadRunner, { type ReadTarget } from "@/components/AutoReadRunner";
import RoundHint from "@/components/RoundHint";

const MAX_PDF_BYTES = 20 * 1024 * 1024;

// 送るファイル1つ分
type Picked =
  | { key: string; kind: "csv"; name: string; content: string; rowCount: number; headers: string[] }
  | { key: string; kind: "pdf"; name: string; file: File; size: number };

type Result = { name: string; ok: boolean; message?: string };

// ファイルの中身から作る照合用の値(同じファイルをもう一度送っていないかを確かめる)
async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// 事業者担当者向け: 健診機関のCSVやPDFをそのまま産業医事務所に送る(複数ファイルをまとめて送れる)。
//   CSV: 中身をそのまま送り、産業医事務所が取込画面で列を指定して取り込む(0135)
//   PDF: 非公開の保存領域(hm-files/<company_id>/checkup-uploads/)に保存し、
//        産業医事務所がダウンロードしてCSVに変換して取り込む(0136)
//   送ったあとは、その場でAIが読み取り、事務所の基準で判定して、就業判定を表示する(components/AutoReadRunner)。
//   産業医事務所が、企業の代わりに送るときも同じ画面を使う(role="office")
export default function CsvSubmit({
  companyId,
  backHref,
  role = "company",
  manualHref,
}: {
  companyId: string;
  backHref: string;
  role?: "company" | "office";
  manualHref?: string; // 手作業の取込画面(事務所のみ)
}) {
  const router = useRouter();
  const [fiscalYear, setFiscalYear] = useState(getFiscalYear());
  const [checkupType, setCheckupType] = useState("regular");
  const [round, setRound] = useState(1);
  const [specialKind, setSpecialKind] = useState("");
  const [note, setNote] = useState("");
  const [files, setFiles] = useState<Picked[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [sent, setSent] = useState<ReadTarget[]>([]); // 送ったファイル(このあと自動で読み取る)
  const [dupes, setDupes] = useState<string[]>([]); // 前に送ったものと同じ中身だったファイル

  // ファイルを追加する(何回かに分けて選んでもよい)
  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (list.length === 0) return;
    setError(null);
    const errors: string[] = [];
    const added: Picked[] = [];
    for (const file of list) {
      const key = `${file.name}-${file.size}-${file.lastModified}`;
      if (files.some((f) => f.key === key) || added.some((f) => f.key === key)) continue; // 同じファイルは1回だけ
      const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
      if (isPdf) {
        if (file.size > MAX_PDF_BYTES) {
          errors.push(`${file.name}: PDFが大きすぎます（20MBまで）`);
          continue;
        }
        added.push({ key, kind: "pdf", name: file.name, file, size: file.size });
        continue;
      }
      try {
        const text = await readCsvFile(file);
        const parsed = parseCsv(text);
        if (parsed.length < 2) {
          errors.push(`${file.name}: データ行がありません（1行目に見出し、2行目以降にデータ）`);
          continue;
        }
        added.push({
          key,
          kind: "csv",
          name: file.name,
          content: text,
          rowCount: parsed.length - 1,
          headers: parsed[0],
        });
      } catch {
        errors.push(`${file.name}: 読み込みに失敗しました（CSV形式か確認してください）`);
      }
    }
    setFiles((prev) => [...prev, ...added]);
    if (errors.length > 0) setError(errors.join("\n"));
  };

  const removeFile = (key: string) => setFiles((prev) => prev.filter((f) => f.key !== key));

  const onSubmit = async () => {
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const common = {
      p_fiscal_year: fiscalYear,
      p_checkup_type: checkupType,
      p_round: round,
      p_special_kind: checkupType === "special" ? specialKind.trim() || null : null,
      p_note: note.trim() || null,
    };
    const out: Result[] = [];
    const sentNow: ReadTarget[] = [];
    const dupNow: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setProgress(`${i + 1} / ${files.length}: ${f.name} を送信中…`);
      // 同じ中身のファイルを前に送っていたら、送らない(二重の登録を防ぐ)
      let hash: string | undefined;
      try {
        hash = await sha256Hex(f.kind === "csv" ? new TextEncoder().encode(f.content) : await f.file.arrayBuffer());
        const res = await fetch(`/api/checkup-read?hash=${hash}&companyId=${encodeURIComponent(companyId)}`);
        const j = res.ok ? ((await res.json()) as { duplicate?: { file_name: string; created_at: string } | null }) : {};
        if (j.duplicate) {
          const d = new Date(j.duplicate.created_at);
          dupNow.push(`${f.name}(${d.getMonth() + 1}月${d.getDate()}日に「${j.duplicate.file_name}」として受け付け済み)`);
          out.push({ name: f.name, ok: true });
          continue;
        }
      } catch {
        /* 照合できないときは、そのまま送る */
      }
      if (f.kind === "csv") {
        const { data, error } = await supabase.rpc("hm_submit_csv_upload", {
          p_company_id: companyId,
          p_file_name: f.name,
          p_content: f.content,
          p_row_count: f.rowCount,
          ...common,
        });
        out.push(error ? { name: f.name, ok: false, message: error.message } : { name: f.name, ok: true });
        if (!error && typeof data === "string") sentNow.push({ id: data, name: f.name, kind: "csv", hash });
        continue;
      }
      // PDF本体を非公開の保存領域に保存してから、記録を作る
      const id = crypto.randomUUID();
      const path = `${companyId}/checkup-uploads/${id}.pdf`;
      const { error: upErr } = await supabase.storage
        .from("hm-files")
        .upload(path, f.file, { contentType: "application/pdf", upsert: false });
      if (upErr) {
        out.push({ name: f.name, ok: false, message: `PDFの保存に失敗: ${upErr.message}` });
        continue;
      }
      const { error } = await supabase.rpc("hm_submit_file_upload", {
        p_id: id,
        p_company_id: companyId,
        p_kind: "pdf",
        p_file_name: f.name,
        p_storage_path: path,
        p_file_size: f.size,
        ...common,
      });
      if (error) {
        await supabase.storage.from("hm-files").remove([path]); // 記録が作れなければ保存したファイルも消す
        out.push({ name: f.name, ok: false, message: error.message });
        continue;
      }
      out.push({ name: f.name, ok: true });
      sentNow.push({ id, name: f.name, kind: "pdf", hash });
    }
    setSent(sentNow);
    setDupes(dupNow);
    setProgress(null);
    // 送れなかったものだけ残し、やり直せるようにする
    const failed = new Set(out.filter((r) => !r.ok).map((r) => r.name));
    setFiles((prev) => prev.filter((f) => failed.has(f.name)));
    setResults(out);
    setBusy(false);
  };

  const sizeLabel = (bytes: number) =>
    bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.ceil(bytes / 1024)}KB`;

  const csvCount = files.filter((f) => f.kind === "csv").length;
  const pdfCount = files.filter((f) => f.kind === "pdf").length;

  const dupNotice = dupes.length > 0 && (
    <div style={{ background: "var(--orange-light)", border: "1px solid var(--orange)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 14 }}>
      <strong>前に送ったものと同じファイルのため、送りませんでした(二重の登録を防ぐため)。</strong>
      <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
        {dupes.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
    </div>
  );

  // 送信結果(すべて成功したら、その場で読み取って結果を表示する)
  if (results && results.every((r) => r.ok)) {
    const again = () => {
      setResults(null);
      setSent([]);
      setDupes([]);
    };
    return (
      <div>
        {dupNotice}
        {sent.length > 0 ? (
          <AutoReadRunner uploads={sent} role={role} listHref={backHref} manualHref={manualHref} onAgain={again} />
        ) : (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn" onClick={() => { startNavigationProgress(); router.push(backHref); }}>
              健診一覧へ戻る
            </button>
            <button className="btn secondary" onClick={again}>
              続けて別のファイルを送る
            </button>
          </div>
        )}
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
      {/* 同じ年度・種別にすでに登録されている実施回を知らせる(2回目の健診を「1回目」のまま送らないように) */}
      <RoundHint companyId={companyId} fiscalYear={fiscalYear} checkupType={checkupType} specialKind={specialKind} round={round} />
      <p className="muted" style={{ fontSize: 12, marginTop: 0 }}>
        年度・種別・連絡事項は、ここで選んだファイルすべてに共通で付きます。年度や種別が違うファイルは分けて送ってください。
      </p>

      <div className="form-row">
        <label className="btn secondary" style={{ display: "inline-block" }}>
          {files.length === 0 ? "CSV・PDFファイルを選択（複数可）" : "ファイルを追加"}
          <input
            type="file"
            accept=".csv,.txt,.pdf,application/pdf"
            multiple
            style={{ display: "none" }}
            onChange={onFiles}
          />
        </label>
        {files.length > 0 && (
          <span style={{ marginLeft: 10 }} className="muted">
            {files.length}件（CSV {csvCount}・PDF {pdfCount}）
          </span>
        )}
      </div>

      {files.length > 0 && (
        <table className="list" style={{ marginBottom: 14, maxWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ width: 60 }}>種類</th>
              <th>ファイル</th>
              <th>内容</th>
              <th style={{ width: 70 }}></th>
            </tr>
          </thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.key}>
                <td>
                  <span className={`badge${f.kind === "pdf" ? " orange" : ""}`}>{f.kind === "pdf" ? "PDF" : "CSV"}</span>
                </td>
                <td>{f.name}</td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {f.kind === "csv"
                    ? `データ ${f.rowCount} 行・${f.headers.length} 列（${f.headers.filter((h) => h.trim()).slice(0, 6).join("、")}…）`
                    : sizeLabel(f.size)}
                </td>
                <td>
                  <button
                    className="btn secondary"
                    style={{ padding: "2px 8px", fontSize: 12 }}
                    onClick={() => removeFile(f.key)}
                    disabled={busy}
                  >
                    外す
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="form-row">
        <label>{role === "office" ? "メモ（任意）" : "産業医事務所への連絡事項（任意）"}</label>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="例: 2名分は再検査の結果を後日送ります"
          style={{ minHeight: 60 }}
        />
      </div>

      {error && <p className="error-message" style={{ whiteSpace: "pre-wrap" }}>{error}</p>}
      {results && results.some((r) => !r.ok) && (
        <div className="error-message" style={{ marginBottom: 10 }}>
          <div>送れなかったファイルがあります。残っているファイルをもう一度送ってください。</div>
          <ul style={{ margin: "4px 0 0", paddingLeft: 20, fontSize: 13 }}>
            {results.map((r) => (
              <li key={r.name}>
                {r.name}: {r.ok ? "送信済み" : `失敗（${r.message}）`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {progress && <p className="muted">{progress}</p>}
      <button className="btn orange" onClick={onSubmit} disabled={busy || files.length === 0}>
        {busy ? "送信中…" : role === "office" ? `${files.length}件のファイルを読み取って取り込む` : `${files.length}件のファイルを送る(自動で読み取ります)`}
      </button>
    </div>
  );
}
