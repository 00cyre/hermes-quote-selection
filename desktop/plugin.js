/**
 * Quote in reply, a Hermes Desktop plugin.
 *
 * Select text in a chat message and keep it as an annotation: the passage plus
 * an optional comment. Annotations collect in a pill above the reply box and
 * are sent with your next message, as Markdown quotes ahead of what you typed.
 *
 * Hermes Desktop loads this file uncompiled, so UI is jsx() calls, not JSX, and
 * only @hermes/plugin-sdk, react and react/jsx-runtime can be imported.
 */

import { atom, Codicon, COMPOSER_AREAS, host, useValue } from '@hermes/plugin-sdk'
import { useEffect, useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const ID = 'quote-selection'
const OWN = 'data-quote-selection'

// Message text in the transcript. These two slots are the app's own markup, not
// part of the plugin SDK: if the app renames them, the popup stops appearing.
const BODIES = '[data-slot="aui_assistant-message-content"], [data-slot="aui_user-message-root"]'
const RICH = '[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], textarea'
const FIELDS = `${RICH}, input, [role="textbox"]`

const ARM_MS = 2000 // a send within this long of the user's Enter or click takes the annotations
const EMPTY_MS = 250 // how long the app gets to send by itself before annotations go alone
const REJECT_MS = 2500 // when to look whether the app gave a rejected message back

// ---------------------------------------------------------------------------
// Pending annotations, per chat
// ---------------------------------------------------------------------------

/** { [storedSessionId]: [{ id, text, comment }] }. In memory only. */
export const $annotations = atom({})

const NONE = []
let nextId = 1

const currentChat = () => host.state.focusedStoredSessionId.get() || null
const listFor = chat => $annotations.get()[chat] ?? NONE

function setList(chat, list) {
  const next = { ...$annotations.get() }

  if (list.length) {
    next[chat] = list
  } else {
    delete next[chat]
  }

  $annotations.set(next)
}

export function addAnnotation(chat, text, comment = '') {
  setList(chat, [...listFor(chat), { id: nextId++, text, comment: comment.trim() }])
}

function setComment(chat, id, comment) {
  setList(
    chat,
    listFor(chat).map(item => (item.id === id ? { ...item, comment: comment.trim() } : item))
  )
}

function removeAnnotation(chat, id) {
  setList(
    chat,
    listFor(chat).filter(item => item.id !== id)
  )
}

const quoteLines = text =>
  text
    .split('\n')
    .map(line => (line.trim() ? `> ${line}` : '>'))
    .join('\n')

/** Each passage as a Markdown quote with its comment under it, then the typed message. */
export function formatMessage(list, typed) {
  const parts = []

  for (const { text, comment } of list) {
    parts.push(quoteLines(text))

    if (comment) {
      parts.push(comment)
    }
  }

  if ((typed ?? '').trim()) {
    parts.push(typed.trim())
  }

  return parts.join('\n\n')
}

// ---------------------------------------------------------------------------
// The pill above the reply box
// ---------------------------------------------------------------------------

const STROKE = 'var(--ui-stroke-tertiary, color-mix(in srgb, currentColor 22%, transparent))'
const MUTED = 'var(--ui-text-tertiary, inherit)'

const S = {
  root: { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0, width: '100%' },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    alignSelf: 'flex-start',
    maxWidth: '100%',
    border: `1px solid ${STROKE}`,
    borderRadius: '8px',
    background: 'var(--ui-bg-quinary, transparent)',
    color: 'var(--ui-text-secondary, inherit)',
    fontSize: '12px',
    lineHeight: '16px'
  },
  toggle: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 2px 4px 8px',
    border: 0,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    cursor: 'pointer'
  },
  icon: {
    display: 'inline-grid',
    placeItems: 'center',
    flex: 'none',
    width: '22px',
    height: '22px',
    padding: 0,
    border: 0,
    borderRadius: '6px',
    background: 'transparent',
    color: MUTED,
    font: 'inherit',
    cursor: 'pointer'
  },
  list: {
    margin: 0,
    padding: '2px 0',
    listStyle: 'none',
    maxHeight: '220px',
    overflowY: 'auto',
    border: `1px solid ${STROKE}`,
    borderRadius: '8px',
    fontSize: '12px',
    lineHeight: '17px'
  },
  item: { display: 'flex', alignItems: 'flex-start', gap: '8px', padding: '6px 6px 6px 10px' },
  number: { flex: 'none', color: MUTED, fontVariantNumeric: 'tabular-nums' },
  body: { display: 'flex', flex: 1, flexDirection: 'column', gap: '3px', minWidth: 0 },
  quote: {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 3,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
    paddingInlineStart: '7px',
    borderInlineStart: '2px solid var(--ui-accent, currentColor)',
    color: 'var(--ui-text-secondary, inherit)'
  },
  comment: { overflowWrap: 'anywhere', whiteSpace: 'pre-wrap', color: 'var(--ui-text-primary, inherit)' },
  noComment: { color: MUTED },
  field: {
    boxSizing: 'border-box',
    width: '100%',
    padding: '2px 6px',
    border: `1px solid ${STROKE}`,
    borderRadius: '6px',
    outline: 0,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit'
  }
}

