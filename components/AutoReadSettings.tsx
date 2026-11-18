"use client";

import { useEffect, useState } from "react";

// 事務所の設定: 健診結果の自動読み取り(AI)
export default function AutoReadSettings() {
  const [state, setState] = useState<{ ready?: boolean; aiReady?: boolean; pdfAuto?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/checkup-read?settings=1")
      .then((r) => (r.ok ? r.json() : { ready: false }))
      .then(setState)
      .catch(() => setState({ ready: false }));
  }, []);

  const toggle = async (pdfAuto: boolean) => {
    const text = pdfAuto
      ? "PDFから読み取った結果を、事務所の確認なしで取り込み、就業判定まで返すようにします。\n(読み取りをくり返しても結果がそろわない方・ありえない値のある方などは、これまでどおり確認待ちに入ります)\n\nよろしいですか？"
      : "PDFから読み取った結果は、事務所が確認してから取り込む形に戻します。よろしいですか？";
    if (!window.confirm(text)) return;
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/checkup-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "settings", pdfAuto }) });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setErr(j.error ?? "変更できませんでした");
    setState((s) => ({ ...s, pdfAuto }));
  };

  return (
    <div className="card">
      <h2>健診結果の自動読み取り（AI）</h2>
      {!state ? (
        <p className="muted">読み込んでいます…</p>
      ) : !state.ready ? (
        <p className="muted">準備中です(サーバーの設定とSQL 0155 が済むと使えるようになります)。それまでは、今までどおり手作業で取り込みます。</p>
      ) : (
        <>
          <ul style={{ margin: "0 0 10px", paddingLeft: 20, fontSize: 14, lineHeight: 1.8 }}>
            <li>
              <strong>CSV</strong>: 送られるとすぐに読み取り、事務所の判定基準で判定して、就業判定を返します。
            </li>
            <li>
              <strong>PDF</strong>: AIが2回読み取って突き合わせ、食い違ったページは3回目を読んで、そろった値を採ります。
              {state.aiReady ? "" : "(AIの設定がまだのため、いまはPDFを読み取れません)"}
            </li>
            <li>就業判定: 就業制限の検討水準(R)がある方は「判定保留」、要医療(D)で受診勧奨の基準に届く方は「通常勤務可・受診が条件」、それ以外は「通常勤務可」。</li>
            <li>
              <strong>特殊健診</strong>: 作業条件・代謝物・物質ごとの判定なども読み取って取り込みます(総合判定・管理区分は健診機関のものを使います)。
              就業判定は自動では付けません。PDFは、下の設定にかかわらず、事務所が確認してから取り込みます。
            </li>
          </ul>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", background: "var(--teal-light)", borderRadius: 8, padding: "10px 14px" }}>
            <div style={{ flex: "1 1 300px", fontSize: 14 }}>
              PDFの読み取り結果の扱い: <strong>{state.pdfAuto ? "確認なしで自動で返す" : "事務所が確認してから取り込む(はじめはこちら)"}</strong>
              <div className="muted" style={{ fontSize: 12.5 }}>
                健診機関ごとの読み取りの正確さを確かめてから、自動に切り替えることをおすすめします。
              </div>
            </div>
            <button className="btn secondary" disabled={busy} onClick={() => toggle(!state.pdfAuto)}>
              {state.pdfAuto ? "確認してから取り込む形に戻す" : "確認なしで自動で返す形にする"}
            </button>
          </div>
          {err && <p className="error-message">{err}</p>}
          <p className="muted" style={{ fontSize: 12.5, marginBottom: 0 }}>
            送られたCSV・PDFの原本は、5年間保管したあと自動で消します(取り込んだ健診データは残ります)。
          </p>
        </>
      )}
    </div>
  );
}
