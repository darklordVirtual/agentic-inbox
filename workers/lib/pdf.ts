// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

/**
 * Minimal PDF text extraction for Cloudflare Workers.
 *
 * Extracts readable text from text-based PDFs (not scanned/image PDFs)
 * by parsing the raw PDF byte stream directly — no dependencies required.
 *
 * This covers virtually all Norwegian debt documents (invoices, collection
 * notices, court letters) which are always digitally-generated, text-based PDFs.
 * The extracted text is capped at MAX_CHARS to keep it suitable for AI analysis.
 */

const MAX_CHARS = 8000;

/** Unescape PDF literal-string escape sequences. */
function unescapePdfString(s: string): string {
	return s
		.replace(/\\n/g, "\n")
		.replace(/\\r/g, "\r")
		.replace(/\\t/g, "\t")
		.replace(/\\\\/g, "\\")
		.replace(/\\\(/g, "(")
		.replace(/\\\)/g, ")");
}

/**
 * Parse readable text segments from a raw PDF byte string decoded as Latin-1.
 *
 * Handles:
 *  - BT...ET text blocks with Tj and TJ operators
 *  - Both literal strings (parentheses) and hex strings (<...>) in TJ arrays
 */
function extractFromRaw(raw: string): string {
	const strings: string[] = [];

	// Scan BT...ET blocks (begin-text / end-text PDF operators).
	// Limit each block to 5000 chars to avoid catastrophic backtracking on
	// malformed PDFs that are missing the closing ET.
	const blockRe = /\bBT\b([\s\S]{1,5000}?)\bET\b/g;
	let bm: RegExpExecArray | null;

	while ((bm = blockRe.exec(raw)) !== null) {
		const block = bm[1];

		// Tj / ' / " operators:  (string) Tj
		const tjRe = /\(([^)]{0,400})\)\s*(?:Tj|'|")/g;
		let tj: RegExpExecArray | null;
		while ((tj = tjRe.exec(block)) !== null) {
			const s = unescapePdfString(tj[1]);
			if (/[a-zA-Z0-9æøåÆØÅ]/.test(s)) strings.push(s);
		}

		// TJ operator: [ (str) -kern (str) ... ] TJ
		const tjArrRe = /\[([\s\S]{0,600}?)\]\s*TJ/g;
		let ta: RegExpExecArray | null;
		while ((ta = tjArrRe.exec(block)) !== null) {
			// Extract literal strings from the array, strip numbers (kerning values)
			const inner = ta[1]
				.replace(/\(([^)]*)\)/g, (_, s: string) => unescapePdfString(s) + " ")
				.replace(/-?\d+(?:\.\d+)?\s*/g, "");
			if (/[a-zA-Z0-9æøåÆØÅ]/.test(inner)) strings.push(inner);
		}

		// Hex strings in TJ: <hexhex> TJ (common in embedded fonts)
		const hexStrRe = /<([0-9a-fA-F]{2,})>/g;
		let hx: RegExpExecArray | null;
		while ((hx = hexStrRe.exec(block)) !== null) {
			const hex = hx[1];
			let decoded = "";
			for (let i = 0; i < hex.length - 1; i += 2) {
				const code = parseInt(hex.slice(i, i + 2), 16);
				// Only keep printable ASCII + common Norwegian chars
				if (code >= 32 && code < 128) decoded += String.fromCharCode(code);
				else if (code === 0xe6 || code === 0xf8 || code === 0xe5) decoded += String.fromCharCode(code); // æøå
				else if (code === 0xc6 || code === 0xd8 || code === 0xc5) decoded += String.fromCharCode(code); // ÆØÅ
			}
			if (decoded.length > 1 && /[a-zA-Z0-9æøåÆØÅ]/.test(decoded)) {
				strings.push(decoded);
			}
		}
	}

	return strings.join(" ").replace(/\s+/g, " ").trim().slice(0, MAX_CHARS);
}

/**
 * Fetch a PDF from R2 and extract its text content.
 * Returns null if the object does not exist, is not a valid PDF, or extraction
 * yields fewer than 20 characters (likely an image-only/scanned PDF).
 */
export async function extractPdfText(
	bucket: R2Bucket,
	key: string,
): Promise<string | null> {
	try {
		const obj = await bucket.get(key);
		if (!obj) return null;

		const bytes = new Uint8Array(await obj.arrayBuffer());

		// Quick sanity-check: PDFs start with %PDF-
		const header = new TextDecoder("ascii").decode(bytes.slice(0, 5));
		if (header !== "%PDF-") return null;

		// Decode as Latin-1 — safe for binary PDF content
		const raw = new TextDecoder("latin1").decode(bytes);
		const text = extractFromRaw(raw);

		return text.length >= 20 ? text : null;
	} catch {
		return null;
	}
}

/**
 * Build the R2 storage key for a given attachment.
 * Mirrors the key format used in `storeAttachments()`.
 */
export function buildAttachmentKey(
	emailId: string,
	attachmentId: string,
	filename: string,
): string {
	const safe = filename.replace(/[/\\:*?"<>|\x00-\x1f]/g, "_");
	return `attachments/${emailId}/${attachmentId}/${safe}`;
}
