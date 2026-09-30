// Cascade System Guide build. Zero dependencies, Node stdlib only.
// Usage: node build.mjs [--src <dir containing content/>] [--out <dir>]
// Reads content/NNN-*.html, writes staff/index.html and admin/index.html under --out.
// Exit 1 on any error; nothing is written when there is an error.
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, createCipheriv, pbkdf2Sync, randomBytes } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))
// Cache-bust: a new asset hash makes returning browsers fetch the updated file from GitHub Pages.
const assetVer = (f) => createHash('sha1').update(readFileSync(join(HERE, 'assets', f))).digest('hex').slice(0, 8)
const argv = process.argv.slice(2)
const opt = (name, dflt) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : dflt
}
const SRC = opt('--src', HERE)
const OUT = opt('--out', HERE)

const errors = []
const warnings = []
const seen = new Set()
const fail = (m) => { if (!seen.has(m)) { seen.add(m); errors.push(m) } }
const warn = (m) => { if (!seen.has('w' + m)) { seen.add('w' + m); warnings.push(m) } }

// ---------- small html helpers ----------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const attr = (attrs, name) => {
  const m = attrs.match(new RegExp('(?:^|\\s)' + name + '="([^"]*)"'))
  return m ? m[1] : null
}
const hasClass = (attrs, cls) => {
  const c = attr(attrs, 'class')
  return !!c && c.split(/\s+/).includes(cls)
}
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
const text = (html) => decode(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

// index just after the tag that closes the one opening at `from`; -1 when unbalanced
function balanced(html, from, tag) {
  const re = new RegExp('<(/?)' + tag + '\\b', 'g')
  re.lastIndex = from
  let depth = 0
  let m
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1
    if (depth === 0) {
      const gt = html.indexOf('>', m.index)
      return gt < 0 ? -1 : gt + 1
    }
  }
  return -1
}

// ---------- inputs ----------
const sprite = readFileSync(join(HERE, 'assets', 'icons.svg'), 'utf8').replace(/<\?xml[^>]*\?>/, '').trim()
const spriteIds = new Set([...sprite.matchAll(/\bid="(i-[\w-]+)"/g)].map((m) => m[1]))

let glossary = null
const gPath = join(SRC, 'content', 'glossary.json')
if (existsSync(gPath)) {
  try { glossary = JSON.parse(readFileSync(gPath, 'utf8')) } catch (e) { fail('content/glossary.json is not valid JSON: ' + e.message) }
} else warn('content/glossary.json is missing: glossary tooltips and search terms are off')

const REQUIRED = ['id', 'title', 'audience', 'roles', 'order', 'icon', 'summary']
const chapters = []
// Admin chapters live in private/content (gitignored); only their encrypted build is published.
const PRIVATE = join(SRC, 'private')
const chapterFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{3}-.+\.html$/.test(f)).map((f) => ({ f, dir })) : [])
const files = [...chapterFiles(join(SRC, 'content')), ...chapterFiles(join(PRIVATE, 'content'))]
if (!files.length) warn('no chapters found in content/')

let tgCount = 0
let placeholders = 0

function includeFiles(src, name) {
  return src.replace(/^[ \t]*<!--\s*include[:][ \t]*(\S+?)\s*-->[ \t]*$/gm, (all, rel) => {
    const p = [join(SRC, rel), join(PRIVATE, rel)].find((x) => existsSync(x))
    if (rel.includes('..') || !p) { fail(`${name}: include not found: ${rel}`); return '' }
    return readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/<\?xml[^>]*\?>/, '').trim()
  })
}

