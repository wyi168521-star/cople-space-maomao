// 从真实本地 Supabase 导出 Nuxt 类型；CLI 失败时不覆盖已有类型。
import { spawnSync } from 'node:child_process'
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('../../', import.meta.url))
const cli = fileURLToPath(new URL('../../node_modules/supabase/dist/supabase.js', import.meta.url))
const target = fileURLToPath(new URL('../../app/types/database.generated.ts', import.meta.url))
const temporary = target + '.tmp'
const result = spawnSync(process.execPath, [cli, 'gen', 'types', 'typescript', '--local'], {
  cwd: projectRoot,
  encoding: 'utf8',
  env: process.env,
  maxBuffer: 16 * 1024 * 1024,
})

if (result.error || result.status !== 0) {
  console.error(result.stderr || result.error?.message || '本地 Supabase 类型生成失败')
  process.exit(result.status || 1)
}
if (!/export type Database\s*=/.test(result.stdout)) {
  console.error('CLI 未返回有效 Database schema，现有类型未被修改')
  process.exit(1)
}

const schema = result.stdout.replace(/[ \t]+$/gm, '')
await mkdir(new URL('../../app/types/', import.meta.url), { recursive: true })
try {
  await writeFile(temporary, schema, 'utf8')
  await rename(temporary, target)
} catch (error) {
  await unlink(temporary).catch(() => {})
  throw error
}
console.log(`已从本地数据库生成 app/types/database.generated.ts（${schema.split('\n').length} 行）`)