// One pill element per mounted reply box, while the chat in focus has annotations.
const roots = new Set()

const trackRoot = el => {
  if (!el) {
    return undefined
  }

  roots.add(el)

  return () => roots.delete(el)
}

function Row({ chat, item, number, editing, setEditing }) {
  const save = value => {
    setComment(chat, item.id, value)
    setEditing(null)
  }

  return jsxs('li', {
    style: S.item,
    children: [
      jsx('span', { style: S.number, children: `${number}.` }),
      jsxs('div', {
        style: S.body,
        children: [
          jsx('div', { style: S.quote, title: item.text, children: item.text }),
          editing
            ? jsx('input', {
                'aria-label': `Comment for annotation ${number}`,
                autoFocus: true,
                defaultValue: item.comment,
                placeholder: 'Comment',
                style: S.field,
                type: 'text',
                onBlur: event => save(event.currentTarget.value),
                onKeyDown: event => {
                  // The reply box is a form: an unhandled Enter here would submit it.
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.stopPropagation()
                    save(event.currentTarget.value)
                  } else if (event.key === 'Escape') {
                    event.preventDefault()
                    event.stopPropagation()
                    setEditing(null)
                  }
                }
              })
            : jsx('div', {
                style: item.comment ? S.comment : S.noComment,
                children: item.comment || 'No comment'
              })
        ]
      }),
      jsx('button', {
        'aria-label': `Edit comment ${number}`,
        style: S.icon,
        title: 'Edit comment',
        type: 'button',
        onClick: () => setEditing(item.id),
        children: jsx(Codicon, { name: 'edit', size: '0.8rem' })
      }),
      jsx('button', {
        'aria-label': `Remove annotation ${number}`,
        style: S.icon,
        title: 'Remove',
        type: 'button',
        onClick: () => removeAnnotation(chat, item.id),
        children: jsx(Codicon, { name: 'trash', size: '0.8rem' })
      })
    ]
  })
}

