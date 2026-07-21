export interface GutterOffsetInput {
    scrollerLeft: number;
    contentLeft: number;
    gutterWidth: number;
}

/** Sub-pixel slack so fractional layout values do not flip the overlay decision. */
const ROOM_TOLERANCE_PX = 0.5;

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

/**
 * Whether the empty space left of the content box is wide enough to host the
 * gutter. Measured with the gutter already taken out of the flex flow, so the
 * content position reflects where it sits when the gutter costs no width.
 *
 * When this is true the gutter can be overlaid on that empty margin (Joplin's
 * max editor width setting leaves one there) and the note text keeps its
 * centered position. When false the gutter has to occupy flow width, which
 * pushes the content right.
 */
export function hasRoomForOverlaidGutter({ scrollerLeft, contentLeft, gutterWidth }: GutterOffsetInput): boolean {
    const room = contentLeft - scrollerLeft;
    if (!Number.isFinite(room) || !Number.isFinite(gutterWidth)) return false;
    return room + ROOM_TOLERANCE_PX >= gutterWidth;
}
