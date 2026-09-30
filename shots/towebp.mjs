// Convert a screenshot (jpg/png) to img/<name>.webp. `node shots/towebp.mjs <src> <surface/name> [cropTop] [cropBottom]`
// Used for pages behind a sign-in: the in-app browser saves its screenshot, this re-encodes it.
import { createRequire } from 'node:module'
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const [src, name, cropTop = '0', cropBottom = '0'] = process.argv.slice(2)
if (!src || !name) { console.error('usage: node shots/towebp.mjs <src> <surface/name> [cropTop] [cropBottom]'); process.exit(2) }
const ROOT = fileURLToPath(new URL('..', import.meta.url))
const req = createRequire(join(execSync('npm root -g').toString().trim(), '@modelcontextprotocol/server-puppeteer/'))
const puppeteer = req('puppeteer')
const mime = extname(src).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg'
const dataUrl = `data:${mime};base64,${readFileSync(src).toString('base64')}`

const browser = await puppeteer.launch({ headless: true })
try {
  const page = await browser.newPage()
  const webp = await page.evaluate(async (u, top, bottom) => {
    const img = new Image(); img.src = u; await img.decode()
    const h = img.naturalHeight - top - bottom
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = h
    c.getContext('2d').drawImage(img, 0, top, img.naturalWidth, h, 0, 0, img.naturalWidth, h)
    return c.toDataURL('image/webp', 0.85)
  }, dataUrl, +cropTop, +cropBottom)
  const out = join(ROOT, 'img', name + '.webp')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, Buffer.from(webp.split(',')[1], 'base64'))
  console.log(`${name}: saved`)
} finally {
  await browser.close()
}
