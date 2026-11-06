import { offlineState, urlLookSnapshot, type StreamRenderer } from "./stream-renderer";

// Starts a ?demo= scene once its chunk has loaded. The screen passes its own dynamic import, so
// this module never imports the demo scenes (or their sample data) itself.

export interface DemoScenes {
    startDemo(renderer: StreamRenderer, name: string, params: URLSearchParams): () => void;
}

/**
 * Loads the demo scenes with `load` and starts the scene the URL names. A chunk that fails to
 * load draws the URL look's offline scene, as for a dead link. Returns the cleanup: once it ran,
 * a late chunk starts nothing and a late failure draws nothing.
 */
export function loadDemoScene(renderer: StreamRenderer, params: URLSearchParams, load: () => Promise<DemoScenes>): () => void {
    let stop: (() => void) | null = null;
    let unmounted = false;
    load()
        .then(({ startDemo }) => {
            if (!unmounted) stop = startDemo(renderer, params.get("demo") ?? "", params);
        })
        .catch(() => {
            if (!unmounted) renderer.render(offlineState(urlLookSnapshot(params)));
        });
    return () => {
        unmounted = true;
        stop?.();
    };
}
