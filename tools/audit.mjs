// Never-list + contract check. Usage: node tools/audit.mjs [files...]  (no args = every published file)
// Exit 0 = clean, 1 = findings. Zero dependencies.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SKIP = new Set(['research', 'node_modules', '.git', '.claude', 'tools', 'shots', 'test'])
const TEXT = new Set(['.html', '.svg', '.json', '.js', '.css', '.md', '.mjs'])

const NEVER = [
  [/qkgfhsdppslwunarczeq|supabase\.co\b/i, 'Supabase ref / URL'],
  [/\b(TELEGRAM|CASCADE|OPENROUTER|GEMINI|SUPABASE|GOLDEN|PROBE)_[A-Z0-9_]{2,}/, 'secret / env-var name'],
  [/\b[A-Z][A-Z0-9]*_[A-Z0-9_]*(KEY|SECRET|TOKEN)\b/, 'secret / env-var name'],
  [/-100\d{6,}/, 'Telegram chat id'],
  [/\b(sk-or-|AIza|ghp_|eyJhbGci)[\w-]{6,}/, 'API key / token'],
  [/[A-Za-z]:\\[\w\\. -]+/, 'Windows path'],
  [/(^|[\s`'"(])(F|SS|N|src)\/[\w-]+\//, 'source path'],
  [/\.(ts|tsx|sql|gs|mjs|js):\d+/, 'line-number citation'],
  [/\balfred\b|trycloudflare|cfargotunnel/i, 'internal host name'],
  [/cascade-admin-dashboard|script\.google\.com|https?:\/\/n8n\./i, 'admin / n8n / Apps Script URL'],
  [/run-sql-on-host|apply-release-on-host|supabase-backup|golden-run\.ts|probe-chat\.ts/i, 'runner / script name'],
  [/\bPIN\b[^.<\n]{0,25}\b\d{4,6}\b/, 'PIN digits'],
  [/door code[^.<\n]{0,25}\b\d{4,8}\b/i, 'door code digits'],
  [/(wi-?fi|password)\s*[:=]\s*\S+/i, 'Wi-Fi / password value'],
  [/\bLeyson\b/i, 'staff surname'],
]
const ALLOWED_EMAIL = /^(cascadereservations@gmail\.com|guest@example\.com)$/i
const ALLOWED_PHONE = /0917 ?000 ?0000|991 ?853 ?8269/
const ALLOWED_URL = /^https:\/\/(cascadereservations-del\.github\.io\/(Stay_At_CascadeGSC|Welcome-To-Cascades-|Cascade-Manual|CH-Cleaners-Checklist|Cascade-System-Guide)\/|m\.me\/cascade\.hideaway|fonts\.googleapis\.com|fonts\.gstatic\.com)/
const XMLNS = /^http:\/\/www\.w3\.org\//

const CONTRACT = readFileSync(join(ROOT, 'CONTRACT.md'), 'utf8')
const SHOTS = new Set(CONTRACT.match(/img\/[\w-]+\/[\w-]+\.webp/g))
const CHAPTERS = Object.fromEntries([...CONTRACT.matchAll(/^\| ([sa]\d+-[\w-]+) \| (\d+) \| \w+ \| (both|admin) \| (\w+) \|/gm)]
  .map((m) => [m[1], { order: +m[2], audience: m[3], roles: m[4] }]))
const glossPath = join(ROOT, 'content', 'glossary.json')
const GLOSS = existsSync(glossPath) ? JSON.parse(readFileSync(glossPath, 'utf8')) : null

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (SKIP.has(n)) continue
    const p = join(dir, n)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (TEXT.has(extname(n)) && n !== 'CONTRACT.md') out.push(p)
  }
  return out
}

const files = process.argv.slice(2).length ? process.argv.slice(2) : walk(ROOT)
const findings = []
const add = (f, line, msg) => findings.push(`${f}:${line}  ${msg}`)

for (const f of files) {
  const src = readFileSync(f, 'utf8')
  src.split('\n').forEach((l, i) => {
    for (const [re, what] of NEVER) if (re.test(l)) add(f, i + 1, `NEVER: ${what}: ${l.trim().slice(0, 120)}`)
    for (const e of l.match(/[\w.+-]+@[\w-]+\.[a-z][\w.]*/gi) || []) if (!ALLOWED_EMAIL.test(e)) add(f, i + 1, `NEVER: e-mail ${e}`)
    for (const p of l.match(/(\+?63 ?|0)9\d{2}[ -]?\d{3}[ -]?\d{4}/g) || []) if (!ALLOWED_PHONE.test(p)) add(f, i + 1, `NEVER: phone ${p}`)
    if (/\b\d{10,}\b/.test(l) && !/viewBox|\sd="|points=/.test(l)) add(f, i + 1, `CHECK: long digit run: ${l.trim().slice(0, 80)}`)
    for (const u of l.match(/https?:\/\/[^\s"'<>)\]`]+/g) || []) if (!ALLOWED_URL.test(u) && !XMLNS.test(u)) add(f, i + 1, `LINK: not an allowed public URL: ${u}`)
  })
  if (!/content[\\/]\d{3}-/.test(f)) continue
  // chapter contract checks
  const fm = src.match(/^﻿?<!--([\s\S]*?)-->/)
  if (!fm) { add(f, 1, 'CONTRACT: missing front-matter comment'); continue }
  const meta = Object.fromEntries(fm[1].split('\n').map((l) => l.match(/^\s*(\w+):\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]))
  const want = CHAPTERS[meta.id]
  if (!want) add(f, 1, `CONTRACT: unknown chapter id ${meta.id}`)
  else {
    const name = `${String(want.order).padStart(3, '0')}-${meta.id}.html`
    if (basename(f) !== name) add(f, 1, `CONTRACT: file name should be ${name}`)
    for (const k of ['audience', 'roles']) if (meta[k] !== want[k]) add(f, 1, `CONTRACT: ${k} is ${meta[k]}, contract says ${want[k]}`)
    if (+meta.order !== want.order) add(f, 1, `CONTRACT: order ${meta.order} != ${want.order}`)
  }
  for (const k of ['title', 'icon', 'summary']) if (!meta[k]) add(f, 1, `CONTRACT: missing ${k}`)
  const prefix = (meta.id || '').split('-')[0] + '-'
  for (const m of src.matchAll(/<h([34])(\s[^>]*)?>/g)) {
    const id = (m[2] || '').match(/id="([^"]+)"/)
    if (!id) add(f, 0, `CONTRACT: <h${m[1]}> without id`)
    else if (!id[1].startsWith(prefix)) add(f, 0, `CONTRACT: id ${id[1]} not prefixed ${prefix}`)
  }
  if (/<script|<style|\son[a-z]+=/i.test(src)) add(f, 0, 'CONTRACT: script/style/inline handler')
  if (meta.audience === 'both') for (const m of src.matchAll(/href="#(a\d+-[\w-]*)"/g)) add(f, 0, `CONTRACT: staff chapter links admin #${m[1]}`)
  for (const m of src.matchAll(/<img\b[^>]*>/g)) {
    const s = m[0].match(/src="([^"]+)"/)
    if (s && !SHOTS.has(s[1])) add(f, 0, `CONTRACT: image not in shot list: ${s[1]}`)
    if (!/alt="[^"]{3,}"/.test(m[0])) add(f, 0, 'CONTRACT: img without real alt')
  }
  if (GLOSS) for (const m of src.matchAll(/data-term="([^"]+)"/g)) if (!GLOSS[m[1]]) add(f, 0, `CONTRACT: glossary term missing: ${m[1]}`)
}

console.log(findings.length ? findings.join('\n') : `clean: ${files.length} file(s)`)
process.exit(findings.some((x) => !x.includes('  CHECK:')) ? 1 : 0)
