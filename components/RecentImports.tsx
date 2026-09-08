"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { CHECKUP_TYPES } from "@/lib/checkups";
import { formatDateJa } from "@/lib/fiscal";

type ImportBatch = {
  batch_id: string;
  imported_at: string;
  fiscal_year: number;
  checkup_type: string;
  rows_count: number;
  judged_count: number;
};

// CSV取込のまとまり(バッチ)の一覧。取込ミスをまとめて取り消せるようにする。
export default function RecentImports({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [batches, setBatches] = useState<ImportBatch[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_recent_imports", {
      p_company_id: companyId,
      p_limit: 5,
    });
    if (error) {
      setError(`取込の履歴を取得できませんでした: ${error.message}`);
      setBatches([]);
      return;
    }
    setBatches((data ?? []) as ImportBatch[]);
  }, [companyId]);

  useEffect(() => {
    if (open && batches === null) load();
  }, [open, batches, load]);

  const undo = async (b: ImportBatch) => {
    const ok = window.confirm(
      `${formatDateJa(b.imported_at)}に取り込んだ ${b.rows_count}件の健診記録を削除します。\n` +
        (b.judged_count > 0
          ? `※ このうち ${b.judged_count}件は就業判定が入力済みです。判定内容も一緒に消えます。\n`
          : "") +
        `健康診断個人票は5年保存が原則です。取込ミスの修正など、正当な理由がある場合のみ取り消してください。\n` +
        `この操作は元に戻せません。続行しますか？`
    );
    if (!ok) return;
    const reason = window.prompt("取り消す理由を入力してください（監査ログに記録されます）:", "取込内容の誤り");
    if (!reason) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("hm_delete_import_batch", {
      p_batch: b.batch_id,
      p_reason: reason,
    });
    if (error) {
      setError(`取り消しに失敗しました: ${error.message}`);
      setBusy(false);
      return;
    }
    setMessage(`${data}件を取り消しました。`);
    setBatches(null);
    setBusy(false);
    await load();
    router.refresh();
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <button className="btn secondary" onClick={() => setOpen((v) => !v)} style={{ fontSize: 13 }}>
        {open ? "最近の取込を閉じる" : "最近の取込（取り消し）"}
      </button>

      {open && (
        <div className="card" style={{ marginTop: 8 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            CSVで取り込んだまとまりごとに、まとめて取り消せます。列の選び違いや年度の誤りに気づいた
            ときにご利用ください。個別入力で登録した記録は含まれません。
          </p>
          {error && <p className="error-message">{error}</p>}
          {message && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>{message}</p>}

          {batches === null ? (
            <p className="muted">読み込み中…</p>
          ) : batches.length === 0 ? (
            <p className="muted">取り消せる取込はありません。</p>
          ) : (
            <table className="list">
              <thead>
                <tr>
                  <th>取込日時</th>
                  <th>年度</th>
                  <th>種別</th>
                  <th>件数</th>
                  <th>判定済み</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.batch_id}>
                    <td>{new Date(b.imported_at).toLocaleString("ja-JP")}</td>
                    <td>{b.fiscal_year}年度</td>
                    <td>{CHECKUP_TYPES[b.checkup_type] ?? b.checkup_type}</td>
                    <td>{b.rows_count}件</td>
                    <td>{b.judged_count > 0 ? `${b.judged_count}件` : "—"}</td>
                    <td>
                      <button
                        className="btn danger"
                        style={{ padding: "3px 10px", fontSize: 12 }}
                        onClick={() => undo(b)}
                        disabled={busy}
                      >
                        この取込を取り消す
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
