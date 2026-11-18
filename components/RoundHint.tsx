"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { CHECKUP_TYPES, parseKinds, roundCaption, summarizeRounds, type RoundInfo } from "@/lib/checkups";

// 健診結果を送る・取り込む画面で、選んだ年度・種別にすでに登録されている実施回を知らせる。
// 年に2回ある健診(特定業務従事者の定期健診、有機溶剤・特定化学物質などの特殊健診)で、
// 2回目の結果を「1回目」のまま送ってしまう間違いを防ぐ
export default function RoundHint({
  companyId,
  fiscalYear,
  checkupType,
  specialKind,
  round,
}: {
  companyId: string;
  fiscalYear: number;
  checkupType: string;
  specialKind: string;
  round: number;
}) {
  const [info, setInfo] = useState<RoundInfo[] | null>(null);
  // 特殊健診は、選んだ種類の分だけを見る(いくつか選んだときはその全部。選んでいないときは、特殊健診の全部)
  const kind = checkupType === "special" ? parseKinds(specialKind).join(",") : "";

  useEffect(() => {
    let alive = true;
    setInfo(null);
    if (!companyId || !Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) return;
    // 入力の途中で何度も問い合わせないよう、少し待ってから調べる
    const timer = setTimeout(async () => {
      const supabase = createClient();
      const rows: { round: number | null; checkup_date: string | null; special_kind: string | null }[] = [];
      for (let from = 0; from < 20000; from += 1000) {
        const { data, error } = await supabase
          .from("hm_checkups")
          .select("round, checkup_date, special_kind")
          .eq("company_id", companyId)
          .eq("fiscal_year", fiscalYear)
          .eq("checkup_type", checkupType)
          .range(from, from + 999);
        if (error || !data) break;
        rows.push(...(data as typeof rows));
        if (data.length < 1000) break;
      }
      if (!alive) return;
      const kinds = parseKinds(kind);
      setInfo(summarizeRounds(checkupType === "special" && kinds.length > 0 ? rows.filter((r) => kinds.includes((r.special_kind ?? "").trim())) : rows));
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [companyId, fiscalYear, checkupType, kind]);

  if (!info || info.length === 0) return null;
  const label = `${fiscalYear}年度の${CHECKUP_TYPES[checkupType] ?? "健診"}${kind ? `（${parseKinds(kind).join("・")}）` : ""}`;
  const registered = info.map(roundCaption).join("、");
  const taken = info.some((r) => r.round === round);
  const next = Math.min(4, Math.max(...info.map((r) => r.round)) + 1);
  return (
    <div
      role="status"
      style={{
        background: taken ? "var(--orange-light)" : "var(--teal-light)",
        border: `1px solid ${taken ? "var(--orange)" : "var(--line)"}`,
        borderRadius: 8,
        padding: "8px 12px",
        margin: "0 0 12px",
        fontSize: 14,
      }}
    >
      {label}は、<strong>{registered}</strong>がすでに登録されています。
      {taken ? (
        <>
          <br />
          今回が<strong>別の回の健診（半年後の健診など）</strong>なら、実施回を「{next}回目」に変えてください。同じ回の追加（受けそびれた方・項目の追加）なら、このままで大丈夫です。
        </>
      ) : (
        <> 今回は第{round}回として登録されます。</>
      )}
    </div>
  );
}
