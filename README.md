# 健康管理Web（kenko-kanri）

うえまつ産業医事務所（Mestate LLC）の産業保健活動 統合管理システム。
稼働中の「ストレスチェックWeb」と将来同じSupabaseプロジェクトを共用します（開発中は別の無料プロジェクトを使用）。

- 技術: Next.js 14 (App Router) + Supabase (Auth / Postgres / RLS) + Vercel
- 設計原則: RLS＋最小権限 / 危険操作はSECURITY DEFINER RPC＋監査ログ / 10名未満の集計非表示 / 年度は4月始まり / セッションCookie＋20分自動ログアウト

## 開発フェーズ

| フェーズ | 内容 | 状態 |
|---|---|---|
| Phase 1 | 基盤（認証・ロール・企業共用）＋ 安全衛生委員会議事録（作成・共有・添付・印刷/PDF） | ✅ 実装済み |
| Phase 2 | 面談管理（高ストレス申出との連携含む） | 未着手 |
| Phase 3 | 健康診断結果（CSV取込・有所見・就業判定・事後措置） | 未着手 |
| Phase 4 | 統合ビュー・ダッシュボード・集計、companyロール本格開放 | 未着手 |

## セットアップ手順（開発用・無料Supabaseプロジェクト）

### 1. 開発用Supabaseプロジェクトを作る

1. https://supabase.com にログインし「New project」で無料プロジェクトを作成
   （**既存のストレスチェックWebのプロジェクトは使わないでください**）
2. SQL Editor で次の順に実行:
   1. `supabase/dev_setup/0000_dev_base.sql` …… 開発用のみ（companies / profiles の代替を作成）
   2. `supabase/migrations/0101_hm_phase1.sql` …… Phase 1 本体
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
   `supabase/migrations/0101_*.sql` 以降 **のみ** を実行する
   （`dev_setup/0000_dev_base.sql` は**絶対に実行しない**。本番にはcompanies/profilesが既にあるため）
2. Vercelの環境変数を本番プロジェクトのURL/keyに差し替えてRedeploy
3. 既存テーブル・既存ポリシー・既存関数は一切変更しない（追加のみ）

## データベース方針

- 新規テーブル・関数はすべて `hm_` 接頭辞（`hm_minutes`, `hm_minute_files`, `hm_access_logs` など）
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
