import { calculateGutterOffset } from './layoutHelpers';

describe('calculateGutterOffset', () => {
    it('shifts the gutter into the centered editor margin', () => {
        expect(
            calculateGutterOffset({
                scrollerLeft: 0,
                contentLeft: 240,
                gutterWidth: 36,
                contentPaddingStart: 8,
            })
        ).toBe(212);
    });

    it('returns zero when the content already starts at the gutter edge', () => {
        expect(
            calculateGutterOffset({
                scrollerLeft: 0,
                contentLeft: 28,
                gutterWidth: 36,
                contentPaddingStart: 0,
            })
        ).toBe(0);
    });

    it('rounds fractional browser layout values', () => {
        expect(
            calculateGutterOffset({
                scrollerLeft: 12.4,
                contentLeft: 154.8,
                gutterWidth: 35.6,
                contentPaddingStart: 7.9,
            })
        ).toBe(115);
    });

    it('guards against invalid layout measurements', () => {
        expect(
            calculateGutterOffset({
                scrollerLeft: 0,
                contentLeft: Number.NaN,
                gutterWidth: 36,
                contentPaddingStart: 8,
            })
        ).toBe(0);
    });
});
