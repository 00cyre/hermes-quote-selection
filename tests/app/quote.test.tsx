// The plugin against Hermes Desktop's real SDK, plugin context, composer slot and
// middleware chain. Run with `npm run test:app` (see run.cjs).
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { COMPOSER_AREAS, runComposerMiddleware } from '@/app/chat/composer/contrib'
import { createPluginContext } from '@/contrib/plugin'
import { composerFocusKeysAllowed, typeToFocusChar } from '@/lib/keybinds/composer-focus-keys'
import { Slot } from '@/contrib/react/slot'
import { registry } from '@/contrib/registry'
import { host } from '@/sdk'
import { $selectedStoredSessionId } from '@/store/session'

// @ts-expect-error plain JS plugin
import plugin, { addAnnotation } from './plugin.js'

const disposers: Array<() => void> = []

afterEach(() => {
  disposers.splice(0).forEach(dispose => dispose())
  cleanup()
})

const mine = (area: string) => registry.getArea(area).filter(c => c.source === 'plugin:quote-selection')
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

it('registers through the real plugin context, renders in the real slot, and rides the real middleware chain', async () => {
  plugin.register(createPluginContext(plugin.id, dispose => disposers.push(dispose)))

  expect(mine(COMPOSER_AREAS.top)).toHaveLength(1)
  expect(mine(COMPOSER_AREAS.middleware)).toHaveLength(1)

  $selectedStoredSessionId.set('s1')
  expect(host.state.focusedStoredSessionId.get()).toBe('s1')
  expect(host.state.busy.get()).toBe(false)

  render(
    <form>
      <div>
        <Slot area={COMPOSER_AREAS.top} />
        <div contentEditable data-testid="input" suppressContentEditableWarning />
        <button type="button">Send</button>
      </div>
    </form>
  )

  expect(screen.queryByRole('button', { name: /annotation/ })).toBeNull()

  act(() => addAnnotation('s1', 'quoted text', 'why?'))
  act(() => addAnnotation('s1', 'second', ''))
  expect(screen.getByRole('button', { name: '2 annotations' })).toBeTruthy()
  expect(document.querySelector('.codicon-comment')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: '2 annotations' }))
  expect(screen.getByRole('list', { name: 'Annotations' }).textContent).toContain('quoted text')

  // A send nobody pressed passes through untouched.
  expect(await runComposerMiddleware({ text: 'from elsewhere' })).toEqual({ text: 'from elsewhere' })
  expect(screen.getByRole('button', { name: '2 annotations' })).toBeTruthy()

  // Enter in the reply box, then the app's send, with a slow middleware ahead of ours.
  disposers.push(
    registry.register({
      id: 'slow',
      area: COMPOSER_AREAS.middleware,
      order: -1,
      data: { handler: async (draft: { text: string }) => (await wait(300), draft) }
    })
  )

  const input = screen.getByTestId('input')

  input.textContent = 'hello'
  fireEvent.keyDown(input, { key: 'Enter' })

  let sent: { text: string } | null = null

  await act(async () => {
    sent = await runComposerMiddleware({ text: 'hello' })
  })

  expect(sent).toEqual({ text: '> quoted text\n\nwhy?\n\n> second\n\nhello' })
  expect(screen.queryByRole('button', { name: /annotation/ })).toBeNull()

  // Unloading removes both contributions.
  disposers.splice(0).forEach(dispose => dispose())
  expect(mine(COMPOSER_AREAS.top)).toHaveLength(0)
  expect(mine(COMPOSER_AREAS.middleware)).toHaveLength(0)
})

it("puts the cursor in the comment box after a selection made by hand, where the app's type-to-focus stands down", async () => {
  plugin.register(createPluginContext(plugin.id, dispose => disposers.push(dispose)))
  $selectedStoredSessionId.set('s1')

  render(
    <div data-chat-surface="">
      <p data-testid="passage">a passage in the chat</p>
    </div>
  )

  // jsdom has no layout: give the selection a place on screen.
  const measure = Range.prototype.getBoundingClientRect

  Range.prototype.getBoundingClientRect = () =>
    ({ bottom: 120, height: 20, left: 40, right: 240, top: 100, width: 200, x: 40, y: 100 }) as DOMRect
  disposers.push(() => {
    Range.prototype.getBoundingClientRect = measure
  })

  // What the app's own key handler decides for a printable key, asked where it
  // listens: true means the key is taken away and typed into the reply box.
  const takenForReplyBox = (target: Element) => {
    let taken: boolean | null = null

    const probe = (event: KeyboardEvent) => {
      taken = typeToFocusChar(event) === 'w' && composerFocusKeysAllowed(event, 'type')
    }

    window.addEventListener('keydown', probe, { capture: true })
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'w' }))
    window.removeEventListener('keydown', probe, { capture: true })

    return taken
  }

  // With the cursor nowhere, which is where a mouse selection leaves it.
  expect(takenForReplyBox(document.body)).toBe(true)

  const passage = screen.getByTestId('passage')

  fireEvent.pointerDown(passage, { button: 0 })
  window.getSelection()?.selectAllChildren(passage)
  fireEvent.pointerUp(passage, { button: 0 })

  const note = await screen.findByPlaceholderText('Add a comment…')

  await waitFor(() => expect(document.activeElement).toBe(note))
  expect(takenForReplyBox(note)).toBe(false)

  // Escape hands the selection back to the page.
  fireEvent.keyDown(note, { key: 'Escape' })
  expect(screen.queryByPlaceholderText('Add a comment…')).toBeNull()
  expect(window.getSelection()?.toString()).toBe('a passage in the chat')
})