// Telegram cards: write who / danger lines into each result so they read with JS off, and link buttons to results
function telegramCards(html, name) {
  let out = ''
  let pos = 0
  const re = /<div\b[^>]*>/g
  let m
  while ((m = re.exec(html))) {
    if (!hasClass(m[0], 'tg-card')) continue
    const end = balanced(html, m.index, 'div')
    if (end < 0) { fail(`${name}: unclosed tg-card`); break }
    let card = html.slice(m.index, end)
    const group = attr(m[0], 'data-group')
    if (group !== 'Finance' && group !== 'OPS') warn(`${name}: tg-card data-group should be Finance or OPS`)
    const btns = [...card.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)]
    const nRes = (card.match(/<div\b[^>]*class="[^"]*\btg-result\b/g) || []).length
    if (btns.length !== nRes) fail(`${name}: tg-card has ${btns.length} button(s) but ${nRes} tg-result(s)`)
    const base = `csg-tg${++tgCount}`
    let bi = 0
    card = card.replace(/<button\b([^>]*)>/g, (tag, a) => {
      if (!hasClass(a, 'tg-btn')) return tag
      return `<button${a} aria-controls="${base}-r${bi++}">`
    })
    let ri = 0
    card = card.replace(/<div\b([^>]*)>/g, (tag, a) => {
      if (!hasClass(a, 'tg-result')) return tag
      const b = btns[ri]
      const i = ri++
      let inject = ''
      if (b) {
        const who = attr(b[1], 'data-who')
        const danger = attr(b[1], 'data-danger')
        inject = `<p class="tg-tap"><strong>You tap:</strong> ${esc(text(b[2]))}.${who ? ` <strong>Who can tap it:</strong> ${who}.` : ''}</p>`
        if (danger) inject += `<p class="tg-danger">Careful: ${danger}</p>`
      }
      return `<div${a} id="${base}-r${i}">${inject}`
    })
    out += html.slice(pos, m.index) + card
    pos = end
    re.lastIndex = end
  }
  return out + html.slice(pos)
}

// Annotated screenshots: number the hotspots and print the legend under the figure (JS adds the pins)
function annotated(html) {
  return html.replace(/<figure\b[^>]*class="[^"]*\bannotated\b[^"]*"[^>]*>[\s\S]*?<\/figure>/g, (fig) => {
    let n = 0
    const items = []
    const marked = fig.replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/g, (all, a, inner) => {
      if (!hasClass(a, 'hotspot')) return all
      n++
      const title = attr(a, 'data-title') || ''
      const who = attr(a, 'data-who')
      const undo = attr(a, 'data-undo')
      const meta = []
      if (who) meta.push(`Who: ${who}`)
      if (undo === 'yes') meta.push('Can undo')
      else if (undo === 'no') meta.push('Cannot undo')
      items.push(`<li><strong class="lg-title">${title}</strong> <span class="lg-text">${inner}</span>${meta.map((x) => ` <span class="lg-meta">${x}</span>`).join('')}</li>`)
      return `<span${a} data-n="${n}">${inner}</span>`
    })
    if (!items.length) return fig
    return marked.replace(/<\/figure>$/, `<ol class="legend" aria-label="Numbered key to the screenshot">${items.join('')}</ol></figure>`)
  })
}

function images(html, name) {
  return html.replace(/<img\b[^>]*>/g, (tag) => {
    const alt = attr(tag, 'alt')
    if (!alt || alt.trim().length < 3) fail(`${name}: <img> without a real alt: ${tag.slice(0, 80)}`)
    const src = attr(tag, 'src')
    if (!src || !src.startsWith('img/')) return tag
    if (!existsSync(join(SRC, src))) {
      placeholders++
      return `<div class="shot-missing" role="img" aria-label="${alt || ''}">Screenshot coming: ${alt || ''}</div>`
    }
    const out = tag.replace(`src="${src}"`, `src="../${src}"`)
    return /\bloading=/.test(out) ? out : out.replace(/<img\b/, '<img loading="lazy"')
  })
}

