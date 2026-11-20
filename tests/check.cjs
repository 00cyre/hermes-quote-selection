const assert = require('node:assert/strict')
const { start } = require('./harness.cjs')

// A transcript with none of the app's own slot names: the plugin may rely only on
// the documented chat surface root that tests/mock-app.js puts around each pane.
const S1 = `
  <article>
    <p id="a">one <em>two</em><br>three four</p>
    <p id="b">second passage</p>
  </article>
  <article><button type="button"><span id="user">my words</span></button></article>`
const S2 = `<article><p id="other">other chat text</p></article>`
const ONE = [{ session: 's1', html: S1 }]
const TWO = [...ONE, { session: 's2', html: S2 }]

const scenarios = []
const scenario = (name, panes, run) => scenarios.push({ name, panes, run })

async function until(check, message) {
  for (let i = 0; i < 60; i++) {
    if (await check()) {
      return
    }

    await new Promise(resolve => setTimeout(resolve, 50))
  }

  assert.fail(message)
}

async function annotate(t, id, comment) {
  await t.select(id)
  await t.addButton.waitFor()

  if (comment) {
    await t.comment.fill(comment)
  }

  await t.addButton.click()
  await t.addButton.waitFor({ state: 'hidden' })
}

async function type(t, session, text) {
  await t.input(session).click()
  await t.page.keyboard.type(text)
}

const pills = t => t.page.getByRole('button', { name: /^\d+ annotations?$/ })
const quiet = t => t.page.waitForTimeout(500)
const sends = async t => (await t.log()).map(entry => `${entry.kind}:${entry.session}:${entry.text}`)

scenario('a mouse selection becomes a pill, and nothing is typed or sent', ONE, async t => {
  await t.drag('b')
  await t.addButton.waitFor()
  await t.comment.fill('why?')
  await t.addButton.click()
  await t.pill('s1').waitFor()
  assert.equal(await t.pill('s1').innerText(), '1 annotation')
  assert.equal((await t.input('s1').innerText()).trim(), '')
  assert.equal(await t.page.evaluate(() => getSelection().isCollapsed), true)

  await annotate(t, 'a', 'and this?')
  assert.equal(await t.pill('s1').innerText(), '2 annotations')
  await quiet(t)
  assert.deepEqual(await t.log(), [])
})

// --- the comment box takes the cursor ---------------------------------------

const hasCursor = locator => locator.evaluate(el => el === document.activeElement).catch(() => false)
const selected = t => t.page.evaluate(() => getSelection().toString())
// The text the plugin keeps marked while the page's own selection is elsewhere.
const marked = t =>
  t.page.evaluate(() => {
    const ranges = [...CSS.highlights.values()].flatMap(highlight => [...highlight])

    return ranges.length ? ranges.map(String).join('|') : null
  })

const ends = t => t.page.evaluate(() => [getSelection().anchorOffset, getSelection().focusOffset])

async function dragInto(t, id) {
  await t.drag(id)
  await until(() => hasCursor(t.comment), 'the comment box has the cursor')
}

// Select a one-line element right to left, starting in the empty part of its line.
async function dragBackInto(t, id) {
  const box = await t.page.locator('#' + id).boundingBox()

  await t.page.mouse.move(box.x + box.width - 1, box.y + box.height / 2)
  await t.page.mouse.down()
  await t.page.mouse.move(box.x + 1, box.y + box.height / 2, { steps: 6 })
  await t.page.mouse.up()
  await until(() => hasCursor(t.comment), 'the comment box has the cursor')
}

scenario('a finished mouse selection puts the cursor in the comment box, so typing goes there', ONE, async t => {
  await dragInto(t, 'b')
  await t.page.keyboard.type('why?')
  assert.equal(await t.comment.inputValue(), 'why?')
  assert.equal((await t.input('s1').innerText()).trim(), '', 'nothing was typed into the reply box')
  assert.equal(await marked(t), 'second passage', 'the passage stays marked while the comment is typed')

  await t.page.keyboard.press('Enter')
  await t.pill('s1').waitFor()
  assert.equal(await marked(t), null)
  await until(() => hasCursor(t.input('s1')), 'the cursor moves on to the reply box')
  await t.page.keyboard.type('fix it')
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 1, 'the message is sent')
  assert.deepEqual(await sends(t), ['send:s1:> second passage\n\nwhy?\n\nfix it'])
})

