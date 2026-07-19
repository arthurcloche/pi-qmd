# pi-qmd

A [Pi](https://github.com/earendil-works/pi-mono) package that helps a personal qmd knowledge base compound instead of letting useful discoveries die in closed chats.

When you press **Ctrl+D** on an empty Pi editor, pi-qmd:

1. extracts the active conversation branch without dumping tool-result noise;
2. refreshes qmd and runs lexical + semantic search against existing notes;
3. asks the active model whether the conversation contains durable, novel knowledge;
4. explains its recommendation and blocks exit until you choose to save, skip, or stay;
5. if saved, writes a Markdown note and immediately runs `qmd update` and `qmd embed`.

It also reviews before `/new` and `/resume`, and provides manual capture through `/memory-review` or `/remember`.

## Why an exit gate?

A manual “remember this” command depends on remembering to use it. The exit gate puts the decision at the point where knowledge would otherwise be lost, while comparison with qmd avoids filling the knowledge base with duplicates and routine session logs.

## Requirements

- Pi with extension support
- [qmd](https://github.com/tobi/qmd) available as `qmd`
- a configured qmd collection for the destination directory
- an API key for the active Pi model (the review uses one low-reasoning completion)

## Install

```bash
pi install git:github.com/arthurcloche/pi-qmd
```

Try without installing:

```bash
pi -e git:github.com/arthurcloche/pi-qmd
```

## qmd setup

```bash
mkdir -p ~/knowledge-base
qmd collection add ~/knowledge-base --name knowledge-base
qmd context add qmd://knowledge-base \
  "Personal knowledge base — durable learnings captured from Pi sessions"
qmd update
qmd embed
```

qmd's own MCP server and skill now provide the read path for agents. This package intentionally adds only what qmd does not provide: a write tool and a conversation-close review gate.

## Usage

### Review on close

Press Ctrl+D while the editor is empty. After analysis, choose one of:

- **Save “…”** — write and index the proposed note, then exit
- **Exit without saving** — leave the knowledge base unchanged
- **Stay in this chat** — cancel closing

Short conversations are classified as not worth capturing without spending a model call.

### Manual review

```text
/memory-review
```

`/remember` is an alias.

### Agent write tool

The package registers `kb_remember`. Agents can use it to save a self-contained Markdown note. Unlike the original pi-hub implementation, indexing is automatic; there is no follow-up `qmd update && qmd embed` chore to forget.

## Configuration

Create `~/.config/pi-qmd/config.json`:

```json
{
  "knowledgeBaseDir": "~/knowledge-base",
  "collection": "knowledge-base",
  "reviewOnExit": true,
  "minConversationChars": 700,
  "maxConversationChars": 40000,
  "searchLimit": 5,
  "refreshBeforeReview": true,
  "autoIndex": true
}
```

| Setting | Purpose |
| --- | --- |
| `knowledgeBaseDir` | Directory where generated notes are written |
| `collection` | qmd collection searched for overlap; use `""` to search all collections |
| `reviewOnExit` | Enable Ctrl+D and session-switch gates |
| `minConversationChars` | Skip model analysis for obviously trivial chats |
| `maxConversationChars` | Bound review prompt size while preserving both ends |
| `searchLimit` | Number of qmd candidates supplied to the reviewer |
| `refreshBeforeReview` | Run `qmd update` and incremental `qmd embed` before comparison |
| `autoIndex` | Index immediately after writing a note |

Run `/reload` after changing configuration.

## Important limitations

Pi's `session_shutdown` event is notification-only; it cannot cancel a shutdown that has already begun. The package therefore intercepts Pi's normal **Ctrl+D** exit action and cancellable session-switch events. OS signals, terminal closure, process kills, and other custom exit mechanisms cannot be blocked.

Only one custom editor can be active in Pi. If another extension already owns the editor, pi-qmd leaves it untouched and asks you to use `/memory-review` manually. `/new` and `/resume` remain gated.

## Development

```bash
pnpm install
pnpm test
pi -e .
```

The repository history begins with the original pi-hub `pi-qmd` implementation before the package was simplified around qmd's native MCP tooling.

## License

MIT
