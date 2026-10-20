import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {fromAsync, wait} from '../async.js';
import {errorMessage, isCancelled} from '../errors.js';
import {deleteFile} from '../files.js';
import {errorText} from './provider.js';

const BASE64_CHUNK_BYTES = 3 * 16384;
const DICTATION_TIMEOUT_SECONDS = 60;
const RETRY_DELAYS_SECONDS = [30, 60, 120];
// How long a service may go without sending or receiving a byte, which covers
// the time a slow model may spend on a piece before it answers.
const TIMEOUT_SECONDS = 600;

export type AudioFormat = 'ogg' | 'wav';

export type Body =
    | {fields: [string, string][]; format: AudioFormat; kind: 'form'}
    | {fields: Record<string, unknown>; format: AudioFormat; kind: 'json'};

export type Upload = {
    apiKey: string;
    audio: Gio.File;
    body: Body;
    cancellable: Gio.Cancellable;
    url: string;
};

export type Answer = Record<string, unknown>;

export class Refusal extends Error {
    readonly status: number;

    constructor(status: number, reason: string) {
        super(reason);
        this.status = status;
    }
}

type Reply = {answer: Answer} | {reason: string; retry: boolean; retryAfter: number | null; status: number};

type Parts = {head: string; tail: string; type: string};

// The body is assembled in a file of its own and streamed from there, so hours
// of audio never pass through the compositor's memory.
export async function transcribeUpload(upload: Upload): Promise<Answer> {
    const {body, cancellable} = upload;
    const parts = partsOf(body);
    const [file, stream] = await fromAsync(
        callback => Gio.file_new_tmp_async('murmur-XXXXXX.upload', GLib.PRIORITY_DEFAULT,
            cancellable, callback),
        result => Gio.file_new_tmp_finish(result));

    try {
        const output = stream.get_output_stream();
        await append(output, text(parts.head), cancellable);
        if (body.kind === 'form')
            await append(output, await readStream(upload.audio, cancellable), cancellable);
        else
            await appendBase64(output, upload.audio, cancellable);
        await append(output, text(parts.tail), cancellable);
        await fromAsync(
            callback => stream.close_async(GLib.PRIORITY_DEFAULT, cancellable, callback),
            result => stream.close_finish(result));
        const size = await fromAsync(
            callback => file.query_info_async(Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, callback),
            result => file.query_info_finish(result).get_size());
        for (let attempt = 0; ; attempt++) {
            const reply = await send(upload, parts.type, {
                size, stream: await readStream(file, cancellable),
            }, TIMEOUT_SECONDS);
            if ('answer' in reply)
                return reply.answer;
            const delay = RETRY_DELAYS_SECONDS[attempt];
            if (!reply.retry || delay === undefined)
                throw new Refusal(reply.status, reply.reason);
            await wait(Math.min(reply.retryAfter ?? delay, Math.max(...RETRY_DELAYS_SECONDS)),
                cancellable);
        }
    } finally {
        await deleteFile(file).catch(() => {});
    }
}

// A dictation is held in memory and sent from there in one attempt: it is never
// written to disk, and someone waiting at a text field is not kept waiting
// through a retry.
export async function transcribeDictation(
    dictation: Omit<Upload, 'audio'> & {audio: Uint8Array}): Promise<Answer> {
    const {audio, body} = dictation;
    const parts = partsOf(body);
    const encoder = new TextEncoder();
    const payload = [
        encoder.encode(parts.head),
        body.kind === 'form' ? audio : encoder.encode(GLib.base64_encode(audio)),
        encoder.encode(parts.tail),
    ];
    const bytes = new Uint8Array(payload.reduce((size, part) => size + part.length, 0));
    let offset = 0;
    for (const part of payload) {
        bytes.set(part, offset);
        offset += part.length;
    }
    const reply = await send(dictation, parts.type, {bytes}, DICTATION_TIMEOUT_SECONDS);
    if ('answer' in reply)
        return reply.answer;
    throw new Refusal(reply.status, reply.reason);
}