function Annotations() {
  const all = useValue($annotations)
  const chat = useValue(host.state.focusedStoredSessionId) || ''
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const list = all[chat] ?? NONE
  const count = list.length

  useEffect(() => {
    if (!count) {
      setOpen(false)
      setEditing(null)
    }
  }, [count])

  if (!count) {
    return null
  }

  return jsxs('div', {
    [OWN]: 'pill',
    ref: trackRoot,
    style: S.root,
    children: [
      jsxs('span', {
        style: S.pill,
        children: [
          jsxs('button', {
            'aria-expanded': open,
            style: S.toggle,
            title: open ? 'Hide annotations' : 'Show annotations',
            type: 'button',
            onClick: () => setOpen(value => !value),
            children: [
              jsx(Codicon, { name: 'comment', size: '0.8rem' }),
              jsx('span', { children: count === 1 ? '1 annotation' : `${count} annotations` }),
              jsx(Codicon, { name: open ? 'chevron-up' : 'chevron-down', size: '0.7rem' })
            ]
          }),
          jsx('button', {
            'aria-label': 'Remove all annotations',
            style: S.icon,
            title: 'Remove all',
            type: 'button',
            onClick: () => setList(chat, []),
            children: jsx(Codicon, { name: 'close', size: '0.75rem' })
          })
        ]
      }),
      open &&
        jsx('ol', {
          'aria-label': 'Annotations',
          style: S.list,
          children: list.map((item, index) =>
            jsx(Row, { chat, item, number: index + 1, editing: editing === item.id, setEditing }, item.id)
          )
        })
    ]
  })
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const elementOf = node => (node?.nodeType === 1 ? node : (node?.parentElement ?? null))
const isCommand = text => (text ?? '').trim().startsWith('/')
const typedIn = input => (input.value ?? input.innerText ?? input.textContent ?? '').replace(/\u200b/g, '').trim()

// The app's @ and / completion list. While it is open, Enter picks a row.
const completionOpen = () =>
  [...document.querySelectorAll('[role="listbox"]')].some(list => list.getClientRects().length > 0)

/** The reply box a pill sits in: its nearest ancestor that also holds a text field. */
function replyBoxOf(root) {
  for (let box = root.parentElement, depth = 0; box && depth < 6; box = box.parentElement, depth++) {
    const input = [...box.querySelectorAll(RICH)].find(field => !root.contains(field))

    if (input) {
      return { box, input }
    }
  }

  return null
}

/** Where an event landed, when that is a reply box holding one of our pills. */
function replyBoxAt(target) {
  const el = elementOf(target)

  if (!el) {
    return null
  }

  for (const root of roots) {
    if (!root.isConnected) {
      roots.delete(root)

      continue
    }

    if (root.contains(el)) {
      return null // our own buttons and comment field
    }

    const found = replyBoxOf(root)

    if (found?.box.contains(el)) {
      return { ...found, inInput: found.input.contains(el) }
    }
  }

  return null
}

// When the user last pressed Enter in, or clicked a control of, a reply box that
// holds a pill. Only a send that follows takes the annotations, so a queued or
// scripted send from elsewhere never picks them up.
let armed = -Infinity

/** A rejected send puts the typed words back in the reply box. Give its annotations back too. */
async function restoreIfRejected(chat, list, typed) {
  if (listFor(chat).length) {
    return
  }

  const back = await Promise.resolve(host.composer.getDraft(chat)).catch(() => null)

  if (typeof back === 'string' && back.trim() === typed.trim()) {
    setList(chat, list)
  }
}

/** Idle sends go through here: add the annotations ahead of the typed message. */
function makeMiddleware(later) {
  return {
    handler: draft => {
      const chat = currentChat()
      const list = chat ? listFor(chat) : NONE
      const typed = draft?.text ?? ''

      if (!list.length || isCommand(typed) || performance.now() - armed > ARM_MS) {
        return draft
      }

      armed = -Infinity
      setList(chat, [])

      if (typed.trim()) {
        later(() => void restoreIfRejected(chat, list, typed), REJECT_MS)
      }

      return { ...draft, text: formatMessage(list, typed) }
    }
  }
}

/** Send through the SDK, for the cases where the app's own send skips the middleware. */
async function sendNow(chat, list, typed) {
  armed = -Infinity
  setList(chat, []) // taken first, so the app's send path cannot add them a second time

  let draft = typed

  if (typed) {
    const live = await Promise.resolve(host.composer.getDraft(chat)).catch(() => null)

    if (typeof live === 'string' && live.trim()) {
      draft = live
    }
  }

  let sent = false

  try {
    sent = host.composer.submit(chat, formatMessage(list, draft)) === true
  } catch {
    sent = false
  }

  if (!sent) {
    setList(chat, [...list, ...listFor(chat)])
    host.notify({ kind: 'warning', message: 'Could not send the annotations. They are still above the reply box.' })

    return
  }

  if (typed) {
    await Promise.resolve(host.composer.setDraft(chat, '')).catch(() => false)
  }
}

function onEnter(event, later) {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229 || event.defaultPrevented) {
    return
  }

  if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) {
    return // a new line, or the app's own queue shortcut
  }

  const replyBox = replyBoxAt(event.target)

  if (!replyBox?.inInput) {
    return
  }

  const chat = currentChat()
  const list = chat ? listFor(chat) : NONE

  if (!list.length) {
    return
  }

  const typed = typedIn(replyBox.input)

  if (isCommand(typed)) {
    return
  }

  armed = performance.now()

  if (!typed) {
    // Nothing typed. If the app sends anyway (an attachment, a queued message), the
    // middleware adds the annotations. Otherwise they go on their own.
    later(() => {
      if (listFor(chat) === list) {
        void sendNow(chat, list, '')
      }
    }, EMPTY_MS)

    return
  }

  if (host.state.busy.get() && !completionOpen()) {
    // A message typed while the agent is working is delivered without the middleware.
    event.preventDefault()
    event.stopImmediatePropagation()
    void sendNow(chat, list, typed)
  }
}