scenario('a double-click and a triple-click put the cursor there too', ONE, async t => {
  const box = await t.page.locator('#b').boundingBox()
  const at = [box.x + 12, box.y + box.height / 2]

  await t.page.mouse.dblclick(...at)
  await until(() => hasCursor(t.comment), 'the comment box has the cursor after a double-click')
  assert.match(await marked(t), /^second\s?$/)

  await t.page.mouse.click(...at, { clickCount: 3 })
  await until(async () => ((await marked(t)) ?? '').trim() === 'second passage', 'the triple-click picked the whole passage')
  await until(() => hasCursor(t.comment), 'the comment box has the cursor after a triple-click')
})

scenario('copying still copies the passage while the cursor is in the comment box', ONE, async t => {
  await t.page.evaluate(() => {
    window.copies = []
    // Runs after the plugin: what a copy would put on the clipboard, and whether the plugin supplied it.
    document.addEventListener('copy', event =>
      window.copies.push({ text: event.clipboardData.getData('text/plain'), supplied: event.defaultPrevented })
    )
  })

  const copies = () => t.page.evaluate(() => window.copies)

  await dragInto(t, 'b')
  await t.page.keyboard.press('ControlOrMeta+c')
  await until(async () => (await copies()).length === 1, 'the copy happened')
  assert.deepEqual((await copies())[0], { text: 'second passage', supplied: true })

  // Words selected in the comment box itself are copied the usual way.
  await t.page.keyboard.type('my note')
  await t.comment.evaluate(el => el.select())
  await t.page.keyboard.press('ControlOrMeta+c')
  await until(async () => (await copies()).length === 2, 'the second copy happened')
  assert.deepEqual((await copies())[1], { text: '', supplied: false })
})

scenario('Escape gives the selection back, and the popup stays closed for it', ONE, async t => {
  await dragBackInto(t, 'b')
  assert.equal(await selected(t), '', 'the cursor is in the comment box, so the page has no selection')

  await t.page.keyboard.press('Escape')
  await until(async () => (await selected(t)) === 'second passage', 'the selection is back on the page')
  assert.deepEqual(await ends(t), [14, 0], 'the same way round as it was made')
  assert.equal(await marked(t), null)
  await quiet(t)
  assert.equal(await t.addButton.isVisible(), false, 'the popup stays closed')

  // A click on a control elsewhere leaves the selection, and the popup, alone.
  await t.pane('s1').locator('.attach').click()
  await quiet(t)
  assert.equal(await selected(t), 'second passage')
  assert.equal(await t.addButton.isVisible(), false, 'a click elsewhere does not bring it back')

  // Selecting the very same passage again by hand does.
  await dragBackInto(t, 'b')
  assert.equal(await marked(t), 'second passage')
})

scenario('a click on a control elsewhere closes the popup, and it does not come back for that selection', ONE, async t => {
  await dragInto(t, 'b')
  await t.pane('s1').locator('.attach').click()
  await quiet(t)
  assert.equal(await t.addButton.isVisible(), false)
  assert.equal(await selected(t), 'second passage', 'the selection went back to the page')
  assert.equal(await hasCursor(t.comment), false)
})

scenario('a right-click closes the popup and leaves the selection for the menu', ONE, async t => {
  await dragInto(t, 'b')

  const box = await t.page.locator('#b').boundingBox()

  await t.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: 'right' })
  await until(async () => (await selected(t)) === 'second passage', 'the selection is back for the menu')
  await quiet(t)
  assert.equal(await t.addButton.isVisible(), false)
  assert.equal(await selected(t), 'second passage', 'nothing took the selection away again')

  // A right-click on other text (macOS selects the word under it) opens a menu
  // for that text. The popup stays out of its way too.
  const a = await t.page.locator('#a').boundingBox()

  await t.page.mouse.click(a.x + 20, a.y + a.height - 8, { button: 'right' })
  await quiet(t)

  const after = await selected(t)

  assert.equal(await t.addButton.isVisible(), false, 'no popup while a menu is open for the selection')
  assert.equal(await selected(t), after)
})

