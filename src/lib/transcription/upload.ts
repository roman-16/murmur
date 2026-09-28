import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {fromAsync} from '../async.js';
import {deleteFile} from '../files.js';
import {errorText} from './provider.js';

// How long a service may go without sending or receiving a byte, which covers
// the minutes it may spend transcribing hours of audio before it answers.
const TIMEOUT_SECONDS = 600;

export type Upload = {
    apiKey: string;
    audio: Gio.File;
    cancellable: Gio.Cancellable;
    fields: [string, string][];
    url: string;
};

type Answer = {detail?: unknown; error?: unknown; message?: unknown; text?: unknown};

// A recording goes up as a form with the audio as its last part, which is where
// xAI requires it. The form is assembled in a file of its own and streamed
// from there, so hours of audio never pass through the compositor's memory.
export async function transcribeUpload(upload: Upload): Promise<string> {
    const boundary = `murmur-${GLib.uuid_string_random()}`;
    const [form, stream] = await fromAsync(
        callback => Gio.file_new_tmp_async('murmur-XXXXXX.form', GLib.PRIORITY_DEFAULT,
            upload.cancellable, callback),
        result => Gio.file_new_tmp_finish(result));

    try {
        await writeForm(stream.get_output_stream(), boundary, upload);
        await fromAsync(
            callback => stream.close_async(GLib.PRIORITY_DEFAULT, upload.cancellable, callback),
            result => stream.close_finish(result));
        const size = await fromAsync(
            callback => form.query_info_async(Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, upload.cancellable, callback),
            result => form.query_info_finish(result).get_size());
        const body = await fromAsync(
            callback => form.read_async(GLib.PRIORITY_DEFAULT, upload.cancellable, callback),
            result => form.read_finish(result));
        return await send(upload, `multipart/form-data; boundary=${boundary}`, body, size);
    } finally {
        await deleteFile(form).catch(() => {});
    }
}

async function writeForm(
    output: Gio.OutputStream, boundary: string, upload: Upload): Promise<void> {
    const {audio, cancellable, fields} = upload;
    // OpenAI's endpoint, which OpenRouter's upload follows, knows Ogg by the
    // name .ogg and has never heard of .opus.
    const head = [
        ...fields.map(([name, value]) =>
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="recording.ogg"\r\n`,
        'Content-Type: audio/ogg\r\n\r\n',
    ].join('');

    const tail = `\r\n--${boundary}--\r\n`;

    await append(output, text(head), cancellable);
    await append(output, await fromAsync(
        callback => audio.read_async(GLib.PRIORITY_DEFAULT, cancellable, callback),
        result => audio.read_finish(result)), cancellable);
    await append(output, text(tail), cancellable);
}

function text(value: string): Gio.InputStream {
    return Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(new TextEncoder().encode(value)));
}

// A splice writes all of what it reads, where a single write may take only
// part of what it is handed.
function append(
    output: Gio.OutputStream, source: Gio.InputStream, cancellable: Gio.Cancellable) {
    return fromAsync(
        callback => output.splice_async(source, Gio.OutputStreamSpliceFlags.CLOSE_SOURCE,
            GLib.PRIORITY_DEFAULT, cancellable, callback),
        result => output.splice_finish(result));
}

async function send(
    upload: Upload, contentType: string, body: Gio.InputStream, size: number): Promise<string> {
    const http = new Soup.Session({timeout: TIMEOUT_SECONDS});
    const message = Soup.Message.new('POST', upload.url);
    message.get_request_headers().append('Authorization', `Bearer ${upload.apiKey}`);
    message.set_request_body(contentType, body, size);

    const reply = await fromAsync(
        callback => http.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, upload.cancellable, callback),
        result => http.send_and_read_finish(result));

    const status = message.get_status();
    const answer = parse(reply.get_data());
    if (status < 200 || status >= 300) {
        const reason = answer?.error ?? answer?.message ?? answer?.detail;
        throw new Error(reason === undefined
            ? `the service answered ${status}`
            : errorText(reason as {message?: string} | string));
    }
    if (typeof answer?.text !== 'string')
        throw new Error('the service sent no transcription');
    return answer.text;
}

function parse(data: Uint8Array | null): Answer | null {
    if (!data)
        return null;
    try {
        return JSON.parse(new TextDecoder().decode(data)) as Answer;
    } catch {
        return null;
    }
}
