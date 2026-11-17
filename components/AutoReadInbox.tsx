"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { CHECKUP_TYPES, CHECKUP_WORK_JUDGMENTS, roundLabel } from "@/lib/checkups";
import type { Coverage, Diff, ReadSummary, AutoJudgment } from "@/lib/autoRead";
import { ReadSummaryView } from "@/components/AutoReadRunner";

// 産業医事務所ダッシュボード: 自動の読み取り(AI)で「確認待ち」になった方を、内容を確かめて取り込む。
// 読み取りが途中で止まったファイル・読み取れなかったファイルも、ここから続き・読み直しができる

type Person = {
  name: string;
  birth: string;
  page: number | null;
  status: string;
  reasons: string[];
  clean: boolean;
  diffs: Diff[];
  diffKind: "read" | "existing" | null;
  judgment: AutoJudgment | null;
  overall: string;
  row?: { items: { name: string; value?: string; judgment?: string }[]; sex: string; checkup_date: string | null };
};
type Item = {
  id: string;
  company_id: string;
  company_name: string;
  file_name: string;
  kind: string | null;
  storage_path: string | null;
  fiscal_year: number | null;
  checkup_type: string | null;
  round: number | null;
  special_kind: string | null;
  created_at: string;
  read_status: string;
  read_error: string | null;
  read_result: { summary: ReadSummary; people: Person[]; coverage?: Coverage } | null;
  progress: { done: number; total: number } | null;
};

const judgmentLabel = (j: AutoJudgment | null) =>
  !j ? "産業医が判定" : j.judgment === "pending" ? "判定保留(産業医が確定)" : j.condition === "consult" ? "通常勤務可・受診が条件" : CHECKUP_WORK_JUDGMENTS.normal;

