import type { ChangeSpec, Text } from '@codemirror/state';
import type { SyntaxNodeRef, Tree } from '@lezer/common';

type HeadingType = 'atx' | 'setext';

/**
 * The syntax-tree range and markers for a Markdown heading.
 *
 * `markerFrom`/`markerTo` cover the opening `#` run for ATX headings and the
 * underline for setext headings. `closingFrom`/`closingTo` cover the optional
 * ATX closing sequence (`## Heading ##`) and are `null` when there is none.
 */
export interface HeadingInfo {
    from: number;
    to: number;
    markerFrom: number;
    markerTo: number;
    closingFrom: number | null;
    closingTo: number | null;
    level: number;
    type: HeadingType;
}

const HEADING_NODE_PATTERN = /^(ATX|Setext)Heading([1-6])$/;

/** Convert a Lezer Markdown heading node into the data needed to edit it. */
export function headingInfoFromNode(node: SyntaxNodeRef): HeadingInfo | null {
    const match = HEADING_NODE_PATTERN.exec(node.name);
    if (!match) return null;

    // ATX headings expose the opening run first and an optional closing run
    // second; setext headings expose only their underline.
    const [marker, closing] = node.node.getChildren('HeaderMark');
    if (!marker) return null;

    return {
        from: node.from,
        to: node.to,
        markerFrom: marker.from,
        markerTo: marker.to,
        closingFrom: closing ? closing.from : null,
        closingTo: closing ? closing.to : null,
        level: Number(match[2]),
        type: match[1] === 'ATX' ? 'atx' : 'setext',
    };
}

/** Find the heading whose first document line matches the given line. */
export function findHeadingAtLine(tree: Tree, doc: Text, lineFrom: number): HeadingInfo | null {
    const line = doc.lineAt(lineFrom);
    let heading: HeadingInfo | null = null;

    tree.iterate({
        from: line.from,
        to: line.to,
        enter(node) {
            if (heading) return false;

            const candidate = headingInfoFromNode(node);
            if (candidate && doc.lineAt(candidate.from).from === line.from) {
                heading = candidate;
                return false;
            }
        },
    });

    return heading;
}

export function headingsEqual(left: HeadingInfo, right: HeadingInfo): boolean {
    return (
        left.from === right.from &&
        left.to === right.to &&
        left.markerFrom === right.markerFrom &&
        left.markerTo === right.markerTo &&
        left.closingFrom === right.closingFrom &&
        left.closingTo === right.closingTo &&
        left.level === right.level &&
        left.type === right.type
    );
}

function hasValidRanges(doc: Text, heading: HeadingInfo): boolean {
    if (
        heading.from < 0 ||
        heading.from > heading.markerFrom ||
        heading.markerFrom >= heading.markerTo ||
        heading.markerTo > heading.to ||
        heading.to > doc.length
    ) {
        return false;
    }

    if (heading.closingFrom !== null || heading.closingTo !== null) {
        if (
            heading.closingFrom === null ||
            heading.closingTo === null ||
            heading.closingFrom < heading.markerTo ||
            heading.closingFrom >= heading.closingTo ||
            heading.closingTo > heading.to
        ) {
            return false;
        }
    }

    // A setext underline always sits on a line below the heading content, which
    // lets the paragraph conversion reach for the preceding line unconditionally.
    return heading.type !== 'setext' || doc.lineAt(heading.from).number < doc.lineAt(heading.markerFrom).number;
}

/**
 * Range covering an ATX closing sequence (`## Heading ##`) plus the whitespace
 * separating it from the content, or `null` when there is nothing to remove.
 *
 * Unlike the opening separator, every space is taken: leaving two behind would
 * turn the removed closing sequence into a trailing hard line break.
 */
function atxClosingRange(doc: Text, heading: HeadingInfo, openingTo: number): ChangeSpec | null {
    if (heading.closingFrom === null || heading.closingTo === null) return null;
    if (heading.closingTo <= openingTo) return null;
    if (!/^#+$/.test(doc.sliceString(heading.closingFrom, heading.closingTo))) return null;

    let from = Math.max(heading.closingFrom, openingTo);
    while (from > openingTo && /^[ \t]$/.test(doc.sliceString(from - 1, from))) from--;

    return { from, to: heading.closingTo, insert: '' };
}

function buildAtxChange(doc: Text, heading: HeadingInfo, newLevel: number | null): ChangeSpec | null {
    const marker = doc.sliceString(heading.markerFrom, heading.markerTo);
    if (marker !== '#'.repeat(heading.level)) return null;

    if (newLevel !== null) {
        return {
            from: heading.markerFrom,
            to: heading.markerTo,
            insert: '#'.repeat(newLevel),
        };
    }

    const markerLine = doc.lineAt(heading.markerFrom);
    const separator = doc.sliceString(heading.markerTo, Math.min(heading.markerTo + 1, markerLine.to));
    const openingTo = heading.markerTo + (/^[ \t]$/.test(separator) ? 1 : 0);

    const changes: ChangeSpec[] = [{ from: heading.markerFrom, to: openingTo, insert: '' }];
    const closing = atxClosingRange(doc, heading, openingTo);
    if (closing) changes.push(closing);

    return changes;
}

function setextContent(doc: Text, heading: HeadingInfo): string {
    const firstLine = doc.lineAt(heading.from);
    const underlineLine = doc.lineAt(heading.markerFrom);
    const content: string[] = [];

    for (let lineNumber = firstLine.number; lineNumber < underlineLine.number; lineNumber++) {
        const line = doc.line(lineNumber);
        const from = lineNumber === firstLine.number ? heading.from - line.from : 0;
        // Continuation lines inside block quotes include their quote marker in
        // the heading node. Strip that container prefix before collapsing.
        const text = line.text
            .slice(from)
            .trim()
            .replace(/^(?:>[ \t]?)+/, '')
            .trim();
        if (text) content.push(text);
    }

    return content.join(' ');
}

function buildSetextChange(doc: Text, heading: HeadingInfo, newLevel: number | null): ChangeSpec | null {
    const marker = doc.sliceString(heading.markerFrom, heading.markerTo);
    const expectedMarker = heading.level === 1 ? '=' : '-';
    if (!marker || [...marker].some((character) => character !== expectedMarker)) return null;

    const underlineLine = doc.lineAt(heading.markerFrom);

    if (newLevel === null) {
        return {
            from: doc.line(underlineLine.number - 1).to,
            to: heading.to,
            insert: '',
        };
    }

    if (newLevel <= 2) {
        return {
            from: heading.markerFrom,
            to: heading.markerTo,
            insert: (newLevel === 1 ? '=' : '-').repeat(marker.length),
        };
    }

    return {
        from: heading.from,
        to: heading.to,
        insert: `${'#'.repeat(newLevel)} ${setextContent(doc, heading)}`,
    };
}

/** Build one localized edit for changing or removing a syntax-tree heading. */
export function buildHeadingChange(doc: Text, heading: HeadingInfo, newLevel: number | null): ChangeSpec | null {
    if (!hasValidRanges(doc, heading)) return null;
    if (newLevel !== null && (!Number.isInteger(newLevel) || newLevel < 1 || newLevel > 6)) return null;
    if (newLevel === heading.level) return null;

    return heading.type === 'atx' ? buildAtxChange(doc, heading, newLevel) : buildSetextChange(doc, heading, newLevel);
}
