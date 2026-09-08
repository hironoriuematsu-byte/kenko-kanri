"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { gradeFromValue } from "@/lib/gradeFromValue";
import { isFindingJudgment, isRestrictionJudgment } from "@/lib/checkups";
import { overallGrade, worstGrade, type Grade, type JudgmentRule } from "@/lib/judgment";

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
        `・就業判定（医師の意見）は変更しません\n\n` +
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
      .select("id, sex")
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

    if (changed === 0) {
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
    for (let i = 0; i < payload.length; i += 50) {
      const { data, error: sErr } = await supabase.rpc("hm_apply_judgments", {
        p_rows: payload.slice(i, i + 50),
      });
      if (sErr) {
        setError(`保存に失敗しました: ${sErr.message}`);
        setBusy(false);
        return;
      }
      saved += Number(data ?? 0);
    }

    setMessage(`${saved}名分の判定を計算し直しました（項目 ${changed}件を更新）。`);
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
