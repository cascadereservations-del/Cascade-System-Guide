// Headless captures of PUBLIC pages only (no sign-in, nothing submitted). `node shots/public.mjs [name...]`
// Uses the globally installed puppeteer (no project dependency).
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const req = createRequire(join(execSync('npm root -g').toString().trim(), '@modelcontextprotocol/server-puppeteer/'))
const puppeteer = req('puppeteer')
const REDACT = readFileSync(join(ROOT, 'shots/redact.js'), 'utf8')

const SITE = 'https://cascadereservations-del.github.io/Stay_At_CascadeGSC/'
const GUIDE = 'https://cascadereservations-del.github.io/Welcome-To-Cascades-/'
const MANUAL = 'https://cascadereservations-del.github.io/Cascade-Manual/'
const CLEANER = 'https://cascadereservations-del.github.io/CH-Cleaners-Checklist/'
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

const SHOTS = {
  'site/hero': { url: SITE, view: PHONE },
  'site/booking-form': { url: SITE, view: PHONE, el: '#bookingStep1' },
  // Step 2 is never reached for real (that would create a booking): unhide it and mask the numbers.
  'site/payment': { url: SITE, view: PHONE, el: '#bookingStep2', blur: true,
    setup: () => {
      const s = document.querySelector('#bookingStep2'); s.hidden = false; s.style.display = 'block'
      document.querySelector('#bookingStep1')?.style.setProperty('display', 'none')
      // The account holder's name and numbers never leave this page.
      const vals = [...s.querySelectorAll('.pay-bank-val')]
      const holder = (vals[1]?.textContent || '').trim()
      for (const el of vals) if (el.id !== 'payBankRef') el.textContent = el.id === 'bankAcctNumber' ? '0000 000 0000' : el === vals[0] ? 'Sample Bank' : 'Account holder'
      const g = document.querySelector('#gcashNumber'); if (g) g.textContent = '0917 000 0000'
      if (holder.length > 3) { const w = document.createTreeWalker(s, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.nodeValue.includes(holder)) n.nodeValue = n.nodeValue.split(holder).join('the account holder') }
      for (const q of s.querySelectorAll('img, canvas, svg')) { const r = q.getBoundingClientRect(); if (r.width > 80) q.style.filter = 'blur(10px)' }
    } },
  'guide/gate': { url: GUIDE, view: PHONE },
  'guide/welcome': { url: GUIDE, view: PHONE,
    setup: () => {
      const vw = innerWidth * innerHeight
      for (const el of document.querySelectorAll('body *')) { const c = getComputedStyle(el); const r = el.getBoundingClientRect(); if ((c.position === 'fixed' || c.position === 'absolute') && r.width * r.height > vw * 0.5 && +c.zIndex > 10) el.remove() }
      for (const el of document.querySelectorAll('body *')) { const c = getComputedStyle(el); if (c.filter !== 'none' && c.filter.includes('blur')) el.style.filter = 'none' }
      document.body.style.overflow = 'auto'; document.documentElement.style.overflow = 'auto'
    } },
  'manual/login': { url: MANUAL, view: PHONE },
  'cleaner/signin': { url: CLEANER, view: PHONE },
}

const want = process.argv.slice(2)
const browser = await puppeteer.launch({ headless: true })
try {
  for (const [name, s] of Object.entries(SHOTS)) {
    if (want.length && !want.includes(name)) continue
    const page = await browser.newPage()
    await page.setViewport(s.view)
    await page.goto(s.url, { waitUntil: 'networkidle2', timeout: 60000 })
    await new Promise((r) => setTimeout(r, 3500))
    if (s.setup) await page.evaluate(s.setup)
    await page.addScriptTag({ content: REDACT })
    const changed = await page.evaluate((b) => window.__redact({ money: false, blurImages: b }), !!s.blur)
    await new Promise((r) => setTimeout(r, 500))
    const out = join(ROOT, 'img', name + '.webp')
    mkdirSync(dirname(out), { recursive: true })
    const target = s.el ? await page.$(s.el) : page
    if (!target) throw new Error(`${name}: selector ${s.el} not found`)
    await target.screenshot({ path: out, type: 'webp', quality: 80 })
    console.log(`${name}: saved (${changed} text nodes redacted)`)
    await page.close()
  }
} finally {
  await browser.close()
}
