/**
 * pi-qmd — A knowledge base bridge between pi agents and qmd.
 *
 * Gives every pi session two things:
 *   1. Tools to search & retrieve from your qmd index  (read path)
 *   2. A tool + command to capture learnings back into it (write path)
 *
 * The "remember" flow:
 *   - The agent (or you via /remember) writes a markdown file into a
 *     designated knowledge-base collection folder, then tells you to
 *     run `qmd update && qmd embed` so the index stays fresh.
 *
 * Search tools mirror qmd's three tiers:
 *   - kb_search   → fast BM25 keyword search
 *   - kb_lookup   → semantic vector search
 *   - kb_query    → hybrid deep search (expansion + reranking)
 *   - kb_get      → retrieve a specific document by path or docid
 *   - kb_status   → show what's indexed
 *
 * The extension also injects a system-prompt snippet so the agent
 * knows the knowledge base exists and how to use it.
 */

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	truncateHead,
	DEFAULT_MAX_BYTES,
	DEFAULT_MAX_LINES,
	formatSize,
} from "@mariozechner/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Where new knowledge files get written. */
const KB_DIR = path.join(os.homedir(), "knowledge-base");

/** Check if qmd is available (sync, runs once at load). */
function isQmdAvailable(): boolean {
	try {
		const { execSync } = require("node:child_process");
		execSync("which qmd", { encoding: "utf-8", stdio: "pipe", timeout: 2000 });
		return true;
	} catch {
		return false;
	}
}
const QMD_AVAILABLE = isQmdAvailable();

/** Ensure the knowledge-base directory exists. */
function ensureKbDir(): string {
	if (!fs.existsSync(KB_DIR)) {
		fs.mkdirSync(KB_DIR, { recursive: true });
	}
	return KB_DIR;
}

/** Slugify a title into a filename-safe string. */
function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

