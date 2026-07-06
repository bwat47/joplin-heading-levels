/**
 * Pure functions for detecting and rewriting Markdown headings.
 *
 * Supports ATX headings (`# H1` through `###### H6`) and setext headings
 * (`===` for H1, `---` for H2).  All functions are side-effect free so they
 * can be unit-tested without a CM6 editor context.
 */

type HeadingType = 'atx' | 'setext';

export interface HeadingInfo {
    level: number;
    type: HeadingType;
}

/**
 * Parse a single line as an ATX heading.
 *
 * @example `parseAtxHeading('# Hello')` → `{ level: 1, type: 'atx' }`
 * @example `parseAtxHeading('## World')` → `{ level: 2, type: 'atx' }`
 * @example `parseAtxHeading('plain text')` → `null`
 * @example `parseAtxHeading('####### seven')` → `null` (7 hashes not valid)
 */
export function parseAtxHeading(line: string): HeadingInfo | null {
    // 1-6 # characters followed by a space/tab or end-of-line
    const match = /^(#{1,6})([ \t]|$)/.exec(line);
    if (!match) return null;
    return { level: match[1].length, type: 'atx' };
}

/**
 * Parse a setext heading given the text line and its following underline line.
 *
 * A setext underline is a line of only `=` characters (H1) or `-` characters (H2),
 * optionally followed by trailing spaces.
 *
 * @example `parseSetextHeading('Hello', '=====')` → `{ level: 1, type: 'setext' }`
 * @example `parseSetextHeading('Hello', '-----')` → `{ level: 2, type: 'setext' }`
 * @example `parseSetextHeading('', '=====')` → `null` (blank text line)
 */
export function parseSetextHeading(line: string, underlineLine: string | undefined): HeadingInfo | null {
    if (underlineLine === undefined) return null;
    // Blank text lines cannot form setext headings
    if (!line.trim()) return null;
    // Lines that are themselves ATX headings take precedence
    if (/^#{1,6}([ \t]|$)/.test(line)) return null;

    if (/^={1,}\s*$/.test(underlineLine)) return { level: 1, type: 'setext' };
    if (/^-{1,}\s*$/.test(underlineLine)) return { level: 2, type: 'setext' };
    return null;
}

/**
 * Detect the heading type and level at a given (0-based) line index.
 *
 * ATX headings are detected on `lines[lineIndex]` alone.
 * Setext headings require `lines[lineIndex + 1]` to be a valid underline.
 *
 * Returns `null` when `lineIndex` does not start a heading.
 */
export function detectHeadingAtLine(lines: string[], lineIndex: number): HeadingInfo | null {
    const line = lines[lineIndex];
    if (line === undefined) return null;

    const atx = parseAtxHeading(line);
    if (atx) return atx;

    return parseSetextHeading(line, lines[lineIndex + 1]);
}

/**
 * Rewrite the heading at `lineIndex` to `newLevel`, returning a new lines array.
 *
 * Rules:
 * - ATX headings keep ATX syntax; only the `#` prefix is updated.
 * - Setext H1 ↔ H2 stays setext; the underline character is updated to match.
 * - Setext heading changed to H3–H6 is rewritten as ATX; the underline line is removed.
 *
 * The input `lines` array is never mutated.  When `lineIndex` is not a heading or
 * `newLevel` equals the current level the original array reference is returned unchanged.
 */
export function rewriteHeading(lines: string[], lineIndex: number, newLevel: number): string[] {
    const heading = detectHeadingAtLine(lines, lineIndex);
    if (!heading) return lines;
    if (heading.level === newLevel) return lines;

    const result = lines.slice();
    const line = lines[lineIndex];

    if (heading.type === 'atx') {
        // Preserve everything after the leading # characters (including any space)
        const match = /^(#{1,6})/.exec(line)!;
        result[lineIndex] = '#'.repeat(newLevel) + line.slice(match[1].length);
    } else {
        // setext heading — underline is always on the next line
        const underlineIndex = lineIndex + 1;
        const underline = lines[underlineIndex];

        if (newLevel <= 2) {
            // Keep setext; swap underline character while preserving its length
            const underlineChar = newLevel === 1 ? '=' : '-';
            const underlineLen = Math.max(underline.replace(/\s+$/, '').length, 3);
            result[underlineIndex] = underlineChar.repeat(underlineLen);
        } else {
            // Convert to ATX; remove the underline line
            result[lineIndex] = '#'.repeat(newLevel) + ' ' + line.trim();
            result.splice(underlineIndex, 1);
        }
    }

    return result;
}

/**
 * Remove heading formatting at `lineIndex`, returning a new lines array.
 *
 * Rules:
 * - ATX headings drop the leading `#` markers and their required separator.
 * - Setext headings keep the text line and remove the underline line.
 *
 * The input `lines` array is never mutated. When `lineIndex` is not a heading
 * the original array reference is returned unchanged.
 */
export function removeHeading(lines: string[], lineIndex: number): string[] {
    const heading = detectHeadingAtLine(lines, lineIndex);
    if (!heading) return lines;

    const result = lines.slice();
    const line = lines[lineIndex];

    if (heading.type === 'atx') {
        result[lineIndex] = line.replace(/^#{1,6}(?:[ \t]|$)/, '');
    } else {
        result.splice(lineIndex + 1, 1);
    }

    return result;
}
