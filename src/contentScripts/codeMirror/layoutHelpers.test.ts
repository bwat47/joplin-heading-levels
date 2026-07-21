import { calculateGutterOffset, hasRoomForOverlaidGutter } from './layoutHelpers';

describe('calculateGutterOffset', () => {
    it('shifts the gutter into the centered editor margin', () => {
        expect(
            calculateGutterOffset({
                scrollerLeft: 0,
                contentLeft: 240,
                gutterWidth: 36,
            })
        ).toBe(204);
    });

    it('returns zero when the content already starts at the gutter edge', () => {
        expect(
            calculateGutterOffset({
                scrollerLeft: 0,
                contentLeft: 28,
                gutterWidth: 36,
            })
        ).toBe(0);
    });

    it('does not shift the gutter into the line padding area', () => {
        expect(
            calculateGutterOffset({
                scrollerLeft: 0,
                contentLeft: 56,
                gutterWidth: 28,
            })
        ).toBe(28);
    });

    it('rounds fractional browser layout values', () => {
        expect(
            calculateGutterOffset({
                scrollerLeft: 12.4,
                contentLeft: 154.8,
                gutterWidth: 35.6,
            })
        ).toBe(107);
    });

    it('guards against invalid layout measurements', () => {
        expect(
            calculateGutterOffset({
                scrollerLeft: 0,
                contentLeft: Number.NaN,
                gutterWidth: 36,
            })
        ).toBe(0);
    });
});

describe('hasRoomForOverlaidGutter', () => {
    it('accepts a centered editor whose margin is wider than the gutter', () => {
        expect(
            hasRoomForOverlaidGutter({
                scrollerLeft: 0,
                contentLeft: 220,
                gutterWidth: 36,
            })
        ).toBe(true);
    });

    it('rejects a full-width editor where the content starts at the scroller edge', () => {
        expect(
            hasRoomForOverlaidGutter({
                scrollerLeft: 0,
                contentLeft: 0,
                gutterWidth: 36,
            })
        ).toBe(false);
    });

    it('rejects a margin narrower than the gutter', () => {
        expect(
            hasRoomForOverlaidGutter({
                scrollerLeft: 40,
                contentLeft: 60,
                gutterWidth: 36,
            })
        ).toBe(false);
    });

    it('accepts a margin that matches the gutter within sub-pixel rounding', () => {
        expect(
            hasRoomForOverlaidGutter({
                scrollerLeft: 12.4,
                contentLeft: 48.2,
                gutterWidth: 36,
            })
        ).toBe(true);
    });

    it('guards against invalid layout measurements', () => {
        expect(
            hasRoomForOverlaidGutter({
                scrollerLeft: 0,
                contentLeft: Number.NaN,
                gutterWidth: 36,
            })
        ).toBe(false);
    });
});
