import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {fromAsync} from './async.js';

const DIRECTORY_MODE = 0o700;
const WRITE_FLAGS =
    Gio.FileCreateFlags.PRIVATE | Gio.FileCreateFlags.REPLACE_DESTINATION;

// The shell process is the compositor, so nothing here touches the disk from
// the thread drawing the screen: every call is the asynchronous form, which
// GIO runs on a worker and answers on the main loop.

// Nothing written yet and no file yet are the same answer, so the read asks
// for the contents rather than asking first whether there are any.
export async function readText(file: Gio.File): Promise<string> {
    const contents = await ignoreMissing(fromAsync(
        callback => file.load_contents_async(null, callback),
        result => file.load_contents_finish(result)[1]));
    return contents ? new TextDecoder().decode(contents) : '';
}

// PRIVATE makes the file readable by its owner alone at the moment it is
// created, so there is no instant in which what was said is world readable,
// as a write followed by a chmod would leave.
//
// Nothing to write is written by closing the file straight away: GIO asked to
// write no bytes asserts on the empty buffer and never answers.
export async function writePrivately(file: Gio.File, text: string): Promise<void> {
    const data = new TextEncoder().encode(text);
    if (data.length === 0) {
        const stream = await withDirectory(file, () => fromAsync(
            callback => file.replace_async(
                null, false, WRITE_FLAGS, GLib.PRIORITY_DEFAULT, null, callback),
            result => file.replace_finish(result)));
        await fromAsync(
            callback => stream.close_async(GLib.PRIORITY_DEFAULT, null, callback),
            result => stream.close_finish(result));
        return;
    }

    const bytes = new GLib.Bytes(data);
    await withDirectory(file, () => fromAsync(
        callback => file.replace_contents_bytes_async(
            bytes, null, false, WRITE_FLAGS, null, callback),
        result => file.replace_contents_finish(result)));
}

export async function createPrivately(file: Gio.File): Promise<void> {
    const stream = await withDirectory(file, () => fromAsync(
        callback => file.create_async(
            Gio.FileCreateFlags.PRIVATE, GLib.PRIORITY_DEFAULT, null, callback),
        result => file.create_finish(result)));
    await fromAsync(
        callback => stream.close_async(GLib.PRIORITY_DEFAULT, null, callback),
        result => stream.close_finish(result));
}

export async function deleteFile(file: Gio.File): Promise<void> {
    await ignoreMissing(fromAsync(
        callback => file.delete_async(GLib.PRIORITY_DEFAULT, null, callback),
        result => file.delete_finish(result)));
}

export async function exists(file: Gio.File): Promise<boolean> {
    const info = await ignoreMissing(fromAsync(
        callback => file.query_info_async(Gio.FILE_ATTRIBUTE_STANDARD_TYPE,
            Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, callback),
        result => file.query_info_finish(result)));
    return info !== null;
}

export async function ignoreMissing<T>(operation: Promise<T>): Promise<T | null> {
    try {
        return await operation;
    } catch (error) {
        if (isMissing(error))
            return null;
        throw error;
    }
}

// The directory is there for every write but the first, so it is made when a
// write asks for it rather than looked for before each one.
async function withDirectory<T>(file: Gio.File, operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        const directory = file.get_parent();
        if (!directory || !isMissing(error))
            throw error;
        await makeDirectory(directory);
        return operation();
    }
}

// GIO has no asynchronous form of "make this and every directory above it", so
// a missing level asks for the one above it and the walk unwinds downwards.
// Each level Murmur creates is its own, and the base directory specification
// asks for 0700.
async function makeDirectory(directory: Gio.File): Promise<void> {
    try {
        await fromAsync(
            callback => directory.make_directory_async(GLib.PRIORITY_DEFAULT, null, callback),
            result => directory.make_directory_finish(result));
    } catch (error) {
        if (matches(error, Gio.IOErrorEnum.EXISTS))
            return;
        const parent = directory.get_parent();
        if (!parent || !isMissing(error))
            throw error;
        await makeDirectory(parent);
        await makeDirectory(directory);
        return;
    }

    const mode = new Gio.FileInfo();
    mode.set_attribute_uint32('unix::mode', DIRECTORY_MODE);
    await fromAsync(
        callback => directory.set_attributes_async(
            mode, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, null, callback),
        result => directory.set_attributes_finish(result));
}

function isMissing(error: unknown): boolean {
    return matches(error, Gio.IOErrorEnum.NOT_FOUND);
}

function matches(error: unknown, code: number): boolean {
    return error instanceof GLib.Error && error.matches(Gio.IOErrorEnum, code);
}
