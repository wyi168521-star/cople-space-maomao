// 仅用于全新本地初始化：保留原 SQL 文件，按真实依赖生成一份可重放的基础迁移。
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const migrations = path.join(root, 'migrations')
const archive = path.join(root, 'legacy-migrations')
const baselineName = '20261026000000_baseline.sql'
const alignmentName = '20261027162443_align_schema.sql'
const legacy = name => `legacy-migrations/${name}`
const sources = [
  ...['001_auth_and_couples.sql', '002_memories.sql', '003_ai_saved_works.sql',
    '003001_albums.sql', '004_together_list.sql', '005_anniversaries.sql'].map(legacy),
  'setup_messages.sql', 'upgrade_message_media.sql', 'upgrade_album_media.sql',
  'upgrade_couple_letters.sql', 'setup_account_management.sql', 'setup_couple_cover.sql',
  'upgrade_love_letter.sql', 'upgrade_ai_date_plans.sql', 'hotfix_invitation_code.sql',
  'setup_heart_ai.sql',
  ...['006_message_audio.sql', '007_letters_realtime.sql', '008_pet_streak.sql',
    '009_pet_style.sql', '010_pet_evolution.sql', '011_security_hardening.sql',
    '012_account_security.sql', '013_call_history_and_member_realtime.sql',
    '014_media_variants.sql', '015_push_tokens.sql', '016_streak_status.sql',
    '017_streak_protection.sql', '018_streak_history_rewards.sql',
    '019_media_interactions.sql', '020_album_photo_realtime_delete.sql',
    '20261027090005_init.sql', '20261027161714_align_core_schema.sql'].map(legacy),
]

await mkdir(archive, { recursive: true })
const allowed = new Set([baselineName, alignmentName, ...sources.filter(s => s.startsWith('legacy-migrations/')).map(s => path.basename(s))])
for (const entry of await readdir(migrations, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.sql')) continue
  if (!allowed.has(entry.name)) {
    // 只整理已记录的历史来源；后续新增的正常增量迁移继续原位保留。
    if (/^\d{14}_.+\.sql$/.test(entry.name) && entry.name > alignmentName) continue
    throw new Error(`未识别迁移，拒绝自动整理：${entry.name}`)
  }
  if (entry.name === baselineName || entry.name === alignmentName) continue
  const target = path.join(archive, entry.name)
  try {
    await readFile(target)
    throw new Error(`归档文件已存在，拒绝覆盖：${entry.name}`)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await rename(path.join(migrations, entry.name), target)
}

const sections = []
const manifest = []
for (const source of sources) {
  const bytes = await readFile(path.join(root, source))
  const digest = createHash('sha256').update(bytes).digest('hex')
  manifest.push({ source, sha256: digest, bytes: bytes.length })
  // 去掉各来源的事务外壳，再把整份基础结构放入一个显式事务。
  // 当前 CLI 不会自动包事务，原升级的 LOCK TABLE 必须在事务中运行。
  // PL/pgSQL 的 BEGIN 没有分号，因此不会被这条精确的整行规则影响。
  const statements = bytes.toString('utf8').replace(/^[ \t]*(?:begin|commit);[ \t]*\r?$/gim,
    '-- 来源文件的事务外壳已省略，由整份基础迁移统一管理。')
  sections.push(`-- ============================================================================\n-- SOURCE: ${source}\n-- SHA256: ${digest}\n-- ============================================================================\n${statements.trimEnd()}\n`)
}
const header = `-- CoupleSpace：全新本地数据库的连贯基础结构。\n-- 原迁移完整归档于 supabase/legacy-migrations/，没有丢弃仍在使用的业务表。\n-- messages / couple_letters 等基础表先创建，再执行依赖它们的历史升级。\n-- 此合并历史用于本地重新初始化；现有部署继续使用原有迁移历史。\n-- 由 node supabase/scripts/rebuild-baseline.mjs 根据带哈希的来源清单生成。\n\n`
await writeFile(path.join(migrations, baselineName), header + 'begin;\n\n' + sections.join('\n') + '\ncommit;\n', 'utf8')
await writeFile(path.join(archive, 'baseline-sources.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`基础迁移已生成：${baselineName}（${sources.length} 个按依赖排序的来源）`)
console.log(`活动迁移：${(await readdir(migrations)).filter(s => s.endsWith('.sql')).sort().join(', ')}`)
