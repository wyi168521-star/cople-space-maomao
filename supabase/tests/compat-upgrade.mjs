// 独立内存 PostgreSQL：模拟 Auth/Storage 接口，执行仓库原始 SQL 和真实升级迁移。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

const coupleCountNotices = []
const noticeOptions = { onNotice: notice => {
  if (notice.message?.startsWith('couples 现有 ')) coupleCountNotices.push(notice.message)
} }
const db = new PGlite({ extensions: { pgcrypto } })
const sql = async path => {
  try {
    return await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT' || !path.startsWith('migrations/')) throw error
    return readFile(new URL(`../legacy-migrations/${path.slice('migrations/'.length)}`, import.meta.url), 'utf8')
  }
}
const uid = n => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const a = uid(1), b = uid(2), outsider = uid(3), c = uid(11), other = uid(12)
const memory = uid(21), album = uid(31), photo = uid(41), message = uid(51), anniversary = uid(61)
let checks = 0
const rows = async q => (await db.query(q)).rows
const one = async q => (await rows(q))[0]
const check = (condition, label) => { assert.ok(condition, label); checks++ }
const as = async id => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${id}', false);`)
const admin = () => db.exec('reset role;')
async function reject(q, pattern, label) {
  await assert.rejects(() => db.exec(q), pattern, label)
  checks++
}