/** Build a dated filename:  2026-02-14-some-title.md */
function buildFilename(title: string): string {
	const date = new Date().toISOString().slice(0, 10);
	const slug = slugify(title);
	return `${date}-${slug}.md`;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	// -----------------------------------------------------------------------
	// Inject KB awareness into the system prompt
	// -----------------------------------------------------------------------

	pi.on("before_agent_start", async (event, _ctx) => {
		const statusResult = await pi.exec("qmd", ["status"], { timeout: 5000 });
		const qmdAvailable = statusResult.code === 0;

		if (!qmdAvailable) return;

		const status = statusResult.stdout.trim();
		const kbExists = fs.existsSync(KB_DIR);

		const injection = [
			"",
			"## Knowledge Base (qmd)",
			"",
			"You have access to a personal knowledge base powered by qmd.",
			"Use the kb_* tools to search and retrieve information before doing redundant work.",
			"",
			"Current index status:",
			"```",
			status,
			"```",
			"",
			"### Searching",
			"- `kb_search` — fast keyword search (~30ms). Start here.",
			"- `kb_lookup` — semantic search (~2s). Use when keywords miss.",
			"- `kb_query`  — deep hybrid search (~10s). Best quality.",
			"- `kb_get`    — retrieve a full document by path or #docid.",
			"",
			"### Remembering",
			"When the user asks you to remember, save, or capture something:",
			"- Use `kb_remember` to write a markdown file to ~/knowledge-base/",
			"- The file will be a well-structured markdown note with frontmatter.",
			"- After writing, remind the user to run `qmd update && qmd embed`.",
			kbExists
				? `- Knowledge base directory: ${KB_DIR}`
				: `- Knowledge base directory will be created at: ${KB_DIR}`,
			"",
		].join("\n");

		return {
			systemPrompt: event.systemPrompt + injection,
		};
	});

	// -----------------------------------------------------------------------
	// Search tools — only register if qmd is installed
	// Without qmd, only kb_remember (file writing) and commands are available
	// -----------------------------------------------------------------------

	if (!QMD_AVAILABLE) {
		// Skip search tool registration — no point adding 5 tools to context
		// that will all fail. kb_remember still works (just writes markdown files).
		// Commands /remember and /kb are still registered below.
	}

	if (QMD_AVAILABLE) {

	// -----------------------------------------------------------------------
	// Tool: kb_search  (BM25 keyword search)
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "kb_search",
		label: "KB Search",
		description:
			"Fast keyword search across the knowledge base. Finds documents containing the exact words in your query. Start here before trying semantic search.",
		parameters: Type.Object({
			query: Type.String({ description: "Keywords or phrase to search for" }),
			limit: Type.Optional(
				Type.Number({ description: "Max results (default 10)", default: 10 })
			),
			collection: Type.Optional(
				Type.String({ description: "Restrict to a specific collection" })
			),
		}),

		async execute(_id, params, signal) {
			const args = ["search", params.query, "-n", String(params.limit ?? 10), "--md"];
			if (params.collection) args.push("-c", params.collection);

			const result = await pi.exec("qmd", args, { signal, timeout: 15000 });
			if (result.code !== 0) {
				return {
					content: [{ type: "text", text: `qmd search failed:\n${result.stderr}` }],
					isError: true,
				};
			}

			const truncation = truncateHead(result.stdout, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			let output = truncation.content || "No results found.";
			if (truncation.truncated) {
				output += `\n\n[Truncated: showing ${truncation.outputLines}/${truncation.totalLines} lines (${formatSize(truncation.outputBytes)}/${formatSize(truncation.totalBytes)})]`;
			}

			return { content: [{ type: "text", text: output }] };
		},
	});

	// -----------------------------------------------------------------------
	// Tool: kb_lookup  (vector / semantic search)
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "kb_lookup",
		label: "KB Lookup",
		description:
			"Semantic search across the knowledge base. Finds conceptually related documents even when vocabulary differs. Use when keyword search misses.",
		parameters: Type.Object({
			query: Type.String({
				description: "Natural-language description of what you're looking for",
			}),
			limit: Type.Optional(
				Type.Number({ description: "Max results (default 10)", default: 10 })
			),
			collection: Type.Optional(
				Type.String({ description: "Restrict to a specific collection" })
			),
		}),

		async execute(_id, params, signal) {
			const args = [
				"vsearch",
				params.query,
				"-n",
				String(params.limit ?? 10),
				"--md",
				"--min-score",
				"0.3",
			];
			if (params.collection) args.push("-c", params.collection);

			const result = await pi.exec("qmd", args, { signal, timeout: 30000 });
			if (result.code !== 0) {
				return {
					content: [{ type: "text", text: `qmd vsearch failed:\n${result.stderr}` }],
					isError: true,
				};
			}

			const truncation = truncateHead(result.stdout, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			let output = truncation.content || "No results found.";
			if (truncation.truncated) {
				output += `\n\n[Truncated: showing ${truncation.outputLines}/${truncation.totalLines} lines]`;
			}

			return { content: [{ type: "text", text: output }] };
		},
	});

	// -----------------------------------------------------------------------
	// Tool: kb_query  (hybrid deep search)
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "kb_query",
		label: "KB Query",
		description:
			"Deep hybrid search: expands the query, searches by keyword AND meaning, then re-ranks. Best quality but slower (~10s). Use when you need the best possible results.",
		parameters: Type.Object({
			query: Type.String({
				description: "Natural-language question or topic",
			}),
			limit: Type.Optional(
				Type.Number({ description: "Max results (default 10)", default: 10 })
			),
			collection: Type.Optional(
				Type.String({ description: "Restrict to a specific collection" })
			),
		}),

		async execute(_id, params, signal) {
			const args = ["query", params.query, "-n", String(params.limit ?? 10), "--md"];
			if (params.collection) args.push("-c", params.collection);

			const result = await pi.exec("qmd", args, { signal, timeout: 60000 });
			if (result.code !== 0) {
				return {
					content: [{ type: "text", text: `qmd query failed:\n${result.stderr}` }],
					isError: true,
				};
			}

			const truncation = truncateHead(result.stdout, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			let output = truncation.content || "No results found.";
			if (truncation.truncated) {
				output += `\n\n[Truncated: showing ${truncation.outputLines}/${truncation.totalLines} lines]`;
			}

			return { content: [{ type: "text", text: output }] };
		},
	});

	// -----------------------------------------------------------------------
	// Tool: kb_get  (retrieve full document)
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "kb_get",
		label: "KB Get",
		description:
			"Retrieve the full content of a document by file path or docid (#abc123) from search results.",
		parameters: Type.Object({
			file: Type.String({
				description:
					"File path or docid from search results (e.g. 'notes/meeting.md' or '#abc123')",
			}),
			from_line: Type.Optional(
				Type.Number({ description: "Start from this line number" })
			),
			max_lines: Type.Optional(
				Type.Number({ description: "Maximum lines to return" })
			),
		}),

		async execute(_id, params, signal) {
			const args = ["get", params.file, "--full", "--line-numbers"];
			if (params.from_line) args.push("--from", String(params.from_line));
			if (params.max_lines) args.push("-l", String(params.max_lines));

			const result = await pi.exec("qmd", args, { signal, timeout: 10000 });
			if (result.code !== 0) {
				return {
					content: [{ type: "text", text: `qmd get failed:\n${result.stderr}` }],
					isError: true,
				};
			}

			const truncation = truncateHead(result.stdout, {
				maxLines: DEFAULT_MAX_LINES,
				maxBytes: DEFAULT_MAX_BYTES,
			});

			let output = truncation.content;
			if (truncation.truncated) {
				output += `\n\n[Truncated: showing ${truncation.outputLines}/${truncation.totalLines} lines. Use from_line/max_lines to paginate.]`;
			}

			return { content: [{ type: "text", text: output }] };
		},
	});

	// -----------------------------------------------------------------------
	// Tool: kb_status  (index health)
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "kb_status",
		label: "KB Status",
		description: "Show the status of the knowledge base index: collections, document counts, and health.",
		parameters: Type.Object({}),

		async execute(_id, _params, signal) {
			const result = await pi.exec("qmd", ["status"], { signal, timeout: 5000 });
			if (result.code !== 0) {
				return {
					content: [
						{
							type: "text",
							text: `qmd is not installed or not configured.\nInstall: bun install -g https://github.com/tobi/qmd\n\n${result.stderr}`,
						},
					],
					isError: true,
				};
			}

			return { content: [{ type: "text", text: result.stdout }] };
		},
	});

	} // end if (QMD_AVAILABLE)

	// -----------------------------------------------------------------------
	// Tool: kb_remember  (write a knowledge note) — always available (just writes files)
	// -----------------------------------------------------------------------

	pi.registerTool({
		name: "kb_remember",
		label: "KB Remember",
		description: [
			"Save a piece of knowledge to the knowledge base as a markdown file.",
			"Use this when the user asks you to remember, save, or capture something.",
			"Write well-structured markdown with a clear title and tags.",
			"After writing, remind the user to run: qmd update && qmd embed",
		].join(" "),
		parameters: Type.Object({
			title: Type.String({
				description: "Short descriptive title for the note (used in filename)",
			}),
			tags: Type.Array(Type.String(), {
				description: "Tags for categorization (e.g. ['python', 'debugging', 'til'])",
			}),
			content: Type.String({
				description:
					"The markdown content of the note. Should be well-structured with headings, code blocks, etc. Do NOT include frontmatter — it will be added automatically.",
			}),
			subfolder: Type.Optional(
				Type.String({
					description:
						"Optional subfolder within ~/knowledge-base/ (e.g. 'til', 'recipes', 'projects/foo')",
				})
			),
		}),

		async execute(_id, params, _signal, _onUpdate, _ctx) {
			const dir = params.subfolder
				? path.join(ensureKbDir(), params.subfolder)
				: ensureKbDir();

			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			const filename = buildFilename(params.title);
			const filepath = path.join(dir, filename);

			// Build frontmatter
			const frontmatter = [
				"---",
				`title: "${params.title.replace(/"/g, '\\"')}"`,
				`date: ${new Date().toISOString()}`,
				`tags: [${params.tags.map((t) => `"${t}"`).join(", ")}]`,
				"---",
			].join("\n");

			const fullContent = `${frontmatter}\n\n# ${params.title}\n\n${params.content}\n`;

			fs.writeFileSync(filepath, fullContent, "utf-8");

			const relativePath = path.relative(os.homedir(), filepath);

			return {
				content: [
					{
						type: "text",
						text: [
							`✓ Saved to ~/${relativePath}`,
							"",
							"To make this searchable, the user should run:",
							"```",
							"qmd update && qmd embed",
							"```",
							"",
							`If ~/knowledge-base is not yet a qmd collection, they should first run:`,
							"```",
							`qmd collection add ~/knowledge-base --name knowledge-base`,
							`qmd context add qmd://knowledge-base "Personal knowledge base — learnings, notes, and reference material captured from agent conversations and exploration"`,
							"```",
						].join("\n"),
					},
				],
				details: { filepath, title: params.title, tags: params.tags },
			};
		},
	});

	// -----------------------------------------------------------------------
	// Command: /remember — quick capture from conversation
	// -----------------------------------------------------------------------

	pi.registerCommand("remember", {
		description:
			"Ask the agent to distill and save a learning from this conversation into the knowledge base",
		handler: async (args, ctx) => {
			const topic = args?.trim();

			const prompt = topic
				? `Please review our conversation and save a knowledge note about: "${topic}". Use the kb_remember tool. Extract the key insights, decisions, code patterns, or learnings. Make it useful for future reference.`
				: `Please review our conversation and identify the most important learnings, decisions, or insights worth remembering. Use the kb_remember tool to save them. If there are multiple distinct topics, save them as separate notes.`;

			pi.sendUserMessage(prompt, { deliverAs: "followUp" });

			if (ctx.hasUI) {
				ctx.ui.notify(
					topic ? `Capturing knowledge about: ${topic}` : "Capturing learnings from conversation...",
					"info"
				);
			}
		},
	});

	// -----------------------------------------------------------------------
	// Command: /kb — quick search shortcut
	// -----------------------------------------------------------------------

	pi.registerCommand("kb", {
		description: "Search the knowledge base (shortcut for kb_search)",
		handler: async (args, ctx) => {
			const query = args?.trim();
			if (!query) {
				if (ctx.hasUI) ctx.ui.notify("Usage: /kb <search query>", "warning");
				return;
			}

			const prompt = `Search the knowledge base for "${query}" using kb_search. If the results aren't satisfactory, try kb_lookup for semantic search. Show me the relevant results.`;
			pi.sendUserMessage(prompt, { deliverAs: "followUp" });
		},
	});

	// -----------------------------------------------------------------------
	// Startup notification
	// -----------------------------------------------------------------------

	pi.on("session_start", async (_event, ctx) => {
		if (!QMD_AVAILABLE) {
			// qmd not installed — quiet dim indicator, no nagging
			if (ctx.hasUI) {
				const theme = ctx.ui.theme;
				ctx.ui.setStatus(
					"kb",
					`${theme.fg("dim", "📚")} ${theme.fg("muted", "kb offline")}`
				);
			}
			return;
		}

		const result = await pi.exec("qmd", ["status"], { timeout: 5000 });
		if (result.code === 0) {
			const match = result.stdout.match(/(\d+)\s+documents/);
			const docCount = match ? match[1] : "?";
			if (ctx.hasUI) {
				ctx.ui.setStatus("kb", `📚 KB: ${docCount} docs`);
			}
		}
	});
}
