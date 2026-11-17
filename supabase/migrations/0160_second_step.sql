-- ============================================================
-- 0160_second_step.sql : 二段階認証(メールの確認コード + この端末を30日間覚える)
-- ============================================================
-- ★ ストレスチェックWebの 0035_second_step.sql と同じ内容(データベースが共通のため)。
--   どちらか一方を実行すればよい(両方実行しても問題ない)
-- ストレスチェックWeb と 健康管理Web は同じデータベースを使っているため、このSQLは両方に効く。
--
-- 対象:
--   ・産業医事務所(office)                         … スイッチ「office」
--   ・実施事務従事者(jimu)・会社の担当者(company)・
--     健康管理Webの担当を兼ねる方(hm_company_access)  … スイッチ「staff」
--   ・従業員(メールのない ID・合言葉の方を含む)は対象外
--
-- しくみ:
--   ・パスワードでログインしただけでは、対象の方は「権限のない状態」になる。
--     メールに届く確認コードを入力する(または、30日以内に覚えた端末から入る)と、そのログインが「確認済み」になる
--   ・確認が済んでいないログインでは、データベースが何も返さない
--       - すべての表に「確認済みであること」の制限(restrictive policy)を付ける
--       - 権限を調べる関数(my_role / my_company / my_attested / hm_my_role / hm_my_company / hm_is_office)が
--         権限なしを返す(関数経由の操作も止まる)
--     画面を通さずにデータベースへ直接つないでも、同じように止まる
--   ・確認コード・確認済みの記録・覚えた端末の表には、アプリのサーバー(service_role)だけが触れる
--
-- ★ このSQLを実行しただけでは、何も変わらない(スイッチは最初はオフ)。
--   有効にするのは、アプリ側の準備ができてから(事務所の画面の「二段階認証」から。下の「切り替え」も参照)
--
-- 切り替え(SQL Editor から。画面に入れなくなったときの緊急停止にも使う):
--   有効にする(事務所):  select public.second_step_enable('office', true);
--   有効にする(担当者):  select public.second_step_enable('staff', true);
--   緊急停止(すべて):    select public.second_step_enable('office', false); select public.second_step_enable('staff', false);
--
-- 新しい表を追加したときは、最後に  select public.second_step_apply_policies();  を実行する(制限を付け直す)
-- 実行方法: Supabase SQL Editor に全文を貼り付けて Run。再実行しても問題ない
-- ============================================================

-- ------------------------------------------------------------
-- 1. 表(アプリのサーバーだけが使う。利用者からは見えない)
-- ------------------------------------------------------------
create table if not exists public.login_security_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.login_security_settings (key, value)
values ('second_step', '{"office": false, "staff": false}'::jsonb)
on conflict (key) do nothing;

-- 確認コード(1人につき1つ。中身そのものは保存せず、照合用の値だけを持つ)
create table if not exists public.login_codes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  sent_at timestamptz not null default now(),
  window_start timestamptz not null default now(),
  sent_count int not null default 1
);

-- 確認が済んだログイン(セッション)
create table if not exists public.login_verified_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  method text not null check (method in ('code', 'device')),
  verified_at timestamptz not null default now()
);
create index if not exists login_verified_sessions_user_idx on public.login_verified_sessions (user_id);

-- 覚えた端末(30日間)。端末に渡した印そのものは保存せず、照合用の値だけを持つ
create table if not exists public.login_trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz not null
);
create index if not exists login_trusted_devices_user_idx on public.login_trusted_devices (user_id);

