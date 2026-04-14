import { EditorView, gutter, GutterMarker, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { Compartment, RangeSetBuilder, RangeSet } from '@codemirror/state';
import type { CodeMirrorControl, ContentScriptContext } from 'api/types';
import { detectHeadingAtLine, rewriteHeading } from './headingHelpers';
import { calculateGutterOffset } from './layoutHelpers';
import {
    cancelViewAnimationFrame,
    getDocumentWindow,
    getViewDocument,
    getViewResizeObserver,
    getViewWindow,
    requestViewAnimationFrame,
} from './domContext';
import { logger } from '../../logger';

const COMMAND_SET_CONFIG = 'headingLevels__setConfig';

interface Config {
    gutterPlacement: 'before' | 'after';
}

const DEFAULT_CONFIG: Config = { gutterPlacement: 'after' };

// ---------------------------------------------------------------------------
// Styles injected once into the webview document
// ---------------------------------------------------------------------------

const STYLES = `
/* Remove the gutter panel's background and separator so our markers sit
   flush against the editor text with no visible column boundary. */
.cm-editor .cm-gutters {
    background-color: transparent;
    border-right: none;
}
.hl-gutter {
    background: transparent;
    min-width: 2em;
    padding: 0 2px 0 4px;
}
.hl-gutter-before {
    order: -1;
}
.hl-gutter-marker {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.75em;
    font-weight: 500;
    line-height: 1;
    height: 100%;
    padding: 0 2px;
    border-radius: 3px;
    cursor: pointer;
    color: var(--joplin-color-faded, #888);
    opacity: 0.6;
    user-select: none;
    transition: opacity 0.15s;
}
.hl-gutter-marker:hover {
    opacity: 1;
    color: var(--joplin-color, inherit);
    background: var(--joplin-background-color-hover3, rgba(128,128,128,0.12));
}
.hl-popup {
    position: fixed;
    z-index: 9999;
    background: var(--joplin-background-color, #fff);
    border: 1px solid var(--joplin-divider-color, #ccc);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    padding: 4px 0;
    min-width: 120px;
    font-family: inherit;
    font-size: 13px;
}
.hl-popup-item {
    padding: 6px 14px;
    cursor: pointer;
    color: var(--joplin-color, inherit);
    display: flex;
    align-items: center;
    gap: 8px;
}
.hl-popup-item:hover {
    background: var(--joplin-background-color-hover3, rgba(128,128,128,0.15));
}
.hl-popup-item-current {
    font-weight: 700;
}
.hl-popup-item-current::after {
    content: '✓';
    margin-left: auto;
    font-size: 0.9em;
}
`;

function ensureStylesInjected(view: EditorView): void {
    const doc = getViewDocument(view);

    if (doc.getElementById('hl-plugin-styles')) return;

    const style = doc.createElement('style');
    style.id = 'hl-plugin-styles';
    style.textContent = STYLES;
    doc.head.appendChild(style);
}

function getContentPaddingStart(contentEl: HTMLElement): number {
    const computedStyle = getDocumentWindow(contentEl.ownerDocument).getComputedStyle(contentEl);
    const padding = computedStyle.paddingInlineStart || computedStyle.paddingLeft || '0';
    const value = Number.parseFloat(padding);

    return Number.isFinite(value) ? value : 0;
}

function syncGutterAlignment(view: EditorView): void {
    const gutterWrapper = view.scrollDOM.querySelector<HTMLElement>('.cm-gutters');
    if (!gutterWrapper) return;

    const scrollerRect = view.scrollDOM.getBoundingClientRect();
    const contentRect = view.contentDOM.getBoundingClientRect();
    const gutterRect = gutterWrapper.getBoundingClientRect();
    const nextOffset = calculateGutterOffset({
        scrollerLeft: scrollerRect.left,
        contentLeft: contentRect.left,
        gutterWidth: gutterRect.width,
        contentPaddingStart: getContentPaddingStart(view.contentDOM),
    });
    const nextLeft = `${nextOffset}px`;

    if (gutterWrapper.style.left !== nextLeft) {
        gutterWrapper.style.left = nextLeft;
    }
}

class GutterAlignmentPlugin {
    private frameHandle: number | null = null;

    private readonly resizeObserver: ResizeObserver | null;

    private readonly viewWindow: Window;

    private readonly handleWindowResize = () => {
        this.scheduleSync();
    };

    constructor(private readonly view: EditorView) {
        this.viewWindow = getViewWindow(view);
        this.scheduleSync();

        const ResizeObserverCtor = getViewResizeObserver(view);

        if (ResizeObserverCtor) {
            this.resizeObserver = new ResizeObserverCtor(() => {
                this.scheduleSync();
            });
            this.resizeObserver.observe(this.view.dom);
            this.resizeObserver.observe(this.view.scrollDOM);
            this.resizeObserver.observe(this.view.contentDOM);
        } else {
            this.resizeObserver = null;
            this.viewWindow.addEventListener('resize', this.handleWindowResize);
        }
    }

    update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.geometryChanged) {
            this.scheduleSync();
        }
    }

    destroy(): void {
        if (this.frameHandle !== null) {
            cancelViewAnimationFrame(this.view, this.frameHandle);
            this.frameHandle = null;
        }

        this.resizeObserver?.disconnect();
        this.viewWindow.removeEventListener('resize', this.handleWindowResize);
    }

    private scheduleSync(): void {
        if (this.frameHandle !== null) return;

        this.frameHandle = requestViewAnimationFrame(this.view, () => {
            this.frameHandle = null;
            syncGutterAlignment(this.view);
        });
    }
}

