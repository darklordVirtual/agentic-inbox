/**
 * Norwegian amount parser.
 *
 * Handles all common Norwegian and international number formats:
 *   "1 234,56"   → 1234.56
 *   "1.234,56"   → 1234.56
 *   "1234,56"    → 1234.56
 *   "1234.56"    → 1234.56
 *   "437.50"     → 437.50
 *   "437,50"     → 437.50
 *   "kr 437,50"  → 437.50
 *   "437.50 NOK" → 437.50
 */

/**
 * Parse a raw amount string (with or without currency prefix/suffix).
 * Returns null if the string cannot be parsed as a finite number.
 */
export function parseNorwegianAmount(raw: string): number | null {
	if (!raw) return null;

	// Strip currency symbols, whitespace wrapper, non-numeric prefix/suffix
	// but preserve the numeric content with separators
	let s = raw
		.replace(/^\s*(?:kr\.?|nok)\s*/i, "")   // leading "kr" / "NOK"
		.replace(/\s*(?:kr\.?|nok)\s*$/i, "")   // trailing "kr" / "NOK"
		.replace(/\s/g, "");                     // strip all whitespace

	if (s.length === 0) return null;

	const hasDot   = s.includes(".");
	const hasComma = s.includes(",");

	if (hasDot && hasComma) {
		// Both separators present.
		// The one that appears LAST is the decimal separator.
		const lastDot   = s.lastIndexOf(".");
		const lastComma = s.lastIndexOf(",");
		if (lastComma > lastDot) {
			// "1.234,56" — dot is thousands, comma is decimal
			s = s.replace(/\./g, "").replace(",", ".");
		} else {
			// "1,234.56" — comma is thousands, dot is decimal
			s = s.replace(/,/g, "");
		}
	} else if (hasComma && !hasDot) {
		// Only comma.
		// If exactly 2 or 3 digits follow the last comma it could be:
		//   "1234,56"  → decimal (2 digits after comma)
		//   "1,234"    → thousands (3 digits after comma) — ambiguous, treat as decimal
		//   "437,50"   → decimal
		s = s.replace(",", ".");
	}
	// Only dot, or no separators → already in numeric form.

	const val = Number(s);
	return Number.isFinite(val) && val >= 0 ? val : null;
}

// ── Regex patterns for extracting amounts from text ────────────────

/** Matches "kr 1 234,56", "kr 437,50", "1234.56 NOK" etc. */
export const AMOUNT_PREFIXED =
	/(?:kr\.?|nok)\s*([\d\s,.]+)/gi;

/** Matches plain amounts followed by "kr" / "NOK" */
export const AMOUNT_SUFFIXED =
	/\b([\d]{1,3}(?:[. ]\d{3})*(?:[,.]\d{1,2})?)(?:\s*(?:kr\.?|nok))\b/gi;

/**
 * Find the first parseable amount in a block of text.
 * Returns null if no amount found.
 */
export function extractFirstAmount(text: string): number | null {
	// Try prefixed patterns first (more reliable)
	const prefixPattern = /(?:kr\.?|nok)\s*([\d\s,.]+)/i;
	const suffixPattern = /\b([\d]{1,3}(?:[. ]\d{3})*(?:[,.]\d{1,2})?)(?:\s*(?:kr\.?|nok))\b/i;

	let m = prefixPattern.exec(text);
	if (!m) m = suffixPattern.exec(text);
	if (!m) return null;
	return parseNorwegianAmount(m[1]);
}

/**
 * Extract all distinct amounts from text.
 * Returns sorted ascending array of unique parseable amounts.
 */
export function extractAllAmounts(text: string): number[] {
	const found = new Set<number>();

	for (const re of [AMOUNT_PREFIXED, AMOUNT_SUFFIXED]) {
		re.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = re.exec(text)) !== null) {
			const v = parseNorwegianAmount(m[1]);
			if (v !== null && v > 0) found.add(v);
		}
	}
	return [...found].sort((a, b) => a - b);
}
