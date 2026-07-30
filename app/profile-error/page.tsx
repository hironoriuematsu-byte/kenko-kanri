import LogoutButton from "@/components/LogoutButton";

export const dynamic = "force-dynamic";

// ログインは成功したがプロフィール(profiles)が取得できない場合の案内ページ
export default function ProfileErrorPage() {
  return (
    <div className="container" style={{ maxWidth: 560, paddingTop: 60 }}>
      <div className="card">
        <h2>アカウント情報を取得できませんでした</h2>
        <p>
          ログインには成功しましたが、アカウント情報（プロフィール）の読み取りに失敗しました。
          考えられる原因:
        </p>
        <ul style={{ paddingLeft: 20 }}>
          <li>データベースの設定（SQL）が最後まで実行されていない</li>
          <li>開発用DBの場合: 修正パッチ 0001_dev_fix_recursion.sql が未実行</li>
          <li>このアカウントにプロフィールが作成されていない</li>
        </ul>
        <p className="muted">
          管理者（産業医事務所）にお問い合わせください。設定を修正した後、再度ログインしてください。
        </p>
        <LogoutButton />
      </div>
    </div>
  );
}