export default function AutoReadInbox() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, Set<number>>>({});
  const [useB, setUseB] = useState<Record<string, Record<number, Set<string>>>>({}); // 食い違いで「2回目」を採る項目

  const load = useCallback(async () => {
    const res = await fetch("/api/checkup-read?list=1").catch(() => null);
    const j = res && res.ok ? ((await res.json()) as { items?: Item[] }) : {};
    setItems(j.items ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/checkup-read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as { error?: string; status?: string; busy?: boolean };
    return { ok: res.ok, ...j };
  };

  const act = async (it: Item, action: "approve" | "skip", indexes: number[]) => {
    if (indexes.length === 0) return;
    if (action === "skip" && !window.confirm(`選んだ${indexes.length}名を取り込みません。よろしいですか？\n(あとで取り込むときは、ファイルを送り直すか、個別に入力します)`)) return;
    setBusy(it.id);
    setErr(null);
    setMsg(null);
    const choices = Object.fromEntries(Object.entries(useB[it.id] ?? {}).map(([i, set]) => [i, Array.from(set)]));
    const r = await post({ action, uploadId: it.id, indexes, choices });
    setBusy(null);
    if (!r.ok) return setErr(r.error ?? "処理できませんでした");
    if (r.error) setErr(r.error);
    else setMsg(action === "approve" ? `${it.company_name}: ${indexes.length}名を取り込み、就業判定を付けました。` : `${it.company_name}: ${indexes.length}名を取り込まないことにしました。`);
    setChecked((c) => ({ ...c, [it.id]: new Set() }));
    load();
  };

  // 読み取りの続き・読み直し(終わるまで続けて呼ぶ)
  const resume = async (it: Item, action: "run" | "retry") => {
    setBusy(it.id);
    setErr(null);
    setMsg(null);
    let a: string = action;
    for (let n = 0; n < 600; n++) {
      const r = await post({ action: a, uploadId: it.id });
      a = "run";
      if (!r.ok) {
        setErr(r.error ?? "処理できませんでした");
        break;
      }
      if (r.busy) await new Promise((res) => setTimeout(res, 6000));
      if (r.status === "done" || r.status === "review" || r.status === "failed" || (r.error && !r.busy)) break;
      load();
    }
    setBusy(null);
    load();
  };

  const openPdf = async (it: Item, page: number | null) => {
    if (!it.storage_path) return;
    const { data } = await createClient().storage.from("hm-files").createSignedUrl(it.storage_path, 300);
    if (data?.signedUrl) window.open(`${data.signedUrl}${page ? `#page=${page}` : ""}`, "_blank", "noopener");
  };

  if (!items || items.length === 0) return null;

  return (
    <div className="card" style={{ borderColor: "var(--orange)" }}>
      <h2>読み取りの確認待ち</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        自動で読み取った健診結果のうち、確認が必要な方です。内容を確かめて「取り込む」を押すと、事務所の基準で就業判定まで付きます。
      </p>
      {err && <p className="error-message" style={{ whiteSpace: "pre-wrap" }}>{err}</p>}
      {msg && <p style={{ color: "var(--teal-dark)", fontWeight: 700 }}>{msg}</p>}
      {items.map((it) => {
        const people = it.read_result?.people ?? [];
        const held = people.map((p, i) => ({ p, i })).filter(({ p }) => p.status === "hold");
        const clean = held.filter(({ p }) => p.clean);
        const sel = checked[it.id] ?? new Set<number>();
        const isOpen = open === it.id;
        const meta = `${it.fiscal_year ?? "?"}年度 ${CHECKUP_TYPES[it.checkup_type ?? ""] ?? ""}${it.special_kind ? `(${it.special_kind})` : ""}${roundLabel(it.round) ? ` ${roundLabel(it.round)}` : ""}`;
        return (
          <div key={it.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "12px 14px", marginBottom: 10, background: "#fff" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 260px" }}>
                <div style={{ fontWeight: 700, color: "var(--teal-dark)" }}>{it.company_name}</div>
                <div style={{ fontSize: 13 }}>
                  <span className={`badge${it.kind === "pdf" ? " orange" : ""}`} style={{ marginRight: 6 }}>
                    {it.kind === "pdf" ? "PDF" : "CSV"}
                  </span>
                  {it.file_name} <span className="muted">— {meta}</span>
                </div>
              </div>
              {it.read_status === "review" && (
                <>
                  <span style={{ fontSize: 14 }}>
                    確認待ち <strong>{held.length}名</strong>
                    {clean.length > 0 && clean.length < held.length && <span className="muted">(うち問題なし {clean.length}名)</span>}
                  </span>
                  {clean.length > 0 && (
                    <button className="btn orange" disabled={busy === it.id} onClick={() => act(it, "approve", clean.map(({ i }) => i))} style={{ padding: "6px 14px", fontSize: 13 }}>
                      問題のない{clean.length}名をまとめて取り込む
                    </button>
                  )}
                  <button className="btn secondary" onClick={() => setOpen(isOpen ? null : it.id)} style={{ padding: "6px 14px", fontSize: 13 }}>
                    {isOpen ? "閉じる" : "内容を見る"}
                  </button>
                </>
              )}
              {it.read_status === "reading" && (
                <>
                  <span className="muted" style={{ fontSize: 14 }}>
                    読み取りの途中{it.progress ? `(${it.progress.done} / ${it.progress.total})` : ""}
                  </span>
                  <button className="btn secondary" disabled={busy === it.id} onClick={() => resume(it, "run")} style={{ padding: "6px 14px", fontSize: 13 }}>
                    {busy === it.id ? "読み取っています…" : "続きを読み取る"}
                  </button>
                </>
              )}
              {it.read_status === "failed" && (
                <>
                  <button className="btn secondary" disabled={busy === it.id} onClick={() => resume(it, "retry")} style={{ padding: "6px 14px", fontSize: 13 }}>
                    {busy === it.id ? "読み取っています…" : "もう一度読み取る"}
                  </button>
                  {it.kind !== "pdf" && (
                    <Link className="btn secondary" href={`/office/${it.company_id}/checkups/import?upload=${it.id}`} style={{ padding: "6px 14px", fontSize: 13 }}>
                      列を指定して手で取り込む
                    </Link>
                  )}
                </>
              )}
            </div>
            {it.read_status === "failed" && <p className="error-message" style={{ margin: "8px 0 0" }}>自動では読み取れませんでした: {it.read_error}</p>}
            {it.read_status === "review" && isOpen && it.read_result && (
              <div style={{ marginTop: 12 }}>
                <ReadSummaryView summary={it.read_result.summary} role="office" coverage={it.read_result.coverage} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0 6px", alignItems: "center" }}>
                  <button className="btn" disabled={busy === it.id || sel.size === 0} onClick={() => act(it, "approve", Array.from(sel))} style={{ padding: "6px 14px", fontSize: 13 }}>
                    選んだ{sel.size}名を取り込む
                  </button>
                  <button className="btn secondary" disabled={busy === it.id || sel.size === 0} onClick={() => act(it, "skip", Array.from(sel))} style={{ padding: "6px 14px", fontSize: 13 }}>
                    選んだ方は取り込まない
                  </button>
                  {it.kind === "pdf" && it.storage_path && (
                    <button className="btn secondary" onClick={() => openPdf(it, null)} style={{ padding: "6px 14px", fontSize: 13 }}>
                      元のPDFを開く
                    </button>
                  )}
                </div>
                {held.map(({ p, i }) => {
                  const b = useB[it.id]?.[i] ?? new Set<string>();
                  const conflict = p.diffKind === "existing";
                  return (
                    <div key={i} style={{ borderTop: "1px solid var(--line)", padding: "10px 0" }}>
                      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: conflict ? "default" : "pointer" }}>
                        <input
                          type="checkbox"
                          checked={sel.has(i)}
                          onChange={(e) => {
                            const n = new Set(sel);
                            if (e.target.checked) n.add(i);
                            else n.delete(i);
                            setChecked((c) => ({ ...c, [it.id]: n }));
                          }}
                          style={{ marginTop: 4, width: "auto" }}
                        />
                        <span style={{ flex: 1 }}>
                          <strong>{p.name}</strong>
                          <span className="muted" style={{ marginLeft: 8, fontSize: 13 }}>
                            {p.birth && `${p.birth}生`} {p.page ? `・${p.page}ページ` : ""} ・総合判定 {p.overall || "—"} → {judgmentLabel(p.judgment)}
                          </span>
                          {it.kind === "pdf" && p.page && (
                            <button type="button" onClick={(e) => { e.preventDefault(); openPdf(it, p.page); }} style={{ marginLeft: 8, background: "none", border: 0, padding: 0, color: "var(--teal-dark)", textDecoration: "underline", cursor: "pointer", fontSize: 13 }}>
                              このページを開く
                            </button>
                          )}
                          <ul style={{ margin: "2px 0 0", paddingLeft: 18, fontSize: 13, color: p.clean ? "var(--teal-dark)" : "#b45415" }}>
                            {p.reasons.map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                          </ul>
                        </span>
                      </label>
                      {p.diffs.length > 0 && (
                        <div style={{ margin: "6px 0 0 26px", fontSize: 13 }}>
                          <table className="list dense" style={{ maxWidth: 560 }}>
                            <thead>
                              <tr>
                                <th>項目</th>
                                <th>{conflict ? "登録済みの値" : "1回目の読み取り"}</th>
                                <th>{conflict ? "今回のファイル" : "2回目の読み取り"}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {p.diffs.map((d) => (
                                <tr key={d.field}>
                                  <td>{d.field}</td>
                                  {conflict ? (
                                    <>
                                      <td>{d.a || "—"}</td>
                                      <td>{d.b || "—"}</td>
                                    </>
                                  ) : (
                                    (["a", "b"] as const).map((side) => (
                                      <td key={side}>
                                        <label style={{ display: "inline-flex", gap: 5, alignItems: "center", fontWeight: 400, margin: 0, cursor: "pointer" }}>
                                          <input
                                            type="radio"
                                            name={`${it.id}-${i}-${d.field}`}
                                            checked={side === "b" ? b.has(d.field) : !b.has(d.field)}
                                            onChange={() => {
                                              const n = new Set(b);
                                              if (side === "b") n.add(d.field);
                                              else n.delete(d.field);
                                              setUseB((u) => ({ ...u, [it.id]: { ...(u[it.id] ?? {}), [i]: n } }));
                                            }}
                                            style={{ width: "auto" }}
                                          />
                                          {(side === "a" ? d.a : d.b) || "(なし)"}
                                        </label>
                                      </td>
                                    ))
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div className="muted" style={{ fontSize: 12 }}>
                            {conflict
                              ? "すでに登録されている結果と値が違います。ここからは取り込めません。値を直すときは、健康診断管理の個人の画面で修正し、この方は「取り込まない」にしてください。"
                              : "元のPDFと見比べて、正しいほうを選んでから取り込んでください。"}
                          </div>
                        </div>
                      )}
                      {p.row && p.row.items.length > 0 && (
                        <details style={{ margin: "6px 0 0 26px", fontSize: 13 }}>
                          <summary style={{ cursor: "pointer", color: "var(--teal-dark)" }}>読み取った値を見る({p.row.items.length}項目)</summary>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 16px", marginTop: 4 }}>
                            {p.row.items.map((x, k) => (
                              <span key={k}>
                                {x.name}: <strong>{x.value}</strong>
                                {x.judgment && <span className="muted"> ({x.judgment})</span>}
                              </span>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
