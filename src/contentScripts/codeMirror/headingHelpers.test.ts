import { EditorState, Text, type ChangeSpec } from '@codemirror/state';
import { parser } from '@lezer/markdown';
import { buildHeadingChange, findHeadingAtLine, headingsEqual, type HeadingInfo } from './headingHelpers';

function headingAt(source: string, lineNumber = 1): { doc: Text; heading: HeadingInfo } {
    const doc = Text.of(source.split('\n'));
    const heading = findHeadingAtLine(parser.parse(source), doc, doc.line(lineNumber).from);
    if (!heading) throw new Error(`Expected a heading on line ${lineNumber}: ${JSON.stringify(source)}`);
    return { doc, heading };
}

function applyChange(source: string, change: ChangeSpec): string {
    const state = EditorState.create({ doc: source });
    return state.update({ changes: change }).state.doc.toString();
}

function changeHeading(source: string, newLevel: number | null, lineNumber = 1): string {
    const { doc, heading } = headingAt(source, lineNumber);
    const change = buildHeadingChange(doc, heading, newLevel);
    if (!change) throw new Error(`Expected a heading change for ${JSON.stringify(source)}`);
    return applyChange(source, change);
}

describe('findHeadingAtLine', () => {
    it('returns ATX heading and marker ranges from the syntax tree', () => {
        const { heading } = headingAt('## Heading');

        expect(heading).toEqual({
            from: 0,
            to: 10,
            markerFrom: 0,
            markerTo: 2,
            closingFrom: null,
            closingTo: null,
            level: 2,
            type: 'atx',
        });
    });

    it('returns the optional ATX closing sequence range', () => {
        const { heading } = headingAt('## Heading ##');

        expect(heading.markerFrom).toBe(0);
        expect(heading.markerTo).toBe(2);
        expect(heading.closingFrom).toBe(11);
        expect(heading.closingTo).toBe(13);
    });

    it.each([' # Heading', '  # Heading', '   # Heading'])('finds an indented ATX heading: %s', (source) => {
        const { heading } = headingAt(source);

        expect(heading.type).toBe('atx');
        expect(heading.level).toBe(1);
        expect(heading.markerFrom).toBe(source.indexOf('#'));
    });

    it('returns a multiline setext heading and its underline marker', () => {
        const source = 'First line\nsecond line\n---';
        const { heading } = headingAt(source);

        expect(heading).toEqual({
            from: 0,
            to: source.length,
            markerFrom: source.lastIndexOf('---'),
            markerTo: source.length,
            closingFrom: null,
            closingTo: null,
            level: 2,
            type: 'setext',
        });
    });

    it('finds headings nested in block quotes and lists by their document line', () => {
        expect(headingAt('> # Quoted').heading.markerFrom).toBe(2);
        expect(headingAt('- ## Listed').heading.markerFrom).toBe(2);
    });

    it('returns null for a non-heading line', () => {
        const source = 'Paragraph';
        const doc = Text.of([source]);

        expect(findHeadingAtLine(parser.parse(source), doc, 0)).toBeNull();
    });
});

describe('buildHeadingChange – ATX', () => {
    it('changes only the opening marker range', () => {
        const source = 'Before\n## Heading\nAfter';
        const { doc, heading } = headingAt(source, 2);
        const change = buildHeadingChange(doc, heading, 4);

        expect(change).toEqual([{ from: 7, to: 9, insert: '####' }]);
        expect(applyChange(source, change!)).toBe('Before\n#### Heading\nAfter');
    });

    it('preserves indentation and separator spacing', () => {
        expect(changeHeading('  ##  Heading', 5)).toBe('  #####  Heading');
    });

    it('normalizes the closing sequence to the new level', () => {
        expect(changeHeading('## Heading ##', 4)).toBe('#### Heading ####');
        expect(changeHeading('## Heading #####', 3)).toBe('### Heading ###');
        expect(changeHeading('  ##  Heading ##', 5)).toBe('  #####  Heading #####');
        expect(changeHeading('> ## Quoted ##', 1)).toBe('> # Quoted #');
        expect(changeHeading('## ##', 4)).toBe('#### ####');
    });

    it.each(['## Heading ##', '  ##  Heading ##', '> ## Quoted ##', '## ##', '## Heading #####'])(
        're-parses at the requested level after a rewrite: %s',
        (source) => {
            for (const level of [1, 3, 6]) {
                const rewritten = changeHeading(source, level);
                expect(headingAt(rewritten).heading.level).toBe(level);
            }
        }
    );

    it('changes an empty heading', () => {
        expect(changeHeading('##', 6)).toBe('######');
    });

    it('removes the marker and exactly one separator character', () => {
        expect(changeHeading('###  Heading', null)).toBe(' Heading');
        expect(changeHeading('  ### Heading', null)).toBe('  Heading');
        expect(changeHeading('###', null)).toBe('');
    });

    it('removes the closing sequence and all of its leading whitespace', () => {
        expect(changeHeading('### Heading ###', null)).toBe('Heading');
        expect(changeHeading('### Heading   ###', null)).toBe('Heading');
        expect(changeHeading('### Heading ###   ', null)).toBe('Heading   ');
        expect(changeHeading('> ## Quoted ##', null)).toBe('> Quoted');
    });

    it('removes overlapping opening and closing sequences of an empty heading', () => {
        expect(changeHeading('## ##', null)).toBe('');
        expect(changeHeading('###  ###', null)).toBe('');
    });

    it('edits nested headings without removing their container markers', () => {
        expect(changeHeading('> ## Quoted', 4)).toBe('> #### Quoted');
        expect(changeHeading('- ## Listed', null)).toBe('- Listed');
    });
});