// ---------------------------------------------------------------------------
// The popup next to a selection
// ---------------------------------------------------------------------------

function createPopup() {
  const stroke = 'var(--ui-stroke-secondary, color-mix(in srgb, currentColor 25%, transparent))'
  const box = document.createElement('div')

  box.setAttribute(OWN, 'popup')
  box.setAttribute('role', 'group')
  box.setAttribute('aria-label', 'Annotate selection')
  box.style.cssText =
    'position:fixed;z-index:2147483000;box-sizing:border-box;width:min(330px,calc(100vw - 16px));padding:8px 10px;' +
    `border:1px solid ${stroke};border-radius:12px;background:var(--ui-bg-elevated,Canvas);` +
    'color:var(--ui-text-primary,CanvasText);font:inherit;font-size:13px;-webkit-app-region:no-drag;' +
    'box-shadow:0 6px 20px color-mix(in srgb,var(--ui-text-primary,#000) 18%,transparent)'

  const preview = document.createElement('div')

  preview.style.cssText =
    'margin-bottom:6px;padding-inline-start:7px;border-inline-start:2px solid var(--ui-accent,currentColor);' +
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ui-text-tertiary,GrayText);font-size:12px'

  const row = document.createElement('div')

  row.style.cssText = 'display:flex;align-items:center;gap:8px'

  const note = document.createElement('input')

  note.type = 'text'
  note.placeholder = 'Add a comment…'
  note.setAttribute('aria-label', 'Optional comment')
  note.style.cssText =
    'flex:1;min-width:0;padding:3px;border:0;outline:0;background:transparent;color:inherit;font:inherit'

  const button = document.createElement('button')

  button.type = 'button'
  button.textContent = 'Add annotation'
  button.style.cssText =
    `padding:4px 8px;border:1px solid ${stroke};border-radius:7px;background:var(--ui-bg-quinary,ButtonFace);` +
    'color:inherit;font:inherit;white-space:nowrap;cursor:pointer'

  row.append(note, button)
  box.append(preview, row)

  return { box, button, note, preview }
}

