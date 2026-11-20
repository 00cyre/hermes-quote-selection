// Loads desktop/plugin.js into a headless Chromium page that mimics the parts of
// the Hermes Desktop transcript the plugin anchors to, with a stub plugin SDK.
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright-core')

const PLUGIN = path.join(__dirname, '..', 'desktop', 'plugin.js')

const THEME = `<style>
  :root { --border:#30363d; --popover:#161b22; --popover-foreground:#e6edf3; --muted-foreground:#8b949e;
          --ui-accent:#a78bfa; --secondary:#21262d; --secondary-foreground:#e6edf3 }
  body { margin:0; background:#0d1117; color:#e6edf3; font:15px/1.55 -apple-system, system-ui, sans-serif }
  main { padding:110px 40px 24px; max-width:760px }
  ::selection { background:#264f78 }
</style>`

async function open(html, { viewport } = {}) {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage(viewport ? { viewport } : {})
  await page.setContent(THEME + html)
  await page.evaluate(async source => {
    window.draft = 'existing'
    window.calls = []
    window.sid = 'main'
    window.cleanup = []
    window.host = {
      state: { activeSessionId: { get: () => window.sid } },
      composer: {
        insertText: async (id, text, opts) => {
          window.calls.push({ id, text, opts })
          window.draft += '\n\n' + text
          return true
        }
      },
      notify: () => {}
    }
    const patched = source.replace(/import\s*\{\s*host\s*\}\s*from\s*['"]@hermes\/plugin-sdk['"];?/, 'const host=window.host;')
    const mod = await import(URL.createObjectURL(new Blob([patched], { type: 'text/javascript' })))
    mod.default.register({
      onDispose: fn => window.cleanup.push(fn),
      addEventListener: (target, type, fn, opts) => {
        target.addEventListener(type, fn, opts)
        window.cleanup.push(() => target.removeEventListener(type, fn, opts))
      }
    })
  }, fs.readFileSync(PLUGIN, 'utf8'))
  const select = id =>
    page.locator('#' + id).evaluate(el => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
    })
  return { browser, page, select }
}

module.exports = { open }