function transform(html, name) {
  html = includeFiles(html, name)
  html = telegramCards(html, name)
  html = annotated(html)
  html = html.replace(/<div\b([^>]*)>/g, (tag, a) => {
    if (!hasClass(a, 'wt-step')) return tag
    const title = attr(a, 'data-title')
    if (!title) { fail(`${name}: wt-step without data-title`); return tag }
    return `${tag}<p class="wt-title">${title}</p>`
  })
  html = images(html, name)
  html = html.replace(/<table\b[\s\S]*?<\/table>/g, (t) => `<div class="table-wrap" role="region" tabindex="0" aria-label="Table, scrolls sideways">${t}</div>`)
  html = html.replace(/<span\b([^>]*)>/g, (tag, a) => {
    if (!hasClass(a, 'term')) return tag
    const id = attr(a, 'data-term')
    if (glossary && id && !glossary[id]) { warn(`${name}: unknown glossary term "${id}"`); return tag }
    if (!glossary || !id || attr(a, 'title')) return tag
    return `<span${a} title="${esc(glossary[id].def)}">`
  })
  const nodes = new Set([...html.matchAll(/\bdata-node="([^"]*)"/g)].map((m) => m[1]))
  for (const m of html.matchAll(/\bdata-go="([^"]*)"/g)) if (!nodes.has(m[1])) fail(`${name}: data-go="${m[1]}" has no matching data-node`)
  return html
}

for (const { f, dir } of files.sort((a, b) => a.f.localeCompare(b.f))) {
  const raw = readFileSync(join(dir, f), 'utf8').replace(/^﻿/, '')
  const fm = raw.match(/^\s*<!--([\s\S]*?)-->/)
  if (!fm) { fail(`${f}: missing front-matter comment`); continue }
  const meta = {}
  for (const line of fm[1].split('\n')) {
    const m = line.match(/^\s*(\w+):\s*(.*?)\s*$/)
    if (m) meta[m[1]] = m[2]
  }
  const missing = REQUIRED.filter((k) => !meta[k])
  if (missing.length) { fail(`${f}: front-matter missing ${missing.join(', ')}`); continue }
  if (!['both', 'admin'].includes(meta.audience)) fail(`${f}: audience must be both or admin`)
  if (!['cleaner', 'office', 'all'].includes(meta.roles)) fail(`${f}: roles must be cleaner, office or all`)
  if (!/^-?\d+$/.test(meta.order)) fail(`${f}: order must be a whole number`)
  if (!spriteIds.has('i-' + meta.icon)) fail(`${f}: unknown icon "${meta.icon}"`)
  const body = raw.slice(fm[0].length)
  chapters.push({ ...meta, order: Number(meta.order), file: f, body, html: transform(body, f) })
}
chapters.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

// ---------- search index ----------
function indexChapter(ch) {
  const out = [{ t: ch.title, h: ch.id, c: ch.title, k: 'chapter' }]
  const html = ch.html
  let cur = ch.id
  const re = /<(h[34]|ol|div|button|span)\b([^>]*)>/g
  let m
  while ((m = re.exec(html))) {
    const [, tag, a] = m
    if (tag === 'h3' || tag === 'h4') {
      const end = html.indexOf(`</${tag}>`, m.index)
      const id = attr(a, 'id')
      if (id) cur = id
      const t = text(html.slice(m.index, end < 0 ? m.index : end))
      if (t && id) out.push({ t: clip(t, 120), h: id, c: ch.title, k: 'section' })
    } else if (tag === 'ol' && hasClass(a, 'steps')) {
      const end = balanced(html, m.index, 'ol')
      const inner = html.slice(m.index, end < 0 ? m.index : end)
      for (const li of inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)) {
        const t = text(li[1])
        if (t) out.push({ t: clip(t, 120), h: cur, c: ch.title, k: 'step' })
      }
    } else if (tag === 'div' && hasClass(a, 'wt-step')) {
      const t = decode(attr(a, 'data-title') || '')
      if (t) out.push({ t: clip(t, 120), h: cur, c: ch.title, k: 'step' })
    } else if (tag === 'button' && hasClass(a, 'tg-btn')) {
      const end = html.indexOf('</button>', m.index)
      const t = text(html.slice(m.index, end < 0 ? m.index : end))
      if (t) out.push({ t: clip(t, 120), h: cur, c: ch.title, k: 'button' })
    } else if (tag === 'span' && hasClass(a, 'hotspot')) {
      const t = decode(attr(a, 'data-title') || '')
      if (t) out.push({ t: clip(t, 120), h: cur, c: ch.title, k: 'hotspot' })
    }
  }
  return out
}

