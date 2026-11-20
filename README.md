# Quote in reply — a Hermes Desktop plugin

Select text in a Hermes Desktop chat and keep it as an annotation above the reply box. Collect as many as you like, then send them with your next message.

![The popup above a selected sentence, and a pill with two annotations above the reply box](docs/demo.png)

*Rendered by `tests/demo.cjs` on a mock chat, not a capture of the Hermes app.*

## What it does

1. Select text in a chat: any message, yours or the agent's.
2. A popup appears next to the selection with the cursor already in its comment box. Type a comment if you want one, then press Enter or click **Add annotation**.
3. A pill above the reply box counts your annotations. Repeat for other passages.
4. Send as usual. Each passage goes out as a Markdown quote with its comment under it, followed by what you typed:

```markdown
> the date column is in UTC, so entries after 23:00 land on the next day.

switch this to local time

> Three rows had no owner, so I left that cell empty.

Can you fix both before the next export?
```

- Escape closes the popup and leaves the text selected. A click elsewhere or a right-click closes it too.
- Copying while the cursor is in the empty comment box still copies the selected text.
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

## What it touches

- Reads the text you select (`window.getSelection()`) and where it is on screen.
- Checks that the selection is inside one chat, using `data-chat-surface`, the attribute the Desktop plugin SDK guide documents for a chat's root. It reads the attribute only. It does not hide or rewrite anything in the app.
- Ignores a selection that touches a text field (`contenteditable`, `textarea`, `input`, `role="textbox"`) or the plugin's own pill.
- Adds a popup element to the page while a selection is active, and a pill in the reply box's `composer.top` slot.
- Moves the cursor into the popup's comment box when you finish a selection with the mouse, unless you are typing in a text field. Without that, the app sends the next key you type to the reply box.
- A text field that takes the cursor also takes the page's selection. So while the cursor is in the comment box, the plugin keeps the passage marked with the CSS Custom Highlight API, in the app's selection colour (`--ui-selection-background`). It puts the selection back when the popup closes without adding.
- Adds the annotations to your message through the SDK's composer middleware when you send.
- Listens for Enter and clicks in a reply box that holds a pill. Only a send that follows one of those takes the annotations, so a queued or scripted send never picks them up.
- In two cases the app sends without running middleware: the box is empty, or the agent is working. There the plugin sends through `host.composer.submit` and clears what you typed with `host.composer.setDraft`. While the agent is working it handles that Enter itself, so the app's own handler does not also send the message. If a completion list (`role="listbox"`) is open, Enter is left to the app.
- Answers a copy made with the cursor in the empty comment box with the selected passage, as plain text. It never reads the clipboard.
- Annotations are kept in memory only. No network calls, no files, no stored settings, no telemetry.

## Known limits

- The popup appears for any text in a chat that is not in a text field, so it also appears for the chat's title and for text inside tool output.
- Outside a chat (Settings, Capabilities, the sidebar) there is no popup.
- In a split view, every visible reply box shows the pill of the chat in focus. Sending from another chat's box does not send them.
- While the agent is working, Enter delivers your message and annotations straight away, and files attached to the box stay there for your next message. Cmd/Ctrl+Enter (queue) and the Send button leave the annotations in the pill.
- Messages sent by voice don't take annotations.
- A selection has to start and end inside one chat. It can span several messages.
- Only a selection finished with the mouse moves the cursor. One made from the keyboard, or by the app itself, shows the popup and leaves the cursor where it is.
- With the cursor in the comment box, Shift+arrow keys no longer change the selection. Press Escape first to get it back.
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