scenario('Shift+click extends the selection the comment box had taken', ONE, async t => {
  await dragBackInto(t, 'b')
  assert.equal(await marked(t), 'second passage')

  // The end of the first line of the paragraph above, clear of the popup.
  const a = await t.page.locator('#a').boundingBox()

  await t.page.keyboard.down('Shift')
  await t.page.mouse.click(a.x + a.width - 40, a.y + 6)
  await t.page.keyboard.up('Shift')
  await until(
    async () => /^three four\s+second passage$/.test(((await marked(t)) ?? '').trim()),
    'the selection grew from the passage to the click'
  )
  await until(() => hasCursor(t.comment), 'the comment box has the cursor again')
})

scenario('a selection nobody made by hand shows the popup without taking the cursor', ONE, async t => {
  await t.select('b')
  await t.addButton.waitFor()
  await quiet(t)
  assert.equal(await hasCursor(t.comment), false)
  assert.equal(await selected(t), 'second passage', 'the selection is left on the page')
  assert.equal(await marked(t), null)
})

scenario('a text field the user is typing in keeps the cursor', ONE, async t => {
  await type(t, 's1', 'half a sen')
  // A pointer gesture that selects chat text while the reply box keeps the cursor.
  await t.page.evaluate(() => {
    const passage = document.getElementById('b')

    passage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    getSelection().selectAllChildren(passage)
    passage.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
  })
  await t.addButton.waitFor()
  await quiet(t)
  assert.equal(await hasCursor(t.input('s1')), true)
  assert.equal(await hasCursor(t.comment), false)
})

scenario('a click on the popup itself keeps it open with the cursor in the comment box', ONE, async t => {
  await dragInto(t, 'b')
  await t.page.keyboard.type('half')
  await t.page.getByRole('group', { name: 'Annotate selection' }).click({ position: { x: 40, y: 12 } })
  await quiet(t)
  assert.equal(await t.addButton.isVisible(), true)
  assert.equal(await hasCursor(t.comment), true)
  assert.equal(await t.comment.inputValue(), 'half')
})

scenario('the popup follows the passage when the page scrolls under the cursor', ONE, async t => {
  await t.page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div style="height:2000px"></div>'))
  await dragInto(t, 'b')

  const popup = t.page.getByRole('group', { name: 'Annotate selection' })
  const before = (await popup.boundingBox()).y

  await t.page.evaluate(() => window.scrollBy(0, 30))
  await until(async () => Math.abs((await popup.boundingBox()).y - (before - 30)) < 1.5, 'the popup moved with the passage')
  assert.equal(await hasCursor(t.comment), true)
})

scenario('Enter in the comment box adds the annotation', ONE, async t => {
  await t.select('b')
  await t.addButton.waitFor()
  await t.comment.fill('typed')
  await t.page.keyboard.press('Enter')
  await t.pill('s1').waitFor()
  await quiet(t)
  assert.deepEqual(await t.log(), [])
})

scenario('the pill opens a list where a comment can be edited and an annotation removed', ONE, async t => {
  await annotate(t, 'a', 'first')
  await annotate(t, 'b', '')
  await t.pill('s1').click()

  const list = t.pane('s1').getByRole('list', { name: 'Annotations' })

  await list.waitFor()
  assert.match(await list.innerText(), /one two/)
  assert.match(await list.innerText(), /first/)
  assert.match(await list.innerText(), /second passage/)

  await t.page.getByRole('button', { name: 'Edit comment 2' }).click()
  await t.page.getByRole('textbox', { name: 'Comment for annotation 2' }).fill('added later')
  await t.page.keyboard.press('Enter')
  await until(async () => /added later/.test(await list.innerText()), 'the edited comment is shown')
  await quiet(t)
  assert.deepEqual(await t.log(), [], 'editing a comment sends nothing')

  await t.page.getByRole('button', { name: 'Remove annotation 1' }).click()
  await until(async () => (await t.pill('s1').innerText()) === '1 annotation', 'one annotation is left')

  await type(t, 's1', 'msg')
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 1, 'the message is sent')
  assert.deepEqual(await sends(t), ['send:s1:> second passage\n\nadded later\n\nmsg'])
})

