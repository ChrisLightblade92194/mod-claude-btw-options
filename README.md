# btw options: a Claude Code mod

When Claude asks you a multiple-choice question, you may not know what an option really means, or what picking it would lead to. This mod adds a side panel that lets you dig into any option in a *by the way* chat. The question dialog stays open and keeps your selection while you read.

## What it does

- **Opens on its own.** When Claude asks a multiple-choice question (single or multi-select), a side panel named **btw** opens beside the dialog.
- **One card per option.** Each option gets a card with its label, its description and a **? Approfondisci** ("dig into it") button.
- **Answers that know the context.** The button asks Claude about that option over the current conversation (a tool-less fork of the session, so nothing runs and the main thread is untouched). While it waits, the card shows a spinner. When the answer arrives, the card offers **Apri approfondimento** ("open the explanation"). If the request fails, it offers **↻ Riprova** ("retry").
- **Runs in parallel.** You can dig into several options at once. The same option is never asked twice.
- **Tabs inside the panel.** Every explanation has its own tab, grouped under the question it came from. In each tab you can ask follow-up questions with **Chiedi** ("ask"). **Chiudi approfondimento** closes one tab, and **✕** closes a whole group.
- **Stays while it is useful.** After you answer the question the option cards go away, but your explanations stay in the panel until you close them. Each group shows the answer you gave. The panel closes by itself when nothing is left.
- **Reopen past questions.** **▾ Riapri opzioni** ("reopen options") on a group brings back the option cards of that question, so you can still dig into the options you skipped. Claude is told that you already answered, and what you answered. **▴ Nascondi opzioni** ("hide options") puts the cards away again and goes back to the question still open, if there is one.

The mod's interface and the prompt it sends to Claude are in **Italian**. Claude replies in the language of your conversation.

## Install

At the prompt of a terminal session:

```
/plugin install btw-opzioni --marketplace ChrisLightblade92194/mod-claude-btw-options
```

Answer `y` to add the marketplace, then pick a scope (user scope loads it in every session).

From a shell:

```bash
claude plugin install btw-opzioni --marketplace ChrisLightblade92194/mod-claude-btw-options
```

In the Claude desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `ChrisLightblade92194/mod-claude-btw-options`, then **Add plugin**.

A mod installed from a terminal at the user scope also loads in the desktop app's local sessions.

## Requirements

- Claude Code with function hooks (mods). Built and tested on **Claude Code 2.1.299**. The mods API is early access and may change between releases.
- Works on the terminal and desktop surfaces. On the terminal the spinner is a plain `⏳`. On the desktop it is an animated icon.

## Known limitations

- **First click on the desktop.** The desktop app gives keyboard focus to a panel on the first click. If the panel does not have focus yet, the first click on a button may only focus it, and you need a second click.
- **Tabs are drawn by the mod.** A mod cannot switch the desktop app's own tabs, so the explanations live in tabs inside the **btw** panel.
- **Session-scoped.** Explanations are kept for the current session only. A new session starts empty.

## How it works

- A `tool.call` hook on `AskUserQuestion` records every question and, once it is answered, the answer. It opens the panel, and closes it when the question is answered unless explanations are still open.
- A `ui.render` hook on the panel draws the option cards and the tabs from the mod's session state (`$.state`).
- Every explanation is one `$.model.fork` call: a single tool-less request over the session's own transcript. The prompt includes the question, all the options and the follow-up history of that tab.

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

The tests in `tests/` drive the whole flow on the terminal and desktop surfaces: parallel explanations, the button that appears only after a successful answer, retry, follow-up questions, grouping by question and closing a group.

To try local changes, load the folder with `claude --plugin-dir <this folder>`, or name it in `CLAUDE_CODE_PLUGIN_DIRS`.

## License

[MIT](LICENSE) © ChrisLightblade92194
