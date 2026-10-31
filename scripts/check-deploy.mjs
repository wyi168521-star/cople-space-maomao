import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const root = fileURLToPath(new URL('../', import.meta.url))
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const read = path => readFileSync(new URL('../' + path, import.meta.url))
const candidates = [...new Set(git(['ls-files', '-c', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean))]
const tracked = git(['ls-files', '-z']).split('\0').filter(Boolean)
const examples = new Set(['.env.example', '.env.production.example'])
const isExample = path => /(?:^|\/)\.env(?:\.[^/]+)?\.example$/.test(path)
const issues = []
const fail = message => issues.push(message)

const unwanted = path => /(?:^|\/)(?:node_modules|\.nuxt|\.output|\.vercel|\.nuxt-preflight|\.output-preflight|\.temp)(?:\/|$)/.test(path)
  || (/(?:^|\/)\.env(?:\.|$)/.test(path) && !isExample(path))
for (const path of tracked) if (unwanted(path)) fail(`不应跟踪的环境文件或构建缓存：${path}`)
for (const path of ['.env', '.env.local', '.env.production', 'node_modules/probe', '.nuxt/probe', '.output/probe', '.vercel/probe']) {
  try { git(['check-ignore', '-q', '--no-index', path]) } catch { fail(`Git 忽略规则缺失：${path}`) }
}

// 本地 CLI 配置、测试和开发文档不参与线上应用打包，允许其使用回环地址。
const runtimeFiles = candidates.filter(path => path === 'nuxt.config.ts' || /^(?:app|server|shared|public)\//.test(path))
const localUrl = /https?:\/\/(?:localhost\b|(?:\d{1,3}\.)?localhost\b|127\.[\d.]+|192\.168\.[\d.]+|10\.[\d.]+|172\.(?:1[6-9]|2\d|3[01])\.[\d.]+|169\.254\.[\d.]+|0\.0\.0\.0|\[::1\])/i
for (const path of [...runtimeFiles, ...examples]) {
  const text = read(path).toString('utf8')
  if (localUrl.test(text)) fail(`线上代码或环境模板包含本机地址：${path}`)
}
for (const path of examples) {
  const env = parseEnv(read(path).toString('utf8'))
  if (!env.NUXT_PUBLIC_SUPABASE_URL?.startsWith('https://')) fail(`云端 Supabase URL 模板需使用 HTTPS：${path}`)
  for (const name of Object.keys(env)) if (/^NUXT_PUBLIC_.*(?:DEEPSEEK|SERVICE_ROLE|SECRET|APPSIGN)/i.test(name)) {
    fail(`私有凭据不应使用公开变量名：${path}（${name}）`)
  }
}

const secrets = []
for (const path of ['.env', '.env.local', '.env.production']) {
  if (!existsSync(new URL('../' + path, import.meta.url))) continue
  const env = parseEnv(read(path).toString('utf8'))
  for (const [name, value] of Object.entries(env)) {
    if (/(?:DEEPSEEK_API_KEY|SERVICE_ROLE_KEY|ZEGO_SERVER_SECRET|ZEGO_APPSIGN|PRIVATE_KEY)/i.test(name) && value.length >= 16) secrets.push(value)
  }
}
for (const path of candidates) {
  let buffer
  try { buffer = read(path) } catch { continue }
  // 只报告文件名，不回显密钥；同时检查已跟踪和即将新增的文件。
  if (secrets.some(secret => buffer.includes(secret))) fail(`待提交文件包含本机已配置的私有密钥：${path}`)
  if (/\.(?:ts|js|mjs|vue|json|md|sql|toml|example)$/.test(path)
    && /(?:sk-[A-Za-z0-9_-]{24,}|sb_secret_[A-Za-z0-9_-]{16,})/.test(buffer.toString('utf8'))) {
    fail(`待提交文件疑似包含明文私有凭据：${path}`)
  }
}

if (issues.length) {
  for (const issue of new Set(issues)) console.error('FAIL ' + issue)
  process.exitCode = 1
} else {
  console.log(`PASS 线上代码及环境模板没有固定的本机地址（检查 ${runtimeFiles.length} 个应用文件）。`)
  console.log('PASS Supabase 生产模板使用环境变量和 HTTPS 云端占位地址。')
  console.log('PASS 私有环境文件、依赖和构建缓存均被忽略，未被 Git 跟踪。')
  console.log(`PASS ${candidates.length} 个待提交候选文件未发现已配置的私有密钥或常见明文凭据。`)
  console.log('本机 .env.local 仅用于本地开发；云端请独立配置生产变量。')
}
