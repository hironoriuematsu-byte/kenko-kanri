import { parseNumber, splitBloodPressure } from "@/lib/judgment";

// 血圧を2回測定した健診結果で、平均値の列が無い場合に平均を求める。
//   readings: 収縮期(または拡張期)として読み取れた各回の値
//     「142」「142/90」のどちらの表記でもよい
//   part: "sbp"(収縮期) / "dbp"(拡張期)
// 有効な値が1つも無ければ null。小数点以下は四捨五入して整数にする
export function averageBloodPressure(readings: string[], part: "sbp" | "dbp"): number | null {
  const nums: number[] = [];
  for (const raw of readings) {
    const v = (raw ?? "").trim();
    if (!v) continue;
    const bp = splitBloodPressure(v);
    if (bp.sbp != null && bp.dbp != null) {
      nums.push(part === "sbp" ? bp.sbp : bp.dbp);
      continue;
    }
    const n = parseNumber(v);
    if (n != null) nums.push(n);
  }
  if (nums.length === 0) return null;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

// 見出しが「平均」の血圧列か
export function isAverageHeader(header: string): boolean {
  return /平均|avg|mean/i.test(header.normalize("NFKC"));
}
