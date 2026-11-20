// Loads desktop/plugin.js into headless Chromium next to tests/mock-app.js, with
// real React and nanostores standing in for the modules Hermes Desktop provides.
const fs = require('node:fs')
const path = require('node:path')
const esbuild = require('esbuild')
const { chromium } = require('playwright-core')

const ROOT = path.join(__dirname, '..')
// QUOTE_PLUGIN points the tests at another copy, such as the one Hermes has installed.
const PLUGIN = process.env.QUOTE_PLUGIN || path.join(ROOT, 'desktop', 'plugin.js')

const PAGE = `<style>
  :root { --ui-bg-elevated:#1c2128; --ui-bg-quinary:#21262d; --ui-stroke-secondary:#3d444d; --ui-stroke-tertiary:#30363d;
          --ui-text-primary:#e6edf3; --ui-text-secondary:#c9d1d9; --ui-text-tertiary:#8b949e; --ui-accent:#a78bfa;
          --chrome-action-hover:#30363d; --ui-selection-background:#264f78 }
  body { margin:0; background:#0d1117; color:#e6edf3; font:15px/1.55 -apple-system, system-ui, sans-serif }
  #app { display:flex; gap:16px; padding:90px 24px 16px; align-items:flex-start }
  main { flex:1; min-width:0; max-width:720px }
  .thread p { margin:0 0 12px }
  .composer { margin-top:18px }
  .fade { display:flex; flex-direction:column; gap:8px; padding:10px 12px; border:1px solid #30363d; border-radius:14px; background:#161b22 }
  .top { display:contents }
  .input { min-height:22px; outline:none }
  .input:empty::before { content:'Message'; color:#6e7681 }
  .controls { display:flex; justify-content:flex-end; gap:6px }
  .controls button { border:0; border-radius:999px; width:26px; height:26px; background:#30363d; color:#e6edf3; font:inherit }
  button { font:inherit }
  .codicon { font-style:normal; line-height:1 }
  .codicon-comment::before { content:'❞' } .codicon-close::before { content:'×' } .codicon-edit::before { content:'✎' }
  .codicon-trash::before { content:'⌫' } .codicon-chevron-down::before { content:'▾' } .codicon-chevron-up::before { content:'▴' }
  ::selection { background:var(--ui-selection-background) }
</style><div id="app"></div><aside id="outside">sidebar text</aside>`

const DEPS = `
  import * as React from 'react'
  import * as jsxRuntime from 'react/jsx-runtime'
  import { createRoot } from 'react-dom/client'
  import { atom } from 'nanostores'
  import { useStore } from '@nanostores/react'
  window.__DEPS__ = { React, jsxRuntime, jsx: jsxRuntime.jsx, createRoot, atom, useStore }
`

// import { a, b } from 'x'  ->  const { a, b } = window.__MODS__['x']
const rewriteImports = source =>
  source.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?/g,
    (_, names, from) => `const {${names}} = window.__MODS__[${JSON.stringify(from)}];`
  )

async function start() {
  const built = await esbuild.build({
    stdin: { contents: DEPS, resolveDir: ROOT },
    bundle: true,
    format: 'iife',
    write: false,
    define: { 'process.env.NODE_ENV': '"development"' }
  })
  const deps = built.outputFiles[0].text
  const browser = await chromium.launch({ headless: true })

  async function open(panes, { viewport = { width: 1100, height: 620 } } = {}) {
    const page = await browser.newPage({ viewport })
    const errors = []

    page.setDefaultTimeout(4000)

    page.on('pageerror', error => errors.push(String(error)))
    page.on('console', message => {
      if (message.type() === 'error') {
        errors.push(message.text())
      }
    })
    await page.setContent(PAGE)
    await page.addScriptTag({ content: deps })
    await page.addScriptTag({ path: path.join(__dirname, 'mock-app.js') })
    await page.evaluate(list => list.forEach(pane => window.mockApp.addPane(pane.session, pane.html)), panes)
    await page.evaluate(async source => {
      const module = await import(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })))

      module.default.register(window.mockApp.ctx)
    }, rewriteImports(fs.readFileSync(PLUGIN, 'utf8')))

    const pane = session => page.locator(`[data-pane="${session}"]`)

    return {
      page,
      errors,
      pane,
      input: session => pane(session).locator('.input'),
      pill: session => pane(session).getByRole('button', { name: /^\d+ annotations?$/ }),
      addButton: page.getByRole('button', { name: 'Add annotation', exact: true }),
      comment: page.getByPlaceholder('Add a comment…'),
      log: () => page.evaluate(() => window.mockApp.log.slice()),
      app: (method, ...args) => page.evaluate(([name, rest]) => window.mockApp[name](...rest), [method, args]),
      // Select an element's text the way a script would: no pointer events.
      select: id =>
        page.locator('#' + id).evaluate(el => {
          const range = document.createRange()

          range.selectNodeContents(el)

          const selection = getSelection()

          selection.removeAllRanges()
          selection.addRange(range)
        }),
      // Select an element's text with a real mouse drag.
      drag: async id => {
        const box = await page.locator('#' + id).boundingBox()

        await page.mouse.move(box.x + 1, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 6 })
        await page.mouse.up()
      }
    }
  }

  return { open, close: () => browser.close() }
}

module.exports = { start }