// A form carries the audio as its last part, which is where xAI requires it.
// OpenAI's endpoint, which OpenRouter's follows, knows Ogg by the name .ogg and
// has never heard of .opus.
function partsOf(body: Body): Parts {
    if (body.kind === 'json') {
        const fields = JSON.stringify(body.fields).slice(1, -1);
        return {
            head: `{${fields}${fields ? ',' : ''}"input_audio":{"format":"${body.format}","data":"`,
            tail: '"}}',
            type: 'application/json',
        };
    }
    const boundary = `murmur-${GLib.uuid_string_random()}`;
    return {
        head: [
            ...body.fields.map(([name, value]) =>
                `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`),
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${body.format}"\r\n`,
            `Content-Type: audio/${body.format}\r\n\r\n`,
        ].join(''),
        tail: `\r\n--${boundary}--\r\n`,
        type: `multipart/form-data; boundary=${boundary}`,
    };
}

function text(value: string): Gio.InputStream {
    return Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(new TextEncoder().encode(value)));
}

function readStream(file: Gio.File, cancellable: Gio.Cancellable): Promise<Gio.FileInputStream> {
    return fromAsync(
        callback => file.read_async(GLib.PRIORITY_DEFAULT, cancellable, callback),
        result => file.read_finish(result));
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

async function appendBase64(
    output: Gio.OutputStream, audio: Gio.File, cancellable: Gio.Cancellable): Promise<void> {
    const input = await readStream(audio, cancellable);
    let carried = new Uint8Array(0);
    try {
        for (;;) {
            const read = await fromAsync(
                callback => input.read_bytes_async(BASE64_CHUNK_BYTES, GLib.PRIORITY_DEFAULT,
                    cancellable, callback),
                result => input.read_bytes_finish(result));
            const data = read.get_data() ?? new Uint8Array(0);
            if (data.length === 0)
                break;
            const joined = new Uint8Array(carried.length + data.length);
            joined.set(carried);
            joined.set(data, carried.length);
            const whole = joined.length - (joined.length % 3);
            if (whole > 0)
                await append(output, text(GLib.base64_encode(joined.subarray(0, whole))), cancellable);
            carried = joined.slice(whole);
        }
        if (carried.length > 0)
            await append(output, text(GLib.base64_encode(carried)), cancellable);
    } finally {
        await fromAsync(
            callback => input.close_async(GLib.PRIORITY_DEFAULT, null, callback),
            result => input.close_finish(result)).catch(() => {});
    }
}

async function send(
    request: {apiKey: string; cancellable: Gio.Cancellable; url: string}, contentType: string,
    body: {bytes: Uint8Array} | {size: number; stream: Gio.InputStream},
    timeout: number): Promise<Reply> {
    const http = new Soup.Session({timeout});
    const message = Soup.Message.new('POST', request.url);
    message.get_request_headers().append('Authorization', `Bearer ${request.apiKey}`);
    if ('bytes' in body)
        message.set_request_body_from_bytes(contentType, new GLib.Bytes(body.bytes));
    else
        message.set_request_body(contentType, body.stream, body.size);

    let data: GLib.Bytes;
    try {
        data = await fromAsync(
            callback => http.send_and_read_async(
                message, GLib.PRIORITY_DEFAULT, request.cancellable, callback),
            result => http.send_and_read_finish(result));
    } catch (error) {
        if (isCancelled(error))
            throw error;
        return {reason: errorMessage(error), retry: true, retryAfter: null, status: 0};
    }

    const status = message.status_code;
    const answer = parse(data.get_data());
    if (status < 200 || status >= 300) {
        const reason = answer?.error ?? answer?.message ?? answer?.detail;
        return {
            reason: reason === undefined
                ? `the service answered ${status}`
                : errorText(reason as {message?: string} | string),
            retry: status === 429 || status >= 500,
            retryAfter: retryAfter(message),
            status,
        };
    }
    if (!answer)
        throw new Error('the service sent no transcription');
    return {answer};
}

export function textOf(answer: Answer): string {
    if (typeof answer.text !== 'string')
        throw new Error('the service sent no transcription');
    return answer.text;
}

export function listOf(answer: Answer, key: string): Record<string, unknown>[] {
    const list = answer[key];
    return Array.isArray(list)
        ? list.filter((item): item is Record<string, unknown> =>
            typeof item === 'object' && item !== null)
        : [];
}

function retryAfter(message: Soup.Message): number | null {
    const header = message.get_response_headers().get_one('Retry-After');
    const seconds = header === null ? NaN : Number(header);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

function parse(data: Uint8Array | null): Answer | null {
    if (!data)
        return null;
    try {
        const answer: unknown = JSON.parse(new TextDecoder().decode(data));
        return typeof answer === 'object' && answer !== null ? answer as Answer : null;
    } catch {
        return null;
    }
}
