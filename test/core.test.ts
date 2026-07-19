import assert from "node:assert/strict";
import test from "node:test";

import {
	buildNote,
	buildSearchDocument,
	extractConversation,
	parseReviewResult,
	slugify,
} from "../extensions/pi-qmd/core.ts";

test("extractConversation keeps user and assistant text but not tool results", () => {
	const result = extractConversation([
		{ type: "message", message: { role: "user", content: "Fix the queue race" } },
		{ type: "message", message: { role: "assistant", content: [
			{ type: "text", text: "Use a mutex." },
			{ type: "toolCall", name: "edit", arguments: { path: "queue.ts" } },
		] } },
		{ type: "message", message: { role: "toolResult", content: "a huge diff" } },
	], 10_000);
	assert.match(result, /User: Fix the queue race/);
	assert.match(result, /Assistant: Use a mutex/);
	assert.match(result, /Tool: edit/);
	assert.doesNotMatch(result, /huge diff/);
});

test("extractConversation preserves both ends when truncating", () => {
	const result = extractConversation([
		{ type: "message", message: { role: "user", content: `start-${"a".repeat(1000)}` } },
		{ type: "message", message: { role: "assistant", content: `${"b".repeat(1000)}-end` } },
	], 400);
	assert.match(result, /start-/);
	assert.match(result, /-end/);
	assert.match(result, /middle truncated/);
});

test("buildSearchDocument emits structured lex and vec queries", () => {
	const result = buildSearchDocument("WebSocket queue race race mutex ordering", "Queue investigation");
	assert.match(result, /^lex: /);
	assert.match(result, /race/);
	assert.match(result, /\nvec: Queue investigation/);
});

test("parseReviewResult accepts fenced JSON and clamps values", () => {
	const result = parseReviewResult('```json\n{"worthCapturing":true,"confidence":2,"title":"Mutex ordering","rationale":"Novel","overlap":"None","tags":["queue"],"summary":"## Finding\\nUse ordering."}\n```');
	assert.equal(result.worthCapturing, true);
	assert.equal(result.confidence, 1);
	assert.equal(result.title, "Mutex ordering");
});

test("slugify and buildNote produce safe markdown", () => {
	assert.equal(slugify("Crème brûlée & Queues"), "creme-brulee-queues");
	const note = buildNote('A "quoted" title', ["qmd", "pi"], "Useful details", new Date("2026-07-19T12:00:00Z"));
	assert.match(note, /title: "A \\"quoted\\" title"/);
	assert.match(note, /date: 2026-07-19T12:00:00.000Z/);
	assert.match(note, /source: pi-session/);
});
