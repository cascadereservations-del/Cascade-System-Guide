// Self-check: the encrypted admin page opens with the right password and refuses a wrong one.
// usage: node test/lock-roundtrip.mjs <admin/index.html> [password]   (or set ADMIN_GUIDE_PASSWORD)
import { readFileSync } from 'node:fs'
const file = process.argv[2]
const pass = process.argv[3] || process.env.ADMIN_GUIDE_PASSWORD || ''
const html = readFileSync(file, 'utf8')
const D = JSON.parse(html.match(/<script type="application\/json" id="lock-data">([\s\S]*?)<\/script>/)[1])
const b64 = (s) => Buffer.from(s, 'base64')
async function open(p) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(p), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(D.salt), iterations: D.iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'])
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(D.iv) }, key, b64(D.ct)))
}
const plain = await open(pass)
if (!plain.includes('id="a3-automations"') || !plain.includes('id="s4-turnover"')) throw new Error('decrypted page is missing admin or staff chapters')
if (html.includes('a3-automations') || html.includes('Automations')) throw new Error('admin text visible in the locked page')
let refused = false
try { await open(pass + 'x') } catch { refused = true }
if (!refused) throw new Error('wrong password opened the page')
console.log('lock round-trip ok:', plain.length, 'chars decrypted; wrong password refused; no admin text in the locked file')