describe('buildHeadingChange – setext', () => {
    it('changes only the underline marker and preserves surrounding whitespace', () => {
        const source = 'Title\n  ===  \t';
        const { doc, heading } = headingAt(source);
        const change = buildHeadingChange(doc, heading, 2);

        expect(change).toEqual({ from: 8, to: 11, insert: '---' });
        expect(applyChange(source, change!)).toBe('Title\n  ---  \t');
        expect(changeHeading('Title\n---', 1)).toBe('Title\n===');
    });

    it('converts a single-line setext heading to ATX', () => {
        expect(changeHeading('Title\n=====', 3)).toBe('### Title');
    });

    it('collapses multiline setext content with single spaces', () => {
        const source = 'Before\n\nFirst line\n  second line  \n---\nAfter';
        expect(changeHeading(source, 4, 3)).toBe('Before\n\n#### First line second line\nAfter');
    });

    it('preserves the first-line indentation when collapsing an indented heading', () => {
        expect(changeHeading('  First\n  second\n  ---', 3)).toBe('  ### First second');
    });

    it('collapses multiline block-quoted setext content without retaining continuation quote markers', () => {
        expect(changeHeading('> First\n> second\n> ---', 3)).toBe('> ### First second');
    });

    it('removes only the underline from a single-line setext heading', () => {
        expect(changeHeading('Before\n\nTitle\n---\nAfter', null, 3)).toBe('Before\n\nTitle\nAfter');
    });

    it('preserves every content line when converting a multiline setext heading to a paragraph', () => {
        expect(changeHeading('First\nsecond\n---\nAfter', null)).toBe('First\nsecond\nAfter');
    });
});

describe('heading change validation', () => {
    it('returns null when the requested level is unchanged or invalid', () => {
        const { doc, heading } = headingAt('## Heading');

        expect(buildHeadingChange(doc, heading, 2)).toBeNull();
        expect(buildHeadingChange(doc, heading, 0)).toBeNull();
        expect(buildHeadingChange(doc, heading, 7)).toBeNull();
        expect(buildHeadingChange(doc, heading, 2.5)).toBeNull();
    });

    it('returns null for stale or inconsistent marker ranges', () => {
        const { doc, heading } = headingAt('## Heading');

        expect(buildHeadingChange(doc, { ...heading, markerTo: heading.markerTo + 1 }, 3)).toBeNull();
        expect(buildHeadingChange(doc, { ...heading, to: doc.length + 1 }, 3)).toBeNull();
        expect(buildHeadingChange(doc, { ...heading, closingFrom: 4 }, 3)).toBeNull();
        expect(buildHeadingChange(doc, { ...heading, closingFrom: 8, closingTo: 4 }, 3)).toBeNull();
    });

    it('compares every syntax-backed heading property', () => {
        const { heading } = headingAt('## Heading');

        expect(headingsEqual(heading, { ...heading })).toBe(true);
        expect(headingsEqual(heading, { ...heading, markerFrom: heading.markerFrom + 1 })).toBe(false);
        expect(headingsEqual(heading, { ...heading, level: 3 })).toBe(false);
        expect(headingsEqual(heading, { ...heading, closingFrom: 8, closingTo: 10 })).toBe(false);
    });
});
