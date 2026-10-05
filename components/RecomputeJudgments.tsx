"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { gradeFromValue } from "@/lib/gradeFromValue";
import { isFindingJudgment, isRestrictionJudgment } from "@/lib/checkups";
import { overallGrade, worstGrade, type Grade, type JudgmentRule } from "@/lib/judgment";
import { referralNote } from "@/lib/referral";

// 医師の意見のうち、一括判定で自動で入れた受診勧奨の文章(例: 「肝機能異常あり内科（消化器内科）受診、脂質異常あり内科受診」)
// を見分ける。定型文・自由記入とは " / " で区切られている
const isReferralSegment = (seg: string) => /あり.+受診$/.test(seg.trim());

// 判定を計算し直したあと、医師の意見の受診勧奨の文章を新しい要医療項目(D)・就業制限項目(R)に合わせる。
// 自動で入れた文章だけを差し替え、定型文や自由記入は触らない。戻り値は新しい意見(変更がなければ null)
export function reconcileReferralNote(note: string | null, newReferral: string): string | null {
  if (!note) return null;
  const segs = note.split("/").map((x) => x.trim()).filter(Boolean);
  const idx = segs.findIndex(isReferralSegment);
  if (idx < 0) return null; // 自動の文章が無い(手入力のみ)なら触らない
  if (segs[idx] === newReferral) return null;
  const next = [...segs];
  if (newReferral) next[idx] = newReferral;
  else next.splice(idx, 1);
  return next.join(" / ");
}

type ItemRow = {
  id: string;
  checkup_id: string;
  item_name: string;
  value: string | null;
  judgment: string | null;
};

