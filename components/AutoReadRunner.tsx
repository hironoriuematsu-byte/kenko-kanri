"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Coverage, ReadSummary } from "@/lib/autoRead";

// 送ったファイルを、その場でAIに読み取らせて、結果(就業判定)を表示する。
// 読み取りはサーバー側で少しずつ進むので、終わるまでこの部品が続けて呼ぶ(途中で閉じても、あとで続きから進められる)

export type ReadTarget = { id: string; name: string; kind: "csv" | "pdf"; hash?: string };
type ApiState = {
  status?: string;
  progress?: { done: number; total: number } | null;
  result?: { summary: ReadSummary; coverage?: Coverage } | null;
  error?: string | null;
  busy?: boolean;
};
type FileState = ApiState & { phase: "wait" | "run" | "end" | "manual" | "stopped" };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 読み取り結果の要約(会社・事務所の画面で共通)
export function ReadSummaryView({ summary, role, coverage }: { summary: ReadSummary; role: "office" | "company"; coverage?: Coverage }) {
  const returned = summary.normal + summary.consult + summary.pending;
  const li = { margin: "2px 0" } as const;
  return (
    <div>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{summary.total}名分を読み取りました</div>
      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14 }}>
        {returned > 0 && (
          <li style={li}>
            就業判定を返しました: <strong>{returned}名</strong>
            <span className="muted">
              (通常勤務可 {summary.normal}名
              {summary.consult > 0 && `・通常勤務可〈受診が条件〉 ${summary.consult}名`}
              {summary.pending > 0 && `・判定保留〈産業医が確認中〉 ${summary.pending}名`})
            </span>
          </li>
        )}
        {summary.unjudged > 0 && (
          <li style={li}>
            取り込みました(就業判定は産業医が行います): <strong>{summary.unjudged}名</strong>
          </li>
        )}
        {summary.same > 0 && (
          <li style={li}>
            登録済みのため変更なし: <strong>{summary.same}名</strong>
          </li>
        )}
        {summary.held > 0 && (
          <li style={{ ...li, color: "#b45415" }}>
            {role === "office" ? "確認待ち" : "産業医事務所で確認中"}: <strong>{summary.held}名</strong>
            <span className="muted">
              {role === "office" ? "(ダッシュボードの「読み取りの確認待ち」で取り込めます)" : "(確認が済むと、健康診断管理の一覧に表示されます)"}
            </span>
          </li>
        )}
      </ul>
      {coverage && (
        <details style={{ marginTop: 6, fontSize: 13 }}>
          <summary style={{ cursor: "pointer", color: "var(--teal-dark)" }}>
            取り込んだ検査項目({coverage.found.length}項目)
            {coverage.missing.length > 0 && <span style={{ color: "#b45415" }}>・見当たらなかった項目 {coverage.missing.length}</span>}
          </summary>
          <div style={{ margin: "4px 0 0 4px", lineHeight: 1.8 }}>
            <div>
              <strong>取り込んだ項目:</strong> {coverage.found.join("、") || "なし"}
            </div>
            {coverage.missing.length > 0 && (
              <div style={{ color: "#b45415" }}>
                <strong>このファイルに見当たらなかった項目:</strong> {coverage.missing.join("、")}
                <span className="muted">(年齢などにより省略されている場合があります)</span>
              </div>
            )}
            {coverage.renamed.length > 0 && (
              <div className="muted">
                見出しを読み替えた列: {coverage.renamed.map((r) => `「${r.from}」→ ${r.to}`).join("、")}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export default function AutoReadRunner({
  uploads,
  role,
  listHref,
  manualHref,
  onAgain,
}: {
  uploads: ReadTarget[];
  role: "office" | "company";
  listHref: string; // 健康診断管理の一覧
  manualHref?: string; // 手作業の取込(事務所のみ)
  onAgain: () => void; // 続けて別のファイルを送る
}) {
  const [states, setStates] = useState<Record<string, FileState>>(() => Object.fromEntries(uploads.map((u) => [u.id, { phase: "wait" as const }])));
  const started = useRef(false);
  const set = (id: string, s: Partial<FileState>) => setStates((prev) => ({ ...prev, [id]: { ...prev[id], ...s } }));

  const drive = async (t: ReadTarget, action: "run" | "retry" = "run") => {
    set(t.id, { phase: "run", error: null });
    let act = action;
    for (let n = 0; n < 600; n++) {
      let res: Response;
      try {
        res = await fetch("/api/checkup-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: act, uploadId: t.id, hash: t.hash }) });
      } catch {
        return set(t.id, { phase: "stopped", error: "通信が切れました。「続ける」を押すと、続きから進みます" });
      }
      act = "run";
      // 自動の読み取りが使えない環境(設定前)では、今までどおり事務所が手で取り込む
      if (res.status === 503 || res.status === 404) return set(t.id, { phase: "manual" });
      const j = (await res.json().catch(() => ({}))) as ApiState;
      if (!res.ok) return set(t.id, { phase: "stopped", error: j.error ?? `エラー(${res.status})` });
      set(t.id, j);
      if (j.busy) {
        await sleep(6000);
        continue;
      }
      if (j.status === "done" || j.status === "review" || j.status === "failed") return set(t.id, { ...j, phase: "end" });
      if (j.error) return set(t.id, { ...j, phase: "stopped" });
    }
    set(t.id, { phase: "stopped", error: "時間がかかりすぎています。「続ける」を押してください" });
  };

  // 1つずつ順に読み取る
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      for (const t of uploads) await drive(t);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const working = uploads.some((u) => ["wait", "run"].includes(states[u.id]?.phase));
  const anyManual = uploads.some((u) => states[u.id]?.phase === "manual");

  return (
    <div>
      {uploads.map((u) => {
        const s = states[u.id] ?? { phase: "wait" };
        const pct = s.progress && s.progress.total > 0 ? Math.round((s.progress.done / s.progress.total) * 100) : null;
        return (
          <div key={u.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "12px 14px", marginBottom: 10, background: "#fff" }}>
            <div style={{ fontWeight: 700, color: "var(--teal-dark)", marginBottom: 6 }}>
              <span className={`badge${u.kind === "pdf" ? " orange" : ""}`} style={{ marginRight: 8 }}>
                {u.kind === "pdf" ? "PDF" : "CSV"}
              </span>
              {u.name}
            </div>
            {s.phase === "wait" && <div className="muted">順番を待っています…</div>}
            {s.phase === "run" && (
              <div>
                <div>
                  読み取っています…{s.progress ? ` (${s.progress.done} / ${s.progress.total})` : ""}
                  {s.busy && " ほかの画面で読み取り中のため、待っています"}
                </div>
                <div style={{ height: 8, background: "var(--teal-light)", borderRadius: 999, overflow: "hidden", margin: "6px 0", maxWidth: 420 }}>
                  <div style={{ height: "100%", width: `${pct ?? 8}%`, background: "var(--teal)", transition: "width .4s" }} />
                </div>
                <div className="muted" style={{ fontSize: 12 }}>
                  {u.kind === "pdf" ? "PDFは数ページずつ読むため、数分かかることがあります。" : ""}
                  この画面を開いたままお待ちください(閉じてしまっても、産業医事務所の画面から続きを進められます)。
                </div>
              </div>
            )}
            {s.phase === "end" && s.result && (s.status === "done" || s.status === "review") && <ReadSummaryView summary={s.result.summary} role={role} coverage={s.result.coverage} />}
            {s.phase === "end" && s.status === "failed" && (
              <div>
                <p className="error-message" style={{ margin: "0 0 8px" }}>
                  自動では読み取れませんでした: {s.error}
                </p>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="btn secondary" onClick={() => drive(u, "retry")}>
                    もう一度読み取る
                  </button>
                  {role === "office" && manualHref && u.kind === "csv" && (
                    <Link className="btn secondary" href={`${manualHref}?upload=${u.id}`}>
                      列を指定して手で取り込む
                    </Link>
                  )}
                  {role === "company" && <span className="muted">このままでも、産業医事務所が内容を確認して取り込みます。</span>}
                </div>
              </div>
            )}
            {s.phase === "stopped" && (
              <div>
                <p className="error-message" style={{ margin: "0 0 8px" }}>{s.error}</p>
                <button className="btn secondary" onClick={() => drive(u)}>
                  続ける
                </button>
              </div>
            )}
            {s.phase === "manual" && <div style={{ color: "var(--teal-dark)" }}>産業医事務所に送りました。産業医事務所が内容を確認して取り込みます。</div>}
          </div>
        );
      })}
      {!working && (
        <>
          {!anyManual && (
            <p className="muted" style={{ fontSize: 12.5 }}>
              就業判定は、産業医があらかじめ定めた基準によるものです。「判定保留」の方は、産業医が内容を確認してから確定します。
            </p>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="btn" href={listHref}>
              健康診断管理の一覧へ
            </Link>
            <button className="btn secondary" onClick={onAgain}>
              続けて別のファイルを送る
            </button>
          </div>
        </>
      )}
    </div>
  );
}
