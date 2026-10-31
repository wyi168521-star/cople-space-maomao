-- 云端 SQL Editor 可直接运行；只查询及断言，不修改表、策略或数据。
select version, name from supabase_migrations.schema_migrations order by version;

select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;

select tablename, policyname, cmd, roles, with_check from pg_policies
where schemaname = 'public' order by tablename, policyname;

select p.proname, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('user_couple_ids', 'create_couple', 'join_couple')
order by p.proname;

select id, public from storage.buckets where id = 'couple-media';
select policyname, cmd, roles, qual, with_check from pg_policies
where schemaname = 'storage' and tablename = 'objects' and policyname in (
  'couple media readable by members', 'couple media insertable by members', 'couple media deletable by members'
) order by policyname;

select pubname, schemaname, tablename from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whispers';

select c.relname, c.reloptions from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname = 'wishes';

do $cloud_acceptance$
begin
  if exists (
    select 1 from (values ('20261026000000'), ('20261027162443'), ('20261029132447'),
      ('20261030144521'), ('20261030162043')) expected(version)
    where not exists (select 1 from supabase_migrations.schema_migrations m where m.version = expected.version)
  ) then raise exception '验收失败：五条基础迁移尚未全部应用'; end if;

  if not exists (select 1 from pg_tables where schemaname = 'public')
    or exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity) then
    raise exception '验收失败：public 表缺少 RLS';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public')
    or exists (select 1 from pg_policies where schemaname = 'public'
      and (roles <> array['authenticated']::name[] or (cmd in ('UPDATE', 'ALL') and with_check is null))) then
    raise exception '验收失败：public 策略角色或 UPDATE 校验不正确';
  end if;

  if not exists (select 1 from pg_proc where oid = to_regprocedure('public.user_couple_ids()') and prosecdef)
    or not exists (select 1 from pg_proc where oid = to_regprocedure('public.create_couple(text,text,date)') and prosecdef)
    or not exists (select 1 from pg_proc where oid = to_regprocedure('public.join_couple(uuid)') and prosecdef) then
    raise exception '验收失败：缺少 SECURITY DEFINER 成员函数或配对 RPC';
  end if;
  if not exists (select 1 from storage.buckets where id = 'couple-media' and public = false) then
    raise exception '验收失败：couple-media 不存在或未设为私有';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and roles = array['authenticated']::name[] and policyname in (
        'couple media readable by members', 'couple media insertable by members', 'couple media deletable by members')) <> 3 then
    raise exception '验收失败：couple-media 成员访问策略不完整';
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'whispers') then
    raise exception '验收失败：whispers 未加入 Realtime 发布';
  end if;
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime' and pubinsert and pubupdate) then
    raise exception '验收失败：Realtime 未启用 INSERT / UPDATE 通知';
  end if;
  if not exists (select 1 from pg_class where oid = to_regclass('public.wishes')
      and relkind = 'v' and reloptions @> array['security_invoker=true']::text[])
    or has_table_privilege('anon', 'public.wishes', 'select') then
    raise exception '验收失败：wishes 兼容视图权限不正确';
  end if;
  raise notice '当前连接数据库的结构、RLS、RPC、Storage 和 Realtime 验收通过';
end
$cloud_acceptance$;

-- Management API 只返回最后一组结果，在末尾输出便于核对的摘要。
select jsonb_build_object(
  'migrations', (select count(*) from supabase_migrations.schema_migrations where version in
    ('20261026000000', '20261027162443', '20261029132447', '20261030144521', '20261030162043')),
  'public_tables', (select count(*) from pg_tables where schemaname = 'public'),
  'all_public_tables_rls', not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity),
  'policies_authenticated_only', not exists (select 1 from pg_policies where schemaname = 'public' and roles <> array['authenticated']::name[]),
  'updates_have_with_check', not exists (select 1 from pg_policies where schemaname = 'public' and cmd in ('UPDATE', 'ALL') and with_check is null),
  'security_definer_helpers', (select count(*) from pg_proc where prosecdef and oid in
    (to_regprocedure('public.user_couple_ids()'), to_regprocedure('public.create_couple(text,text,date)'), to_regprocedure('public.join_couple(uuid)'))),
  'couple_media_private', (select not public from storage.buckets where id = 'couple-media'),
  'storage_member_policies', (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and roles = array['authenticated']::name[] and policyname in
      ('couple media readable by members', 'couple media insertable by members', 'couple media deletable by members')),
  'whispers_realtime', exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'whispers'),
  'realtime_insert_update', exists (select 1 from pg_publication where pubname = 'supabase_realtime' and pubinsert and pubupdate),
  'wishes_security_invoker', exists (select 1 from pg_class where oid = to_regclass('public.wishes') and reloptions @> array['security_invoker=true']::text[])
) as cloud_acceptance;