// ---------- page shell ----------
const icon = (n, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${n}"/></svg>`
const jsonForScript = (o) => JSON.stringify(o).replace(/[<\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
const stamp = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const FONTS = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@600;700&amp;family=Raleway:wght@400;500;600;700;800&amp;display=swap'
const SHELL_IDS = ['csg-main', 'csg-toc', 'csg-menu', 'csg-search', 'csg-search-btn', 'csg-search-input', 'csg-results', 'csg-theme', 'csg-print', 'glossary', 'search-index']

function tocHtml(list) {
  return list.map((ch) => {
    const subs = [...ch.html.matchAll(/<h3\b([^>]*)>([\s\S]*?)<\/h3>/g)]
      .map((m) => ({ id: attr(m[1], 'id'), t: text(m[2]) }))
      .filter((s) => s.id && s.t)
    return `<li class="toc-ch" data-roles="${ch.roles}"><a class="toc-link" href="#${ch.id}">${icon(ch.icon)}<span>${esc(ch.title)}</span></a>` +
      (subs.length ? `<ul class="toc-sub">${subs.map((s) => `<li><a href="#${s.id}">${esc(s.t)}</a></li>`).join('')}</ul>` : '') + '</li>'
  }).join('')
}

function stripAdmin(html, name) {
  const open = (html.match(/<!--\s*admin\s*-->/g) || []).length
  const close = (html.match(/<!--\s*\/admin\s*-->/g) || []).length
  if (open !== close) fail(`${name}: ${open} <!-- admin --> markers but ${close} <!-- /admin -->`)
  return html.replace(/<!--\s*admin\s*-->[\s\S]*?<!--\s*\/admin\s*-->/g, '')
}

function build(kind) {
  // Staff build drops admin chapters and any <!-- admin --> ... <!-- /admin --> block inside a shared chapter.
  const list = chapters.filter((c) => kind === 'admin' || c.audience === 'both')
    .map((c) => (kind === 'staff' ? { ...c, html: transform(stripAdmin(includeFiles(c.body, c.file), c.file), c.file) } : c))
  const label = kind === 'staff' ? 'Staff guide' : 'Admin guide'
  // Glossary entries marked "admin": true stay out of the staff build.
  const gl = Object.fromEntries(Object.entries(glossary || {}).filter(([, g]) => kind === 'admin' || !g.admin))

  // ids and links
  const ids = new Map()
  const addId = (id, where) => {
    if (ids.has(id)) fail(`${label}: duplicate id "${id}" in ${where} and ${ids.get(id)}`)
    else ids.set(id, where)
  }
  spriteIds.forEach((i) => addId(i, 'icon sprite'))
  SHELL_IDS.forEach((i) => addId(i, 'page shell'))
  for (const ch of list) {
    addId(ch.id, ch.file)
    for (const m of ch.html.matchAll(/<[a-z][^>]*?\sid="([^"]+)"/g)) addId(m[1], ch.file)
  }
  for (const ch of list) {
    for (const m of ch.html.matchAll(/\bhref="#([^"]+)"/g)) {
      if (!ids.has(m[1])) fail(`${label}: ${ch.file} links to #${m[1]}, which is not in the ${kind} build`)
    }
  }

  const index = []
  for (const ch of list) index.push(...indexChapter(ch))
  const gIn = list.find((c) => /glossary/.test(c.id))
  for (const [k, g] of Object.entries(gl)) index.push({ t: g.term || k, h: gIn ? gIn.id : '', c: 'Glossary', k: 'term', d: g.def || '' })

  const articles = list.map((ch) =>
    `<article class="chapter" id="${ch.id}" data-roles="${ch.roles}" aria-label="${esc(ch.title)}">` +
    `<h2 class="chapter-title">${icon(ch.icon)}<span>${esc(ch.title)}</span></h2>` +
    `<p class="chapter-summary">${esc(ch.summary)}</p>\n${ch.html.trim()}\n</article>`).join('\n')

  const roleBar = kind === 'staff'
    ? `<div class="role-bar" role="group" aria-label="Show chapters for"><span class="role-label">Show me:</span>` +
      ['all:All', 'cleaner:Cleaner', 'office:Office'].map((r) => { const [v, l] = r.split(':'); return `<button type="button" class="role-chip" data-role="${v}" aria-pressed="${v === 'all'}">${l}</button>` }).join('') +
      `<span class="role-status sr-only" aria-live="polite"></span></div>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${label} - Cascade Hideaway</title>
<meta name="description" content="Cascade Hideaway ${label.toLowerCase()}: how things work, step by step.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${FONTS}">
<link rel="stylesheet" href="../assets/guide.css?v=${assetVer('guide.css')}">
<script>
document.documentElement.classList.add('js');
try { var t = localStorage.getItem('csg:theme'); if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t); } catch (e) {}
</script>
<script src="../assets/guide.js?v=${assetVer('guide.js')}" defer></script>
</head>
<body>
<a class="skip-link" href="#csg-main">Skip to content</a>
${sprite}
<header class="site-header">
<button type="button" class="hd-btn toc-toggle" id="csg-menu" aria-controls="csg-toc" aria-expanded="false" aria-label="Contents">${icon('menu')}</button>
<a class="brand" href="#csg-main"><span class="brand-name">Cascade Hideaway</span><span class="brand-sub">${label}</span></a>
<button type="button" class="hd-btn hd-search" id="csg-search-btn" aria-label="Search the guide">${icon('search')}<span class="hd-label">Search</span><kbd>Ctrl K</kbd></button>
<button type="button" class="hd-btn" id="csg-theme" aria-label="Colour theme: Auto. Tap to change.">${icon('sun')}<span class="hd-label">Auto</span></button>
<button type="button" class="hd-btn hd-print" id="csg-print" aria-label="Print this guide">${icon('print')}</button>
</header>
<div class="layout">
<nav class="toc" id="csg-toc" aria-label="Chapters"><p class="toc-title">Chapters</p><ul>${tocHtml(list)}</ul></nav>
<div class="toc-backdrop" hidden></div>
<main id="csg-main">
${roleBar}
${articles || '<p class="empty">No chapters yet.</p>'}
<footer class="site-footer"><p>Built ${stamp} (Manila time) &middot; ${list.length} chapter${list.length === 1 ? '' : 's'} &middot; <a href="../">Choose another guide</a></p></footer>
</main>
</div>
<div class="search" id="csg-search" role="dialog" aria-modal="true" aria-label="Search the guide" hidden>
<div class="search-box"><input class="search-input" id="csg-search-input" type="search" placeholder="Search the guide" autocomplete="off" aria-label="Search the guide"><ul class="search-results" id="csg-results"></ul></div>
</div>
<script type="application/json" id="glossary">${jsonForScript(gl)}</script>
<script type="application/json" id="search-index">${jsonForScript(index)}</script>
</body>
</html>
`
}

const pages = { staff: build('staff'), admin: build('admin') }

// AES-256-GCM, key from PBKDF2-SHA256. The page decrypts in the browser (WebCrypto) and writes the guide in place.
const ITER = 600000
function lockPage(html, pass) {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', pbkdf2Sync(pass, salt, ITER, 32, 'sha256'), iv)
  const ct = Buffer.concat([c.update(html, 'utf8'), c.final(), c.getAuthTag()])
  const data = jsonForScript({ salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64'), iter: ITER })
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<meta name="color-scheme" content="light dark">
<title>Admin guide - Cascade Hideaway</title>
<link rel="stylesheet" href="../assets/guide.css?v=${assetVer('guide.css')}">
</head>
<body>
<main class="chooser lock">
<h1>Admin guide</h1>
<p class="lead">For the owner and Lloyd. Enter the admin guide password.</p>
<form id="lock-form" class="lock-form">
<label for="lock-pass">Password</label>
<input id="lock-pass" type="password" autocomplete="current-password" required>
<label class="lock-remember"><input id="lock-remember" type="checkbox"> Remember on this device</label>
<button type="submit" id="lock-go">Open the admin guide</button>
<p id="lock-msg" role="status" aria-live="polite"></p>
</form>
<p><a href="../">Back to the guide chooser</a> &middot; <a href="../staff/">Staff guide</a></p>
</main>
<script type="application/json" id="lock-data">${data}</script>
<script>
(function () {
  var D = JSON.parse(document.getElementById('lock-data').textContent)
  var KEY = 'csg:adminkey'
  var b64 = function (s) { return Uint8Array.from(atob(s), function (c) { return c.charCodeAt(0) }) }
  var msg = document.getElementById('lock-msg')
  function decrypt(key) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(D.iv) }, key, b64(D.ct)) }
  function write(pt) {
    // document.write while the lock page is still loading would append instead of replace
    if (document.readyState !== 'complete') { window.addEventListener('load', function () { write(pt) }, { once: true }); return }
    var hash = location.hash
    document.open(); document.write(new TextDecoder().decode(pt)); document.close()
    // Jump to the linked section; again after images above it have loaded and moved it down.
    var jump = function () { var el = document.getElementById(decodeURIComponent(hash.slice(1))); if (el) el.scrollIntoView() }
    if (hash) { setTimeout(jump, 400); setTimeout(jump, 2500) }
  }
  function show(key) { return decrypt(key).then(write) }
  function stored() { try { return localStorage.getItem(KEY) || sessionStorage.getItem(KEY) } catch (e) { return null } }
  function store(raw, keep) { try { (keep ? localStorage : sessionStorage).setItem(KEY, raw) } catch (e) {} }
  var s = stored()
  if (s) crypto.subtle.importKey('raw', b64(s), 'AES-GCM', false, ['decrypt']).then(show).catch(function () {
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY) } catch (e) {}
  })
  document.getElementById('lock-form').addEventListener('submit', function (ev) {
    ev.preventDefault()
    msg.textContent = 'Opening...'
    var pass = document.getElementById('lock-pass').value
    crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']).then(function (base) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(D.salt), iterations: D.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, true, ['decrypt'])
    }).then(function (key) {
      return decrypt(key).then(function (pt) {
        return crypto.subtle.exportKey('raw', key).then(function (raw) {
          store(btoa(String.fromCharCode.apply(null, new Uint8Array(raw))), document.getElementById('lock-remember').checked)
          write(pt)
        })
      })
    }).catch(function () { msg.textContent = 'That password is not right. Try again.' })
  })
})()
</script>
</body>
</html>
`
}

if (errors.length) {
  for (const e of errors) console.error('ERROR: ' + e)
  for (const w of warnings) console.error('warn: ' + w)
  console.error(`build failed: ${errors.length} error(s), ${warnings.length} warning(s)`)
  process.exit(1)
}
if (placeholders) warn(`${placeholders} screenshot placeholder(s): image file not found`)
// The admin guide is published only encrypted (the repo is public). Without a password the admin page is left as it is.
const PASS = process.env.ADMIN_GUIDE_PASSWORD || ''
if (PASS) pages.admin = lockPage(pages.admin, PASS)
else { delete pages.admin; warn('ADMIN_GUIDE_PASSWORD not set: admin/index.html was not rebuilt') }
for (const [kind, html] of Object.entries(pages)) {
  mkdirSync(join(OUT, kind), { recursive: true })
  writeFileSync(join(OUT, kind, 'index.html'), html)
}
for (const w of warnings) console.log('warn: ' + w)
const staffN = chapters.filter((c) => c.audience === 'both').length
console.log(`built staff (${staffN} chapters) and admin (${chapters.length} chapters), ${warnings.length} warning(s)`)
