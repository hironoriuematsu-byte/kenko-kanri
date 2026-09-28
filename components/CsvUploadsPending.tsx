"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import { createClient } from "@/lib/supabase/browser";
import { CHECKUP_TYPES, roundLabel } from "@/lib/checkups";

type Upload = {
  id: string;
  company_id: string;
  company_name: string;
  kind?: string; // 'csv' | 'pdf'(0136 以前は undefined = csv)
  file_name: string;
  storage_path?: string | null;
  file_size?: number | null;
  row_count: number;
  fiscal_year: number | null;
  checkup_type: string | null;
  round: number;
  special_kind: string | null;
  note: string | null;
  uploaded_by_name: string | null;
  created_at: string;
};

// ファイルの中身を取り出す(PDFはストレージから、CSVは保存された内容から)
async function fetchUploadBlob(supabase: ReturnType<typeof createClient>, u: Upload): Promise<Blob> {
  if (u.kind === "pdf") {
    if (!u.storage_path) throw new Error("PDFの保存先がありません");
    const { data, error } = await supabase.storage.from("hm-files").download(u.storage_path);
    if (error || !data) throw new Error(error?.message ?? "PDFを取得できませんでした");
    return data;
  }
  const { data, error } = await supabase.rpc("hm_csv_upload_get", { p_id: u.id });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row?.content) throw new Error(error?.message ?? "CSVの内容がありません");
  return new Blob(["﻿" + row.content], { type: "text/csv;charset=utf-8;" });
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
};