try {
  const alignSchemaSql = await sql('migrations/20261027162443_align_schema.sql')
  assert.deepEqual([...alignSchemaSql.matchAll(/^-- ([①②③④⑤⑥⑦⑧]) /gm)].map(m => m[1]), ['①','②','③','④','⑤','⑥','⑦','⑧']); checks++
  const indexSection = alignSchemaSql.slice(alignSchemaSql.indexOf('-- ④ '), alignSchemaSql.indexOf('-- ⑤ '))
  check((indexSection.match(/^create index if not exists /gm) || []).length === 9, '第四段独立包含九条索引')
  check(alignSchemaSql.trimEnd().endsWith("raise notice 'couples 现有 % 行', n;\nend $$;"), '原有 NOTICE DO 仍为文件最后一条语句')
  const countQueryStart = alignSchemaSql.indexOf("select 'couples' t, count(*) from public.couples")
  const countQueryEnd = alignSchemaSql.indexOf(';', countQueryStart) + 1
  check(countQueryStart > alignSchemaSql.indexOf('-- ⑧ ') && countQueryEnd < alignSchemaSql.lastIndexOf('do $$'), '五表统计位于第八段的 NOTICE DO 之前')
  const tableCountSql = alignSchemaSql.slice(countQueryStart, countQueryEnd)
  const sortedCounts = records => records.map(row => ({ t: row.t, count: Number(row.count) })).sort((a,b) => a.t.localeCompare(b.t))
  const expectedCounts = values => sortedCounts(Object.entries(values).map(([t,count]) => ({ t,count })))
  const countResult = results => {
    const result = results.find(r => r.fields?.length === 2 && r.fields[0].name === 't' && r.fields[1].name === 'count')
    assert.ok(result, '迁移返回 t / count 五表结果集')
    return sortedCounts(result.rows)
  }
  // 下面的临时表只存在于本脚本的内存数据库，用于覆盖部分升级的旧库。
  const fixtureTables = ['couples', 'couple_members', 'memories', 'albums', 'anniversaries']
  const mediaFixtureTables = ['memory_media', 'album_media', 'whispers']
  const allFixtureTables = [...fixtureTables, ...mediaFixtureTables]
  const managedBuckets = ['memory-photos','album-media','message-media','couple-media']
  const storageNames = {
    'memory-photos': ['memory photos read by couple','memory photos upload by couple','memory photos delete by couple'],
    'album-media': ['album media read couple','album media upload couple','album media delete couple'],
    'message-media': ['message media read by couple','message media upload by couple','message media delete by couple'],
    'couple-media': ['couple media readable by members','couple media insertable by members','couple media deletable by members'],
  }
  const storagePath = (bucket, coupleId, file) => `${coupleId}/${bucket === 'message-media' ? 'messages' : bucket}/${file}`
  const bucketState = () => rows("select id,public,file_size_limit::text,allowed_mime_types from storage.buckets where id in ('memory-photos','album-media','message-media') order by id")
  const storagePolicies = () => rows(`select policyname,roles::text[],cmd,qual,with_check from pg_catalog.pg_policies
    where schemaname='storage' and tablename='objects' and policyname in (${Object.values(storageNames).flat().map(name => `'${name}'`).join(',')}) order by policyname`)
  const storageRows = () => rows("select id::text,bucket_id,name from storage.objects order by bucket_id,name")
  const verifyManagedPolicies = async () => {
    const states = await rows(`select relname,relrowsecurity from pg_catalog.pg_class where relnamespace='public'::regnamespace
      and relname in (${allFixtureTables.map(name => `'${name}'`).join(',')})`)
    check(states.length === 8 && states.every(s => s.relrowsecurity), '八张目标表均启用 RLS')
    const commands = { albums: ['DELETE','INSERT','SELECT','UPDATE'], anniversaries: ['DELETE','INSERT','SELECT','UPDATE'],
      memory_media: ['DELETE','INSERT','SELECT','UPDATE'], album_media: ['DELETE','INSERT','SELECT'], whispers: ['DELETE','INSERT','SELECT','UPDATE'] }
    for (const [table, expected] of Object.entries(commands)) {
      const policies = await rows(`select cmd,roles::text[] from pg_catalog.pg_policies where schemaname='public' and tablename='${table}' order by cmd`)
      assert.deepEqual(policies, expected.map(cmd => ({ cmd, roles: ['authenticated'] })), `${table} 沿用已知业务权限并限定 authenticated`); checks++
    }
    const receiptPrivileges = await one("select has_column_privilege('authenticated','public.whispers','read_at','UPDATE') as receipt, has_column_privilege('authenticated','public.whispers','body','UPDATE') as body")
    check(receiptPrivileges.receipt && !receiptPrivileges.body, '悄悄话只授予 read_at 的列级更新权限')
    const policies = await storagePolicies()
    check(policies.length === 12 && policies.every(p => p.roles.length === 1 && p.roles[0] === 'authenticated')
      && ['SELECT','INSERT','DELETE'].every(cmd => policies.filter(p => p.cmd === cmd).length === 4), '四个私有 bucket 各有 authenticated 读取上传删除策略')
    check((await one("select public from storage.buckets where id='couple-media'")).public === false, '统一 couple-media bucket 存在且为私有')
    const publicPolicies = await rows("select roles::text[],cmd,with_check from pg_catalog.pg_policies where schemaname='public'")
    check(publicPolicies.every(p => p.roles.length === 1 && p.roles[0] === 'authenticated'
      && (!['UPDATE','ALL'].includes(p.cmd) || p.with_check !== null)), '全部 public 策略限定 authenticated，更新操作显式验证新行')
  }
  const snapshotFixtures = async (tables = fixtureTables) => Object.fromEntries(await Promise.all(tables.map(async table => [table, await rows(`select * from public.${table} order by 1`)])))
  const roleChecks = () => rows(`select oid::text, conname, conrelid::regclass::text as target, contype, convalidated
    from pg_catalog.pg_constraint
    where (conname='couple_members_role_check' and conrelid='public.couple_members'::regclass)
      or (conname='memories_author_role_check' and conrelid='public.memories'::regclass)
    order by conname`)
  const coupleIdsFunction = () => one(`select p.oid::text, p.pronargs, p.proretset, t.typname,
    p.provolatile, p.prosecdef, p.proconfig, l.lanname
    from pg_catalog.pg_proc p join pg_catalog.pg_type t on t.oid=p.prorettype
    join pg_catalog.pg_language l on l.oid=p.prolang
    where p.oid='public.user_couple_ids()'::regprocedure`)
  const currentCoupleIds = () => rows('select public.user_couple_ids()::text as couple_id order by couple_id')
  const directMemberships = () => rows('select couple_id::text,user_id::text from public.couple_members order by user_id')
  const membershipPolicies = () => rows(`select policyname,permissive,roles::text[],cmd,qual,with_check
    from pg_catalog.pg_policies where schemaname='public' and tablename='couple_members' order by policyname`)
  const couplePolicies = () => rows(`select policyname,permissive,roles::text[],cmd,qual,with_check
    from pg_catalog.pg_policies where schemaname='public' and tablename='couples' order by policyname`)
  const memoryPolicies = () => rows(`select policyname,permissive,roles::text[],cmd,qual,with_check
    from pg_catalog.pg_policies where schemaname='public' and tablename='memories' order by policyname`)
  const verifyMemoryPolicies = async () => {
    check((await one("select relrowsecurity from pg_catalog.pg_class where oid='public.memories'::regclass")).relrowsecurity, '记忆表启用 RLS')
    assert.deepEqual((await memoryPolicies()).map(p => ({ name: p.policyname, roles: p.roles, command: p.cmd,
      permissive: p.permissive, memberFilter: p.qual === null ? null : p.qual.includes('user_couple_ids()'),
      memberCheck: p.with_check === null ? null : p.with_check.includes('user_couple_ids()') })), [
      { name: 'memories deletable by members', roles: ['authenticated'], command: 'DELETE', permissive: 'PERMISSIVE', memberFilter: true, memberCheck: null },
      { name: 'memories insertable by members', roles: ['authenticated'], command: 'INSERT', permissive: 'PERMISSIVE', memberFilter: null, memberCheck: true },
      { name: 'memories readable by members', roles: ['authenticated'], command: 'SELECT', permissive: 'PERMISSIVE', memberFilter: true, memberCheck: null },
      { name: 'memories updatable by members', roles: ['authenticated'], command: 'UPDATE', permissive: 'PERMISSIVE', memberFilter: true, memberCheck: true },
    ]); checks++
  }
  const verifyCouplePolicies = async () => {
    check((await one("select relrowsecurity from pg_catalog.pg_class where oid='public.couples'::regclass")).relrowsecurity, '空间表启用 RLS')
    const policies = await couplePolicies()
    assert.deepEqual(policies.map(p => ({ name: p.policyname, roles: p.roles, command: p.cmd, permissive: p.permissive,
      memberFilter: p.qual?.includes('user_couple_ids()') === true,
      memberCheck: p.with_check === null ? null : p.with_check.includes('user_couple_ids()') })),
    [{ name: 'couples readable by members', roles: ['authenticated'], command: 'SELECT', permissive: 'PERMISSIVE', memberFilter: true, memberCheck: null },
      { name: 'couples updatable by members', roles: ['authenticated'], command: 'UPDATE', permissive: 'PERMISSIVE', memberFilter: true, memberCheck: true }]); checks++
  }
  const indexSpec = {
    idx_couple_members_user: { table: 'couple_members', columns: ['user_id'], descending: [false] },
    idx_couple_members_couple: { table: 'couple_members', columns: ['couple_id'], descending: [false] },
    idx_memories_couple_date: { table: 'memories', columns: ['couple_id', 'date'], descending: [false, true] },
    idx_albums_couple: { table: 'albums', columns: ['couple_id'], descending: [false] },
    idx_anniversaries_couple: { table: 'anniversaries', columns: ['couple_id'], descending: [false] },
    idx_whispers_couple_created: { table: 'whispers', columns: ['couple_id', 'created_at'], descending: [false, true] },
    idx_whispers_sender: { table: 'whispers', columns: ['sender_id'], descending: [false] },
    idx_memory_media_memory: { table: 'memory_media', columns: ['memory_id'], descending: [false] },
    idx_album_media_album: { table: 'album_media', columns: ['album_id'], descending: [false] },
  }
  const alignmentIndexes = () => rows(`select i.oid::text, i.relname as name, t.relname as table_name,
    am.amname as method, x.indisvalid as valid, x.indisready as ready,
    array(select a.attname::text from unnest(x.indkey) with ordinality k(attnum,pos)
      join pg_catalog.pg_attribute a on a.attrelid=x.indrelid and a.attnum=k.attnum order by k.pos) as columns,
    array(select (o.flags & 1)=1 from unnest(x.indoption) with ordinality o(flags,pos) order by o.pos) as descending
    from pg_catalog.pg_index x join pg_catalog.pg_class i on i.oid=x.indexrelid
    join pg_catalog.pg_class t on t.oid=x.indrelid join pg_catalog.pg_am am on am.oid=i.relam
    where i.relnamespace='public'::regnamespace and i.relname in (${Object.keys(indexSpec).map(name => `'${name}'`).join(',')})
    order by i.relname`)
  const verifyIndexes = async () => {
    const actualIndexes = await alignmentIndexes()
    for (const [name, expected] of Object.entries(indexSpec)) {
      const actual = actualIndexes.find(index => index.name === name)
      assert.deepEqual(actual && { table: actual.table_name, columns: actual.columns, descending: actual.descending, method: actual.method, valid: actual.valid, ready: actual.ready },
        { ...expected, method: 'btree', valid: true, ready: true }, `${name} 所属表、列顺序、排序方向及索引有效性`)
      checks++
    }
  }
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    insert into auth.users(id) values('${a}');
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema storage;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, unique(bucket_id,name));
    create function storage.foldername(text) returns text[] language sql immutable as
      $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,anon;
    grant select,insert,update,delete on storage.objects to authenticated,anon;
    insert into storage.buckets values('memory-photos','memory-photos',true,123456,array['image/png']);
    create table public.couples(id uuid primary key, cover_path text, settings jsonb, name_a text, name_b text, start_date date, created_at timestamptz);
    insert into public.couples values('${a}','cover/original.jpg',null,'旧甲','旧乙','2023-05-20','2023-05-20T08:00:00Z'),('${b}',null,'{"theme":"warm"}',null,null,null,null);
    create table public.couple_members(couple_id uuid, user_id uuid, role text);
    insert into public.couple_members values('${a}','${b}','b');
    create table public.memories(id uuid primary key, couple_id uuid, date date, body text, location text, author_role text, created_at timestamptz);
    insert into public.memories values('${a}','${a}','2023-06-01','保留正文','保留地点','a','2023-06-01T09:00:00Z');
    create table public.albums(id uuid primary key, couple_id uuid, cover_path text, created_at timestamptz);
    insert into public.albums values('${a}','${a}','album/original.jpg','2023-06-02T10:00:00Z');
    create table public.anniversaries(id uuid primary key, couple_id uuid, repeat_yearly boolean default false, icon text, created_at timestamptz);
    insert into public.anniversaries values('${a}','${a}',false,'heart','2023-06-03T11:00:00Z');
    create schema compat_role_collision;
    create table compat_role_collision.members(role text constraint couple_members_role_check check(role in ('a','b')));
    create table public.unrelated_author_roles(author_role text constraint memories_author_role_check check(author_role in ('a','b')));
  `)
  const beforeAlignment = await snapshotFixtures()
  const initialResults = await db.exec(alignSchemaSql, noticeOptions)
  assert.deepEqual(countResult(initialResults), expectedCounts({ couples: 2, couple_members: 1, memories: 1, albums: 1, anniversaries: 1 })); checks++
  const beforeReadOnlyCounts = await snapshotFixtures(allFixtureTables)
  await rows(tableCountSql)
  assert.deepEqual(await snapshotFixtures(allFixtureTables), beforeReadOnlyCounts); checks++
  check(coupleCountNotices.length === 1 && coupleCountNotices.at(-1) === 'couples 现有 2 行', '行数检查输出本地执行时的实际 couples 数量')
  await verifyIndexes()
  check((await one("select relrowsecurity from pg_catalog.pg_class where oid='public.couple_members'::regclass")).relrowsecurity, '成员表启用 RLS')
  assert.deepEqual(await membershipPolicies(), [{ policyname: 'members read own memberships', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'SELECT', qual: '(user_id = auth.uid())', with_check: null }]); checks++
  await verifyCouplePolicies()
  await verifyMemoryPolicies()
  await verifyManagedPolicies()
  const initialBuckets = await bucketState()
  check(initialBuckets.length === 3 && initialBuckets.every(bucket => bucket.public === false), '三种媒体 bucket 均为私有')
  assert.deepEqual(initialBuckets.find(bucket => bucket.id === 'memory-photos'), { id: 'memory-photos', public: false, file_size_limit: '123456', allowed_mime_types: ['image/png'] }); checks++
  check(initialBuckets.find(bucket => bucket.id === 'album-media').file_size_limit === '52428800'
    && initialBuckets.find(bucket => bucket.id === 'message-media').file_size_limit === '41943040', '缺失 bucket 使用仓库既有大小限制')
  // 此基线没有所有权触发器，让失败原因直接来自 UPDATE 策略的 WITH CHECK。
  await db.exec('grant usage on schema public,auth to authenticated; grant select,update on public.couples to authenticated;')
  await as(b)
  await reject(`update public.couples set id='${uid(999)}' where id='${a}'`, /row-level security/, 'WITH CHECK 拒绝把空间主键移出成员范围')
  await admin()
  await db.exec('grant select,insert,update,delete on public.memories to authenticated;')
  await db.exec('grant select,insert on public.albums,public.anniversaries to authenticated;')
  await as(b)
  await reject(`insert into public.memories(id,couple_id,date,body) values('${uid(998)}','${uid(999)}','2026-10-28','越界新增')`, /row-level security/, '记忆 INSERT WITH CHECK 拒绝其他空间')
  await reject(`update public.memories set couple_id='${uid(999)}' where id='${a}'`, /row-level security/, '记忆 UPDATE WITH CHECK 拒绝移出成员范围')
  await reject(`insert into public.albums(id,couple_id) values('${uid(997)}','${a}')`, /row-level security/, '缺少旧创建者字段时不开放相册创建')
  await reject(`insert into public.anniversaries(id,couple_id) values('${uid(996)}','${a}')`, /row-level security/, '缺少旧创建者字段时不开放纪念日创建')
  await admin()
  const helperMetadata = await coupleIdsFunction()
  check(helperMetadata.pronargs === 0 && helperMetadata.proretset && helperMetadata.typname === 'uuid'
    && helperMetadata.provolatile === 's' && helperMetadata.prosecdef && helperMetadata.lanname === 'sql', '成员查询函数为无参数 STABLE SECURITY DEFINER SQL 函数，返回 UUID 集合')
  check(helperMetadata.proconfig?.length === 1 && helperMetadata.proconfig[0].replaceAll('"', '') === 'search_path=', '成员查询函数固定空 search_path')
  await db.exec(`insert into public.couple_members(couple_id,user_id,role) values('${b}','${b}','a');
    select set_config('request.jwt.claim.sub','${b}',false);`)
  assert.deepEqual(await currentCoupleIds(), [{ couple_id: a }, { couple_id: b }]); checks++
  await db.exec(`delete from public.couple_members where couple_id='${b}';
    select set_config('request.jwt.claim.sub','',false);`)
  const addedRoleChecks = await roleChecks()
  for (const [name, target] of [['couple_members_role_check', 'couple_members'], ['memories_author_role_check', 'memories']]) {
    check(addedRoleChecks.some(c => c.conname === name && c.target === target && c.contype === 'c' && c.convalidated), `${target} 补齐有效 CHECK，不受其他表同名约束影响`)
  }
  await reject(`insert into public.couple_members(couple_id,user_id,role) values('${a}','${outsider}','c')`, /couple_members_role_check/, '角色 CHECK 拒绝非法新增成员')
  await reject(`insert into public.memories(id,author_role) values('${outsider}','c')`, /memories_author_role_check/, '作者 CHECK 拒绝非法新增角色')
  await reject("update public.couple_members set role='A'", /couple_members_role_check/, '角色 CHECK 拒绝非法更新')
  await reject("update public.memories set author_role=''", /memories_author_role_check/, '作者 CHECK 拒绝空字符串')
  await db.exec("update public.couple_members set role='a'; update public.memories set author_role='b';")
  check((await one('select role from public.couple_members')).role === 'a' && (await one('select author_role from public.memories')).author_role === 'b', '两项 CHECK 接受有效 a / b')
  await db.exec('update public.couple_members set role=null; update public.memories set author_role=null;')
  check((await one('select role from public.couple_members')).role === null && (await one('select author_role from public.memories')).author_role === null, 'CHECK 保留 SQL NULL 语义，不额外添加非空要求')
  await db.exec("update public.couple_members set role='b'; update public.memories set author_role='a';")
  const mediaSchema = {
    memory_media: { id: 'uuid!', memory_id: 'uuid!', storage_path: 'text!', media_type: 'text!', taken_at: 'date', created_at: 'timestamp with time zone!' },
    album_media: { id: 'uuid!', album_id: 'uuid!', storage_path: 'text!', media_type: 'text!', taken_at: 'date', created_at: 'timestamp with time zone!' },
    whispers: { id: 'uuid!', couple_id: 'uuid!', sender_id: 'uuid!', body: 'text', media_path: 'text', media_type: 'text', read_at: 'timestamp with time zone', created_at: 'timestamp with time zone!' },
  }
  const mediaColumns = await rows("select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public'")
  for (const [table, fields] of Object.entries(mediaSchema)) {
    const actual = Object.fromEntries(Object.keys(fields).map(name => {
      const col = mediaColumns.find(item => item.table_name === table && item.column_name === name)
      return [name, col ? col.data_type + (col.is_nullable === 'NO' ? '!' : '') : 'MISSING']
    }))
    assert.deepEqual(actual, fields, `${table} 缺表时创建指定字段和非空约束`); checks++
    check(mediaColumns.find(col => col.table_name === table && col.column_name === 'id').column_default.includes('gen_random_uuid()')
      && mediaColumns.find(col => col.table_name === table && col.column_name === 'created_at').column_default === 'now()', `${table} UUID 和时间默认值`)
  }
  await db.exec(`insert into public.memory_media(memory_id,storage_path,media_type) values('${a}','fixture/photo.jpg','photo');
    insert into public.album_media(album_id,storage_path,media_type) values('${a}','fixture/video.mp4','video');
    insert into public.whispers(couple_id,sender_id,body,media_path,media_type) values('${a}','${a}','保留悄悄话','fixture/voice.webm','voice');`)
  for (const table of mediaFixtureTables) {
    const mediaRow = await one(`select * from public.${table} limit 1`)
    check(/^[0-9a-f-]{36}$/.test(mediaRow.id) && mediaRow.created_at !== null, `${table} 实际生成 UUID 和创建时间`)
    await reject(`insert into public.${table} select * from public.${table}`, /unique constraint/, `${table} 主键拒绝重复`)
  }
  await reject(`insert into public.memory_media(memory_id,storage_path,media_type) values('${a}','bad.jpg','image')`, /check constraint/, '记忆媒体拒绝旧格式 image')
  await reject(`insert into public.album_media(album_id,storage_path,media_type) values('${a}','bad.mp3','voice')`, /check constraint/, '相册媒体拒绝 voice')
  await reject(`insert into public.whispers(couple_id,sender_id,media_type) values('${a}','${a}','audio')`, /check constraint/, '悄悄话拒绝旧格式 audio')
  await reject(`insert into public.memory_media(memory_id,storage_path,media_type) values('${outsider}','missing.jpg','photo')`, /foreign key constraint/, '记忆媒体拒绝不存在的父记录')
  await reject(`insert into public.album_media(album_id,storage_path,media_type) values('${outsider}','missing.mp4','video')`, /foreign key constraint/, '相册媒体拒绝不存在的父记录')
  await reject(`insert into public.whispers(couple_id,sender_id,body) values('${outsider}','${a}','无空间')`, /foreign key constraint/, '悄悄话空间外键有效')
  await reject(`insert into public.whispers(couple_id,sender_id,body) values('${a}','${outsider}','无用户')`, /foreign key constraint/, '悄悄话发送者外键有效')
  await reject(`delete from auth.users where id='${a}'`, /foreign key constraint/, '发送者外键保持默认不级联删除')
  // 第二项约束验证失败时，同一 DO 块中新加的第一项也必须回滚，旧行保持原样。
  await db.exec(`alter table public.couple_members drop constraint couple_members_role_check;
    alter table public.memories drop constraint memories_author_role_check;
    update public.memories set author_role='legacy-invalid';`)
  const invalidRolesBefore = await snapshotFixtures(allFixtureTables)
  await reject(alignSchemaSql, /memories_author_role_check/, '旧非法角色会使约束添加失败')
  check((await roleChecks()).length === 0, 'DO 失败回滚同块新添的第一项 CHECK')
  assert.deepEqual(await snapshotFixtures(allFixtureTables), invalidRolesBefore); checks++
  await db.exec("update public.memories set author_role='a';")
  await db.exec(alignSchemaSql)
  check((await roleChecks()).length === 2, '角色数据有效后两项约束均可补齐')
  assert.deepEqual((await one(`select settings from public.couples where id='${a}'`)).settings, {}); checks++
  assert.deepEqual((await one(`select settings from public.couples where id='${b}'`)).settings, { theme: 'warm' }); checks++
  check((await one(`select cover_path from public.couples where id='${a}'`)).cover_path === 'cover/original.jpg', '对齐保留既有封面')
  const existingCouple = await one(`select name_a,name_b,start_date::text,created_at from public.couples where id='${a}'`)
  assert.deepEqual(existingCouple, { name_a: '旧甲', name_b: '旧乙', start_date: '2023-05-20', created_at: beforeAlignment.couples[0].created_at }); checks++
  for (const table of fixtureTables.slice(1)) {
    assert.deepEqual(await rows(`select * from public.${table} order by 1`), beforeAlignment[table], `${table} 既有值保留`); checks++
  }
  check((await one("select column_default from information_schema.columns where table_schema='public' and table_name='anniversaries' and column_name='repeat_yearly'")).column_default === 'false', 'IF NOT EXISTS 不覆盖已有列默认值')
  const settingsColumn = await one("select is_nullable,column_default,data_type from information_schema.columns where table_schema='public' and table_name='couples' and column_name='settings'")
  check(settingsColumn.is_nullable === 'NO' && settingsColumn.column_default === "'{}'::jsonb" && settingsColumn.data_type === 'jsonb', '对齐补齐 JSONB 默认值及非空约束')
  await reject(`insert into public.couples(id,settings) values('${outsider}',null)`, /not-null constraint/, '对齐后拒绝显式空设置')
  const beforeRepeat = await snapshotFixtures(allFixtureTables)
  const beforeRepeatRoleChecks = await roleChecks()
  const beforeRepeatIndexes = await alignmentIndexes()
  const beforeRepeatFunction = await coupleIdsFunction()
  const beforeRepeatPolicies = await membershipPolicies()
  const beforeRepeatCouplePolicies = await couplePolicies()
  const beforeRepeatMemoryPolicies = await memoryPolicies()
  const beforeRepeatStoragePolicies = await storagePolicies()
  const beforeRepeatBuckets = await bucketState()
  await db.exec(alignSchemaSql)
  assert.deepEqual(await snapshotFixtures(allFixtureTables), beforeRepeat); checks++
  assert.deepEqual(await roleChecks(), beforeRepeatRoleChecks); checks++
  assert.deepEqual(await alignmentIndexes(), beforeRepeatIndexes); checks++
  assert.deepEqual(await coupleIdsFunction(), beforeRepeatFunction); checks++
  assert.deepEqual(await membershipPolicies(), beforeRepeatPolicies); checks++
  assert.deepEqual(await couplePolicies(), beforeRepeatCouplePolicies); checks++
  assert.deepEqual(await memoryPolicies(), beforeRepeatMemoryPolicies); checks++
  assert.deepEqual(await storagePolicies(), beforeRepeatStoragePolicies); checks++
  assert.deepEqual(await bucketState(), beforeRepeatBuckets); checks++
  await db.exec(`delete from public.memories where id='${a}'; delete from public.albums where id='${a}'; delete from public.couples where id='${a}';`)
  for (const table of mediaFixtureTables) check((await rows(`select * from public.${table}`)).length === 0, `${table} 父记录删除时级联清理`)
  await db.exec(`drop table public.memory_media,public.album_media,public.whispers;
    drop table public.couples,public.couple_members,public.memories,public.albums,public.anniversaries;
    create table public.couples(id uuid primary key);
    insert into public.couples(id) values('${a}');
    create table public.couple_members(couple_id uuid,user_id uuid);
    insert into public.couple_members values('${a}','${b}');
    create table public.memories(id uuid primary key,couple_id uuid,date date);
    insert into public.memories values('${a}','${a}','2023-06-01');
    create table public.albums(id uuid primary key,couple_id uuid);
    insert into public.albums values('${a}','${a}');
    create table public.anniversaries(id uuid primary key,couple_id uuid);
    insert into public.anniversaries values('${a}','${a}');`)
  await db.exec(alignSchemaSql)
  assert.deepEqual((await one(`select settings from public.couples where id='${a}'`)).settings, {}); checks++
  await db.exec(`insert into public.couples(id) values('${b}');`)
  assert.deepEqual((await one(`select settings from public.couples where id='${b}'`)).settings, {}); checks++
  const coverColumn = await one("select data_type,is_nullable from information_schema.columns where table_schema='public' and table_name='couples' and column_name='cover_path'")
  check(coverColumn.data_type === 'text' && coverColumn.is_nullable === 'YES', '缺少封面列时补齐可空 text 列')
  const addedFields = {
    couples: { name_a: ['text', null], name_b: ['text', null], start_date: ['date', null], created_at: ['timestamp with time zone', 'now()'] },
    couple_members: { role: ['text', null] },
    memories: { body: ['text', null], location: ['text', null], author_role: ['text', null], created_at: ['timestamp with time zone', 'now()'] },
    albums: { cover_path: ['text', null], created_at: ['timestamp with time zone', 'now()'] },
    anniversaries: { repeat_yearly: ['boolean', 'true'], icon: ['text', null], created_at: ['timestamp with time zone', 'now()'] },
  }
  const addedColumns = await rows("select table_name,column_name,data_type,column_default,is_nullable from information_schema.columns where table_schema='public'")
  for (const [table, fields] of Object.entries(addedFields)) {
    for (const [name, expected] of Object.entries(fields)) {
      const actual = addedColumns.find(col => col.table_name === table && col.column_name === name)
      assert.deepEqual(actual && [actual.data_type, actual.column_default, actual.is_nullable], [...expected, 'YES'], `${table}.${name} 补列定义`)
      checks++
    }
  }
  check((await one(`select name_a,start_date from public.couples where id='${a}'`)).name_a === null && (await one('select role from public.couple_members')).role === null, '可空补列不虚构姓名或角色')
  check((await one('select repeat_yearly from public.anniversaries')).repeat_yearly === true, '新增重复列时既有行使用 true 默认值')
  for (const table of ['couples', 'memories', 'albums', 'anniversaries']) {
    check((await one(`select created_at from public.${table} limit 1`)).created_at !== null, `${table} 新增创建时间列填入默认值`)
  }
  const missingColumnsAligned = await snapshotFixtures(allFixtureTables)
  await db.exec(alignSchemaSql)
  assert.deepEqual(await snapshotFixtures(allFixtureTables), missingColumnsAligned); checks++
  await db.exec(`drop table public.memory_media,public.album_media,public.whispers;
    drop table public.couples,public.couple_members,public.memories,public.albums,public.anniversaries;
    drop table public.unrelated_author_roles,compat_role_collision.members;
    drop schema compat_role_collision;
    delete from auth.users;`)

  await db.exec(`
    create publication supabase_realtime;
    grant usage on schema public, auth to authenticated, anon, service_role;
    grant execute on function auth.uid() to authenticated, anon, service_role;
  `)
  for (const file of ['migrations/001_auth_and_couples.sql', 'migrations/002_memories.sql',
    'migrations/003_ai_saved_works.sql', 'migrations/003001_albums.sql', 'migrations/004_together_list.sql',
    'migrations/005_anniversaries.sql', 'setup_heart_ai.sql', 'setup_messages.sql', 'upgrade_message_media.sql',
    'upgrade_album_media.sql', 'upgrade_couple_letters.sql', 'setup_account_management.sql', 'migrations/011_security_hardening.sql',
    'migrations/012_account_security.sql', 'migrations/013_call_history_and_member_realtime.sql', 'migrations/014_media_variants.sql',
    'migrations/019_media_interactions.sql', 'migrations/020_album_photo_realtime_delete.sql']) {
    await db.exec(await sql(file))
  }
  // Supabase 既有 public schema 的 API 表权限；本次新增表由迁移显式授权。
  await db.exec('grant select, insert, update, delete on all tables in schema public to authenticated;')
  await db.exec(`
    insert into auth.users(id,email,raw_user_meta_data) values
      ('${a}','a@example.test','{"display_name":"阿甲"}'),
      ('${b}','b@example.test','{"display_name":"阿乙"}'),
      ('${outsider}','c@example.test','{"display_name":"第三人"}');
    insert into public.couples(id,name,relationship_start,created_by) values
      ('${c}','旧空间','2023-05-20','${a}'), ('${other}','其他空间','2024-02-29','${outsider}');
    insert into public.couple_members(couple_id,user_id) values ('${c}','${a}'),('${c}','${b}'),('${other}','${outsider}');
    insert into public.memories(id,couple_id,author_id,content,memory_date,photos) values
      ('${memory}','${c}','${a}','原来的记忆','2023-06-01',
      '[{"path":"couple/original.jpg","thumbPath":"couple/thumb.webp","mediumPath":"couple/medium.webp","originalPath":"couple/original.jpg"},{"url":"local-display-only"},{"path":"couple/original.jpg"}]');
    insert into public.albums(id,couple_id,created_by,name,description) values ('${album}','${c}','${a}','旧相册','保留说明');
    insert into public.album_photos(id,album_id,uploaded_by,path,caption,taken_date,thumb_path,media_type)
      values('${photo}','${album}','${a}','album/photo.jpg','保留照片说明','2023-06-02','album/thumb.webp','image');
    insert into public.messages(id,couple_id,sender_id,content,image_path) values
      ('${message}','${c}','${a}','旧消息','message/old.jpg');
    insert into public.messages(couple_id,sender_id,media_path,media_type) values
      ('${c}','${a}','message/voice.webm','audio');
    insert into public.anniversaries(id,couple_id,created_by,title,event_date,recurring,note)
      values('${anniversary}','${c}','${a}','旧纪念日','2025-05-20',false,'保留备注');
    insert into public.memory_favorites(memory_id,couple_id,user_id) values('${memory}','${c}','${b}');
    insert into public.daily_questions(id,couple_id,question) values
      ('${uid(71)}','${c}','共同问题'),('${uid(72)}','${other}','其他空间的问题');
    insert into public.daily_answers(question_id,user_id,answer) values
      ('${uid(71)}','${a}','甲的回答'),('${uid(71)}','${b}','乙的回答'),
      ('${uid(72)}','${outsider}','其他空间的回答');
  `)
  const preserved = await one(`select photos, created_at from public.memories where id='${memory}'`)
  // 前置异常和 DDL 中途失败都必须完整回滚，而不是留下一半的新字段。
  await db.exec(`insert into auth.users(id,email) values('${uid(4)}','temporary@example.test');
    insert into public.couple_members(couple_id,user_id) values('${c}','${uid(4)}');`)
  await reject(await sql('migrations/20261027090005_init.sql'), /超过两位成员/, '异常成员不被静默删掉')
  await db.exec('rollback;')
  check((await rows(`select * from public.couple_members where couple_id='${c}'`)).length === 3, '失败保留所有成员')
  await db.exec(`delete from auth.users where id='${uid(4)}'; create table public.whispers(id uuid);`)
  await reject(await sql('migrations/20261027090005_init.sql'), /already exists/, '目标对象冲突中止升级')
  await db.exec('rollback;')
  check((await rows("select 1 from information_schema.columns where table_schema='public' and table_name='couples' and column_name='name_a'")).length === 0, 'DDL 中途失败回滚新增列')
  await db.exec('drop table public.whispers;')
  await db.exec(await sql('migrations/20261027090005_init.sql'))
  await db.exec(await sql('migrations/20261027161714_align_core_schema.sql'))
  // 先重现直接叠加新旧宽松策略的结果，确保迁移确实移除了旧的宽策略。
  await db.exec(`create policy "members read own memberships"
    on public.couple_members for select to authenticated using(user_id=auth.uid());`)
  await as(a)
  assert.deepEqual(await directMemberships(), [{ couple_id: c, user_id: a }, { couple_id: c, user_id: b }]); checks++
  await admin()
  const fullChainRoleChecks = await roleChecks()
  const noticesBeforeFullMigration = coupleCountNotices.length
  const bucketsBeforeFullMigration = await bucketState()
  const fullResults = await db.exec(alignSchemaSql, noticeOptions)
  assert.deepEqual(countResult(fullResults), expectedCounts({ couples: 2, couple_members: 3, memories: 1, albums: 1, anniversaries: 1 })); checks++
  check(coupleCountNotices.length === noticesBeforeFullMigration + 1 && coupleCountNotices.at(-1) === 'couples 现有 2 行', '完整链路也输出当前行数，不修改记录')
  assert.deepEqual(await roleChecks(), fullChainRoleChecks); checks++
  await verifyIndexes()
  assert.deepEqual(await membershipPolicies(), [{ policyname: 'members read own memberships', permissive: 'PERMISSIVE', roles: ['authenticated'], cmd: 'SELECT', qual: '(user_id = auth.uid())', with_check: null }]); checks++
  await verifyCouplePolicies()
  await verifyMemoryPolicies()
  await verifyManagedPolicies()
  assert.deepEqual(await bucketState(), bucketsBeforeFullMigration); checks++
  check((await one("select tgfoid='public.love_sync_memory_fields()'::regprocedure as updated from pg_catalog.pg_trigger where tgrelid='public.memories'::regclass and tgname='love_sync_core'")).updated, '原记忆触发器接入共同编辑兼容逻辑')
  for (const bucket of managedBuckets) {
    await db.query('insert into storage.objects(bucket_id,name) values($1,$2),($1,$3),($1,$4)',
      [bucket, storagePath(bucket,c,'seed-self.jpg'), storagePath(bucket,other,'seed-other.jpg'), storagePath(bucket,'not-a-uuid','malformed.jpg')])
  }
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['message-media', `${c}/wrong/hidden.jpg`])
  for (const userId of [a,b,outsider]) await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['avatars',`${userId}/avatar.jpg`])
  const storageBeforeRepeat = await storageRows()
  await db.exec(alignSchemaSql)
  assert.deepEqual(await storageRows(), storageBeforeRepeat); checks++
  // 按五表需求直接检查数据库目录，而不只验证触发器生成的行值。
  const coreSchema = {
    couples: { id: 'uuid!', name_a: 'text!', name_b: 'text!', start_date: 'date!', cover_path: 'text', settings: 'jsonb!', created_at: 'timestamp with time zone!' },
    couple_members: { couple_id: 'uuid!', user_id: 'uuid!', role: 'text!' },
    memories: { id: 'uuid!', couple_id: 'uuid!', date: 'date!', title: 'text!', body: 'text', location: 'text', author_role: 'text', created_at: 'timestamp with time zone!' },
    albums: { id: 'uuid!', couple_id: 'uuid!', title: 'text!', cover_path: 'text', created_at: 'timestamp with time zone!' },
    anniversaries: { id: 'uuid!', couple_id: 'uuid!', title: 'text!', target_date: 'date!', repeat_yearly: 'boolean!', icon: 'text', created_at: 'timestamp with time zone!' },
  }
  const catalog = await rows("select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public'")
  const column = (table, name) => catalog.find(c => c.table_name === table && c.column_name === name)
  for (const [table, fields] of Object.entries(coreSchema)) {
    const actual = Object.fromEntries(Object.keys(fields).map(name => {
      const col = column(table, name)
      return [name, col ? col.data_type + (col.is_nullable === 'NO' ? '!' : '') : 'MISSING']
    }))
    assert.deepEqual(actual, fields, `${table} 字段类型和非空约束`); checks++
  }
  check(column('anniversaries', 'repeat_yearly').column_default === 'true', 'repeat_yearly 有真实数据库 DEFAULT true')
  check(column('couples', 'settings').column_default === "'{}'::jsonb", 'settings 默认空 JSON 对象')
  for (const table of ['couples', 'memories', 'albums', 'anniversaries']) {
    check(column(table, 'id').column_default.includes('gen_random_uuid()') && column(table, 'created_at').column_default === 'now()', `${table} UUID 和创建时间默认值`)
  }
  const primaryKeys = await rows("select conrelid::regclass::text as tab, pg_get_constraintdef(oid) as definition from pg_constraint where contype='p' and connamespace='public'::regnamespace")
  for (const table of Object.keys(coreSchema)) {
    check(primaryKeys.some(p => p.tab === table && p.definition === (table === 'couple_members' ? 'PRIMARY KEY (couple_id, user_id)' : 'PRIMARY KEY (id)')), `${table} 主键`)
  }
  const foreignKeys = await rows("select conrelid::regclass::text as tab, confrelid::regclass::text as target, confdeltype as deletion from pg_constraint where contype='f' and connamespace='public'::regnamespace")
  for (const table of ['couple_members', 'memories', 'albums', 'anniversaries']) {
    check(foreignKeys.some(f => f.tab === table && f.target === 'couples' && f.deletion === 'c'), `${table} 空间外键级联删除`)
  }
  check(foreignKeys.some(f => f.tab === 'couple_members' && f.target === 'profiles' && f.deletion === 'c'), '成员用户外键保留级联删除')
  check((await one(`select name_a, name_b, start_date::text from public.couples where id='${c}'`)).name_b === '阿乙', '成员名称回填')
  check((await one(`select role from public.couple_members where user_id='${a}'`)).role === 'a', '创建者角色 a')
  check((await one(`select body, title from public.memories where id='${memory}'`)).body === '原来的记忆', '记忆正文回填')
  assert.deepEqual((await one(`select photos, created_at from public.memories where id='${memory}'`)), preserved); checks++
  check((await rows('select * from public.memory_favorites')).length === 1, '关联收藏保留')
  check((await rows('select * from public.memory_media')).length === 1, '重复路径投影一次，原 JSON 不变')
  check((await one(`select media_type from public.album_media where id='${photo}'`)).media_type === 'photo', '相册 image -> photo')
  check((await one(`select media_path from public.whispers where id='${message}'`)).media_path === 'message/old.jpg', '旧 image_path 保留')
  check((await rows("select * from public.whispers where media_type='voice'")).length === 1, 'audio -> voice')
  check((await one(`select repeat_yearly from public.anniversaries where id='${anniversary}'`)).repeat_yearly === false, '旧 false 不被默认覆盖')

  await as(a)
  assert.deepEqual(await currentCoupleIds(), [{ couple_id: c }]); checks++
  check((await rows('select * from public.daily_answers')).length === 2, '双方回答后可以读取本空间的两条答案')
  check((await one(`select public.daily_answer_count('${uid(72)}') as count`)).count === 0, '答案计数辅助函数不泄露其他空间的数据')
  assert.deepEqual(sortedCounts(await rows(tableCountSql)), expectedCounts({ couples: 1, couple_members: 1, memories: 1, albums: 1, anniversaries: 1 })); checks++
  assert.deepEqual(await rows('select id::text from public.couples order by id'), [{ id: c }]); checks++
  assert.deepEqual(await rows("select name from storage.objects where bucket_id='avatars' order by name"), [{ name: `${a}/avatar.jpg` }, { name: `${b}/avatar.jpg` }]); checks++
  for (const bucket of managedBuckets) {
    const own = storagePath(bucket,c,'seed-self.jpg')
    assert.deepEqual((await db.query('select name from storage.objects where bucket_id=$1 order by name', [bucket])).rows, [{ name: own }]); checks++
    const added = storagePath(bucket,c,'uploaded.jpg')
    check((await db.query('insert into storage.objects(bucket_id,name) values($1,$2) returning id', [bucket,added])).rows.length === 1, `${bucket} 成员能上传自己的空间文件`)
    await reject(`insert into storage.objects(bucket_id,name) values('${bucket}','${storagePath(bucket,other,'forbidden-new.jpg')}')`, /row-level security/, `${bucket} 跨空间上传被拒绝`)
    await reject(`insert into storage.objects(bucket_id,name) values('${bucket}','${storagePath(bucket,'not-a-uuid','forbidden-new.jpg')}')`, /row-level security/, `${bucket} 畸形 UUID 路径安全拒绝`)
    await reject(`insert into storage.objects(bucket_id,name) values('${bucket}','${c}')`, /row-level security/, `${bucket} 无目录的对象名被拒绝`)
    assert.deepEqual((await db.query('update storage.objects set name=$1 where bucket_id=$2 and name=$3 returning id', [storagePath(bucket,other,'moved.jpg'),bucket,added])).rows, []); checks++
    assert.deepEqual((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning id', [bucket,storagePath(bucket,other,'seed-other.jpg')])).rows, []); checks++
    check((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning id', [bucket,added])).rows.length === 1, `${bucket} 成员可清理自己空间的文件`)
  }
  await reject(`insert into storage.objects(bucket_id,name) values('message-media','${c}/wrong/blocked.webm')`, /row-level security/, '消息文件必须放在 messages 子目录')
  await reject(`insert into storage.objects(bucket_id,name) values('message-media','${c}/messages')`, /row-level security/, '消息路径必须包含文件名')
  await admin()
  const helperPrivileges = await one("select has_function_privilege('authenticated','public.user_couple_ids()','EXECUTE') as member, has_function_privilege('anon','public.user_couple_ids()','EXECUTE') as anonymous")
  check(helperPrivileges.member && !helperPrivileges.anonymous, '成员辅助函数显式授权 authenticated，并禁止匿名执行')
  await as(a)
  assert.deepEqual(await rows('select id::text from public.couples order by id'), [{ id: c }]); checks++
  assert.deepEqual(await rows(`update public.couples set cover_path='cover/from-a.jpg' where id='${c}' returning id::text`), [{ id: c }]); checks++
  await reject(`insert into public.couples(name,relationship_start,name_a,name_b,start_date,created_by)
    values('不能直接新建','2026-10-28','甲','乙','2026-10-28','${a}')`, /row-level security|permission denied for table couples/, '只授予读取更新，不开放直接新建空间')
  assert.deepEqual(await directMemberships(), [{ couple_id: c, user_id: a }]); checks++
  check((await rows(`select * from public.couple_members where user_id='${b}'`)).length === 0, '成员 A 不能直接读取伴侣成员行')
  assert.deepEqual(await rows('select m.couple_id::text,c.name from public.couple_members m join public.couples c on c.id=m.couple_id'), [{ couple_id: c, name: '旧空间' }]); checks++
  assert.deepEqual(await rows('select user_id::text from public.get_couple_profiles() order by user_id'), [{ user_id: a }, { user_id: b }]); checks++
  check((await one(`select public.is_couple_member('${c}','${b}') as member`)).member, '定义者权限成员校验仍能验证伴侣')
  await db.exec(`insert into public.couple_letters(couple_id,sender_id,recipient_id,content)
    values('${c}','${a}','${b}','成员读取收紧后仍能发送');`)
  check((await rows("select * from public.couple_letters where content='成员读取收紧后仍能发送'")).length === 1, '合法伴侣情书仍可发送')
  await reject(`insert into public.couple_letters(couple_id,sender_id,recipient_id,content)
    values('${c}','${a}','${outsider}','错误收件人')`, /row-level security/, '情书不能发送给其他空间成员')
  await reject(`insert into public.couple_letters(couple_id,sender_id,recipient_id,content)
    values('${c}','${b}','${a}','伪造发送者')`, /row-level security/, '情书不能伪造发送者')
  await admin()
  await db.exec('revoke select on public.couple_members from authenticated;')
  try {
    await as(a)
    await reject('select * from public.couple_members', /permission denied/, '普通调用者失去成员表直接读取权限')
    assert.deepEqual(await currentCoupleIds(), [{ couple_id: c }]); checks++
  } finally {
    await admin()
    await db.exec('grant select on public.couple_members to authenticated;')
    await as(a)
  }
  await db.exec(`insert into public.memories(couple_id,author_id,content,memory_date) values('${c}','${a}','旧客户端新增','2025-01-01');`)
  check((await one("select body from public.memories where content='旧客户端新增'")).body === '旧客户端新增', '旧记忆 INSERT')
  await db.exec(`insert into public.memories(couple_id,date,title,body) values('${c}','2025-01-02','新标题','新正文');`)
  check((await one("select content, author_role from public.memories where title='新标题'")).author_role === 'a', '新记忆 INSERT 补真实作者')
  await db.exec(`insert into public.memories(couple_id,date,title) values('${c}','2025-01-03','只有标题');`)
  check((await one("select content,body from public.memories where title='只有标题'")).body === null, '可空正文保留，旧内容回退标题')
  await db.exec(`update public.memories set body='新版正文', date='2025-03-03' where id='${memory}';`)
  check((await one(`select content,memory_date::text from public.memories where id='${memory}'`)).content === '新版正文', '新字段 UPDATE 同步旧字段')
  await db.exec(`update public.memories set content='旧版修改' where id='${memory}';`)
  check((await one(`select body from public.memories where id='${memory}'`)).body === '旧版修改', '旧字段 UPDATE 同步新字段')
  await reject(`update public.memories set date='2025-02-02', memory_date='2025-02-03' where id='${memory}'`, /冲突/, '日期冲突拒绝')
  await reject(`insert into public.memories(couple_id,date,title,author_role) values('${c}','2025-01-01','冒充','b')`, /角色一致/, '不可冒充另一作者角色')
  await reject(`insert into public.memories(couple_id,date,title,author_id) values('${c}','2025-01-01','伪造作者','${b}')`, /author_id 必须是当前用户/, '成员新增记忆不能伪造真实作者')
  await db.exec(`insert into public.albums(couple_id,title) values('${c}','新相册');`)
  check((await one("select name from public.albums where title='新相册'")).name === '新相册', '新相册补旧列')
  await db.exec(`insert into public.anniversaries(couple_id,title,target_date,repeat_yearly) values('${c}','新版单次','2026-10-27',false);`)
  check((await one("select recurring from public.anniversaries where title='新版单次'")).recurring === false, '新 false 不被默认覆盖')
  await db.exec(`insert into public.anniversaries(couple_id,created_by,title,event_date,recurring) values('${c}','${a}','旧版单次','2026-10-27',false);`)
  check((await one("select repeat_yearly from public.anniversaries where title='旧版单次'")).repeat_yearly === false, '旧客户端 false INSERT')
  await db.exec(`insert into public.anniversaries(couple_id,title,target_date) values('${c}','默认每年','2026-10-27');`)
  check((await one("select recurring from public.anniversaries where title='默认每年'")).recurring === true, '缺省每年重复')
  await db.exec(`insert into public.anniversaries(couple_id,title,target_date,repeat_yearly,recurring)
    values('${c}','兼容旧 false','2026-10-27',true,false);`)
  check((await one("select repeat_yearly,recurring from public.anniversaries where title='兼容旧 false'")).repeat_yearly === false, 'INSERT 默认值歧义保留旧 false')
  await reject(`insert into public.anniversaries(couple_id,title,target_date,repeat_yearly,recurring)
    values('${c}','显式冲突','2026-10-27',false,true)`, /冲突/, '其他 INSERT 冲突仍拒绝')
  await db.exec("update public.anniversaries set repeat_yearly=true,recurring=false where title='兼容旧 false';")
  check((await one("select recurring from public.anniversaries where title='兼容旧 false'")).recurring === true, 'UPDATE 按实际变更的新字段同步')
  await db.exec("update public.anniversaries set recurring=false where title='兼容旧 false';")
  check((await one("select repeat_yearly from public.anniversaries where title='兼容旧 false'")).repeat_yearly === false, '旧字段 UPDATE false 仍同步')
  await reject(`update public.anniversaries set target_date='2028-01-01',event_date='2028-01-02' where title='兼容旧 false'`, /冲突/, '两边同时改变且冲突时仍拒绝')
  await db.exec(`update public.couples set start_date='2023-05-21' where id='${c}';
    update public.albums set name='旧相册改名' where id='${album}';
    update public.anniversaries set repeat_yearly=true where id='${anniversary}';`)
  check((await one(`select relationship_start::text as d from public.couples where id='${c}'`)).d === '2023-05-21', '起始日双向映射')
  check((await one(`select title from public.albums where id='${album}'`)).title === '旧相册改名', '相册名称双向映射')
  check((await one(`select recurring from public.anniversaries where id='${anniversary}'`)).recurring === true, '重复开关 UPDATE')

  await db.exec(`insert into public.memory_media(memory_id,storage_path,media_type) values('${memory}','new/photo.jpg','photo');`)
  check((await one(`select photos from public.memories where id='${memory}'`)).photos.some(p => p.path === 'new/photo.jpg'), '新照片同步旧 JSON')
  check((await one(`select photos from public.memories where id='${memory}'`)).photos[0].thumbPath === 'couple/thumb.webp', '缩略图元数据不丢失')
  await db.exec(`insert into public.memory_media(memory_id,storage_path,media_type) values('${memory}','new/video.mp4','video');`)
  check(!(await one(`select photos from public.memories where id='${memory}'`)).photos.some(p => p.path === 'new/video.mp4'), '视频不进入旧图片渲染列表')
  await db.exec(`delete from public.memory_media where storage_path='new/photo.jpg';`)
  check(!(await one(`select photos from public.memories where id='${memory}'`)).photos.some(p => p.path === 'new/photo.jpg'), '新表删除同步旧 JSON')
  await reject(`update public.memory_media set memory_id='${uid(22)}' where memory_id='${memory}'`, /不可修改/, '媒体不能重新归属')
  await reject(`update public.memories set author_id='${b}' where id='${memory}'`, /不可修改/, '普通调用者不能转移作者')
  await reject(`update public.memories set photos=photos || '[{"path":"new/video.mp4"}]'::jsonb where id='${memory}'`, /同时作为照片和视频/, '路径类型冲突拒绝')
  const beforeLimit = await one(`select photos from public.memories where id='${memory}'`)
  await reject(`insert into public.memory_media(memory_id,storage_path,media_type)
    select '${memory}', 'limit/' || n || '.jpg', 'photo' from generate_series(1,7) n`, /check constraint/, '原 6 张图片限制保留')
  assert.deepEqual((await one(`select photos from public.memories where id='${memory}'`)).photos, beforeLimit.photos); checks++
  await db.exec(`update public.memories set photos=photos || '[{"path":"old/new.jpg"}]'::jsonb where id='${memory}';`)
  check((await rows("select * from public.memory_media where storage_path='old/new.jpg'")).length === 1, '旧 JSON 新增同步新表')
  check((await rows("select * from public.memory_media where media_type='video'")).length === 1, '旧 JSON 修改保留新视频')
  await db.exec(`insert into public.album_media(album_id,storage_path,media_type) values('${album}','new/album.mp4','video');`)
  check((await rows("select * from public.album_photos where path='new/album.mp4' and media_type='video'")).length === 1, '新相册媒体同步旧表')
  await db.exec(`delete from public.album_media where storage_path='new/album.mp4';`)
  check((await rows("select * from public.album_photos where path='new/album.mp4'")).length === 0, '新相册媒体删除同步')
  await db.exec(`insert into public.album_photos(album_id,uploaded_by,path) values('${album}','${a}','old/new-album.jpg');`)
  check((await rows("select * from public.album_media where storage_path='old/new-album.jpg'")).length === 1, '旧相册新增同步')
  await db.exec("delete from public.album_photos where path='old/new-album.jpg';")
  check((await rows("select * from public.album_media where storage_path='old/new-album.jpg'")).length === 0, '旧相册删除同步')
  await db.exec(`insert into public.whispers(couple_id,sender_id,body,media_path,media_type) values('${c}','${a}','新悄悄话','new/voice.webm','voice');`)
  check((await rows("select * from public.messages where content='新悄悄话' and media_type='audio'")).length === 1, '新悄悄话同步旧消息')

  await as(b)
  assert.deepEqual(await currentCoupleIds(), [{ couple_id: c }]); checks++
  for (const bucket of managedBuckets) {
    check((await db.query('select name from storage.objects where bucket_id=$1', [bucket])).rows.length === 1, `${bucket} 伴侣可读取共享文件`)
    check((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning id', [bucket,storagePath(bucket,c,'seed-self.jpg')])).rows.length === 1, `${bucket} 伴侣也可删除共享文件`)
  }
  assert.deepEqual(await rows("select name from storage.objects where bucket_id='avatars' order by name"), [{ name: `${a}/avatar.jpg` }, { name: `${b}/avatar.jpg` }]); checks++
  assert.deepEqual(await rows(`update public.albums set title='不能修改他人相册' where id='${album}' returning id`), []); checks++
  assert.deepEqual(await rows(`delete from public.albums where id='${album}' returning id`), []); checks++
  check((await rows(`update public.anniversaries set note='共同提醒' where id='${anniversary}' returning id`)).length === 1, '纪念日仍允许同空间成员更新')
  assert.deepEqual(await rows(`delete from public.anniversaries where id='${anniversary}' returning id`), []); checks++
  assert.deepEqual(await rows('select id::text from public.couples order by id'), [{ id: c }]); checks++
  assert.deepEqual(await rows(`update public.couples set cover_path='cover/from-b.jpg' where id='${c}' returning id::text`), [{ id: c }]); checks++
  assert.deepEqual(await directMemberships(), [{ couple_id: c, user_id: b }]); checks++
  check((await rows("select * from public.couple_letters where content='成员读取收紧后仍能发送'")).length === 1, '伴侣仍可读取收到的情书')
  const originalAuthor = await one(`select author_id,author_role,created_at from public.memories where id='${memory}'`)
  assert.deepEqual(await rows(`update public.memories set body='伴侣共同编辑',date='2025-06-01' where id='${memory}' returning content,memory_date::text`), [{ content: '伴侣共同编辑', memory_date: '2025-06-01' }]); checks++
  assert.deepEqual(await one(`select author_id,author_role,created_at from public.memories where id='${memory}'`), originalAuthor); checks++
  await db.exec(`update public.memories set content='伴侣旧字段编辑' where id='${memory}';`)
  check((await one(`select body from public.memories where id='${memory}'`)).body === '伴侣旧字段编辑', '共同编辑仍保持旧 content 和新 body 同步')
  await reject(`update public.memories set author_id='${b}' where id='${memory}'`, /归属不可修改/, '伴侣编辑不能更改真实作者')
  await reject(`update public.memories set author_role='b' where id='${memory}'`, /角色一致/, '伴侣编辑不能篡改原作者角色')
  await reject(`update public.memories set couple_id='${other}' where id='${memory}'`, /归属不可修改/, '现有归属保护不允许转移空间')
  await reject(`update public.memories set created_at=created_at+interval '1 day' where id='${memory}'`, /归属不可修改/, '共同编辑不允许篡改创建时间')
  await db.exec(`insert into public.memories(id,couple_id,date,title,photos) values('${uid(81)}','${c}','2026-10-28','成员 B 新增','[{"path":"shared/delete.jpg"}]');`)
  assert.deepEqual(await one(`select author_id,author_role from public.memories where id='${uid(81)}'`), { author_id: b, author_role: 'b' }); checks++
  await db.exec("update public.messages set read_at=now() where media_path='message/voice.webm';")
  check((await one("select read_at from public.whispers where media_path='message/voice.webm'")).read_at !== null, '旧已读同步新消息')
  await db.exec(`update public.whispers set read_at=now() where id='${message}';`)
  check((await one(`select read_at from public.messages where id='${message}'`)).read_at !== null, '新已读同步旧消息')
  await reject(`update public.whispers set body='篡改' where id='${message}'`, /只允许收件人|permission denied/, '收件人不能修改正文')
  await reject(`insert into public.memory_media(memory_id,storage_path,media_type) values('${memory}','forbidden.jpg','photo')`, /无法访问|作者|row-level security/, '伙伴不可改作者媒体')
  check(!(await one(`select photos from public.memories where id='${memory}'`)).photos.some(p => p.path === 'forbidden.jpg'), '媒体权限拒绝时回滚 BEFORE 触发器对记忆的改动')
  await reject(`insert into public.whispers(couple_id,sender_id,body) values('${c}','${a}','伪造')`, /row-level security/, '不能冒充发送者')
  await db.exec(`delete from public.album_media where id='${photo}';`)
  check((await rows(`select * from public.album_photos where id='${photo}'`)).length === 0, '沿用 020 伙伴可删相册媒体')
  await as(a)
  assert.deepEqual(await rows(`delete from public.memories where id='${uid(81)}' returning id::text`), [{ id: uid(81) }]); checks++
  check((await rows(`select * from public.memory_media where memory_id='${uid(81)}'`)).length === 0, '成员删除伴侣记忆时级联清理媒体')
  await db.exec(`delete from public.whispers where body='新悄悄话';`)
  check((await rows("select * from public.messages where content='新悄悄话'")).length === 0, '新消息撤回同步旧表')
  await db.exec(`delete from public.messages where id='${message}';`)
  check((await rows(`select * from public.whispers where id='${message}'`)).length === 0, '旧消息撤回同步新表')

  await as(outsider)
  assert.deepEqual(await currentCoupleIds(), [{ couple_id: other }]); checks++
  assert.deepEqual(await rows('select answer from public.daily_answers'), [{ answer: '其他空间的回答' }]); checks++
  check((await one(`select public.daily_answer_count('${uid(71)}') as count`)).count === 0, '外部成员无法通过辅助函数统计双方已答的内容')
  assert.deepEqual(sortedCounts(await rows(tableCountSql)), expectedCounts({ couples: 1, couple_members: 1, memories: 0, albums: 0, anniversaries: 0 })); checks++
  for (const bucket of managedBuckets) {
    assert.deepEqual((await db.query('select name from storage.objects where bucket_id=$1', [bucket])).rows, [{ name: storagePath(bucket,other,'seed-other.jpg') }]); checks++
  }
  assert.deepEqual(await rows("select name from storage.objects where bucket_id='avatars'"), [{ name: `${outsider}/avatar.jpg` }]); checks++
  check((await rows(`select * from public.memories where couple_id='${c}'`)).length === 0, '其他空间用户无法读取记忆')
  await reject(`insert into public.memories(couple_id,date,title) values('${c}','2026-10-28','越界写入')`, /row-level security/, '其他空间用户无法新增记忆')
  assert.deepEqual(await rows(`update public.memories set body='越界修改' where id='${memory}' returning id`), []); checks++
  assert.deepEqual(await rows(`delete from public.memories where id='${memory}' returning id`), []); checks++
  assert.deepEqual(await rows('select id::text from public.couples order by id'), [{ id: other }]); checks++
  assert.deepEqual(await rows(`update public.couples set cover_path='forbidden.jpg' where id='${c}' returning id::text`), []); checks++
  await admin()
  check((await one(`select cover_path from public.couples where id='${c}'`)).cover_path === 'cover/from-b.jpg', '外部成员更新零行且原记录不变')
  check((await one(`select body from public.memories where id='${memory}'`)).body === '伴侣旧字段编辑', '越界更新删除均未改动原记忆')
  await as(outsider)
  assert.deepEqual(await directMemberships(), [{ couple_id: other, user_id: outsider }]); checks++
  check((await rows(`select * from public.couple_members where couple_id='${c}'`)).length === 0, '外部成员不能读取情侣成员行')
  assert.deepEqual(await rows('select user_id::text from public.get_couple_profiles()'), [{ user_id: outsider }]); checks++
  check((await rows('select * from public.memory_media')).length === 0, '外部成员看不到媒体')
  check((await rows('select * from public.album_media')).length === 0, '外部成员看不到相册')
  check((await rows('select * from public.whispers')).length === 0, '外部成员看不到悄悄话')
  await reject(`insert into public.memory_media(memory_id,storage_path,media_type) values('${memory}','outsider.mp4','video')`, /无法访问|row-level security/, '外部成员不能插入视频')
  await reject(`insert into public.album_media(album_id,storage_path,media_type) values('${album}','outsider.jpg','photo')`, /row-level security/, '外部成员不能插入相册')
  await reject(`insert into public.whispers(couple_id,sender_id,body) values('${c}','${outsider}','越权')`, /row-level security/, '外部成员不能发消息')
  await db.exec("reset role; set role anon; select set_config('request.jwt.claim.sub','',false);")
  await reject('select public.user_couple_ids()', /permission denied for function user_couple_ids/, '匿名不能调用成员辅助函数')
  check((await rows("select * from storage.objects where bucket_id in ('memory-photos','album-media','message-media','couple-media')")).length === 0, '匿名无法读取私有 bucket 文件')
  await reject(`insert into storage.objects(bucket_id,name) values('memory-photos','${storagePath('memory-photos',c,'anonymous.jpg')}')`, /row-level security/, '匿名无法上传私有文件')
  assert.deepEqual(await rows("delete from storage.objects where bucket_id in ('memory-photos','album-media','message-media','couple-media') returning id"), []); checks++
  assert.deepEqual(await rows("update storage.objects set name='anonymous.jpg' where bucket_id in ('memory-photos','album-media','message-media','couple-media') returning id"), []); checks++
  assert.deepEqual(await rows("select name from storage.objects where bucket_id='avatars'"), []); checks++
  await admin()
  await db.exec('grant select on public.couple_members to anon; grant select,update on public.couples to anon;')
  await db.exec('grant select,update,delete on public.memories to anon;')
  try {
    await db.exec("set role anon; select set_config('request.jwt.claim.sub','',false);")
    assert.deepEqual(await directMemberships(), []); checks++
    assert.deepEqual(await rows('select id from public.couples'), []); checks++
    assert.deepEqual(await rows(`update public.couples set cover_path='anonymous.jpg' where id='${c}' returning id`), []); checks++
    assert.deepEqual(await rows('select id from public.memories'), []); checks++
    assert.deepEqual(await rows(`update public.memories set body='匿名修改' where id='${memory}' returning id`), []); checks++
    assert.deepEqual(await rows(`delete from public.memories where id='${memory}' returning id`), []); checks++
  } finally {
    await admin()
    await db.exec("revoke select on public.couple_members from anon; revoke select,update on public.couples from anon; revoke select,update,delete on public.memories from anon; set role anon;")
  }
  await reject('select * from public.whispers', /permission denied/, '匿名无新表权限')

  await admin()
  await db.exec(`insert into auth.users(id,email) values('${uid(4)}','four@example.test'),('${uid(5)}','five@example.test');`)
  await as(uid(4))
  assert.deepEqual(await currentCoupleIds(), []); checks++
  const invite = (await one("select public.create_couple_with_invitation('RPC 创建', '2026-10-27') as code")).code
  const created = (await one(`select * from public.couples where created_by='${uid(4)}'`)).id
  assert.deepEqual(await currentCoupleIds(), [{ couple_id: created }]); checks++
  check((await one(`select role from public.couple_members where user_id='${uid(4)}'`)).role === 'a', '旧创建 RPC 自动角色')
  await as(uid(5))
  await db.query('select public.accept_couple_invitation($1)', [invite])
  check((await one(`select role from public.couple_members where user_id='${uid(5)}'`)).role === 'b', '旧加入 RPC 自动角色')
  check((await one(`select name_b from public.couples where id='${created}'`)).name_b === 'five', '新加入伙伴姓名补齐')
  await as(uid(4))
  await db.exec(`insert into public.memories(couple_id,date,title) values('${created}','2026-10-27','待移交记忆');
    insert into public.albums(couple_id,title) values('${created}','待移交相册');
    select public.prepare_account_deletion();`)
  await as(uid(5))
  check((await one("select author_id,author_role from public.memories where title='待移交记忆'")).author_role === 'b', '旧账号移交 RPC 重新计算作者角色')
  check((await one("select created_by from public.albums where title='待移交相册'")).created_by === uid(5), '旧账号移交 RPC 保留相册')
  await admin()
  await db.exec(`insert into auth.users(id,email) values('${uid(6)}','six@example.test');`)
  await reject(`insert into public.couple_members(couple_id,user_id) values('${c}','${uid(6)}')`, /unique constraint/, '第三位成员拒绝，不覆盖旧角色')
  await reject(`update public.couple_members set role='b' where user_id='${a}'`, /不可修改/, '成员角色不可改')
  await db.exec(`delete from public.memories where id='${memory}';`)
  check((await rows(`select * from public.memory_media where memory_id='${memory}'`)).length === 0, '删除记忆级联媒体')
  await db.exec(`delete from public.couples where id='${c}';`)
  check((await rows('select * from public.whispers')).length === 0, '删除空间级联新旧消息')
  check((await rows('select * from public.album_media')).length === 0, '删除空间级联新旧相册')
  console.log(JSON.stringify({ passed: checks, engine: '@electric-sql/pglite 0.5.12', database: 'isolated in-memory PostgreSQL', cloudApplied: false }, null, 2))
} finally {
  await db.close()
}
