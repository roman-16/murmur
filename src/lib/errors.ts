import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export function cancellation(): GLib.Error {
    return new Gio.IOErrorEnum({code: Gio.IOErrorEnum.CANCELLED, message: 'Operation was cancelled'});
}

export function isCancelled(error: unknown): boolean {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

export function errorMessage(error: unknown): string {
    if (error instanceof GLib.Error || error instanceof Error)
        return error.message;
    return String(error);
}
