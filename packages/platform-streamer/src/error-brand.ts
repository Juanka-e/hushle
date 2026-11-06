// The custom server and the Next route bundles each load this package (one globalThis, two copies
// of every module), so an error built by one copy of a class can reach code holding the other:
// `instanceof` fails across copies, a registry symbol does not. Each error class stamps its brand
// (`Symbol.for("hushle.platform-streamer.<name>")`) in its constructor; its `is…` guard reads it.

export function brandError(error: Error, brand: symbol): void {
    Object.defineProperty(error, brand, { value: true });
}

export function hasErrorBrand(value: unknown, brand: symbol): boolean {
    return typeof value === "object" && value !== null && Reflect.get(value, brand) === true;
}