// 取り込み済みの健診結果の判定を、いまの判定基準で計算し直して保存する。
// 判定基準を変えたときや、取込時の判定に誤りが見つかったときに使う。
export default function RecomputeJudgments({
  companyId,
  fiscalYear,
  rules,
}: {
  companyId: string;
  fiscalYear: number;
  rules: JudgmentRule[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    const ok = window.confirm(
      `${fiscalYear}年度の健診結果について、法定項目の判定を「判定基準の設定」に従って計算し直します。\n\n` +
        `・対象は測定値がある法定項目です（健診機関の判定は上書きされます）\n` +
        `・法定項目以外の判定はそのまま残ります\n` +
        `・総合判定と有所見も計算し直します\n` +
        `・就業判定は変更しません（総合判定がDに上がった方の「通常勤務可」は判定保留に戻します）\n` +
        `・医師の意見のうち自動で入れた受診勧奨の文章（例: 肝機能異常あり内科（消化器内科）受診）は新しい判定に合わせます\n\n` +
        `よろしいですか？`
    );
    if (!ok) return;

    setBusy(true);
    setError(null);
    setMessage(null);
    const supabase = createClient();

    // 対象の健診結果(性別は判定に使う)
    const { data: checkups, error: cErr } = await supabase
      .from("hm_checkups")
      .select("id, sex, work_judgment_note")
      .eq("company_id", companyId)
      .eq("fiscal_year", fiscalYear);
    if (cErr || !checkups || checkups.length === 0) {
      setError(cErr ? `取得に失敗しました: ${cErr.message}` : "対象の健診結果がありません。");
      setBusy(false);
      return;
    }
    const sexById = new Map<string, "male" | "female" | null>(
      checkups.map((c) => [c.id, (c.sex as "male" | "female" | null) ?? null])
    );

    // 検査項目(1回の取得件数に上限があるため分割して取得する)
    const ids = checkups.map((c) => c.id);
    const items: ItemRow[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      for (let from = 0; ; from += 1000) {
        const { data, error: iErr } = await supabase
          .from("hm_checkup_items")
          .select("id, checkup_id, item_name, value, judgment")
          .in("checkup_id", chunk)
          .order("checkup_id")
          .order("sort_order")
          .range(from, from + 999);
        if (iErr) {
          setError(`検査項目の取得に失敗しました: ${iErr.message}`);
          setBusy(false);
          return;
        }
        if (!data || data.length === 0) break;
        items.push(...(data as ItemRow[]));
        if (data.length < 1000) break;
      }
    }

    // 判定を計算する
    const byCheckup = new Map<string, { id: string; judgment: string | null }[]>();
    const gradesByCheckup = new Map<string, Grade[]>();
    let changed = 0;
    for (const it of items) {
      const g = gradeFromValue(it.item_name, it.value, sexById.get(it.checkup_id) ?? null, rules);
      if (!g) continue; // 法定項目以外・測定値なしはそのまま
      gradesByCheckup.set(it.checkup_id, [...(gradesByCheckup.get(it.checkup_id) ?? []), g]);
      if (g === it.judgment) continue;
      changed += 1;
      byCheckup.set(it.checkup_id, [
        ...(byCheckup.get(it.checkup_id) ?? []),
        { id: it.id, judgment: g },
      ]);
    }

    // 医師の意見の受診勧奨の文章を、新しい判定(D・R)に合わせる(自動で入れた文章だけ)。
    // 判定に変更が無くても、以前の再計算で判定だけ変わって意見が古いままの方を直す
    const newJudgmentById = new Map<string, string | null>();
    byCheckup.forEach((list) => list.forEach((it) => newJudgmentById.set(it.id, it.judgment)));
    const noteUpdates: { id: string; note: string }[] = [];
    for (const c of checkups as { id: string; sex: string | null; work_judgment_note: string | null }[]) {
      if (!c.work_judgment_note) continue;
      const its = items
        .filter((it) => it.checkup_id === c.id)
        .map((it) => ({ item_name: it.item_name, value: it.value, judgment: newJudgmentById.get(it.id) ?? it.judgment }));
      const next = reconcileReferralNote(c.work_judgment_note, referralNote(its, sexById.get(c.id) ?? null));
      if (next !== null) noteUpdates.push({ id: c.id, note: next });
    }

    if (changed === 0 && noteUpdates.length === 0) {
      setMessage("判定基準どおりでした（変更はありません）。");
      setBusy(false);
      return;
    }

    // 保存する形に組み立てる(総合判定・有所見も入れ直す)
    const payload = Array.from(byCheckup.keys()).map((checkupId) => {
      const grades = gradesByCheckup.get(checkupId) ?? [];
      const worst = overallGrade(worstGrade(grades));
      const hasFindings = grades.some((g) => isFindingJudgment(g) || isRestrictionJudgment(g));
      return {
        checkup_id: checkupId,
        overall_judgment: worst ?? "",
        has_findings: hasFindings,
        items: byCheckup.get(checkupId) ?? [],
      };
    });

    // 1回の送信が大きくなりすぎないよう分けて送る
    let saved = 0;
    let resetPending = 0; // 再計算で D に上がり、就業判定を「判定保留」に戻した方(0144)
    for (let i = 0; i < payload.length; i += 50) {
      const { data, error: sErr } = await supabase.rpc("hm_apply_judgments", {
        p_rows: payload.slice(i, i + 50),
      });
      if (sErr) {
        setError(`保存に失敗しました: ${sErr.message}`);
        setBusy(false);
        return;
      }
      // 0144 以降は {count, reset_pending}、それ以前は人数だけが返る
      if (data && typeof data === "object") {
        const r = data as { count?: number; reset_pending?: number };
        saved += Number(r.count ?? 0);
        resetPending += Number(r.reset_pending ?? 0);
      } else {
        saved += Number(data ?? 0);
      }
    }

    // 医師の意見の受診勧奨の文章を更新する
    let notesUpdated = 0;
    for (const u of noteUpdates) {
      const { error: nErr } = await supabase.rpc("hm_save_work_judgment_note", { p_id: u.id, p_note: u.note });
      if (!nErr) notesUpdated += 1;
    }

    setMessage(
      `${saved}名分の判定を計算し直しました（項目 ${changed}件を更新）。` +
        (notesUpdated > 0 ? ` 医師の意見の受診勧奨の文章を ${notesUpdated}名分、新しい判定に合わせました。` : "") +
        (resetPending > 0
          ? ` 総合判定がDに上がった ${resetPending}名の就業判定を「判定保留」に戻しました。一覧の「要対応」からご確認のうえ、再判定と医師の意見の入力をお願いします。`
          : "")
    );
    setBusy(false);
    router.refresh();
  };

  return (
    <span>
      <button className="btn secondary" onClick={run} disabled={busy} style={{ fontSize: 13 }}>
        {busy ? "計算中…" : "判定を再計算（事務所基準）"}
      </button>
      {error && <p className="error-message">{error}</p>}
      {message && <p style={{ color: "var(--teal-dark)", fontSize: 13 }}>{message}</p>}
    </span>
  );
}
