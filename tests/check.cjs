const assert = require('node:assert/strict')
const { open } = require('./harness.cjs')

const HTML = `
<main data-chat-surface data-session-anchor="workspace">
  <article data-role="assistant" data-slot="aui_assistant-message-root">
    <section data-slot="aui_assistant-message-content"><p id="a">one <em>two</em><br>three four</p></section>
  </article>
  <article data-slot="aui_user-message-root"><button><span id="user">my words</span></button></article>
</main>
<aside id="outside">sidebar text</aside>
<main data-chat-surface data-session-anchor="session-tile:tileA">
  <article data-slot="aui_assistant-message-content" id="tile">tile text</article>
</main>`

;(async () => {
  const { browser, page, select } = await open(HTML)
  try {
    const quote = page.getByRole('button', { name: 'Quote in reply', exact: true })

    // Multiline selection plus a comment is appended to the existing draft.
    await select('a')
    await quote.waitFor()
    await page.getByPlaceholder('Add a comment…').fill('why?')
    await quote.click()
    assert.equal(await page.evaluate(() => window.draft), 'existing\n\n> one two\n> three four\n\nwhy?')
    assert.equal(await page.evaluate(() => window.calls[0].id), 'main')
    assert.deepEqual(await page.evaluate(() => window.calls[0].opts), { mode: 'block' })

    // Text outside a chat message never offers the popup.
    await select('outside')
    await page.waitForTimeout(80)
    assert.equal(await quote.isVisible(), false)

    // Escape dismisses it.
    await select('user')
    await quote.waitFor()
    await page.keyboard.press('Escape')
    assert.equal(await quote.isVisible(), false)

    // A selection in a split tile goes to that tile's session.
    await select('tile')
    await quote.click()
    assert.equal(await page.evaluate(() => window.calls[1].id), 'tileA')

    // Switching chats after selecting never writes into the new chat.
    await select('user')
    await quote.waitFor()
    await page.evaluate(() => (window.sid = 'switched'))
    await quote.click()
    assert.equal(await page.evaluate(() => window.calls.length), 2)

    // Unloading the plugin removes every listener.
    await page.evaluate(() => window.cleanup.reverse().forEach(fn => fn()))
    await select('a')
    await page.waitForTimeout(80)
    assert.equal(await quote.isVisible(), false)

    console.log('PASS: multiline quote + comment, draft kept, non-chat text ignored, Escape, tile routing, stale chat, unload.')
  } finally {
    await browser.close()
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
