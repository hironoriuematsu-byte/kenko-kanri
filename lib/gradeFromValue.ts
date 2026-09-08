import {
  findLegalItemByHeader,
  judgeItem,
  splitBloodPressure,
  worstGrade,
  type Grade,
  type JudgmentRule,
} from "@/lib/judgment";

// 項目名と測定値から、事務所の判定基準で判定する。
// 健診機関の判定が入っていない項目を補うためと、就業制限の検討水準(R)を
// 測定値から確かめるために使う。
export function gradeFromValue(
  itemName: string,
  value: string | null,
  sex: "male" | "female" | null,
  rules: JudgmentRule[]
): Grade | null {
  if (!value || rules.length === 0) return null;
  const key = findLegalItemByHeader(itemName);
  if (!key) return null;
  // 「142/90」形式の血圧は収縮期・拡張期に分けて判定する
  if (key === "sbp" || key === "dbp") {
    const bp = splitBloodPressure(value);
    if (bp.sbp != null && bp.dbp != null) {
      return worstGrade([
        judgeItem("sbp", String(bp.sbp), sex, rules),
        judgeItem("dbp", String(bp.dbp), sex, rules),
      ]);
    }
  }
  return judgeItem(key, value, sex, rules);
}
