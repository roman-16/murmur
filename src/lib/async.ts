import type Gio from 'gi://Gio';
import GLib from 'gi://GLib';

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

// Resolves after the delay, or right away once cancelled. Either path removes
// the timer, so no source outlives the extension.
export function sleep(milliseconds: number, cancellable: Gio.Cancellable): Promise<void> {
    return new Promise(resolve => {
        let cancelledId = 0;
        let sourceId = 0;

        const finish = () => {
            if (sourceId) {
                GLib.source_remove(sourceId);
                sourceId = 0;
            }
            if (cancelledId) {
                cancellable.disconnect(cancelledId);
                cancelledId = 0;
            }
            resolve();
        };

        sourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            sourceId = 0;
            finish();
            return GLib.SOURCE_REMOVE;
        });
        cancelledId = cancellable.connect(finish);
    });
}
