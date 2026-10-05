// 従業員カルテ(hm_persons)と本人のログインアカウント(profiles)を突合する共通ロジック。
// ストレスチェックWebの自己登録で本人が入力した「社員番号」「生年月日」を手がかりに、
//   社員番号(一意) → 氏名+生年月日 → 氏名(一意で、生年月日が矛盾しない場合のみ)
// の順で紐付ける。氏名だけの一致で同姓同名がいる場合は紐付けない。

export type EmployeeAccount = {
  id: string; // profiles.id(= user_id)
  full_name: string | null;
  employee_no: string | null;
  birth_date?: string | null; // ストレスチェックWeb 0024 未実行の環境では undefined
};

export type AccountMatch = {
  account: EmployeeAccount;
  by: "employee_no" | "birth_date" | "name";
};

export const MATCH_LABEL: Record<AccountMatch["by"], string> = {
  employee_no: "社員番号が一致",
  birth_date: "氏名と生年月日が一致",
  name: "氏名が一致(同姓同名なし)",
};

const norm = (s: string | null | undefined) => (s ?? "").replace(/[\s　]/g, "").toLowerCase();

export function matchAccount(
  accounts: EmployeeAccount[],
  input: { name: string; employeeNo?: string | null; birthDate?: string | null }
): AccountMatch | null {
  const name = norm(input.name);
  const empNo = norm(input.employeeNo);
  const birth = input.birthDate || null;

  // 1) 社員番号が一致するアカウントが1つだけならそれ
  if (empNo) {
    const byNo = accounts.filter((a) => a.employee_no && norm(a.employee_no) === empNo);
    if (byNo.length === 1) return { account: byNo[0], by: "employee_no" };
  }
  if (!name) return null;

  const byName = accounts.filter((a) => norm(a.full_name) === name);
  if (byName.length === 0) return null;

  // 2) 氏名+生年月日
  if (birth) {
    const byBirth = byName.filter((a) => a.birth_date === birth);
    if (byBirth.length === 1) return { account: byBirth[0], by: "birth_date" };
    if (byBirth.length > 1) return null; // 同姓同名・同じ生年月日は手で選ぶ
  }

  // 3) 氏名が一意で、生年月日が矛盾しない(どちらかが未登録なら矛盾なしとみなす)
  if (byName.length === 1) {
    const a = byName[0];
    if (birth && a.birth_date && a.birth_date !== birth) return null;
    return { account: a, by: "name" };
  }
  return null;
}

// 一覧・選択欄に出す表示名: 氏名(社員番号・生年月日)
export function accountLabel(a: EmployeeAccount): string {
  const extra = [a.employee_no ? `社員番号 ${a.employee_no}` : null, a.birth_date ? a.birth_date.replace(/-/g, "/") : null]
    .filter(Boolean)
    .join("・");
  return `${a.full_name ?? a.id}${extra ? `（${extra}）` : ""}`;
}
