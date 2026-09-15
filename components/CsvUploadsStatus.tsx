"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { CHECKUP_TYPES, roundLabel } from "@/lib/checkups";

type Row = {
  id: string;
  file_name: string;
  row_count: number;
  fiscal_year: number | null;
  checkup_type: string | null;
  round: number;
  status: string;
  created_at: string;
  finished_at: string | null;
};

const STATUS: Record<string, string> = {
  pending: "産業医事務所で取込待ち",
  imported: "取込済み",
  discarded: "取り込まずに終了",
};

// 健診一覧: 送ったCSVの状況(事業者担当者は自社分。実施者も同じものを見る)
export default function CsvUploadsStatus({ companyId }: { companyId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .rpc("hm_csv_uploads_for_company", { p_company_id: companyId })
      .then(({ data, error }) => setRows(error ? [] : ((data ?? []) as Row[])));
  }, [companyId]);

  const pending = (rows ?? []).filter((r) => r.status === "pending");
  if (!rows || pending.length === 0) return null;

  const fmt = (ts: string) => {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  };

  return (
    <div
      className="card"
      style={{ background: "var(--orange-light)", borderColor: "var(--orange)", padding: "10px 16px" }}
    >
      <strong style={{ fontSize: 14 }}>送信済みのCSV（産業医事務所で取込待ち {pending.length}件）</strong>
      <ul style={{ margin: "6px 0 0", paddingLeft: 20, fontSize: 13 }}>
        {pending.map((r) => (
          <li key={r.id}>
            {fmt(r.created_at)} {r.file_name}（{r.row_count}名分）
            {r.fiscal_year ? ` ${r.fiscal_year}年度` : ""}
            {roundLabel(r.round) ? `・${roundLabel(r.round)}` : ""}
            {r.checkup_type ? ` ${CHECKUP_TYPES[r.checkup_type] ?? r.checkup_type}` : ""}
            <span className="muted">（{STATUS[r.status] ?? r.status}）</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
