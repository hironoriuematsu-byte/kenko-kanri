# 健康管理Web（kenko-kanri）

うえまつ産業医事務所（Mestate LLC）の産業保健活動 統合管理システム。
稼働中の「ストレスチェックWeb」と将来同じSupabaseプロジェクトを共用します（開発中は別の無料プロジェクトを使用）。

- 技術: Next.js 14 (App Router) + Supabase (Auth / Postgres / RLS) + Vercel
- 設計原則: RLS＋最小権限 / 危険操作はSECURITY DEFINER RPC＋監査ログ / 10名未満の集計非表示 / 年度は4月始まり / セッションCookie＋20分自動ログアウト

## 開発フェーズ

| フェーズ | 内容 | 状態 |
|---|---|---|
| Phase 1 | 基盤（認証・ロール・企業共用）＋ 安全衛生委員会議事録（作成・共有・添付・印刷/PDF） | ✅ 実装済み |
| Phase 2 | 面談管理（予定・実施記録・非公開メモ・意見書PDF） | ✅ 実装済み |
| Phase 3 | 健康診断結果（CSV取込・有所見・就業判定・事後措置・経年・個人票） | ✅ 実装済み |
| Phase 4 | 統合ビュー・ダッシュボード・集計・ストレスチェック連携 | ✅ 実装済み（本番連携は移行時に0105を調整） |
| Phase 5 | 従業員カルテ（書類共有・産業医文書作成・履歴集約） | ✅ 実装済み |

## セットアップ手順（開発用・無料Supabaseプロジェクト）

### 1. 開発用Supabaseプロジェクトを作る

1. https://supabase.com にログインし「New project」で無料プロジェクトを作成
   （**既存のストレスチェックWebのプロジェクトは使わないでください**）
2. SQL Editor で次の順に実行:
   1. `supabase/dev_setup/0000_dev_base.sql` …… 開発用のみ（companies / profiles の代替を作成）
   2. `supabase/dev_setup/0001_dev_fix_recursion.sql` …… 開発用のみ（RLS修正パッチ。0000を最新版で実行した場合は不要）
   3. `supabase/dev_setup/0002_dev_stress_mock.sql` …… 開発用のみ（ストレスチェック連携モック）
   4. `supabase/migrations/0101_hm_phase1.sql` …… Phase 1 本体
   5. `supabase/migrations/0102_hm_phase2.sql` …… Phase 2 面談管理
   6. `supabase/migrations/0103_hm_phase3.sql` …… Phase 3 健康診断結果
   7. `supabase/migrations/0104_hm_checkup_bulk_delete.sql` …… 健診記録の一括削除RPC
   8. `supabase/migrations/0106_hm_phase5_karte.sql` …… Phase 5 従業員カルテ
   9. `supabase/migrations/0107_hm_company_info.sql` …… 企業補足情報（住所等）
   10. `supabase/migrations/0108_hm_interview_pre_info.sql` …… 面談の事前情報欄
   11. `supabase/migrations/0109_hm_patrols_person_link.sql` …… 産業医巡視記録・面談とカルテの連携
   12. `supabase/migrations/0110_hm_minutes_settings.sql` …… 議事録の企業別デフォルト設定
   13. `supabase/migrations/0111_hm_hygiene_patrols.sql` …… 衛生管理者巡視記録（チェックリスト）
   14. `supabase/migrations/0112_hm_hygiene_defaults.sql` …… 衛生管理者氏名のデフォルト設定
   15. `supabase/migrations/0113_hm_env_patrol_files.sql` …… 作業環境測定・巡視記録の写真添付
   16. `supabase/migrations/0114_hm_bulk_work_judgment.sql` …… 就業判定の一括入力
   17. `supabase/migrations/0116_hm_judgment_rules_2026.sql` …… 健診結果の自動判定基準（判定区分2026年4月1日改定）
       ※ `0115_hm_judgment_rules.sql` は0116に統合済み。0116のみ実行すれば足ります
3. `0000_dev_base.sql` の末尾コメントに沿って、テストユーザー（office / company）とテスト企業を作成

### 2. ローカル/Vercelの環境変数

`.env.local.example` をコピーして `.env.local` を作成し、開発用プロジェクトの
Settings > API から URL と anon key を設定:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

### 3. 起動

```
npm install
npm run dev
```

### 4. Vercelへのデプロイ（新規プロジェクト）

1. https://vercel.com で「Add New > Project」→ このGitHubリポジトリをImport
2. Environment Variables に上記2つを設定してDeploy
3. 本運用時はドメイン（例: kenko.mestate.jp）を割り当て

## 本運用への切替（重要）

1. 本番（ストレスチェックWebと共用のSupabaseプロジェクト）のSQL Editorで
   `supabase/migrations/0101〜0104, 0106〜0114, 0116` **のみ** を順に実行する
   （0115は0116に統合済みのため実行不要）
   （`dev_setup/` 配下のSQLは**絶対に実行しない**。本番にはcompanies/profilesが既にあるため）
2. `0105_hm_stress_link_template.sql` を既存テーブル（results / interview_requests / profiles）の
   実際の列名に合わせて調整し、コメントを外して実行（ストレスチェック連携の有効化）
3. Vercelの環境変数を本番プロジェクトのURL/keyに差し替えてRedeploy
4. 既存テーブル・既存ポリシー・既存関数は一切変更しない（追加のみ・読み取りのみ）

## 今後の改善候補（TODO）

- 面談予定のメール通知（Resendキー設定後に有効化。本文に健康情報を書かない原則を踏襲）
- companyロールの招待フロー（既存 /api/invite の仕組みを流用）
- ストレスチェックWebヘッダーからの相互リンク設置（ストレスチェックWeb側の変更）

## データベース方針

- 新規テーブル・関数はすべて `hm_` 接頭辞（`hm_minutes`, `hm_minute_files`, `hm_interviews`, `hm_interview_opinions`, `hm_access_logs` など）
- 面談の実施記録・産業医非公開メモは列単位GRANTで保護し、officeのみSECURITY DEFINER RPC経由で読み書き（閲覧もログに記録）
- 既存`interview_requests`（高ストレス申出）との連携は`hm_interviews.interview_request_id`で受け口のみ用意（本番スキーマ確認後に接続）
- メール通知（Resend）は未接続（本番のResendキー設定後に有効化予定）
- migrationは `0101_` からの番号付きSQLファイルで管理し、SQL Editorで手動実行
- ストレスチェックの既存テーブル（`results` 等）は読み取り専用で参照（Phase 4）
- 添付ファイルはStorageバケット `hm-files`（非公開・企業別RLS）
- 監査ログ `hm_access_logs` は削除・変更不可（閲覧はofficeのみ）

## ロール（既存 profiles.role を共用）

| ロール | 権限 |
|---|---|
| office | 産業医事務所。全企業・全機能。議事録の削除（論理削除・理由必須・ログ記録）はofficeのみ |
| company | 企業側担当者。自社の議事録の作成・閲覧・添付 |
| employee | 従業員。「従業員に公開」された自社議事録の閲覧のみ |
| jimu | 本システムは対象外（ストレスチェックWebのみ） |
