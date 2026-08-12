import type { ChangeSpec, Text } from '@codemirror/state';
import type { SyntaxNodeRef, Tree } from '@lezer/common';

type HeadingType = 'atx' | 'setext';

/** The syntax-tree range and opening/underline marker for a Markdown heading. */
export interface HeadingInfo {
    from: number;
    to: number;
    markerFrom: number;
    markerTo: number;
    level: number;
    type: HeadingType;
}

const HEADING_NODE_PATTERN = /^(ATX|Setext)Heading([1-6])$/;

/** Convert a Lezer Markdown heading node into the data needed to edit it. */
export function headingInfoFromNode(node: SyntaxNodeRef): HeadingInfo | null {
    const match = HEADING_NODE_PATTERN.exec(node.name);
    if (!match) return null;

    const marker = node.node.getChild('HeaderMark');
    if (!marker) return null;

    return {
        from: node.from,
        to: node.to,
        markerFrom: marker.from,
        markerTo: marker.to,
        level: Number(match[2]),
        type: match[1] === 'ATX' ? 'atx' : 'setext',
    };
}

/** Find the heading whose first document line matches the given line. */
export function findHeadingAtLine(tree: Tree, doc: Text, lineFrom: number): HeadingInfo | null {
    if (lineFrom < 0 || lineFrom > doc.length) return null;

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
        left.level === right.level &&
        left.type === right.type
    );
}

function hasValidRanges(doc: Text, heading: HeadingInfo): boolean {
    return (
        heading.from >= 0 &&
        heading.from <= heading.markerFrom &&
        heading.markerFrom < heading.markerTo &&
        heading.markerTo <= heading.to &&
        heading.to <= doc.length
    );
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

    return {
        from: heading.markerFrom,
        to: heading.markerTo + (/^[ \t]$/.test(separator) ? 1 : 0),
        insert: '',
    };
}

function setextContent(doc: Text, heading: HeadingInfo): string | null {
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

    return content.length > 0 ? content.join(' ') : null;
}

function buildSetextChange(doc: Text, heading: HeadingInfo, newLevel: number | null): ChangeSpec | null {
    const marker = doc.sliceString(heading.markerFrom, heading.markerTo);
    const expectedMarker = heading.level === 1 ? '=' : '-';
    if (!marker || [...marker].some((character) => character !== expectedMarker)) return null;

    const underlineLine = doc.lineAt(heading.markerFrom);

    if (newLevel === null) {
        if (underlineLine.number <= 1) return null;
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

    const content = setextContent(doc, heading);
    if (!content) return null;

    return {
        from: heading.from,
        to: heading.to,
        insert: `${'#'.repeat(newLevel)} ${content}`,
    };
}

/** Build one localized edit for changing or removing a syntax-tree heading. */
export function buildHeadingChange(doc: Text, heading: HeadingInfo, newLevel: number | null): ChangeSpec | null {
    if (!hasValidRanges(doc, heading)) return null;
    if (newLevel !== null && (!Number.isInteger(newLevel) || newLevel < 1 || newLevel > 6)) return null;
    if (newLevel === heading.level) return null;

    return heading.type === 'atx' ? buildAtxChange(doc, heading, newLevel) : buildSetextChange(doc, heading, newLevel);
}
