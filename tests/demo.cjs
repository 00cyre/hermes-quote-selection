// Renders docs/demo.png: the real plugin on the mock app from tests/mock-app.js
// (a mock transcript and reply box, not the Hermes app itself).
const path = require('node:path')
const { start } = require('./harness.cjs')

const HTML = `
  <article>
    <p>The export finished. One thing to check: <span id="one">the date column is in UTC, so entries after 23:00 land on the next day.</span></p>
    <p>All 42 rows were written to the sheet. <span id="two">Three rows had no owner, so I left that cell empty.</span></p>
    <p><span id="three">The summary tab still uses last month's totals.</span></p>
  </article>`

;(async () => {
  const harness = await start()

  try {
    const t = await harness.open([{ session: 's1', html: HTML }], { viewport: { width: 860, height: 470 } })

    for (const [id, comment] of [
      ['one', 'switch this to local time'],
      ['two', '']
    ]) {
      await t.select(id)
      await t.addButton.waitFor()

      if (comment) {
        await t.comment.fill(comment)
      }

      await t.addButton.click()
      await t.addButton.waitFor({ state: 'hidden' })
    }

    await t.pill('s1').click()
    await t.page.evaluate(() => document.activeElement?.blur())
    await t.select('three')
    await t.addButton.waitFor()
    await t.page.screenshot({ path: path.join(__dirname, '..', 'docs', 'demo.png') })
  } finally {
    await harness.close()
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
