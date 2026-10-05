"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { matchAccount, type EmployeeAccount } from "@/lib/accountMatch";

type PersonRow = {
  id: string;
  full_name: string;
  employee_no: string | null;
  birth_date: string | null;
  user_id: string | null;
};

// 未紐付けのカルテに、本人のログインアカウントを自動で紐付ける。
// 社員番号(一意) → 氏名+生年月日 → 氏名(同姓同名なし) で一致したものだけを紐付け、
// 迷うもの(同姓同名・生年月日の不一致)は手動に残す
export default function AutoLinkAccountsButton({
  companyId,
  unlinkedCount,
}: {
  companyId: string;
  unlinkedCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setMessage(null);
    const supabase = createClient();
    try {
      const { data: personsData, error: pErr } = await supabase
        .from("hm_persons")
        .select("id, full_name, employee_no, birth_date, user_id")
        .eq("company_id", companyId);
      if (pErr) throw pErr;
      const persons = (personsData as PersonRow[]) ?? [];

      // アカウント一覧(ストレスチェックWeb 0024 未実行なら生年月日なし)
      let accounts: EmployeeAccount[] = [];
      const withBirth = await supabase
        .from("profiles")
        .select("id, full_name, employee_no, birth_date")
        .eq("company_id", companyId)
        .eq("role", "employee");
      if (!withBirth.error) accounts = (withBirth.data as EmployeeAccount[]) ?? [];
      else {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, full_name, employee_no")
          .eq("company_id", companyId)
          .eq("role", "employee");
        if (error) throw error;
        accounts = (data as EmployeeAccount[]) ?? [];
      }
      if (accounts.length === 0) {
        setMessage("この企業の従業員アカウントが見つかりません(ストレスチェックWebに登録済みの従業員がいないか、閲覧権限がありません)。");
        setBusy(false);
        return;
      }

      // 既に他のカルテに紐付いているアカウントは候補から外す
      const used = new Set(persons.map((p) => p.user_id).filter((v): v is string => !!v));
      const free = accounts.filter((a) => !used.has(a.id));

      const counts = { employee_no: 0, birth_date: 0, name: 0 };
      let skipped = 0;
      for (const p of persons) {
        if (p.user_id) continue;
        const m = matchAccount(free, { name: p.full_name, employeeNo: p.employee_no, birthDate: p.birth_date });
        if (!m) {
          skipped += 1;
          continue;
        }
        const patch: Record<string, string> = { user_id: m.account.id };
        if (!p.birth_date && m.account.birth_date) patch.birth_date = m.account.birth_date;
        if (!p.employee_no && m.account.employee_no) patch.employee_no = m.account.employee_no;
        const { error } = await supabase.from("hm_persons").update(patch).eq("id", p.id);
        if (error) throw error;
        counts[m.by] += 1;
        // 同じアカウントを2人に付けない
        free.splice(free.indexOf(m.account), 1);
      }
      const linked = counts.employee_no + counts.birth_date + counts.name;
      if (linked > 0) {
        await supabase.rpc("hm_log_access", {
          p_action: "link_accounts",
          p_target_table: "hm_persons",
          p_target_id: null,
          p_detail: { company_id: companyId, linked, ...counts },
        });
      }
      setMessage(
        linked > 0
          ? `${linked}名のカルテにアカウントを紐付けました(社員番号 ${counts.employee_no}・氏名+生年月日 ${counts.birth_date}・氏名のみ ${counts.name})。` +
              (skipped > 0 ? `${skipped}名は一致するアカウントが無いか同姓同名のため、カルテの編集画面で手動で選んでください。` : "")
          : `自動で紐付けられるカルテはありませんでした(未紐付け ${skipped}名)。社員番号や生年月日がカルテとアカウントの両方に登録されていると一致しやすくなります。`
      );
      router.refresh();
    } catch (e) {
      setMessage(`紐付けに失敗しました: ${(e as Error).message}`);
    }
    setBusy(false);
  };

  return (
    <>
      <button type="button" className="btn secondary" onClick={run} disabled={busy || unlinkedCount === 0} title="社員番号、または氏名と生年月日が一致する本人のアカウントを自動で紐付けます">
        {busy ? "紐付け中…" : `アカウントを自動で紐付ける（未紐付け ${unlinkedCount}名）`}
      </button>
      {message && (
        <span className="muted" style={{ fontSize: 13 }}>
          {message}
        </span>
      )}
    </>
  );
}