export default {
  id: ID,
  name: 'Quote in reply',
  description:
    'Select text in a chat to keep it as an annotation above the reply box. Annotations are sent with your next message.',
  register(ctx) {
    const later = (fn, ms) => ctx.setTimeout(fn, ms)
    const { box, button, note, preview } = createPopup()
    let picked = null
    let frame = 0
    let dragging = false

    const close = () => {
      cancelAnimationFrame(frame)
      frame = 0
      picked = null
      box.remove()
      preview.textContent = ''
      note.value = ''
    }

    function refresh() {
      frame = 0

      if (dragging || box.contains(document.activeElement)) {
        return
      }

      const selection = window.getSelection()

      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) {
        return close()
      }

      const range = selection.getRangeAt(0)
      const start = elementOf(range.startContainer)
      const end = elementOf(range.endContainer)
      const body = start?.closest(BODIES)

      if (!body || end?.closest(BODIES) !== body || start.closest(FIELDS) || end.closest(FIELDS)) {
        return close()
      }

      const chat = currentChat()
      const text = selection.toString().replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').trim()

      if (!chat || !text) {
        return close()
      }

      const rect = range.getBoundingClientRect()
      const top = Math.max(0, rect.top)
      const bottom = Math.min(window.innerHeight, rect.bottom)

      if (bottom <= top || !rect.width) {
        return close()
      }

      if (!picked || picked.text !== text || picked.body !== body) {
        note.value = ''
      }

      picked = { body, chat, text }
      preview.textContent = text.replace(/\s+/g, ' ')

      if (!box.isConnected) {
        document.body.append(box)
      }

      const width = box.offsetWidth
      const height = box.offsetHeight
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, (rect.left + rect.right - width) / 2))
      const above = top > height + 8 ? top - height - 6 : bottom + 6

      box.style.left = `${left}px`
      box.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, above))}px`
    }

    const schedule = () => {
      if (!frame) {
        frame = requestAnimationFrame(refresh)
      }
    }

    function add() {
      if (!picked) {
        return
      }

      const { body, chat, text } = picked
      const comment = note.value

      close()

      // The message is gone: its chat was closed or replaced since the selection was made.
      if (!body.isConnected) {
        return
      }

      addAnnotation(chat, text, comment)
      window.getSelection()?.removeAllRanges()

      try {
        host.composer.focus(chat)
      } catch {
        // The pill is in place either way.
      }
    }

    ctx.addEventListener(
      document,
      'pointerdown',
      event => {
        if (!box.contains(event.target)) {
          close()
          dragging = true
        }
      },
      true
    )
    ctx.addEventListener(
      window,
      'pointerup',
      () => {
        dragging = false
        schedule()
      },
      true
    )
    ctx.addEventListener(
      window,
      'pointercancel',
      () => {
        dragging = false
        close()
      },
      true
    )
    ctx.addEventListener(document, 'selectionchange', schedule)
    ctx.addEventListener(
      document,
      'scroll',
      () => {
        if (picked && !box.contains(document.activeElement)) {
          schedule()
        }
      },
      true
    )
    ctx.addEventListener(window, 'resize', schedule)
    ctx.addEventListener(window, 'blur', () => {
      dragging = false
      close()
    })
    ctx.addEventListener(
      document,
      'keydown',
      event => {
        if (event.key === 'Escape' && picked && !event.isComposing) {
          event.preventDefault()
          event.stopPropagation()
          close()
        } else if (event.target === note && event.key === 'Enter' && !event.isComposing) {
          event.preventDefault()
          event.stopPropagation()
          add()
        } else {
          onEnter(event, later)
        }
      },
      true
    )
    ctx.addEventListener(
      document,
      'click',
      event => {
        const replyBox = replyBoxAt(event.target)

        if (replyBox && !replyBox.inInput) {
          armed = performance.now() // the Send button, or any other control in the reply box
        }
      },
      true
    )
    ctx.addEventListener(button, 'mousedown', event => event.preventDefault())
    ctx.addEventListener(button, 'click', add)

    ctx.register({ id: 'annotations', area: COMPOSER_AREAS.top, order: -100, render: () => jsx(Annotations, {}) })
    ctx.register({ id: 'send', area: COMPOSER_AREAS.middleware, data: makeMiddleware(later) })

    ctx.onDispose(() => {
      close()
      roots.clear()
      armed = -Infinity
      $annotations.set({})
    })
  }
}
