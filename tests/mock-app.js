// A stand-in for the parts of Hermes Desktop this plugin touches. It is a model
// written from the app's composer source, not the app: which pane has focus,
// which sends run composer middleware, and what host.composer does while the
// agent is busy.
//
//   idle Enter / Send with text or attachments -> middleware chain -> sent
//   idle Enter on an empty box                 -> nothing
//   busy Enter with text                       -> steered, middleware skipped
//   busy Cmd/Ctrl+Enter with text              -> queued, middleware skipped
//   host.composer.submit(id, text)             -> idle: middleware chain -> sent
//                                                 busy: steered
;(() => {
  const { React, jsx, createRoot, atom, useStore } = window.__DEPS__

  const contributions = []
  const disposers = []
  const panes = new Map()
  const log = [] // what reached the agent: { kind: 'send' | 'steer' | 'queue' | 'form-submit', session, text, attachments }
  const notices = []
  const focused = atom(null)
  const busy = atom(false)
  const version = atom(0)

  const bump = () => version.set(version.get() + 1)
  const area = name => contributions.filter(c => c.area === name).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

  function Slot({ name }) {
    useStore(version)

    return jsx(React.Fragment, {
      children: area(name).map(c => jsx(React.Fragment, { children: c.render ? c.render() : null }, c.id))
    })
  }

  function Codicon({ name, size }) {
    // Like the app's: an empty element whose glyph comes from a font, so it adds no text.
    return jsx('i', { 'aria-hidden': 'true', className: `codicon codicon-${name}`, style: { fontSize: size } })
  }

  async function runMiddleware(draft) {
    let current = draft

    for (const c of area('composer.middleware')) {
      if (!c.data?.handler) {
        continue
      }

      try {
        const next = await c.data.handler(current)

        if (next === null) {
          return null
        }

        current = next
      } catch {
        // pass-through, like the app
      }
    }

    return current
  }

  const draftOf = pane => pane.input.innerText.replace(/\u200b/g, '')

  async function dispatch(pane, text, attachments, restore) {
    const draft = await runMiddleware({ text, attachments })

    if (!draft || pane.rejectNext) {
      pane.rejectNext = false

      if (restore) {
        pane.input.textContent = text // a rejected send gives the typed words back
      }

      return
    }

    log.push({ kind: 'send', session: pane.session, text: draft.text, attachments: (draft.attachments ?? []).length })
  }

  function submitDraft(pane) {
    const text = draftOf(pane)
    const payload = text.trim().length > 0 || pane.attachments.length > 0

    if (pane.disabled || !payload) {
      return
    }

    if (pane.busy) {
      const kind = pane.attachments.length ? 'queue' : 'steer'

      log.push({ kind, session: pane.session, text, attachments: pane.attachments.splice(0).length })
      pane.input.textContent = ''

      return
    }

    const attachments = pane.attachments.splice(0)

    pane.input.textContent = ''
    void dispatch(pane, text, attachments, true)
  }

  function focus(session) {
    focused.set(session)
    busy.set(panes.get(session)?.busy ?? false)
  }

  function addPane(session, html) {
    const el = document.createElement('main')

    el.dataset.pane = session
    el.innerHTML =
      `<section class="thread">${html}</section>` +
      '<form class="composer"><div class="fade"><div class="top"></div>' +
      '<div class="input" contenteditable="true" role="textbox" aria-label="Message"></div>' +
      '<div class="controls"><button type="button" class="attach" aria-label="Attach">+</button>' +
      '<button type="button" class="send" aria-label="Send">↑</button></div></div></form>'
    document.getElementById('app').append(el)

    const pane = {
      session,
      el,
      input: el.querySelector('.input'),
      attachments: [],
      busy: false,
      disabled: false,
      rejectNext: false,
      completion: null
    }

    panes.set(session, pane)
    el.addEventListener('pointerdown', () => focus(session), true)
    el.addEventListener('focusin', () => focus(session))
    el.querySelector('form').addEventListener('submit', event => {
      event.preventDefault()
      log.push({ kind: 'form-submit', session, text: '', attachments: 0 })
    })
    el.querySelector('.send').addEventListener('click', () => submitDraft(pane))
    el.querySelector('.attach').addEventListener('click', () => pane.attachments.push({ name: 'file.png' }))
    pane.input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey) {
        return
      }

      event.preventDefault()

      if (event.metaKey || event.ctrlKey) {
        if (pane.busy && draftOf(pane).trim()) {
          log.push({ kind: 'queue', session, text: draftOf(pane), attachments: 0 })
          pane.input.textContent = ''
        }

        return
      }

      if (pane.completion) {
        pane.completion.remove()
        pane.completion = null
        pane.input.textContent += 'completed'

        return
      }

      submitDraft(pane)
    })
    createRoot(el.querySelector('.top')).render(jsx(Slot, { name: 'composer.top' }))

    if (focused.get() === null) {
      focus(session)
    }
  }

  const host = {
    state: { focusedStoredSessionId: focused, busy },
    notify: notice => notices.push(notice),
    composer: {
      getDraft: async id => (panes.has(id) ? draftOf(panes.get(id)) : null),
      setDraft: async (id, text) => {
        if (!panes.has(id)) {
          return false
        }

        panes.get(id).input.textContent = text

        return true
      },
      submit: (id, text) => {
        const pane = panes.get(id)

        if (!pane || pane.disabled || !String(text).trim()) {
          return false
        }

        if (pane.busy) {
          log.push({ kind: 'steer', session: id, text, attachments: 0 })
        } else {
          void dispatch(pane, text, [], false)
        }

        return true
      },
      focus: id => panes.get(id)?.input.focus()
    }
  }

  const ctx = {
    register: contribution => {
      contributions.push(contribution)
      bump()

      const off = () => {
        const index = contributions.indexOf(contribution)

        if (index >= 0) {
          contributions.splice(index, 1)
          bump()
        }
      }

      disposers.push(off)

      return off
    },
    onDispose: fn => void disposers.push(fn),
    addEventListener: (target, type, fn, options) => {
      target.addEventListener(type, fn, options)

      const off = () => target.removeEventListener(type, fn, options)

      disposers.push(off)

      return off
    },
    setTimeout: (fn, ms) => {
      const id = setTimeout(fn, ms)
      const off = () => clearTimeout(id)

      disposers.push(off)

      return off
    }
  }

  window.__MODS__ = {
    '@hermes/plugin-sdk': {
      atom,
      Codicon,
      COMPOSER_AREAS: { top: 'composer.top', middleware: 'composer.middleware' },
      host,
      useValue: useStore
    },
    react: React,
    'react/jsx-runtime': window.__DEPS__.jsxRuntime
  }

  window.mockApp = {
    addPane,
    ctx,
    focus,
    host,
    log,
    notices,
    setBusy: (session, value) => {
      panes.get(session).busy = value

      if (focused.get() === session) {
        busy.set(value)
      }
    },
    setDisabled: (session, value) => void (panes.get(session).disabled = value),
    rejectNext: session => void (panes.get(session).rejectNext = true),
    showCompletion: session => {
      const pane = panes.get(session)
      const list = document.createElement('div')

      list.setAttribute('role', 'listbox')
      list.textContent = '@file'
      pane.el.append(list)
      pane.completion = list
    },
    unload: () =>
      disposers
        .splice(0)
        .reverse()
        .forEach(fn => fn())
  }
})()
