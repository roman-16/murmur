import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {fromAsync, wait, whenCancelled} from '../async.js';
import {errorMessage, isCancelled} from '../errors.js';
import {endpoint, errorText} from './provider.js';

const DICTATION_TIMEOUT_SECONDS = 60;
const HEDGE_SECONDS = 90;
const KEEPALIVE_IDLE_SECONDS = 30;
const KEEPALIVE_INTERVAL_SECONDS = 10;
const LINUX_TCP_KEEPIDLE = 4;
const LINUX_TCP_KEEPINTVL = 5;
const LINUX_TCP_USER_TIMEOUT = 18;
const PIECE_TIMEOUT_SECONDS = 600;
const RETRY_DELAYS_SECONDS = [30, 60, 120];
const UNANSWERED_CONNECTION_SECONDS = 60;

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

type Outcome = {error: unknown} | {reply: Reply};

type Parts = {head: string; tail: string; type: string};

type Payload = {bytes: GLib.Bytes; type: string};

export async function transcribeUpload(upload: Upload): Promise<Answer> {
    const {audio, cancellable} = upload;
    const payload = payloadOf(upload.body, await fromAsync(
        callback => audio.load_contents_async(cancellable, callback),
        result => audio.load_contents_finish(result)[1]));
    for (let attempt = 0; ; attempt++) {
        const reply = await sendHedged(upload, payload);
        if ('answer' in reply)
            return reply.answer;
        const delay = RETRY_DELAYS_SECONDS[attempt];
        if (!reply.retry || delay === undefined)
            throw new Refusal(reply.status, reply.reason);
        await wait(Math.min(reply.retryAfter ?? delay, Math.max(...RETRY_DELAYS_SECONDS)),
            cancellable);
    }
}

export async function transcribeDictation(
    dictation: Omit<Upload, 'audio'> & {audio: Uint8Array}): Promise<Answer> {
    const reply = await send(dictation, payloadOf(dictation.body, dictation.audio),
        DICTATION_TIMEOUT_SECONDS);
    if ('answer' in reply)
        return reply.answer;
    throw new Refusal(reply.status, reply.reason);
}

async function sendHedged(upload: Upload, payload: Payload): Promise<Reply> {
    const requests = new Gio.Cancellable();
    const release = whenCancelled(upload.cancellable, () => requests.cancel());
    const request = {...upload, cancellable: requests};
    try {
        const first = outcomeOf(send(request, payload, PIECE_TIMEOUT_SECONDS));
        const early = await Promise.race([first, wait(HEDGE_SECONDS, requests).then(() => null)]);
        return replyOf(early ?? await firstAnswer([
            first,
            outcomeOf(send(request, payload, PIECE_TIMEOUT_SECONDS)),
        ]));
    } finally {
        release();
        requests.cancel();
    }
}

function outcomeOf(reply: Promise<Reply>): Promise<Outcome> {
    return reply.then(settled => ({reply: settled}), (error: unknown) => ({error}));
}

function firstAnswer(outcomes: Promise<Outcome>[]): Promise<Outcome> {
    return new Promise(resolve => {
        let unsettled = outcomes.length;
        for (const outcome of outcomes) {
            void outcome.then(settled => {
                unsettled--;
                if (answered(settled) || unsettled === 0)
                    resolve(settled);
            });
        }
    });
}

function answered(outcome: Outcome): boolean {
    return 'reply' in outcome && 'answer' in outcome.reply;
}

function replyOf(outcome: Outcome): Reply {
    if ('error' in outcome)
        throw outcome.error;
    return outcome.reply;
}

function payloadOf(body: Body, audio: Uint8Array): Payload {
    const parts = partsOf(body);
    const encoder = new TextEncoder();
    const pieces = [
        encoder.encode(parts.head),
        body.kind === 'form' ? audio : encoder.encode(GLib.base64_encode(audio)),
        encoder.encode(parts.tail),
    ];
    const bytes = new Uint8Array(pieces.reduce((size, piece) => size + piece.length, 0));
    let offset = 0;
    for (const piece of pieces) {
        bytes.set(piece, offset);
        offset += piece.length;
    }
    return {bytes: new GLib.Bytes(bytes), type: parts.type};
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

async function send(
    request: {apiKey: string; cancellable: Gio.Cancellable; url: string}, payload: Payload,
    timeout: number): Promise<Reply> {
    const http = new Soup.Session({timeout});
    const message = Soup.Message.new('POST', endpoint(request.url));
    message.get_request_headers().append('Authorization', `Bearer ${request.apiKey}`);
    message.set_request_body_from_bytes(payload.type, payload.bytes);
    message.connect('network-event', (_message, event, connection) => {
        if (event === Gio.SocketClientEvent.CONNECTED && connection instanceof Gio.SocketConnection)
            giveUpWhenUnanswered(connection.get_socket());
    });

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

function giveUpWhenUnanswered(socket: Gio.Socket): void {
    socket.set_keepalive(true);
    socket.set_option(Gio.SocketProtocol.TCP, LINUX_TCP_KEEPIDLE, KEEPALIVE_IDLE_SECONDS);
    socket.set_option(Gio.SocketProtocol.TCP, LINUX_TCP_KEEPINTVL, KEEPALIVE_INTERVAL_SECONDS);
    socket.set_option(Gio.SocketProtocol.TCP, LINUX_TCP_USER_TIMEOUT,
        UNANSWERED_CONNECTION_SECONDS * 1000);
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
