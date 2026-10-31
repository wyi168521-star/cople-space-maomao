\pset pager off
\pset null '(null)'

\echo '1. public 表 RLS 状态'
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;

\echo '2. public 策略及 UPDATE 校验'
select tablename, policyname, cmd, roles, with_check from pg_policies where schemaname = 'public' order by tablename, policyname;

\echo '3. 成员辅助函数'
select proname, prosecdef from pg_proc where proname = 'user_couple_ids';

\echo '4. 私有 Storage bucket'
select id, public from storage.buckets where id = 'couple-media';

-- 把人工预期也作为失败条件验证，psql 应使用 ON_ERROR_STOP=1。
do $acceptance$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public')
    or exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity) then
    raise exception '验收失败：public 应用表缺少 RLS';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public')
    or exists (select 1 from pg_policies where schemaname = 'public'
      and (roles <> array['authenticated']::name[]
        or (cmd in ('UPDATE', 'ALL') and with_check is null))) then
    raise exception '验收失败：策略角色或写入校验不符合预期';
  end if;
  if not exists (select 1 from pg_proc where proname = 'user_couple_ids'
    and pronamespace = 'public'::regnamespace and prosecdef) then
    raise exception '验收失败：缺少 SECURITY DEFINER 成员辅助函数';
  end if;
  if not exists (select 1 from storage.buckets where id = 'couple-media' and public = false) then
    raise exception '验收失败：couple-media 不存在或不是私有 bucket';
  end if;
  raise notice '安全验收四项全部通过';
end
$acceptance$;
