// Injected into a page right before a screenshot. Real UI, fake people.
// Usage in the page: __redact({ names: ['Real Name'], money: true, blurImages: true })
(function () {
  const KEEP_EMAIL = /^(cascadereservations@gmail\.com|guest@example\.com)$/i
  const KEEP_PHONE = /991[\s-]?853[\s-]?8269|0917 000 0000/
  const EMAIL = /[\w.+-]+@[\w-]+\.[a-z][\w.]*/gi
  const PHONE = /(\+?63[\s-]?|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}/g
  const REF = /\b(CH|DIR|HM)-?[A-Z0-9]{5,}\b/g
  const MONEY = /(₱|PHP)\s?\d[\d,]*(\.\d{1,2})?/g
  const LONG = /\b\d{9,}\b/g // account numbers, ids
  const GROUPED = /\b\d{3,4}(?:[ -]\d{3,4}){2,}\b/g // spaced account numbers

  function fix(s, o) {
    let t = s
    for (const n of o.names) if (n && n.length > 1) t = t.split(n).join('Sample Guest')
    t = t.replace(EMAIL, (m) => (KEEP_EMAIL.test(m) ? m : 'guest@example.com'))
    t = t.replace(PHONE, (m) => (KEEP_PHONE.test(m) ? m : '0917 000 0000'))
    t = t.replace(REF, (m) => m.replace(/-?[A-Z0-9]{5,}$/, '-SAMPLE'))
    t = t.replace(GROUPED, (m) => (KEEP_PHONE.test(m) ? m : m.replace(/\d/g, '0')))
    t = t.replace(LONG, (m) => '0'.repeat(Math.min(m.length, 12)))
    if (o.money) t = t.replace(MONEY, (m) => (m.startsWith('₱') ? '₱' : 'PHP ') + '1,234')
    return t
  }

  window.__redact = function (opts) {
    const o = Object.assign({ names: [], money: true, blurImages: true }, opts || {})
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n, changed = 0
    while ((n = w.nextNode())) {
      const v = fix(n.nodeValue, o)
      if (v !== n.nodeValue) { n.nodeValue = v; changed++ }
    }
    for (const el of document.querySelectorAll('input, textarea')) {
      if (el.type === 'password' || el.type === 'hidden') continue
      const v = fix(el.value || '', o)
      if (v !== el.value) { el.value = v; changed++ }
      if (el.placeholder) el.placeholder = fix(el.placeholder, o)
    }
    if (o.blurImages) {
      for (const img of document.querySelectorAll('img, video')) {
        const r = img.getBoundingClientRect()
        if (r.width >= 64 && r.height >= 64 && !/logo|icon|brand/i.test(img.src + img.alt + img.className)) img.style.filter = 'blur(14px)'
      }
    }
    return changed
  }
})()
