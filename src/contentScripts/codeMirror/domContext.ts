import type { EditorView } from '@codemirror/view';

function getGlobalDocument(): Document {
    const doc = globalThis.document;
    if (!doc) {
        throw new Error('No global document is available for heading-level DOM operations.');
    }

    return doc;
}

function getGlobalWindow(): Window {
    const viewWindow = globalThis.window;
    if (!viewWindow) {
        throw new Error('No global window is available for heading-level DOM operations.');
    }

    return viewWindow;
}

function getNodeDocument(node: Node): Document {
    return node.ownerDocument ?? getGlobalDocument();
}

function getDocumentWindow(doc: Document): Window {
    return doc.defaultView ?? getGlobalWindow();
}

export function getViewDocument(view: EditorView): Document {
    return getNodeDocument(view.dom);
}

export function getViewWindow(view: EditorView): Window {
    return getDocumentWindow(getViewDocument(view));
}

export function getViewResizeObserver(view: EditorView): typeof ResizeObserver | undefined {
    return (
        (getViewWindow(view) as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ??
        globalThis.ResizeObserver
    );
}

export function requestViewAnimationFrame(view: EditorView, callback: FrameRequestCallback): number {
    return getViewWindow(view).requestAnimationFrame(callback);
}

export function cancelViewAnimationFrame(view: EditorView, handle: number): void {
    getViewWindow(view).cancelAnimationFrame(handle);
}
