// 紹介用デモの注意書き(印刷・PDFには出力されない)
export default function DemoNotice() {
  return (
    <div className="notice no-print" style={{ marginBottom: 14 }}>
      <strong>サンプル(デモ)</strong>: 架空企業「モデル株式会社」の作成データによる表示例です。
      実在の企業・個人とは一切関係がなく、実際の健康情報データベースには保存されていません。
      このデモでは閲覧のみでき、登録・保存・ダウンロードはできません。
    </div>
  );
}