-- 記録(確認コードの送信・成功・失敗、端末の記憶、設定の変更)
create table if not exists public.login_security_events (
  id bigint generated always as identity primary key,
  user_id uuid,
  event text not null,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists login_security_events_user_idx on public.login_security_events (user_id, created_at desc);

alter table public.login_security_settings enable row level security;
alter table public.login_codes enable row level security;
alter table public.login_verified_sessions enable row level security;
alter table public.login_trusted_devices enable row level security;
alter table public.login_security_events enable row level security;
revoke all on public.login_security_settings, public.login_codes, public.login_verified_sessions,
              public.login_trusted_devices, public.login_security_events from anon, authenticated;

-- ------------------------------------------------------------
-- 2. 対象かどうか・確認が済んでいるか
-- ------------------------------------------------------------
-- その方が二段階認証の対象か(スイッチがオンの区分に当たるか)
create or replace function public.second_step_required(p_user uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce((
    select case
             when p.role = 'office' then coalesce((s.value ->> 'office')::boolean, false)
             when p.role in ('jimu', 'company') or coalesce((to_jsonb(p) ->> 'hm_company_access')::boolean, false)
               then coalesce((s.value ->> 'staff')::boolean, false)
             else false
           end
      from public.profiles p
      left join public.login_security_settings s on s.key = 'second_step'
     where p.user_id = p_user
  ), false)
$$;
revoke all on function public.second_step_required(uuid) from public, anon, authenticated;

-- いまのログインで、権限を使ってよいか。
--   対象でない方(従業員など)は常に true。対象の方は、このログイン(セッション)が30日以内に確認済みなら true。
--   1回の問い合わせの中で何度も呼ばれるので、結果をその問い合わせの間だけ覚えておく
create or replace function public.second_step_ok()
returns boolean
language plpgsql stable security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sid text := coalesce(auth.jwt() ->> 'session_id', '');
  v_key text;
  v_cached text;
  v_ok boolean;
begin
  if v_uid is null then
    return true;
  end if;
  v_key := v_uid::text || '|' || v_sid || '|';
  v_cached := current_setting('app.second_step', true);
  if v_cached = v_key || 't' then
    return true;
  elsif v_cached = v_key || 'f' then
    return false;
  end if;
  if not public.second_step_required(v_uid) then
    v_ok := true;
  else
    v_ok := v_sid ~ '^[0-9a-fA-F-]{36}$' and exists (
      select 1 from public.login_verified_sessions s
       where s.session_id = v_sid::uuid and s.user_id = v_uid
         and s.verified_at > now() - interval '30 days'
    );
  end if;
  perform set_config('app.second_step', v_key || case when v_ok then 't' else 'f' end, true);
  return v_ok;
end;
$$;
revoke all on function public.second_step_ok() from public, anon;
grant execute on function public.second_step_ok() to authenticated, service_role;

-- 画面の誘導用: 自分が対象か・このログインは確認済みか
create or replace function public.second_step_status()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'required', auth.uid() is not null and public.second_step_required(auth.uid()),
    'verified', public.second_step_ok()
  )
$$;
revoke all on function public.second_step_status() from public, anon;
grant execute on function public.second_step_status() to authenticated, service_role;

-- ------------------------------------------------------------
-- 3. 権限を調べる関数: 確認が済んでいないログインでは、権限なしを返す
--    (中身は今までと同じ。最後の条件だけを足している)
-- ------------------------------------------------------------
do $$
begin
  -- ストレスチェックWeb
  if to_regprocedure('public.my_role()') is not null then
    execute $f$
      create or replace function public.my_role() returns text
      language sql stable security definer set search_path = public as
      $b$ select role from profiles where user_id = auth.uid() and public.second_step_ok() $b$
    $f$;
    execute $f$
      create or replace function public.my_company() returns uuid
      language sql stable security definer set search_path = public as
      $b$ select company_id from profiles where user_id = auth.uid() and public.second_step_ok() $b$
    $f$;
    execute $f$
      create or replace function public.my_attested() returns boolean
      language sql stable security definer set search_path = public as
      $b$ select coalesce(no_personnel_authority, false)
            from profiles where user_id = auth.uid() and public.second_step_ok() $b$
    $f$;
  end if;

  -- 健康管理Web
  if to_regprocedure('public.hm_my_role()') is not null then
    execute $f$
      create or replace function public.hm_my_role() returns text
      language sql stable security definer set search_path = public as
      $b$
        select case
                 when coalesce(hm_company_access, false) and role in ('employee', 'jimu')
                   then 'company'
                 else role
               end
          from public.profiles
         where id = auth.uid() and public.second_step_ok()
      $b$
    $f$;
    execute $f$
      create or replace function public.hm_my_company() returns uuid
      language sql stable security definer set search_path = public as
      $b$ select company_id from public.profiles where id = auth.uid() and public.second_step_ok() $b$
    $f$;
    execute $f$
      create or replace function public.hm_is_office() returns boolean
      language sql stable security definer set search_path = public as
      $b$
        select exists (
          select 1 from public.profiles
           where id = auth.uid() and role = 'office' and public.second_step_ok()
        )
      $b$
    $f$;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. すべての表に「確認済みであること」の制限を付ける
--    (今ある許可の条件に、この条件が AND で加わる。対象でない方には影響しない)
-- ------------------------------------------------------------
create or replace function public.second_step_apply_policies()
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.oid::regclass as tbl, c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
       and c.relname not like 'login\_%'
  loop
    -- 1つの表で失敗しても、ほかの表は続ける(付けられなかった表は、最後の「適用状況」に数が出る)
    begin
      execute format('drop policy if exists second_step on %s', r.tbl);
      execute format(
        'create policy second_step on %s as restrictive for all to authenticated '
        || 'using ((select public.second_step_ok())) with check ((select public.second_step_ok()))', r.tbl);
      n := n + 1;
    exception when others then
      raise notice '% には制限を付けられませんでした: %', r.tbl, sqlerrm;
    end;
  end loop;
  -- 保存したファイル(健診結果のPDFなど)
  begin
    execute 'drop policy if exists second_step on storage.objects';
    execute 'create policy second_step on storage.objects as restrictive for all to authenticated '
         || 'using ((select public.second_step_ok())) with check ((select public.second_step_ok()))';
    n := n + 1;
  exception when others then
    raise notice 'storage.objects には制限を付けられませんでした: %', sqlerrm;
  end;
  return n;
end;
$$;
revoke all on function public.second_step_apply_policies() from public, anon, authenticated;

select public.second_step_apply_policies() as "制限を付けた表の数";

-- ------------------------------------------------------------
-- 5. アプリのサーバー(service_role)だけが使う関数
-- ------------------------------------------------------------
-- 確認コードを発行する(照合用の値だけを受け取る)。
--   送り直しは60秒あけてから。1時間に6回まで。有効期限は10分
create or replace function public.second_step_issue(p_user uuid, p_code_hash text)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  c public.login_codes;
  v_count int := 1;
  v_window timestamptz := now();
begin
  select * into c from public.login_codes where user_id = p_user for update;
  if found then
    if c.sent_at > now() - interval '60 seconds' then
      return jsonb_build_object('ok', false, 'reason', 'wait',
        'wait', ceil(extract(epoch from (c.sent_at + interval '60 seconds' - now())))::int);
    end if;
    if c.window_start > now() - interval '1 hour' then
      if c.sent_count >= 6 then
        return jsonb_build_object('ok', false, 'reason', 'limit',
          'wait', ceil(extract(epoch from (c.window_start + interval '1 hour' - now())))::int);
      end if;
      v_count := c.sent_count + 1;
      v_window := c.window_start;
    end if;
  end if;
  insert into public.login_codes (user_id, code_hash, expires_at, attempts, sent_at, window_start, sent_count)
  values (p_user, p_code_hash, now() + interval '10 minutes', 0, now(), v_window, v_count)
  on conflict (user_id) do update
    set code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0,
        sent_at = excluded.sent_at, window_start = excluded.window_start, sent_count = excluded.sent_count;
  insert into public.login_security_events (user_id, event) values (p_user, 'code_sent');
  -- ついでに、古くなった記録を片づける
  delete from public.login_verified_sessions where verified_at < now() - interval '40 days';
  delete from public.login_trusted_devices where expires_at < now();
  return jsonb_build_object('ok', true, 'expires_in', 600);
end;
$$;

-- メールを送れなかったとき: 発行したコードを無効にして、すぐ送り直せるようにする
create or replace function public.second_step_issue_failed(p_user uuid)
returns void
language sql security definer
set search_path = public
as $$
  update public.login_codes
     set expires_at = now(), sent_at = now() - interval '60 seconds', sent_count = greatest(sent_count - 1, 0)
   where user_id = p_user;
  insert into public.login_security_events (user_id, event) values (p_user, 'mail_failed');
$$;

-- 確認コードを照合する。合っていれば、このログインを確認済みにする(p_device_hash があれば、端末も30日間覚える)
--   戻り値: ok / wrong / locked(5回まちがえた。送り直しが必要) / expired / none
create or replace function public.second_step_check(
  p_user uuid, p_session uuid, p_code_hash text, p_device_hash text default null, p_label text default null
)
returns text
language plpgsql security definer
set search_path = public
as $$
declare
  c public.login_codes;
begin
  select * into c from public.login_codes where user_id = p_user for update;
  if not found then
    return 'none';
  end if;
  if c.expires_at < now() then
    return 'expired';
  end if;
  if c.attempts >= 5 then
    return 'locked';
  end if;
  if c.code_hash <> p_code_hash then
    update public.login_codes set attempts = attempts + 1 where user_id = p_user;
    insert into public.login_security_events (user_id, event, detail)
    values (p_user, case when c.attempts + 1 >= 5 then 'locked' else 'wrong_code' end, jsonb_build_object('attempts', c.attempts + 1));
    return case when c.attempts + 1 >= 5 then 'locked' else 'wrong' end;
  end if;
  delete from public.login_codes where user_id = p_user;
  insert into public.login_verified_sessions (session_id, user_id, method)
  values (p_session, p_user, 'code')
  on conflict (session_id) do update set user_id = excluded.user_id, method = 'code', verified_at = now();
  insert into public.login_security_events (user_id, event) values (p_user, 'verified_code');
  if p_device_hash is not null then
    insert into public.login_trusted_devices (user_id, token_hash, label, expires_at)
    values (p_user, p_device_hash, left(p_label, 200), now() + interval '30 days')
    on conflict (token_hash) do nothing;
    insert into public.login_security_events (user_id, event, detail)
    values (p_user, 'device_trusted', jsonb_build_object('label', left(p_label, 200)));
  end if;
  return 'ok';
end;
$$;

-- 覚えた端末からのログインか。そうなら、このログインを確認済みにする
create or replace function public.second_step_device(p_user uuid, p_session uuid, p_device_hash text)
returns boolean
language plpgsql security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.login_trusted_devices
   where user_id = p_user and token_hash = p_device_hash and expires_at > now();
  if v_id is null then
    return false;
  end if;
  update public.login_trusted_devices set last_used_at = now() where id = v_id;
  insert into public.login_verified_sessions (session_id, user_id, method)
  values (p_session, p_user, 'device')
  on conflict (session_id) do update set user_id = excluded.user_id, method = 'device', verified_at = now();
  insert into public.login_security_events (user_id, event) values (p_user, 'verified_device');
  return true;
end;
$$;

-- ログアウトしたとき: そのログインの確認済みの記録を消す
create or replace function public.second_step_end(p_user uuid, p_session uuid)
returns void
language sql security definer
set search_path = public
as $$
  delete from public.login_verified_sessions where session_id = p_session and user_id = p_user;
$$;

-- 覚えた端末をすべて忘れる(本人の操作、またはパスワードを変えたとき)
create or replace function public.second_step_forget_devices(p_user uuid)
returns int
language plpgsql security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from public.login_trusted_devices where user_id = p_user;
  get diagnostics n = row_count;
  insert into public.login_security_events (user_id, event, detail) values (p_user, 'devices_forgotten', jsonb_build_object('count', n));
  return n;
end;
$$;

-- スイッチの状態
create or replace function public.second_step_settings()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select coalesce((select value from public.login_security_settings where key = 'second_step'),
                  '{"office": false, "staff": false}'::jsonb)
$$;

-- スイッチを切り替える(p_group: 'office' / 'staff')
create or replace function public.second_step_enable(p_group text, p_on boolean, p_actor uuid default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if p_group not in ('office', 'staff') then
    raise exception 'p_group は office か staff を指定してください';
  end if;
  insert into public.login_security_settings (key, value, updated_by)
  values ('second_step', jsonb_build_object('office', false, 'staff', false) || jsonb_build_object(p_group, p_on), p_actor)
  on conflict (key) do update
    set value = public.login_security_settings.value || jsonb_build_object(p_group, p_on),
        updated_at = now(), updated_by = p_actor
  returning value into v;
  insert into public.login_security_events (user_id, event, detail)
  values (p_actor, 'settings_changed', jsonb_build_object('group', p_group, 'on', p_on));
  return v;
end;
$$;

revoke all on function public.second_step_issue(uuid, text) from public, anon, authenticated;
revoke all on function public.second_step_issue_failed(uuid) from public, anon, authenticated;
revoke all on function public.second_step_check(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.second_step_device(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.second_step_end(uuid, uuid) from public, anon, authenticated;
revoke all on function public.second_step_forget_devices(uuid) from public, anon, authenticated;
revoke all on function public.second_step_settings() from public, anon, authenticated;
revoke all on function public.second_step_enable(text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.second_step_required(uuid) to service_role;
grant execute on function public.second_step_issue(uuid, text) to service_role;
grant execute on function public.second_step_issue_failed(uuid) to service_role;
grant execute on function public.second_step_check(uuid, uuid, text, text, text) to service_role;
grant execute on function public.second_step_device(uuid, uuid, text) to service_role;
grant execute on function public.second_step_end(uuid, uuid) to service_role;
grant execute on function public.second_step_forget_devices(uuid) to service_role;
grant execute on function public.second_step_settings() to service_role;
grant execute on function public.second_step_enable(text, boolean, uuid) to service_role;

-- ------------------------------------------------------------
-- 6. パスワードを変えたら、覚えた端末をすべて忘れる
-- ------------------------------------------------------------
create or replace function public.second_step_on_password_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    delete from public.login_trusted_devices where user_id = new.id;
    insert into public.login_security_events (user_id, event) values (new.id, 'password_changed');
  end if;
  return new;
end;
$$;

do $$
begin
  drop trigger if exists second_step_password_change on auth.users;
  create trigger second_step_password_change
    after update of encrypted_password on auth.users
    for each row execute function public.second_step_on_password_change();
exception when others then
  raise notice 'パスワード変更時の処理は設定できませんでした(動作には影響しません): %', sqlerrm;
end $$;

-- ------------------------------------------------------------
-- 7. 適用状況
-- ------------------------------------------------------------
select 項目, 状態 from (
  select 1 as ord, '二段階認証の表(5つ)' as 項目,
         (select case when count(*) = 5 then '✅OK' else '❌未適用' end from information_schema.tables
           where table_schema = 'public'
             and table_name in ('login_security_settings', 'login_codes', 'login_verified_sessions', 'login_trusted_devices', 'login_security_events')) as 状態
  union all
  select 2, '「確認済みであること」の制限が付いた表',
         (select count(*)::text || ' 表' from pg_policies where schemaname = 'public' and policyname = 'second_step')
  union all
  select 3, '制限が付いていない表(行レベルの保護が有効な表のうち。0 が正しい)',
         (select count(*)::text || ' 表' from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
           where ns.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity and c.relname not like 'login\_%'
             and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'second_step'))
  union all
  select 4, '保存したファイル(storage)への制限',
         (select case when count(*) = 1 then '✅OK' else '⚠️なし' end from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'second_step')
  union all
  select 5, '権限を調べる関数(確認済みのログインだけ権限を返す)',
         (select count(*)::text || ' / ' ||
                 (select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
                   where ns.nspname = 'public' and p.proname in ('my_role', 'my_company', 'my_attested', 'hm_my_role', 'hm_my_company', 'hm_is_office'))::text || ' 個'
            from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
           where ns.nspname = 'public' and p.proname in ('my_role', 'my_company', 'my_attested', 'hm_my_role', 'hm_my_company', 'hm_is_office')
             and p.prosrc like '%second_step_ok%')
  union all
  select 6, 'スイッチ(事務所)', case when (public.second_step_settings() ->> 'office')::boolean then '🔒 有効' else 'オフ(今までどおり)' end
  union all
  select 7, 'スイッチ(担当者・実施事務従事者)', case when (public.second_step_settings() ->> 'staff')::boolean then '🔒 有効' else 'オフ(今までどおり)' end
  union all
  select 8, '対象になる方の人数(事務所 / 担当者・実施事務従事者)',
         (select count(*) filter (where role = 'office')::text || ' 名 / ' ||
                 count(*) filter (where role in ('jimu', 'company') or coalesce((to_jsonb(p) ->> 'hm_company_access')::boolean, false))::text || ' 名'
            from public.profiles p)
) t
order by ord;
