// 健診機関のCSVで、所見の有無を「1」「2」の区分番号で載せている列を、文字(所見なし・所見あり)に直す。
//
// 区分番号の向きは健診機関によって逆になる:
//   「1 = なし・2 = あり」の機関と、「1 = 所見有・2 = 所見無」の機関がある。
// 向きを決め打ちにすると、後者のCSVでは、ほぼ全員の聴力が「所見あり」になり、本当に所見のある方が「所見なし」になる。
// そこで、ファイルの中身から向きを確かめる:
//   区分番号の列のとなりに所見の文言の列(「自覚症状」と「自覚症状所見」、「心電図(所見の有無)」と「心電図(所見)」など)が
//   あれば、文言の入っている行の区分番号が「あり」の番号。
//   文言の列のない区分番号の列(聴力など)は、同じファイルで確かめられた向きに合わせる。
//   確かめられる列が1つも無いファイルは、これまでどおり(1 = なし・2 = あり)に読む。
import type { ColumnMode } from "@/lib/importRows";

const squash = (s: string) => (s ?? "").normalize("NFKC").replace(/[\s　]/g, "");
const CODED_KEYS = new Set(["symptoms", "signs", "ecg", "chest_xray", "hearing1000", "hearing4000"]);

// 区分番号の列の見出しから、所見の文言の列の見出し(の候補)を作る
function findingHeaders(h: string): string[] {
  const s = squash(h);
  const out: string[] = [];
  if (/所見の有無/.test(s)) out.push(s.replace(/所見の有無/, "所見"));
  if (/症状$/.test(s)) out.push(`${s}所見`, s.replace(/症状$/, "所見"));
  return out;
}

export type CodedResult = {
  rows: string[][];
  // 区分番号を直した列(見出し)と、その向き
  converted: { header: string; presentCode: "1" | "2" }[];
};

export function normalizeCodedColumns(header: string[], dataRows: string[][], colModes: Record<number, ColumnMode>): CodedResult {
  const cell = (r: string[], i: number) => (r[i] ?? "").normalize("NFKC").trim();
  // 値が 1・2 だけの、所見を表す法定項目の列
  const coded = header
    .map((h, i) => ({ h, i }))
    .filter(({ i }) => {
      const m = colModes[i];
      if (m?.kind !== "legal" || !CODED_KEYS.has(m.itemKey)) return false;
      const vals = dataRows.map((r) => cell(r, i)).filter((v) => v !== "");
      return vals.length > 0 && vals.every((v) => v === "1" || v === "2");
    });
  if (coded.length === 0) return { rows: dataRows, converted: [] };

  // となりの所見の文言の列から、向きを確かめる
  const companionOf = new Map<number, number>();
  const proven = new Map<number, "1" | "2">();
  for (const { h, i } of coded) {
    const wants = findingHeaders(h);
    const j = header.findIndex((x, k) => k !== i && wants.includes(squash(x)));
    if (j < 0) continue;
    companionOf.set(i, j);
    const withText = dataRows.filter((r) => cell(r, j) !== "");
    const ones = withText.filter((r) => cell(r, i) === "1").length;
    const twos = withText.filter((r) => cell(r, i) === "2").length;
    if (ones > 0 && twos === 0) proven.set(i, "1");
    else if (twos > 0 && ones === 0) proven.set(i, "2");
  }
  // ファイル全体の向き: 確かめられた列がすべて同じ向きのときだけ使う
  const dirs = new Set(proven.values());
  const fileDir = dirs.size === 1 ? Array.from(dirs)[0] : null;

  const plan = new Map<number, "1" | "2">();
  for (const { i } of coded) {
    const dir = proven.get(i) ?? (companionOf.has(i) ? null : fileDir);
    if (dir) plan.set(i, dir);
  }
  if (plan.size === 0) return { rows: dataRows, converted: [] };

  const rows = dataRows.map((r) => {
    const out = [...r];
    for (const [i, present] of Array.from(plan)) {
      const v = cell(r, i);
      if (v === "") continue;
      const key = (colModes[i] as { itemKey: string }).itemKey;
      const symptom = key === "symptoms" || key === "signs";
      if (v !== present) {
        out[i] = symptom ? "なし" : "所見なし";
        continue;
      }
      // 所見の文言がとなりの列にある方は、文言の列で判定する(区分番号の列は空にして、二重に数えない)
      const j = companionOf.get(i);
      if (!symptom && j != null && cell(r, j) !== "") out[i] = "";
      else out[i] = symptom ? "あり" : "所見あり";
    }
    return out;
  });
  return { rows, converted: Array.from(plan).map(([i, presentCode]) => ({ header: header[i].trim(), presentCode })) };
}

// 1つのファイルに複数の事業場(会社)の方が入っていないか。入っていれば、事業場ごとの人数を返す
export function workplacesIn(header: string[], dataRows: string[][]): { name: string; count: number }[] {
  const col = header.findIndex((h) => /^(事業場名|事業所名|事業場名称|事業所名称|会社名|企業名|団体名)$/.test(squash(h)));
  if (col < 0) return [];
  const counts = new Map<string, number>();
  for (const r of dataRows) {
    const v = (r[col] ?? "").trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts.size >= 2 ? Array.from(counts).map(([name, count]) => ({ name, count })) : [];
}
