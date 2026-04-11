import { parseAtxHeading, parseSetextHeading, detectHeadingAtLine, rewriteHeading } from './headingHelpers';

describe('parseAtxHeading', () => {
    it('parses H1 through H6', () => {
        expect(parseAtxHeading('# H1')).toEqual({ level: 1, type: 'atx' });
        expect(parseAtxHeading('## H2')).toEqual({ level: 2, type: 'atx' });
        expect(parseAtxHeading('### H3')).toEqual({ level: 3, type: 'atx' });
        expect(parseAtxHeading('###### H6')).toEqual({ level: 6, type: 'atx' });
    });

    it('accepts ATX heading with no content after hashes', () => {
        expect(parseAtxHeading('#')).toEqual({ level: 1, type: 'atx' });
        expect(parseAtxHeading('##')).toEqual({ level: 2, type: 'atx' });
    });

    it('returns null for seven or more hashes', () => {
        expect(parseAtxHeading('####### H7')).toBeNull();
    });

    it('returns null for non-heading lines', () => {
        expect(parseAtxHeading('plain text')).toBeNull();
        expect(parseAtxHeading('')).toBeNull();
        expect(parseAtxHeading('  # indented')).toBeNull();
    });
});

describe('parseSetextHeading', () => {
    it('detects H1 setext with equals underline', () => {
        expect(parseSetextHeading('Hello', '===')).toEqual({ level: 1, type: 'setext' });
        expect(parseSetextHeading('Hello', '=')).toEqual({ level: 1, type: 'setext' });
        expect(parseSetextHeading('Hello', '===========')).toEqual({ level: 1, type: 'setext' });
    });

    it('detects H2 setext with dashes underline', () => {
        expect(parseSetextHeading('Hello', '---')).toEqual({ level: 2, type: 'setext' });
        expect(parseSetextHeading('Hello', '-----------')).toEqual({ level: 2, type: 'setext' });
    });

    it('returns null when underline is undefined', () => {
        expect(parseSetextHeading('Hello', undefined)).toBeNull();
    });

    it('returns null when text line is blank', () => {
        expect(parseSetextHeading('', '===')).toBeNull();
        expect(parseSetextHeading('   ', '===')).toBeNull();
    });

    it('returns null when text line is itself an ATX heading', () => {
        expect(parseSetextHeading('# ATX', '===')).toBeNull();
    });

    it('returns null when underline is not all = or -', () => {
        expect(parseSetextHeading('Hello', 'not underline')).toBeNull();
        expect(parseSetextHeading('Hello', '=-=')).toBeNull();
    });
});

describe('detectHeadingAtLine', () => {
    it('detects ATX heading', () => {
        expect(detectHeadingAtLine(['## Hello', 'text'], 0)).toEqual({ level: 2, type: 'atx' });
    });

    it('detects setext heading', () => {
        expect(detectHeadingAtLine(['Hello', '===', 'text'], 0)).toEqual({ level: 1, type: 'setext' });
    });

    it('returns null for non-heading', () => {
        expect(detectHeadingAtLine(['plain text'], 0)).toBeNull();
    });

    it('returns null for out-of-bounds index', () => {
        expect(detectHeadingAtLine(['text'], 5)).toBeNull();
    });
});

describe('rewriteHeading – ATX', () => {
    it('rewrites H1 to H3, preserving content', () => {
        expect(rewriteHeading(['# My Heading'], 0, 3)).toEqual(['### My Heading']);
    });

    it('rewrites H3 to H1, preserving content', () => {
        expect(rewriteHeading(['### My Heading'], 0, 1)).toEqual(['# My Heading']);
    });

    it('rewrites H1 to H6, preserving content', () => {
        expect(rewriteHeading(['# My Heading'], 0, 6)).toEqual(['###### My Heading']);
    });

    it('preserves surrounding lines unchanged', () => {
        const lines = ['Intro', '## Heading', 'Body text'];
        expect(rewriteHeading(lines, 1, 4)).toEqual(['Intro', '#### Heading', 'Body text']);
    });

    it('preserves multiple spaces after hashes', () => {
        expect(rewriteHeading(['##  Spaced'], 0, 3)).toEqual(['###  Spaced']);
    });

    it('returns same array reference when level is unchanged', () => {
        const lines = ['## Heading'];
        expect(rewriteHeading(lines, 0, 2)).toBe(lines);
    });

    it('does not mutate the input array', () => {
        const lines = ['# Heading'];
        const original = [...lines];
        rewriteHeading(lines, 0, 3);
        expect(lines).toEqual(original);
    });
});

describe('rewriteHeading – setext', () => {
    it('rewrites setext H1 to H2, updating underline to dashes', () => {
        const result = rewriteHeading(['My Heading', '========='], 0, 2);
        expect(result[0]).toBe('My Heading');
        expect(result[1]).toMatch(/^-+$/);
        expect(result[1]).toHaveLength(9);
        expect(result).toHaveLength(2);
    });

    it('rewrites setext H2 to H1, updating underline to equals', () => {
        const result = rewriteHeading(['My Heading', '---------'], 0, 1);
        expect(result[0]).toBe('My Heading');
        expect(result[1]).toMatch(/^=+$/);
        expect(result[1]).toHaveLength(9);
    });

    it('preserves minimum underline length of 3', () => {
        const result = rewriteHeading(['Hi', '='], 0, 2);
        expect(result[1]).toBe('---');
    });

    it('converts setext H1 to ATX H3, removing underline line', () => {
        const result = rewriteHeading(['My Heading', '=========', 'Some text'], 0, 3);
        expect(result).toEqual(['### My Heading', 'Some text']);
    });

    it('converts setext H2 to ATX H6, removing underline line', () => {
        const result = rewriteHeading(['My Heading', '---------'], 0, 6);
        expect(result).toEqual(['###### My Heading']);
    });

    it('trims text content when converting setext to ATX', () => {
        const result = rewriteHeading(['  My Heading  ', '============='], 0, 4);
        expect(result[0]).toBe('#### My Heading');
    });

    it('returns same array reference when level is unchanged', () => {
        const lines = ['My Heading', '========='];
        expect(rewriteHeading(lines, 0, 1)).toBe(lines);
    });

    it('does not mutate the input array', () => {
        const lines = ['My Heading', '=========', 'Next line'];
        const original = [...lines];
        rewriteHeading(lines, 0, 3);
        expect(lines).toEqual(original);
    });
});

describe('rewriteHeading – non-heading lines', () => {
    it('returns same array reference for non-heading line', () => {
        const lines = ['Just some text'];
        expect(rewriteHeading(lines, 0, 2)).toBe(lines);
    });

    it('returns same array reference for out-of-bounds index', () => {
        const lines = ['text'];
        expect(rewriteHeading(lines, 5, 2)).toBe(lines);
    });
});
