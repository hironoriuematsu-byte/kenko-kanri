// Supabase Storageのオブジェクトキーは日本語等を含められないため、
// 保存名は英数字のみで生成する。元のファイル名はDBの file_name 列に保持し、
// ダウンロード時に signed URL の download オプションで復元する。
export function makeStorageFileName(originalName: string): string {
  const extMatch = originalName.match(/\.([A-Za-z0-9]{1,10})$/);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : "";
  const rand = Math.random().toString(36).slice(2, 8);
  return `${Date.now()}_${rand}${ext}`;
}
