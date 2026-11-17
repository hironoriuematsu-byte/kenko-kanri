import Anthropic from "@anthropic-ai/sdk";
import { PDFDocument } from "pdf-lib";
import { LEGAL_ITEMS } from "@/lib/judgment";
import { LEGAL_KEYS, type AiMapping, type ReadPerson } from "@/lib/autoRead";

// 健診結果の自動読み取りのうち、AI(Claude)を呼ぶ部分。AIには「読み取り」だけをさせ、判定はさせない

const MODEL = "claude-opus-5-5";
export const PDF_PAGES_PER_CHUNK = 2; // 一度に読ませるページ数(一覧表は1ページに何十人も入るため、少なくする)

export const aiReady = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY);

let client: Anthropic | null = null;
function claude(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 1, timeout: 270_000 });
  return client;
}

type Json = Record<string, unknown>;
async function askJson(system: string, content: Anthropic.Beta.BetaContentBlockParam[], schema: Json, maxTokens: number): Promise<{ json: Json; truncated: boolean }> {
  const res = await claude()
    .beta.messages.stream({
      model: MODEL,
      max_tokens: maxTokens,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
    })
    .finalMessage();
  if (res.stop_reason === "refusal") throw new Error("AIが読み取れませんでした(refusal)");
  if (res.stop_reason === "max_tokens") return { json: {}, truncated: true };
  const block = res.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text");
  if (!block) throw new Error("AIの応答が空でした");
  return { json: JSON.parse(block.text) as Json, truncated: false };
}

const ITEM_GUIDE = LEGAL_ITEMS.map((it) => `${it.key}: ${it.label.replace(/[（(].*$/, "")}${it.aliases.length ? `(${it.aliases.slice(0, 4).join("・")})` : ""}`).join("\n");

// ---- CSV: 見出しから自動で決まらなかった列を、AIに割り当てさせる ----
const MAP_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "integer", description: "氏名(漢字)の列の番号。なければ -1" },
    kana: { type: "integer", description: "フリガナの列。なければ -1" },
    dept: { type: "integer", description: "所属・部署の列。なければ -1" },
    emp_no: { type: "integer", description: "社員番号の列。なければ -1" },
    sex: { type: "integer", description: "性別の列。なければ -1" },
    birth: { type: "integer", description: "生年月日の列。なければ -1" },
    date: { type: "integer", description: "健診を受けた日の列。なければ -1" },
    overall: { type: "integer", description: "総合判定の列。なければ -1" },
    items: {
      type: "array",
      description: "検査値・所見が入っている列と、対応する検査項目",
      items: {
        type: "object",
        properties: { col: { type: "integer" }, key: { type: "string", enum: LEGAL_KEYS } },
        required: ["col", "key"],
        additionalProperties: false,
      },
    },
  },
  required: ["name", "kana", "dept", "emp_no", "sex", "birth", "date", "overall", "items"],
  additionalProperties: false,
} as const;

// 氏名の列と分かっているものは、中身をAIに送らない
export async function mapCsvColumns(header: string[], samples: string[][], maskCols: number[]): Promise<AiMapping> {
  const lines = header.map((h, i) => {
    const vals = maskCols.includes(i) ? ["(氏名)"] : samples.map((r) => (r[i] ?? "").trim().slice(0, 24)).filter(Boolean).slice(0, 3);
    return `${i}: 「${h.trim()}」 例: ${vals.join(" / ") || "(空)"}`;
  });
  const system = [
    "あなたは、健診機関が出した健康診断結果のCSVの「どの列が何の項目か」を見分ける係です。",
    "列の番号(0から)・見出し・値の例が与えられます。次の検査項目に当たる列を挙げてください。",
    "",
    "検査項目(key: 名前):",
    ITEM_GUIDE,
    "",
    "決まり:",
    "- 検査値や所見の文言が入っている列だけを挙げる。「判定」「指導区分」だけが入っている列は挙げない。",
    "- non-HDL、LDL/HDL比、尿沈渣、肝炎ウイルス検査など、上の一覧にない項目は挙げない。",
    "- 自信がない列は挙げない(-1 にする・一覧に入れない)。推測で埋めない。",
  ].join("\n");
  const { json } = await askJson(system, [{ type: "text", text: lines.join("\n") }], MAP_SCHEMA as unknown as Json, 4000);
  return json as unknown as AiMapping;
}