const gutterAlignmentExtension = ViewPlugin.fromClass(GutterAlignmentPlugin);

// ---------------------------------------------------------------------------
// Gutter marker
// ---------------------------------------------------------------------------

class HeadingMarker extends GutterMarker {
    constructor(readonly level: number) {
        super();
    }

    toDOM(view: EditorView): HTMLElement {
        const el = getViewDocument(view).createElement('div');
        el.className = 'hl-gutter-marker';
        el.setAttribute('data-level', String(this.level));
        el.textContent = `H${this.level}`;
        return el;
    }

    eq(other: GutterMarker): boolean {
        return other instanceof HeadingMarker && other.level === this.level;
    }
}

/** One pre-created marker per level (1–6) for reuse across renders. */
const LEVEL_MARKERS: HeadingMarker[] = [1, 2, 3, 4, 5, 6].map((l) => new HeadingMarker(l));

function buildHeadingMarkers(view: EditorView): RangeSet<GutterMarker> {
    const builder = new RangeSetBuilder<GutterMarker>();
    const { from, to } = view.viewport;

    syntaxTree(view.state).iterate({
        from,
        to,
        enter(node) {
            const match = /^(?:ATX|Setext)Heading(\d)$/.exec(node.name);
            if (match) {
                const level = parseInt(match[1]);
                builder.add(node.from, node.from, LEVEL_MARKERS[level - 1]);
            }
        },
    });

    return builder.finish();
}

// ---------------------------------------------------------------------------
// Popup
// ---------------------------------------------------------------------------

interface PopupState {
    doc: Document;
    el: HTMLElement;
    outsideClickHandler: (e: MouseEvent) => void;
    escapeHandler: (e: KeyboardEvent) => void;
    blurCleanup: () => void;
}

let activePopup: PopupState | null = null;

function closePopup(): void {
    if (!activePopup) return;
    const { doc, el, outsideClickHandler, escapeHandler, blurCleanup } = activePopup;
    el.remove();
    doc.removeEventListener('mousedown', outsideClickHandler);
    doc.removeEventListener('keydown', escapeHandler);
    blurCleanup();
    activePopup = null;
}

function openPopup(view: EditorView, headingLineNumber: number, currentLevel: number, anchorEl: HTMLElement): void {
    closePopup();

    const doc = getViewDocument(view);
    const viewWindow = getViewWindow(view);

    const popup = doc.createElement('div');
    popup.className = 'hl-popup';
    popup.setAttribute('role', 'menu');

    for (let l = 1; l <= 6; l++) {
        const item = doc.createElement('div');
        item.className = 'hl-popup-item';
        if (l === currentLevel) item.classList.add('hl-popup-item-current');
        item.textContent = `Heading ${l}`;
        item.setAttribute('role', 'menuitem');
        const targetLevel = l;
        item.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            applyHeadingChange(view, headingLineNumber, targetLevel);
            closePopup();
        });
        popup.appendChild(item);
    }

    // Position off-screen first to measure dimensions
    popup.style.position = 'fixed';
    popup.style.left = '-9999px';
    popup.style.top = '-9999px';
    doc.body.appendChild(popup);

    const popupRect = popup.getBoundingClientRect();
    const anchorRect = anchorEl.getBoundingClientRect();

    let left = anchorRect.right + 4;
    let top = anchorRect.top;

    if (left + popupRect.width > viewWindow.innerWidth) {
        left = anchorRect.left - popupRect.width - 4;
    }
    if (top + popupRect.height > viewWindow.innerHeight) {
        top = viewWindow.innerHeight - popupRect.height - 8;
    }

    popup.style.left = `${Math.max(0, left)}px`;
    popup.style.top = `${Math.max(0, top)}px`;

    const outsideClickHandler = (e: MouseEvent) => {
        if (!popup.contains(e.target as Node)) {
            closePopup();
        }
    };
    const escapeHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closePopup();
    };
    const blurHandler = () => closePopup();
    view.dom.addEventListener('blur', blurHandler, { capture: true });
    const blurCleanup = () => view.dom.removeEventListener('blur', blurHandler, { capture: true });

    // Delay adding outside-click listener so the current click doesn't immediately close it
    setTimeout(() => {
        doc.addEventListener('mousedown', outsideClickHandler);
        doc.addEventListener('keydown', escapeHandler);
    }, 0);

    activePopup = { doc, el: popup, outsideClickHandler, escapeHandler, blurCleanup };
}

