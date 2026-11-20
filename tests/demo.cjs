// Renders docs/demo.png: the real popup over a mock transcript (not the Hermes app itself).
const path = require('node:path')
const { open } = require('./harness.cjs')

const HTML = `
<main data-chat-surface data-session-anchor="workspace">
  <article data-slot="aui_assistant-message-content">
    <p>The export finished. One thing to check: <span id="pick">the date column is in UTC, so entries after 23:00 land on the next day.</span></p>
    <p>Everything else matches the source file, and all 42 rows were written to the sheet.</p>
  </article>
</main>`

;(async () => {
  const { browser, page, select } = await open(HTML, { viewport: { width: 840, height: 260 } })
  try {
    await select('pick')
    await page.getByRole('button', { name: 'Quote in reply', exact: true }).waitFor()
    await page.screenshot({ path: path.join(__dirname, '..', 'docs', 'demo.png') })
  } finally {
    await browser.close()
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
