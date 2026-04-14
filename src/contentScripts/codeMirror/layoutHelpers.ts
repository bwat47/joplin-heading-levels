export interface GutterOffsetInput {
    scrollerLeft: number;
    contentLeft: number;
    gutterWidth: number;
    contentPaddingStart: number;
}

/**
 * Compute how far the gutter wrapper should be shifted so it sits directly
 * against the left edge of the visible editor content.
 */
export function calculateGutterOffset({
    scrollerLeft,
    contentLeft,
    gutterWidth,
    contentPaddingStart,
}: GutterOffsetInput): number {
    const offset = contentLeft + contentPaddingStart - scrollerLeft - gutterWidth;
    if (!Number.isFinite(offset)) return 0;
    return Math.max(0, Math.round(offset));
}
