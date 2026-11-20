# Quote in reply — a Hermes Desktop plugin

Select text in a Hermes Desktop chat and keep it as an annotation above the reply box. Collect as many as you like, then send them with your next message.

![The popup above a selected sentence, and a pill with two annotations above the reply box](docs/demo.png)

*Rendered by `tests/demo.cjs` on a mock chat, not a capture of the Hermes app.*

## What it does

1. Select text in any message, yours or the agent's.
2. A popup appears next to the selection. Type a comment if you want one, then click **Add annotation** or press Enter.
3. A pill above the reply box counts your annotations. Repeat for other passages.
4. Send as usual. Each passage goes out as a Markdown quote with its comment under it, followed by what you typed:

```markdown
> the date column is in UTC, so entries after 23:00 land on the next day.

switch this to local time

> Three rows had no owner, so I left that cell empty.

Can you fix both before the next export?
```

- Click the pill to see the list, edit a comment or remove an annotation. The × removes them all.
- With nothing typed, Enter sends the annotations on their own.
- Nothing is typed into the reply box, and nothing is sent until you send.
- An annotation belongs to the chat its text came from.
- A slash command is sent on its own. The annotations wait for your next message.
- Annotations are kept in memory. Reloading the plugin or restarting Hermes clears them.

## Install

Needs Hermes Desktop 0.23.2 or newer.

**From the app:** open **Capabilities → Plugins → Install from Git**, enter `00cyre/hermes-quote-selection`, then switch the plugin on.

**From a terminal:**

```bash
hermes plugins install 00cyre/hermes-quote-selection
```

Then switch it on under **Capabilities → Plugins**. The desktop half of a plugin stays off until you do.

**By hand:** copy `desktop/plugin.js` to `~/.hermes/desktop-plugins/quote-selection/plugin.js`. It loads within a few seconds. If it doesn't, run **Reload desktop plugins** from ⌘K.

This plugin is not listed in the Hermes plugin catalog.

## What it touches

- Reads the text you select (`window.getSelection()`) and where it is on screen.
- Adds a popup element to the page while a selection is active, and a pill in the reply box's `composer.top` slot.
- Adds the annotations to your message through the SDK's composer middleware when you send.
- Listens for Enter and clicks in a reply box that holds a pill. Only a send that follows one of those takes the annotations, so a queued or scripted send never picks them up.
- In two cases the app sends without running middleware: the box is empty, or the agent is working. There the plugin sends through `host.composer.submit` and clears what you typed with `host.composer.setDraft`.
- No network calls, no files, no clipboard, no telemetry.

## Known limits

- **It depends on the app's transcript markup.** The plugin recognises message text by two of Hermes Desktop's own `data-slot` attributes, which are not part of the plugin SDK. If a Hermes update renames them, the popup stops appearing until the plugin is updated. `hermes plugins validate` passes with a warning for this reason.
- In a split view, every visible reply box shows the pill of the chat in focus. Sending from another chat's box does not send them.
- While the agent is working, Enter delivers your message and annotations straight away, and files attached to the box stay there for your next message. Cmd/Ctrl+Enter (queue) and the Send button leave the annotations in the pill.
- Messages sent by voice don't take annotations.
- A selection has to start and end inside one message.
- Quotes are plain text. Formatting such as bold or code fences inside a selection is not carried over.

## Tests

Neither set drives the running Hermes app.

`npm test` loads `desktop/plugin.js` in headless Chromium, with real React, against `tests/mock-app.js`. That file is a model of the app's reply box written from its source: which sends run middleware, and what happens while the agent is working.

```bash
npm install
npx playwright-core install chromium
npm test
```

`npm run test:app` runs the plugin against Hermes Desktop's own code: the plugin SDK, the composer slot, the middleware chain and the runtime loader. It needs a Hermes source checkout with the desktop app's dependencies installed. It copies its files into a temporary folder inside that checkout and removes the folder afterwards.

```bash
HERMES_SRC=~/.hermes/hermes-agent npm run test:app
```

## Similar plugins

The Hermes plugin catalog lists three plugins that also quote selected text: `quote-ask`, `hermes-quote-to-chat` and `hermes-action-bar`. Install any of them with `hermes plugins install <name>`.

## License

MIT
