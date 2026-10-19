import Gio from 'gi://Gio';

import {errorMessage} from '../errors.js';
import {INTERFACE_XML, OBJECT_PATH} from '../murmur-bus.js';
import type {Recordings} from './recording.js';

export class MurmurBus {
    readonly #exported: Gio.DBusExportedObject;

    constructor(recordings: Recordings) {
        this.#exported = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML, {
            TranscribeAsync: (
                [path, service]: [string, string], invocation: Gio.DBusMethodInvocation) => {
                recordings.transcribeFile(path, service).then(
                    () => invocation.return_value(null),
                    (error: unknown) => invocation.return_dbus_error(
                        'org.freedesktop.DBus.Error.Failed', errorMessage(error)));
            },
        });
        this.#exported.export(Gio.DBus.session, OBJECT_PATH);
    }

    destroy(): void {
        this.#exported.unexport();
    }
}