scenario('Enter sends the quotes and comments, then the message, with its attachment', ONE, async t => {
  await annotate(t, 'a', 'why?')
  await annotate(t, 'b', '')
  await t.pane('s1').locator('.attach').click()
  await type(t, 's1', 'please fix')
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 1, 'the message is sent')
  await quiet(t)
  assert.deepEqual(await t.log(), [
    {
      kind: 'send',
      session: 's1',
      text: '> one two\n> three four\n\nwhy?\n\n> second passage\n\nplease fix',
      attachments: 1
    }
  ])
  assert.equal(await pills(t).count(), 0)
  assert.equal((await t.input('s1').innerText()).trim(), '')
})

scenario('the Send button sends them too', ONE, async t => {
  await annotate(t, 'b', '')
  await type(t, 's1', 'x')
  await t.pane('s1').locator('.send').click()
  await until(async () => (await t.log()).length === 1, 'the message is sent')
  assert.deepEqual(await sends(t), ['send:s1:> second passage\n\nx'])
  assert.equal(await pills(t).count(), 0)
})

scenario('annotations alone are sent by Enter on an empty box, once', ONE, async t => {
  await annotate(t, 'b', 'check this')
  await t.input('s1').click()
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 1, 'the annotations are sent')
  await quiet(t)
  assert.deepEqual(await sends(t), ['send:s1:> second passage\n\ncheck this'])
  assert.equal(await pills(t).count(), 0)
})

scenario('while the agent is working, Enter delivers one message that includes them', ONE, async t => {
  await annotate(t, 'b', 'hm')
  await t.app('setBusy', 's1', true)
  await type(t, 's1', 'stop')
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 1, 'the message is steered')
  await quiet(t)
  assert.deepEqual(await sends(t), ['steer:s1:> second passage\n\nhm\n\nstop'])
  assert.equal((await t.input('s1').innerText()).trim(), '')
  assert.equal(await pills(t).count(), 0)

  await annotate(t, 'a', '')
  await t.input('s1').click()
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 2, 'annotations alone are steered')
  await quiet(t)
  assert.equal((await sends(t))[1], 'steer:s1:> one two\n> three four')
  assert.equal((await t.log()).length, 2)
})

scenario('with a completion list open, Enter is left to the app', ONE, async t => {
  await annotate(t, 'b', '')
  await t.app('setBusy', 's1', true)
  await type(t, 's1', '@fi')
  await t.app('showCompletion', 's1')
  await t.page.keyboard.press('Enter')
  await quiet(t)
  assert.deepEqual(await t.log(), [])
  assert.equal((await t.input('s1').innerText()).trim(), '@ficompleted')
  assert.equal(await t.pill('s1').innerText(), '1 annotation')
})

scenario('a slash command goes alone and the annotations stay', ONE, async t => {
  await annotate(t, 'b', '')
  await type(t, 's1', '/help')
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 1, 'the command is sent')
  assert.deepEqual(await sends(t), ['send:s1:/help'])
  assert.equal(await t.pill('s1').innerText(), '1 annotation')

  await type(t, 's1', '/status')
  await t.pane('s1').locator('.send').click()
  await until(async () => (await t.log()).length === 2, 'the second command is sent')
  assert.equal((await sends(t))[1], 'send:s1:/status')
  assert.equal(await t.pill('s1').innerText(), '1 annotation')
})

