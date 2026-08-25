import type Gio from 'gi://Gio';

// GIO's async methods take a callback and a matching *_finish call. Wrapping
// them here keeps the call sites awaitable without patching prototypes that the
// whole shell process shares.
export function fromAsync<T>(
    start: (callback: (source: unknown, result: Gio.AsyncResult) => void) => void,
    finish: (result: Gio.AsyncResult) => T,
): Promise<T> {
    return new Promise((resolve, reject) => {
        start((_source, result) => {
            try {
                resolve(finish(result));
            } catch (error) {
                reject(error);
            }
        });
    });
}

export type Deferred<T> = {
    promise: Promise<T>;
    reject: (reason: unknown) => void;
    resolve: (value: T) => void;
};

export function deferred<T>(): Deferred<T> {
    let reject!: (reason: unknown) => void;
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((resolveFn, rejectFn) => {
        reject = rejectFn;
        resolve = resolveFn;
    });
    return {promise, reject, resolve};
}
