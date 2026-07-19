export interface ReviewResult {
	worthCapturing: boolean;
	confidence: number;
	title: string;
	rationale: string;
	overlap: string;
	tags: string[];
	summary: string;
}

interface MessageEntry {
	type: string;
	message?: {
		role?: string;
		content?: unknown;
	};
}

interface ContentBlock {
	type?: string;
	text?: string;
	name?: string;
	arguments?: Record<string, unknown>;
}

const STOP_WORDS = new Set([
	"about", "after", "again", "also", "been", "before", "being", "between", "both", "but", "can",
	"could", "did", "does", "doing", "for", "from", "had", "has", "have", "here", "how", "into", "just",
	"more", "most", "not", "now", "of", "off", "on", "only", "or", "other", "our", "out", "over", "same",
	"should", "some", "such", "than", "that", "the", "their", "them", "then", "there", "these", "they",
	"this", "those", "through", "to", "too", "under", "use", "using", "very", "want", "was", "we", "were",
	"what", "when", "where", "which", "while", "who", "why", "will", "with", "would", "you", "your",
]);

function textParts(content: unknown): string[] {
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];
	return content.flatMap((part) => {
		if (!part || typeof part !== "object") return [];
		const block = part as ContentBlock;
		return block.type === "text" && typeof block.text === "string" ? [block.text] : [];
	});
}

function toolCallParts(content: unknown): string[] {
	if (!Array.isArray(content)) return [];
	return content.flatMap((part) => {
		if (!part || typeof part !== "object") return [];
		const block = part as ContentBlock;
		if (block.type !== "toolCall" || typeof block.name !== "string") return [];
		const interestingKeys = ["path", "file", "command", "query", "url"];
		const details = interestingKeys.flatMap((key) => {
			const value = block.arguments?.[key];
			return typeof value === "string" ? [`${key}=${JSON.stringify(value.slice(0, 240))}`] : [];
		});
		return [`[Tool: ${block.name}${details.length > 0 ? ` ${details.join(" ")}` : ""}]`];
	});
}

export function extractConversation(entries: MessageEntry[], maxChars: number): string {
	const sections: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "message" || !entry.message) continue;
		const { role, content } = entry.message;
		if (role !== "user" && role !== "assistant") continue;
		const parts = textParts(content);
		if (role === "assistant") parts.push(...toolCallParts(content));
		const text = parts.join("\n").trim();
		if (text) sections.push(`${role === "user" ? "User" : "Assistant"}: ${text}`);
	}

	const conversation = sections.join("\n\n");
	if (conversation.length <= maxChars) return conversation;
	const headSize = Math.floor(maxChars * 0.35);
	const tailSize = maxChars - headSize;
	return `${conversation.slice(0, headSize)}\n\n[... middle truncated ...]\n\n${conversation.slice(-tailSize)}`;
}

export function buildSearchDocument(conversation: string, sessionName?: string): string {
	const words = conversation.toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? [];
	const frequencies = new Map<string, number>();
	for (const word of words) {
		if (STOP_WORDS.has(word) || word.length > 40) continue;
		frequencies.set(word, (frequencies.get(word) ?? 0) + 1);
	}
	const lex = [...frequencies.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, 14)
		.map(([word]) => word)
		.join(" ");
	const vecSource = [sessionName, conversation]
		.filter(Boolean)
		.join(". ")
		.replace(/\s+/g, " ")
		.slice(0, 1600);
	return `lex: ${lex || "conversation learnings"}\nvec: ${vecSource}`;
}

export function parseReviewResult(text: string): ReviewResult {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
	const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
	const value = JSON.parse(candidate) as Partial<ReviewResult>;
	if (typeof value.worthCapturing !== "boolean") throw new Error("Review omitted worthCapturing");
	if (typeof value.title !== "string" || typeof value.summary !== "string") {
		throw new Error("Review omitted title or summary");
	}
	return {
		worthCapturing: value.worthCapturing,
		confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0)),
		title: value.title.trim() || "Pi session learning",
		rationale: String(value.rationale ?? "").trim(),
		overlap: String(value.overlap ?? "").trim(),
		tags: Array.isArray(value.tags) ? value.tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 8) : [],
		summary: value.summary.trim(),
	};
}

export function slugify(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80) || "pi-session-learning";
}

function yamlString(value: string): string {
	return JSON.stringify(value.replace(/\r?\n/g, " "));
}

export function buildNote(title: string, tags: string[], content: string, date = new Date()): string {
	const safeTags = tags.map((tag) => yamlString(tag));
	return [
		"---",
		`title: ${yamlString(title)}`,
		`date: ${date.toISOString()}`,
		`tags: [${safeTags.join(", ")}]`,
		"source: pi-session",
		"---",
		"",
		`# ${title}`,
		"",
		content.trim(),
		"",
	].join("\n");
}
