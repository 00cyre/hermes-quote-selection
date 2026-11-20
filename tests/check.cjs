const assert = require('node:assert/strict')
const { start } = require('./harness.cjs')

const S1 = `
  <article data-slot="aui_assistant-message-content">
    <p id="a">one <em>two</em><br>three four</p>
    <p id="b">second passage</p>
  </article>
  <article data-slot="aui_user-message-root"><button type="button"><span id="user">my words</span></button></article>`
const S2 = `<article data-slot="aui_assistant-message-content"><p id="other">other chat text</p></article>`
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

scenario('the popup only appears for message text and closes on Escape', TWO, async t => {
  await t.select('outside')
  await t.page.waitForTimeout(150)
  assert.equal(await t.addButton.isVisible(), false, 'no popup for text outside a message')

  await type(t, 's1', 'draft text')
  await t.input('s1').evaluate(el => getSelection().selectAllChildren(el))
  await t.page.waitForTimeout(150)
  assert.equal(await t.addButton.isVisible(), false, 'no popup for the reply box')

  await t.select('user')
  await t.addButton.waitFor()
  await t.page.keyboard.press('Escape')
  assert.equal(await t.addButton.isVisible(), false)

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
  await t.page.evaluate(() => document.querySelector('[data-slot="aui_assistant-message-content"]').remove())
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
