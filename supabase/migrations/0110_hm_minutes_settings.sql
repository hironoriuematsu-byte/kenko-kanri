-- ============================================================
-- 0110_hm_minutes_settings.sql : 議事録の企業別デフォルト設定
-- ============================================================
-- hm_company_info に議事録用の設定列を追加:
--   committee_name    : 委員会名のデフォルト(衛生委員会 / 安全衛生委員会)
--   default_attendees : デフォルトの出席者リスト(新規作成時に自動入力)
-- RLSは既存の hm_company_info のポリシー(office / company自社)をそのまま利用
-- ============================================================

alter table public.hm_company_info
  add column if not exists committee_name text,
  add column if not exists default_attendees text;