// ---------------------------------------------------------------------------
// Heading change application
// ---------------------------------------------------------------------------

function applyHeadingChange(view: EditorView, headingLineNumber: number, newLevel: number): void {
    const doc = view.state.doc;

    const lines: string[] = [];
    for (let i = 1; i <= doc.lines; i++) {
        lines.push(doc.line(i).text);
    }

    const lineIndex = headingLineNumber - 1;
    const heading = detectHeadingAtLine(lines, lineIndex);
    if (!heading || heading.level === newLevel) return;

    const newLines = rewriteHeading(lines, lineIndex, newLevel);

    let from: number;
    let to: number;
    let insert: string;

    if (heading.type === 'atx') {
        const docLine = doc.line(headingLineNumber);
        from = docLine.from;
        to = docLine.to;
        insert = newLines[lineIndex];
    } else {
        const textDocLine = doc.line(headingLineNumber);
        const underlineDocLine = doc.line(headingLineNumber + 1);
        if (newLevel <= 2) {
            // Only the underline line changes
            from = underlineDocLine.from;
            to = underlineDocLine.to;
            insert = newLines[lineIndex + 1];
        } else {
            // Text line + underline line replaced by single ATX line
            from = textDocLine.from;
            to = underlineDocLine.to;
            insert = newLines[lineIndex];
        }
    }

    view.dispatch({ changes: { from, to, insert } });
}

// ---------------------------------------------------------------------------
// Gutter extension factory
// ---------------------------------------------------------------------------

function createGutterExtension(config: Config) {
    const gutterClass = config.gutterPlacement === 'before' ? 'hl-gutter hl-gutter-before' : 'hl-gutter';

    return gutter({
        class: gutterClass,
        markers: buildHeadingMarkers,
        lineMarkerChange: (update) => update.docChanged || update.viewportChanged,
        domEventHandlers: {
            mousedown(_view, _line, event) {
                const target = event.target as HTMLElement;
                if (target.classList.contains('hl-gutter-marker')) {
                    // Prevent the editor from moving the selection on marker click
                    event.preventDefault();
                    return true;
                }
                return false;
            },
            click(view, line, event) {
                const target = event.target as HTMLElement;
                if (!target.classList.contains('hl-gutter-marker')) return false;

                const level = parseInt(target.getAttribute('data-level') ?? '1');
                const lineNumber = view.state.doc.lineAt(line.from).number;
                openPopup(view, lineNumber, level, target);
                return true;
            },
        },
    });
}

// ---------------------------------------------------------------------------
// Content script entry point
// ---------------------------------------------------------------------------

export default function (context: ContentScriptContext) {
    return {
        plugin: async function (editorControl: CodeMirrorControl) {
            if (!editorControl?.cm6) {
                logger.warn('CodeMirror 6 not available; skipping heading level gutter.');
                return;
            }

            const editor = editorControl.editor as EditorView;

            ensureStylesInjected(editor);

            // Fetch initial config from the main plugin
            let config: Config = DEFAULT_CONFIG;
            try {
                const response = await context.postMessage({ type: 'getSettings' });
                if (response && typeof response === 'object') {
                    config = response as Config;
                }
            } catch (e) {
                logger.warn('Could not fetch settings; using defaults.', e);
            }

            const gutterCompartment = new Compartment();

            editorControl.addExtension([gutterCompartment.of(createGutterExtension(config)), gutterAlignmentExtension]);

            // Command for live config updates pushed from the main plugin
            editorControl.registerCommand(COMMAND_SET_CONFIG, (newConfig: Config) => {
                editor.dispatch({
                    effects: gutterCompartment.reconfigure(createGutterExtension(newConfig)),
                });
            });
        },
    };
}