// ---- PDF: 人ごとに、検査値と所見の文言を書き出させる ----
const READ_SCHEMA = {
  type: "object",
  properties: {
    persons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "氏名(用紙の表記のまま)" },
          kana: { type: "string", description: "フリガナ。なければ空" },
          birth: { type: "string", description: "生年月日(用紙の表記のまま)。なければ空" },
          sex: { type: "string", description: "男 / 女。なければ空" },
          emp_no: { type: "string", description: "社員番号。なければ空" },
          dept: { type: "string", description: "所属・部署。なければ空" },
          date: { type: "string", description: "健診を受けた日(用紙の表記のまま)。なければ空" },
          overall: { type: "string", description: "健診機関の総合判定(A・B・C・要精密検査 など)。なければ空" },
          page: { type: "integer", description: "その方の結果が最初に出てくるページ(このファイルの1ページ目を1とする)" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                k: { type: "string", enum: LEGAL_KEYS, description: "検査項目" },
                v: { type: "string", description: "値、または所見の文言(用紙の表記のまま)" },
                l: { type: "string", description: "同じ項目を2回以上測っているときだけ、用紙の項目名(例: 収縮期血圧1回目)。それ以外は空" },
              },
              required: ["k", "v", "l"],
              additionalProperties: false,
            },
          },
        },
        required: ["name", "kana", "birth", "sex", "emp_no", "dept", "date", "overall", "page", "items"],
        additionalProperties: false,
      },
    },
  },
  required: ["persons"],
  additionalProperties: false,
} as const;

const READ_SYSTEM = [
  "あなたは、健康診断の結果(個人票、または何人分かが並んだ一覧表)のPDFを読み取り、人ごとに検査値を書き出す係です。",
  "判定はしません。用紙に書いてある値と所見の文言を、そのまま写します。",
  "",
  "書き出す検査項目(key: 名前):",
  ITEM_GUIDE,
  "",
  "決まり:",
  "- 上の一覧にある項目だけを書き出す。一覧にない項目(尿沈渣、肝炎ウイルス、non-HDL、腹囲、BMI など)は書き出さない。",
  "- 数値は用紙のとおりに写す(単位は付けない)。「142/90」のように1つの欄に書かれた血圧は、sbp に「142/90」とそのまま入れる。",
  "- 心電図・胸部エックス線・自覚症状・他覚症状は、所見の文言をそのまま写す(「異常なし」「所見なし」もそのまま)。",
  "- 尿糖・尿蛋白は「-」「±」「+」「2+」などの表記をそのまま写す。",
  "- 同じ項目を2回測っている(血圧の1回目・2回目など)ときは、それぞれを別の行にして、l に用紙の項目名を入れる。平均の欄があればそれも別の行にする。",
  "- 読めない・書かれていない項目は、書き出さない。推測で埋めない。前年の値や基準値の欄を、今回の値と取り違えない。",
  "- 1人の結果が2ページにまたがるときは、1人にまとめる。同じ人を2回書き出さない。",
  "- 氏名・生年月日・健診日は、用紙の表記のまま写す(和暦もそのまま)。",
  "- 表紙・案内文・白紙など、検査結果のないページからは何も書き出さない。",
].join("\n");

// PDFの一部(base64)を読む。pageOffset は、元のPDFでの先頭ページ番号-1(ページ番号を元のPDFに合わせる)
export async function readPdfPart(pdfBase64: string, pageOffset: number): Promise<{ persons: ReadPerson[]; truncated: boolean }> {
  const { json, truncated } = await askJson(
    READ_SYSTEM,
    [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
      { type: "text", text: "このPDFに載っている方の健康診断の結果を、人ごとに書き出してください。" },
    ],
    READ_SCHEMA as unknown as Json,
    30000
  );
  if (truncated) return { persons: [], truncated: true };
  const raw = Array.isArray((json as { persons?: unknown }).persons) ? ((json as { persons: unknown[] }).persons as Json[]) : [];
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const persons: ReadPerson[] = raw
    .map((p) => ({
      name: s(p.name),
      kana: s(p.kana),
      birth: s(p.birth),
      sex: s(p.sex),
      emp_no: s(p.emp_no),
      dept: s(p.dept),
      date: s(p.date),
      overall: s(p.overall),
      page: (Number.isInteger(p.page) ? (p.page as number) : 1) + pageOffset,
      items: (Array.isArray(p.items) ? (p.items as Json[]) : [])
        .map((it) => ({ k: s(it.k), v: s(it.v), l: s(it.l) || undefined }))
        .filter((it) => LEGAL_KEYS.includes(it.k) && it.v !== ""),
    }))
    .filter((p) => p.name !== "");
  return { persons, truncated: false };
}

// ---- PDFの分割 ----
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}
// from〜to ページ(1から、両端を含む)だけのPDFを作って base64 で返す
export async function pdfSlice(bytes: Uint8Array, from: number, to: number): Promise<string> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const idx = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  (await out.copyPages(src, idx)).forEach((p) => out.addPage(p));
  return Buffer.from(await out.save()).toString("base64");
}