scenario('Shift+Enter and a queued Cmd+Enter leave the annotations in place', ONE, async t => {
  await annotate(t, 'b', '')
  await type(t, 's1', 'line')
  await t.page.keyboard.press('Shift+Enter')
  await quiet(t)
  assert.deepEqual(await t.log(), [])

  await t.app('setBusy', 's1', true)
  await t.page.keyboard.press('Meta+Enter')
  await until(async () => (await t.log()).length === 1, 'the draft is queued')
  await quiet(t)
  assert.equal((await t.log())[0].kind, 'queue')
  assert.equal((await t.log())[0].text.includes('>'), false)
  assert.equal(await t.pill('s1').innerText(), '1 annotation')
})

scenario('annotations belong to the chat they were made in', TWO, async t => {
  await annotate(t, 'b', '')
  await t.pill('s1').waitFor()

  await type(t, 's2', 'hi')
  assert.equal(await pills(t).count(), 0, 'the other chat shows no pill')
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 1, 'the other chat sends')
  assert.deepEqual(await sends(t), ['send:s2:hi'])

  await t.drag('other')
  await t.addButton.waitFor()
  await t.addButton.click()
  await t.pill('s2').waitFor()
  await type(t, 's2', 'q')
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 2, 'the other chat sends its own annotation')
  assert.equal((await sends(t))[1], 'send:s2:> other chat text\n\nq')

  await t.input('s1').click()
  await t.pill('s1').waitFor()
  assert.equal(await t.pill('s1').innerText(), '1 annotation')
})

scenario('a send nobody pressed does not take the annotations', ONE, async t => {
  await annotate(t, 'b', '')
  await t.page.evaluate(() => window.mockApp.host.composer.submit('s1', 'from elsewhere'))
  await until(async () => (await t.log()).length === 1, 'the outside message is sent')
  assert.deepEqual(await sends(t), ['send:s1:from elsewhere'])
  assert.equal(await t.pill('s1').innerText(), '1 annotation')
})

scenario('a rejected send gives the annotations back', ONE, async t => {
  await annotate(t, 'b', 'c')
  await t.app('rejectNext', 's1')
  await type(t, 's1', 'hello')
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.input('s1').innerText()).trim() === 'hello', 'the app restores the words')
  assert.deepEqual(await t.log(), [])
  await t.pill('s1').waitFor({ timeout: 6000 })
  await t.input('s1').click()
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 1, 'the retry is sent')
  assert.deepEqual(await sends(t), ['send:s1:> second passage\n\nc\n\nhello'])
})

scenario('when the reply box cannot send, the annotations stay and a notice says so', ONE, async t => {
  await annotate(t, 'b', '')
  await t.app('setDisabled', 's1', true)
  await t.input('s1').click()
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.page.evaluate(() => window.mockApp.notices.length)) === 1, 'a notice is shown')
  assert.deepEqual(await t.log(), [])
  assert.equal(await t.pill('s1').innerText(), '1 annotation')
})

scenario('Remove all clears the pill', ONE, async t => {
  await annotate(t, 'a', '')
  await annotate(t, 'b', '')
  await t.page.getByRole('button', { name: 'Remove all annotations' }).click()
  await until(async () => (await pills(t).count()) === 0, 'the pill is gone')
  await type(t, 's1', 'x')
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 1, 'the message is sent')
  assert.deepEqual(await sends(t), ['send:s1:x'])
})

