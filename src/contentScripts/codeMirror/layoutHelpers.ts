export interface GutterOffsetInput {
    scrollerLeft: number;
    contentLeft: number;
    gutterWidth: number;
}

/**
 * Compute how far the gutter wrapper should be shifted so its right edge
 * lines up with the content box, not the text inset inside each line.
 * That preserves the line box area used by left-edge decorations such as
 * block quotes and callouts.
 */
export function calculateGutterOffset({ scrollerLeft, contentLeft, gutterWidth }: GutterOffsetInput): number {
    const offset = contentLeft - scrollerLeft - gutterWidth;
    if (!Number.isFinite(offset)) return 0;
    return Math.max(0, Math.round(offset));
}
