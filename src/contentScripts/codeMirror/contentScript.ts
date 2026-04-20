import {
    EditorView,
    gutter,
    GutterMarker,
    repositionTooltips,
    showTooltip,
    tooltips,
    ViewPlugin,
    type Tooltip,
    type ViewUpdate,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { Compartment, Facet, RangeSetBuilder, RangeSet, StateEffect, StateField } from '@codemirror/state';
import type { CodeMirrorControl, ContentScriptContext } from 'api/types';
import { detectHeadingAtLine, removeHeading, rewriteHeading } from './headingHelpers';
import { calculateGutterOffset } from './layoutHelpers';
import {
    cancelViewAnimationFrame,
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

const configFacet = Facet.define<Config, Config>({
    combine(configs) {
        return configs.length > 0 ? configs[configs.length - 1] : DEFAULT_CONFIG;
    },
});

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
.cm-tooltip.hl-heading-menu {
    z-index: 9999;
    background: var(--joplin-background-color, #fff);
    border: 1px solid var(--joplin-divider-color, #ccc);
    border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    padding: 4px 0;
    min-width: 120px;
    font-family: system-ui, sans-serif;
    font-size: 13px;
    overflow: hidden;
}
.hl-heading-menu-item {
    padding: 6px 14px;
    cursor: pointer;
    color: var(--joplin-color, inherit);
    display: flex;
    align-items: center;
    gap: 8px;
}
.hl-heading-menu-item:hover {
    background: var(--joplin-background-color-hover3, rgba(128,128,128,0.15));
}
.hl-heading-menu-item-current {
    font-weight: 700;
}
.hl-heading-menu-item-current::after {
    content: '✓';
    margin-left: auto;
    font-size: 1.2em;
}
/* Style built-in line numbers consistently with the heading gutter markers. */
.cm-lineNumbers .cm-gutterElement {
    font-size: 0.75em;
    font-weight: 500;
    color: var(--joplin-color-faded, #888);
    opacity: 0.6;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 6px;
    user-select: none;
    transition: opacity 0.15s;
}
.cm-lineNumbers .cm-gutterElement.cm-activeLineGutter {
    opacity: 1;
    color: var(--joplin-color, inherit);
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

class GutterPlacementPlugin {
    constructor(private readonly view: EditorView) {
        this.syncPlacementClass(this.view.state.facet(configFacet));
    }

    update(update: ViewUpdate): void {
        const previousConfig = update.startState.facet(configFacet);
        const nextConfig = update.state.facet(configFacet);

        if (
            previousConfig.gutterPlacement !== nextConfig.gutterPlacement ||
            update.geometryChanged ||
            update.viewportChanged
        ) {
            this.syncPlacementClass(nextConfig);
        }
    }

    private syncPlacementClass(config: Config): void {
        const gutterElement = this.view.scrollDOM.querySelector<HTMLElement>('.hl-gutter');
        if (!gutterElement) return;

        gutterElement.classList.toggle('hl-gutter-before', config.gutterPlacement === 'before');
    }
}

const gutterPlacementExtension = ViewPlugin.fromClass(GutterPlacementPlugin);

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
// Heading menu tooltip
// ---------------------------------------------------------------------------

interface HeadingMenuState {
    pos: number;
    headingLineNumber: number;
    currentLevel: number;
}

const openHeadingMenuEffect = StateEffect.define<HeadingMenuState>();
const closeHeadingMenuEffect = StateEffect.define<null>();

function closeHeadingMenu(view: EditorView): void {
    view.dispatch({ effects: closeHeadingMenuEffect.of(null) });
}

function createHeadingMenuTooltip(menuState: HeadingMenuState): Tooltip {
    return {
        pos: menuState.pos,
        above: false,
        create(view) {
            const doc = getViewDocument(view);
            const viewWindow = getViewWindow(view);
            const menu = doc.createElement('div');
            menu.className = 'hl-heading-menu';
            menu.setAttribute('role', 'menu');

            for (let l = 1; l <= 6; l++) {
                const item = doc.createElement('div');
                item.className = 'hl-heading-menu-item';
                if (l === menuState.currentLevel) item.classList.add('hl-heading-menu-item-current');
                item.textContent = `Heading ${l}`;
                item.setAttribute('role', 'menuitem');
                const targetLevel = l;
                item.addEventListener('pointerdown', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    applyHeadingChange(view, menuState.headingLineNumber, targetLevel);
                });
                menu.appendChild(item);
            }

            const paragraphItem = doc.createElement('div');
            paragraphItem.className = 'hl-heading-menu-item';
            paragraphItem.textContent = 'Paragraph';
            paragraphItem.setAttribute('role', 'menuitem');
            paragraphItem.addEventListener('pointerdown', (event) => {
                event.preventDefault();
                event.stopPropagation();
                applyHeadingChange(view, menuState.headingLineNumber, null);
            });
            menu.appendChild(paragraphItem);

            const outsidePointerDownHandler = (event: PointerEvent) => {
                if (!menu.contains(event.target as Node)) {
                    closeHeadingMenu(view);
                }
            };
            const escapeHandler = (event: KeyboardEvent) => {
                if (event.key === 'Escape') {
                    closeHeadingMenu(view);
                }
            };
            const handleViewportChange = () => repositionTooltips(view);

            return {
                dom: menu,
                offset: { x: 8, y: 4 },
                mount() {
                    doc.addEventListener('pointerdown', outsidePointerDownHandler, true);
                    doc.addEventListener('keydown', escapeHandler);
                    viewWindow.visualViewport?.addEventListener('resize', handleViewportChange);
                    viewWindow.visualViewport?.addEventListener('scroll', handleViewportChange);
                },
                destroy() {
                    doc.removeEventListener('pointerdown', outsidePointerDownHandler, true);
                    doc.removeEventListener('keydown', escapeHandler);
                    viewWindow.visualViewport?.removeEventListener('resize', handleViewportChange);
                    viewWindow.visualViewport?.removeEventListener('scroll', handleViewportChange);
                },
            };
        },
    };
}

const headingMenuStateField = StateField.define<HeadingMenuState | null>({
    create() {
        return null;
    },
    update(value, tr) {
        for (const effect of tr.effects) {
            if (effect.is(openHeadingMenuEffect)) {
                return effect.value;
            }
        }

        if (
            tr.effects.some((effect) => effect.is(closeHeadingMenuEffect)) ||
            tr.docChanged ||
            tr.selection !== undefined
        ) {
            return null;
        }

        return value;
    },
    provide: (field) =>
        showTooltip.compute([field], (state) => {
            const menuState = state.field(field);
            return menuState ? createHeadingMenuTooltip(menuState) : null;
        }),
});

// ---------------------------------------------------------------------------
// Heading change application
// ---------------------------------------------------------------------------

function applyHeadingChange(view: EditorView, headingLineNumber: number, newLevel: number | null): void {
    const doc = view.state.doc;

    const lines: string[] = [];
    for (let i = 1; i <= doc.lines; i++) {
        lines.push(doc.line(i).text);
    }

    const lineIndex = headingLineNumber - 1;
    const heading = detectHeadingAtLine(lines, lineIndex);
    if (!heading || (newLevel !== null && heading.level === newLevel)) {
        closeHeadingMenu(view);
        return;
    }

    const newLines = newLevel === null ? removeHeading(lines, lineIndex) : rewriteHeading(lines, lineIndex, newLevel);

    let from: number;
    let to: number;
    let insert: string;

    if (newLevel === null) {
        const textDocLine = doc.line(headingLineNumber);
        if (heading.type === 'atx') {
            from = textDocLine.from;
            to = textDocLine.to;
            insert = newLines[lineIndex];
        } else {
            const underlineDocLine = doc.line(headingLineNumber + 1);
            from = textDocLine.from;
            to = underlineDocLine.to;
            insert = newLines[lineIndex];
        }
    } else if (heading.type === 'atx') {
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

    view.dispatch({
        changes: { from, to, insert },
        effects: closeHeadingMenuEffect.of(null),
    });
}

function openHeadingMenu(view: EditorView, lineFrom: number, headingLineNumber: number, currentLevel: number): void {
    view.dispatch({
        selection: { anchor: lineFrom },
        effects: openHeadingMenuEffect.of({
            pos: lineFrom,
            headingLineNumber,
            currentLevel,
        }),
    });
}

// ---------------------------------------------------------------------------
// Gutter extension factory
// ---------------------------------------------------------------------------

function createGutterExtension() {
    return gutter({
        class: 'hl-gutter',
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
                openHeadingMenu(view, line.from, lineNumber, level);
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

            const configCompartment = new Compartment();

            editorControl.addExtension([
                configCompartment.of(configFacet.of(config)),
                createGutterExtension(),
                gutterAlignmentExtension,
                gutterPlacementExtension,
                headingMenuStateField,
                tooltips(),
            ]);

            // Command for live config updates pushed from the main plugin
            editorControl.registerCommand(COMMAND_SET_CONFIG, (newConfig: Config) => {
                editor.dispatch({
                    effects: configCompartment.reconfigure(configFacet.of(newConfig)),
                });
            });
        },
    };
}