// 産業医事務所ダッシュボード: 事業者担当者から送られた取込待ちのCSV / PDF(0135・0136)
//   CSV: 「取り込む」で取込画面を開く
//   PDF: ダウンロードしてCSVに変換し、その企業の取込画面から取り込む。終わったら「処理済み」
//   複数ファイルを選んで、ZIPでの一括ダウンロード・一括処理済み・一括破棄ができる
export default function CsvUploadsPending() {
  const [uploads, setUploads] = useState<Upload[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 処理中の行id(一括のときは "bulk")
  const [progress, setProgress] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_csv_uploads_pending");
    if (error) {
      setUploads([]); // 0135 未適用のときは何も出さない
      return;
    }
    const rows = (data ?? []) as Upload[];
    setUploads(rows);
    // 消えた行は選択から外す
    setSelected((prev) => new Set(Array.from(prev).filter((id) => rows.some((r) => r.id === id))));
  };

  useEffect(() => {
    load();
  }, []);

  const selectedUploads = useMemo(() => (uploads ?? []).filter((u) => selected.has(u.id)), [uploads, selected]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => {
    if (!uploads) return;
    setSelected(selected.size === uploads.length ? new Set() : new Set(uploads.map((u) => u.id)));
  };
  // 企業名を押すと、その企業のファイルをまとめて選択・解除する
  const toggleCompany = (companyId: string) => {
    if (!uploads) return;
    const ids = uploads.filter((u) => u.company_id === companyId).map((u) => u.id);
    const allOn = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  };

  // 1件ダウンロード。PDFは署名付きURL(非公開バケット。2分間だけ有効)、CSVは中身をそのまま保存
  const download = async (u: Upload) => {
    setBusy(u.id);
    setError(null);
    const supabase = createClient();
    try {
      if (u.kind === "pdf") {
        if (!u.storage_path) return;
        const { data, error } = await supabase.storage
          .from("hm-files")
          .createSignedUrl(u.storage_path, 120, { download: u.file_name });
        if (error || !data?.signedUrl) throw new Error(error?.message ?? "unknown");
        const a = document.createElement("a");
        a.href = data.signedUrl;
        a.download = u.file_name;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        saveBlob(await fetchUploadBlob(supabase, u), u.file_name);
      }
    } catch (e) {
      setError(`ダウンロードできませんでした: ${e instanceof Error ? e.message : String(e)}`);
    }
    setBusy(null);
  };

  // 選択したファイルをZIPにまとめてダウンロード(企業ごとのフォルダに分ける)
  const downloadZip = async () => {
    if (selectedUploads.length === 0) return;
    setBusy("bulk");
    setError(null);
    const supabase = createClient();
    const zip = new JSZip();
    const used = new Set<string>();
    const failed: string[] = [];
    for (let i = 0; i < selectedUploads.length; i++) {
      const u = selectedUploads[i];
      setProgress(`ファイルを集めています… (${i + 1}/${selectedUploads.length})`);
      try {
        const blob = await fetchUploadBlob(supabase, u);
        // 同名ファイルは (2), (3) … を付けて区別する
        let name = `${u.company_name}/${u.file_name}`;
        for (let n = 2; used.has(name); n++) {
          const dot = u.file_name.lastIndexOf(".");
          const base = dot > 0 ? u.file_name.slice(0, dot) : u.file_name;
          const ext = dot > 0 ? u.file_name.slice(dot) : "";
          name = `${u.company_name}/${base} (${n})${ext}`;
        }
        used.add(name);
        zip.file(name, blob);
      } catch (e) {
        failed.push(`${u.company_name} / ${u.file_name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (used.size > 0) {
      setProgress("ZIPを作成しています…");
      const out = await zip.generateAsync({ type: "blob" });
      const companies = new Set(selectedUploads.map((u) => u.company_name));
      const prefix = companies.size === 1 ? Array.from(companies)[0] : "複数企業";
      saveBlob(out, `${prefix}_健診結果ファイル_${today()}.zip`);
    }
    if (failed.length > 0) setError(`取得できなかったファイルがあります:\n${failed.join("\n")}`);
    setProgress(null);
    setBusy(null);
  };

  // 処理済み / 破棄(1件または複数件)。原本は「破棄」のときだけ消す(処理済みでは保管し、後から削除できる)
  const finishMany = async (targets: Upload[], status: "imported" | "discarded") => {
    if (targets.length === 0) return;
    const label = status === "imported" ? "処理済みにします" : "取り込まずに破棄します";
    const head =
      targets.length === 1
        ? `${targets[0].company_name} から送られた「${targets[0].file_name}」を${label}。\n`
        : `選択した ${targets.length} 件のファイルを${label}。\n` +
          targets
            .slice(0, 8)
            .map((t) => `・${t.company_name} / ${t.file_name}`)
            .join("\n") +
          (targets.length > 8 ? `\n・…ほか ${targets.length - 8} 件` : "") +
          "\n";
    const ok = window.confirm(
      head +
        (status === "discarded"
          ? "送られたファイルは削除されます。\n"
          : "送られたファイルは原本として保管され、健診一覧の「送られたファイルの原本」から確認・削除できます。\n") +
        "よろしいですか？"
    );
    if (!ok) return;
    setBusy(targets.length === 1 ? targets[0].id : "bulk");
    setError(null);
    const supabase = createClient();
    const failed: string[] = [];
    for (let i = 0; i < targets.length; i++) {
      const u = targets[i];
      if (targets.length > 1) setProgress(`処理しています… (${i + 1}/${targets.length})`);
      if (status === "discarded" && u.kind === "pdf" && u.storage_path) {
        const { error: rmErr } = await supabase.storage.from("hm-files").remove([u.storage_path]);
        if (rmErr) {
          failed.push(`${u.company_name} / ${u.file_name}: PDFを削除できませんでした(${rmErr.message})`);
          continue;
        }
      }
      const { error } = await supabase.rpc("hm_csv_upload_finish", { p_id: u.id, p_status: status, p_batch: null });
      if (error) failed.push(`${u.company_name} / ${u.file_name}: ${error.message}`);
    }
    if (failed.length > 0) setError(`更新できなかったファイルがあります:\n${failed.join("\n")}`);
    await load();
    setProgress(null);
    setBusy(null);
  };

  if (!uploads || uploads.length === 0) return null;

  const fmt = (ts: string) => {
    const d = new Date(ts);
    return isNaN(d.getTime())
      ? ts
      : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  const sizeLabel = (bytes?: number | null) =>
    bytes == null
      ? ""
      : bytes >= 1024 * 1024
        ? `${(bytes / 1024 / 1024).toFixed(1)}MB`
        : `${Math.ceil(bytes / 1024)}KB`;
  const hasPdf = uploads.some((u) => u.kind === "pdf");
  const bulkBusy = busy === "bulk";
  const nSel = selectedUploads.length;

  return (
    <div className="card" style={{ borderColor: "var(--orange)" }}>
      <h2>取込待ちのファイルがあります（{uploads.length}件）</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        事業者担当者から送られた健診結果です。CSVは「取り込む」を押すと取込画面が開き、列の割り当てを指定して取り込めます。
        {hasPdf && (
          <>
            <br />
            PDFは「ダウンロード」して内容をCSVに変換し、その企業の取込画面（CSV一括取込）から取り込んでください。
            終わったら「処理済み」を押してください（PDFは原本として保管され、健診一覧から削除できます）。
          </>
        )}
        <br />
        複数のファイルをまとめて扱うときは、左のチェックを付けて（企業名を押すとその企業の分をまとめて選べます）、下のボタンから一括で操作できます。
      </p>
      {error && <p className="error-message" style={{ whiteSpace: "pre-line" }}>{error}</p>}
      {progress && <p className="notice">{progress}</p>}

      {/* 一括操作 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "6px 0 10px" }}>
        <span className="muted" style={{ fontSize: 13 }}>
          {nSel > 0 ? `${nSel} 件を選択中` : "選択なし"}
        </span>
        <button className="btn orange" style={{ padding: "5px 12px", fontSize: 13 }} onClick={downloadZip} disabled={nSel === 0 || busy !== null}>
          {bulkBusy && progress?.includes("ZIP") ? "作成中…" : "選択したファイルを一括ダウンロード（ZIP）"}
        </button>
        <button
          className="btn"
          style={{ padding: "5px 12px", fontSize: 13 }}
          onClick={() => finishMany(selectedUploads, "imported")}
          disabled={nSel === 0 || busy !== null}
        >
          選択を処理済みにする
        </button>
        <button
          className="btn secondary"
          style={{ padding: "5px 12px", fontSize: 13 }}
          onClick={() => finishMany(selectedUploads, "discarded")}
          disabled={nSel === 0 || busy !== null}
        >
          選択を破棄する
        </button>
      </div>

      <table className="list">
        <thead>
          <tr>
            <th style={{ width: 28 }}>
              <input
                type="checkbox"
                aria-label="すべて選択"
                checked={uploads.length > 0 && selected.size === uploads.length}
                onChange={toggleAll}
                disabled={busy !== null}
              />
            </th>
            <th>送信日時</th>
            <th>企業</th>
            <th>ファイル</th>
            <th>対象（担当者の指定）</th>
            <th>連絡事項</th>
            <th>送った方</th>
            <th style={{ width: 300 }}></th>
          </tr>
        </thead>
        <tbody>
          {uploads.map((u) => {
            const isPdf = u.kind === "pdf";
            const rowBusy = busy === u.id || bulkBusy;
            return (
              <tr key={u.id} style={selected.has(u.id) ? { background: "#FFF8EC" } : undefined}>
                <td>
                  <input type="checkbox" checked={selected.has(u.id)} onChange={() => toggle(u.id)} disabled={busy !== null} />
                </td>
                <td style={{ whiteSpace: "nowrap" }}>{fmt(u.created_at)}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => toggleCompany(u.company_id)}
                    title="この企業のファイルをまとめて選択・解除"
                    style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "inherit", font: "inherit", textDecoration: "underline dotted" }}
                  >
                    {u.company_name}
                  </button>
                </td>
                <td>
                  <span className={`badge${isPdf ? " orange" : ""}`} style={{ marginRight: 6 }}>
                    {isPdf ? "PDF" : "CSV"}
                  </span>
                  {u.file_name}
                  <span className="muted" style={{ fontSize: 12, marginLeft: 4 }}>
                    {isPdf ? `（${sizeLabel(u.file_size)}）` : `（${u.row_count}名分）`}
                  </span>
                </td>
                <td>
                  {u.fiscal_year ? `${u.fiscal_year}年度` : "—"}
                  {roundLabel(u.round) ? `・${roundLabel(u.round)}` : ""}
                  {u.checkup_type ? ` / ${CHECKUP_TYPES[u.checkup_type] ?? u.checkup_type}` : ""}
                  {u.special_kind ? `（${u.special_kind}）` : ""}
                </td>
                <td style={{ fontSize: 13 }}>{u.note ?? <span className="muted">—</span>}</td>
                <td>{u.uploaded_by_name ?? "—"}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {isPdf ? (
                    <>
                      <button
                        className="btn orange"
                        style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }}
                        onClick={() => download(u)}
                        disabled={rowBusy}
                      >
                        ダウンロード
                      </button>
                      <Link
                        className="btn secondary"
                        style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }}
                        href={`/office/${u.company_id}/checkups/import`}
                      >
                        取込画面
                      </Link>
                      <button
                        className="btn"
                        style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }}
                        onClick={() => finishMany([u], "imported")}
                        disabled={rowBusy}
                      >
                        処理済み
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        className="btn orange"
                        style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }}
                        href={`/office/${u.company_id}/checkups/import?upload=${u.id}`}
                      >
                        取り込む
                      </Link>
                      <button
                        className="btn secondary"
                        style={{ padding: "4px 10px", fontSize: 12, marginRight: 6 }}
                        onClick={() => download(u)}
                        disabled={rowBusy}
                      >
                        ダウンロード
                      </button>
                    </>
                  )}
                  <button
                    className="btn secondary"
                    style={{ padding: "4px 10px", fontSize: 12 }}
                    onClick={() => finishMany([u], "discarded")}
                    disabled={rowBusy}
                  >
                    {busy === u.id ? "処理中…" : "破棄"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
