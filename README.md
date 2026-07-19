# pi-qmd

A pi extension that gives your agents a shared knowledge base powered by [qmd](https://github.com/tobi/qmd).

**The problem:** You do lots of explorations, learnings rot in unfinished agent conversations, and knowledge doesn't flow between sessions.

**The solution:** Every pi agent session gets tools to search your knowledge base and capture new learnings into it. You (or the agent) say `/remember` and the conversation's insights get distilled into a searchable markdown note.

## What You Get

### Search tools (read path)
| Tool | Speed | Use when |
|------|-------|----------|
| `kb_search` | ~30ms | Keyword/exact matches |
| `kb_lookup` | ~2s | Concepts, synonyms, paraphrases |
| `kb_query` | ~10s | Best quality, hybrid + reranking |
| `kb_get` | instant | Retrieve full doc by path or #docid |
| `kb_status` | instant | Check what's indexed |

### Knowledge capture (write path)
| | |
|-|-|
| `kb_remember` tool | Agent writes a structured markdown note to `~/knowledge-base/` |
| `/remember` command | Ask the agent to distill learnings from the current conversation |
| `/remember <topic>` | Capture a specific topic from the conversation |
| `/kb <query>` | Quick search shortcut |

### Automatic context
The agent's system prompt is augmented with your qmd index status, so it knows what's searchable and will proactively check the KB before doing redundant work.

## Setup

### 1. Install qmd

```bash
bun install -g https://github.com/tobi/qmd
```

### 2. Create your knowledge base collection

```bash
mkdir -p ~/knowledge-base
qmd collection add ~/knowledge-base --name knowledge-base
qmd context add qmd://knowledge-base "Personal knowledge base — learnings, notes, and reference material captured from agent conversations and exploration"
```

### 3. Add any existing collections you want searchable

```bash
# Your Obsidian vault
qmd collection add ~/Documents/Obsidian --name obsidian
qmd context add qmd://obsidian "Obsidian vault — personal notes and documents"

# Project docs
qmd collection add ~/work/docs --name work-docs
qmd context add qmd://work-docs "Work documentation"
```

### 4. Build the index

```bash
qmd update
qmd embed    # generates vector embeddings (~2min first time, downloads ~2GB of models)
```

### 5. Install the extension

Add to your pi settings (`~/.pi/settings.json`):

```json
{
  "extensions": [
    "~/Desktop/pi-qmd"
  ]
}
```

Or symlink into the global extensions directory:

```bash
ln -s ~/Desktop/pi-qmd ~/.pi/agent/extensions/pi-qmd
```

Or test it directly:

```bash
pi -e ~/Desktop/pi-qmd
```

## Usage

### Search from any conversation

Just ask naturally — the agent knows about the KB:

> "Have I written anything about WebSocket connection pooling?"
> "Check my notes for that debugging trick with Chrome DevTools"

Or use the shortcut:

```
/kb websocket pooling
```

### Capture learnings

After a productive session:

```
/remember
```

Or capture something specific:

```
/remember the approach we figured out for handling race conditions in the queue
```

The agent will:
1. Review the conversation
2. Extract the key insights
3. Write a well-structured markdown note to `~/knowledge-base/`
4. Remind you to run `qmd update && qmd embed`

### Keep the index fresh

After capturing notes, update the index:

```bash
qmd update && qmd embed
```

You could also alias this:

```bash
alias kbsync="qmd update && qmd embed"
```

## File Structure

Notes are saved as:

```
~/knowledge-base/
├── 2026-02-14-websocket-connection-pooling.md
├── 2026-02-14-chrome-devtools-debugging.md
├── til/
│   └── 2026-02-14-bash-process-substitution.md
└── projects/
    └── foo/
        └── 2026-02-14-architecture-decisions.md
```

Each note includes frontmatter:

```yaml
---
title: "WebSocket Connection Pooling"
date: 2026-02-14T18:48:00.000Z
tags: ["websocket", "networking", "performance"]
---
```

## Tips

- **Add your Obsidian vault** as a qmd collection — then agents can search your existing notes too
- **Use subfolders** in `/remember` — the agent can organize into `til/`, `recipes/`, `projects/x/`, etc.
- **The agent checks the KB automatically** when its system prompt mentions your indexed collections
- **Works across sessions** — knowledge captured in one conversation is searchable in the next (after `qmd update && qmd embed`)
