// 健診結果を個人カルテ(hm_persons)へ突合するための共通ロジック。
// 社員番号 → 氏名+生年月日 → 氏名(一意の場合のみ) の順で本人を特定する。

export type PersonCandidate = {
  id: string;
  full_name: string;
  employee_no: string | null;
  birth_date: string | null;
  user_id: string | null;
};

const norm = (s: string | null | undefined) => (s ?? "").replace(/[\s　]/g, "").toLowerCase();

export function matchPerson(
  persons: PersonCandidate[],
  input: { name: string; employeeNo?: string | null; birthDate?: string | null }
): PersonCandidate | null {
  const name = norm(input.name);
  const empNo = norm(input.employeeNo);
  const birth = input.birthDate || null;

  // 1) 社員番号が一致する方が1人だけならその方
  if (empNo) {
    const byNo = persons.filter((p) => p.employee_no && norm(p.employee_no) === empNo);
    if (byNo.length === 1) return byNo[0];
  }

  const byName = persons.filter((p) => norm(p.full_name) === name);
  if (byName.length === 0) return null;

  // 2) 同姓同名がいる場合は生年月日で特定
  if (birth) {
    const byBirth = byName.filter((p) => p.birth_date === birth);
    if (byBirth.length === 1) return byBirth[0];
    if (byBirth.length > 1) return byBirth[0];
  }

  // 3) 同姓同名が1人だけなら氏名で特定(複数いる場合は特定しない)
  return byName.length === 1 ? byName[0] : null;
}
