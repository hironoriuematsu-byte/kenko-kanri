-- ============================================================
-- 0112_hm_hygiene_defaults.sql : 衛生管理者氏名のデフォルト設定
-- ============================================================
-- hm_company_info に衛生管理者巡視記録用のデフォルト巡視者名を追加。
-- RLSは既存の hm_company_info のポリシー(office / company自社)をそのまま利用
-- ============================================================

alter table public.hm_company_info
  add column if not exists default_inspector_name text;