scenario('the popup only appears for chat text outside the reply box and the pill, and closes on Escape', TWO, async t => {
  await t.select('outside')
  await t.page.waitForTimeout(150)
  assert.equal(await t.addButton.isVisible(), false, 'no popup for text outside a chat')

  await type(t, 's1', 'draft text')
  await t.input('s1').evaluate(el => getSelection().selectAllChildren(el))
  await t.page.waitForTimeout(150)
  assert.equal(await t.addButton.isVisible(), false, 'no popup for the reply box')

  // A drag that starts in a message and runs on into the reply box.
  await t.page.evaluate(() => {
    const range = document.createRange()

    range.setStart(document.getElementById('b').firstChild, 0)
    range.setEnd(document.querySelector('[data-pane="s1"] .input').firstChild, 5)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
  })
  await t.page.waitForTimeout(150)
  assert.equal(await t.addButton.isVisible(), false, 'no popup for a selection that runs into the reply box')

  // A selection across two chats, with no reply box in between: it starts in
  // text the first chat shows below its reply box.
  await t.page.evaluate(() => {
    const tail = document.createElement('p')

    tail.id = 'tail'
    tail.textContent = 'text below the reply box'
    document.querySelector('[data-pane="s1"]').append(tail)

    const range = document.createRange()

    range.setStart(tail.firstChild, 0)
    range.setEnd(document.getElementById('other').firstChild, 5)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
  })
  await t.page.waitForTimeout(150)
  assert.equal(await t.addButton.isVisible(), false, 'no popup for a selection across two chats')

  await t.select('user')
  await t.addButton.waitFor()
  await t.page.keyboard.press('Escape')
  assert.equal(await t.addButton.isVisible(), false)

  // The pill's own list is not chat text.
  await annotate(t, 'b', 'note')
  await t.pill('s1').click()

  const list = t.pane('s1').getByRole('list', { name: 'Annotations' })

  await list.waitFor()
  await list.evaluate(el => getSelection().selectAllChildren(el))
  await t.page.waitForTimeout(150)
  assert.equal(await t.addButton.isVisible(), false, 'no popup for the text of the pill itself')
})

scenario('one selection can span two messages of the same chat', ONE, async t => {
  await t.page.evaluate(() => {
    const range = document.createRange()

    range.setStart(document.getElementById('b').firstChild, 0)
    range.setEndAfter(document.getElementById('user').firstChild)
    getSelection().removeAllRanges()
    getSelection().addRange(range)
  })
  await t.addButton.waitFor()
  await t.addButton.click()
  await t.pill('s1').waitFor()
  await type(t, 's1', 'both')
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 1, 'the message is sent')

  const [sent] = await sends(t)

  assert.match(sent, /^send:s1:> second passage\n/)
  assert.match(sent, /> my words\n\nboth$/)
})

scenario('an annotation stays with the chat its text came from, even if another chat took focus', TWO, async t => {
  await t.select('a')
  await t.addButton.waitFor()
  await t.app('focus', 's2')
  await t.addButton.click()
  await t.pill('s1').waitFor()

  await type(t, 's2', 'hi')
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 1, 'the other chat sends')
  assert.deepEqual(await sends(t), ['send:s2:hi'])

  await type(t, 's1', 'mine')
  await t.page.keyboard.press('Enter')
  await until(async () => (await t.log()).length === 2, 'the first chat sends')
  assert.equal((await sends(t))[1], 'send:s1:> one two\n> three four\n\nmine')
})

scenario('a message removed before Add is clicked adds nothing', ONE, async t => {
  await t.select('b')
  await t.addButton.waitFor()
  await t.page.evaluate(() => document.getElementById('b').closest('article').remove())
  await t.addButton.click()
  await t.page.waitForTimeout(150)
  assert.equal(await pills(t).count(), 0)
})

scenario('unloading removes the pill and the popup', ONE, async t => {
  await annotate(t, 'b', '')
  await t.app('unload')
  await until(async () => (await pills(t).count()) === 0, 'the pill is gone')
  await t.select('a')
  await t.page.waitForTimeout(150)
  assert.equal(await t.addButton.isVisible(), false)
})

;(async () => {
  const only = process.argv[2]
  const harness = await start()
  let failed = 0
  let ran = 0

  try {
    for (const { name, panes, run } of scenarios) {
      if (only && !name.includes(only)) {
        continue
      }

      const t = await harness.open(panes)

      ran++

      try {
        await run(t)
        assert.deepEqual(t.errors, [], 'the page logged errors')
        assert.equal(
          (await t.log()).some(entry => entry.kind === 'form-submit'),
          false,
          'the reply box form was submitted'
        )
        console.log('ok    ' + name)
      } catch (error) {
        failed++
        console.log('FAIL  ' + name + '\n' + String(error.stack || error).replace(/^/gm, '      '))
      } finally {
        await t.page.close()
      }
    }
  } finally {
    await harness.close()
  }

  console.log(failed ? `${failed} of ${ran} scenarios failed` : `PASS: ${ran} scenarios`)
  process.exitCode = failed ? 1 : 0
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})
