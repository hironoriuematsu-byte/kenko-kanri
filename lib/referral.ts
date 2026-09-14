// 医師の意見に入れる「受診勧奨」の文章を作る。
//   要医療項目(D)・就業制限項目(R)の項目名をそのまま並べるのではなく、
//   異常の区分(高血圧・肝機能異常 など)と受診先(内科（消化器内科） など)に言い換える。
//   例: 「肝機能異常あり内科（消化器内科）受診」
//       「高血圧・脂質異常あり内科受診、肝機能異常あり内科（消化器内科）受診」

import { findLegalItemByHeader } from "@/lib/judgment";
import { isRestrictionJudgment, isSevereJudgment } from "@/lib/checkups";

type Category = { label: string; dept: string | ((sex: "male" | "female" | null) => string) };

// 法定項目のキー → 異常の区分と受診先
const CATEGORY_BY_KEY: Record<string, Category> = {
  chest_xray: { label: "胸部エックス線異常", dept: "内科（呼吸器内科）" },
  sbp: { label: "高血圧", dept: "内科" },
  dbp: { label: "高血圧", dept: "内科" },
  ast: { label: "肝機能異常", dept: "内科（消化器内科）" },
  alt: { label: "肝機能異常", dept: "内科（消化器内科）" },
  ggt: { label: "肝機能異常", dept: "内科（消化器内科）" },
  tg: { label: "脂質異常", dept: "内科" },
  hdl: { label: "脂質異常", dept: "内科" },
  ldl: { label: "脂質異常", dept: "内科" },
  glucose: { label: "耐糖能異常", dept: "内科" },
  casual_glucose: { label: "耐糖能異常", dept: "内科" },
  hba1c: { label: "耐糖能異常", dept: "内科" },
  urine_glucose: { label: "耐糖能異常", dept: "内科" },
  // 貧血: 女性は婦人科の要因も考えられるため受診先を分ける
  hb: { label: "貧血", dept: (sex) => (sex === "female" ? "内科（婦人科）" : "内科") },
  rbc: { label: "貧血", dept: (sex) => (sex === "female" ? "内科（婦人科）" : "内科") },
  ecg: { label: "心電図異常", dept: "内科（循環器内科）" },
  urine_protein: { label: "腎機能異常", dept: "内科（腎臓内科）" },
  cre: { label: "腎機能異常", dept: "内科（腎臓内科）" },
  vision: { label: "視力低下", dept: "眼科" },
  hearing1000: { label: "聴力低下", dept: "耳鼻咽喉科" },
  hearing4000: { label: "聴力低下", dept: "耳鼻咽喉科" },
};

// 法定項目に対応づかない項目名の補助的な判定(見出しの表記から推定)
const CATEGORY_BY_PATTERN: { pattern: RegExp; category: Category }[] = [
  { pattern: /心電図|ecg|ekg/i, category: CATEGORY_BY_KEY.ecg },
  { pattern: /胸部|エックス線|x線|ｘ線|レントゲン|胸写/i, category: CATEGORY_BY_KEY.chest_xray },
  { pattern: /血圧/, category: CATEGORY_BY_KEY.sbp },
  { pattern: /尿蛋白|尿たん白|尿タンパク|egfr|クレアチニン|腎/i, category: CATEGORY_BY_KEY.cre },
  { pattern: /尿糖|血糖|hba1c|グルコース/i, category: CATEGORY_BY_KEY.glucose },
  { pattern: /コレステロール|中性脂肪|脂質/, category: CATEGORY_BY_KEY.ldl },
  { pattern: /貧血|血色素|ヘモグロビン|赤血球|ヘマトクリット|hct/i, category: CATEGORY_BY_KEY.hb },
  { pattern: /視力/, category: CATEGORY_BY_KEY.vision },
  { pattern: /聴力/, category: CATEGORY_BY_KEY.hearing1000 },
];

function categoryOf(itemName: string): Category | null {
  const key = findLegalItemByHeader(itemName);
  if (key && CATEGORY_BY_KEY[key]) return CATEGORY_BY_KEY[key];
  for (const { pattern, category } of CATEGORY_BY_PATTERN) {
    if (pattern.test(itemName.normalize("NFKC"))) return category;
  }
  return null;
}

export type ReferralItem = { item_name: string; judgment: string | null };

// 要医療項目(D)・就業制限項目(R)から受診勧奨の文章を作る。該当が無ければ空文字。
//   同じ受診先は「・」でまとめ、受診先ごとに「、」で区切る
//   区分に当てはまらない項目は「<項目名>異常あり医療機関受診」とする
export function referralNote(items: ReferralItem[], sex: "male" | "female" | null): string {
  // 受診先 → 異常の区分(重複なし・出現順)
  const byDept = new Map<string, string[]>();
  const add = (dept: string, label: string) => {
    const labels = byDept.get(dept) ?? [];
    if (!labels.includes(label)) labels.push(label);
    byDept.set(dept, labels);
  };
  for (const it of items) {
    if (!(isSevereJudgment(it.judgment) || isRestrictionJudgment(it.judgment))) continue;
    const cat = categoryOf(it.item_name);
    if (cat) {
      add(typeof cat.dept === "function" ? cat.dept(sex) : cat.dept, cat.label);
    } else {
      add("医療機関", `${it.item_name.trim()}異常`);
    }
  }
  if (byDept.size === 0) return "";
  return Array.from(byDept.entries())
    .map(([dept, labels]) => `${labels.join("・")}あり${dept}受診`)
    .join("、");
}
