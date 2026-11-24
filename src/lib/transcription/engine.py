import sys

if sys.version_info < (3, 9):
    print('{"error": "Needs Python 3.9 or later"}', flush=True)
    sys.exit(1)

import array
import ctypes
import errno
import fcntl
import hashlib
import inspect
import json
import os
import platform
import queue
import re
import shutil
import signal
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import wave
import zipfile

CHUNK_BYTES = 1 << 20
FAMILY_SLOTS = ('run', 'stream')
GRAPHICS = ('gpu', 'igpu')
INTEGERS = {
    ctypes.c_byte, ctypes.c_int, ctypes.c_int16, ctypes.c_int32, ctypes.c_int64, ctypes.c_long,
    ctypes.c_longlong, ctypes.c_short, ctypes.c_size_t, ctypes.c_ubyte, ctypes.c_uint,
    ctypes.c_uint16, ctypes.c_uint32, ctypes.c_uint64, ctypes.c_ulong, ctypes.c_ulonglong,
    ctypes.c_ushort,
}
LONGEST_STRETCH_MS = 30000
PAUSE_MS = 1000
PINS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'engine.json')
PROGRESS_SECONDS = 0.25
SAMPLE_RATE = 16000
SPEAKER_PRESET = 'very_high_latency'


class Refusal(Exception):
    pass


def say(**fields):
    print(json.dumps(fields), flush=True)


def pins():
    with open(PINS, encoding='utf-8') as file:
        return json.load(file)


def wanted(pinned):
    machine = platform.machine()
    files = [file for file in pinned['files'] if file.get('machine', machine) == machine]
    if not any('machine' in file for file in files):
        raise Refusal(f"The engine isn't made for {machine} computers")
    return files


def file_for(directory, purpose):
    name = next(file['name'] for file in pins()['files'] if file['purpose'] == purpose)
    return os.path.join(directory, 'files', name)


def siblings(directory):
    root = os.path.dirname(directory)
    try:
        names = os.listdir(root)
    except FileNotFoundError:
        return []
    places = (os.path.join(root, name) for name in names)
    return [place for place in places if place != directory and os.path.isdir(place)]


def found(directory, file):
    for place in [directory, *siblings(directory)]:
        path = os.path.join(place, 'files', file['name'])
        if os.path.isfile(path) and os.path.getsize(path) == file['size']:
            return path
    return None


def ready(directory):
    return os.path.exists(os.path.join(directory, 'ready'))


def host_of(url):
    return urllib.parse.urlparse(url).hostname


def plan(request):
    directory = request['engine']
    if ready(directory):
        return {'bytes': 0, 'hosts': []}
    missing = [file for file in wanted(pins()) if found(directory, file) is None]
    return {
        'bytes': sum(file['size'] for file in missing),
        'hosts': sorted({host_of(file['url']) for file in missing}),
    }


class Progress:
    def __init__(self, total):
        self.done = 0
        self.shown = 0.0
        self.total = total

    def add(self, count):
        self.done += count
        now = time.monotonic()
        if now - self.shown >= PROGRESS_SECONDS or self.done == self.total:
            self.shown = now
            say(progress={'done': self.done, 'total': self.total})


def install(request):
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    directory = request['engine']
    files = os.path.join(directory, 'files')
    os.makedirs(files, mode=0o700, exist_ok=True)
    with open(os.path.join(os.path.dirname(directory), 'install.lock'), 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if ready(directory):
            return {}
        for name in os.listdir(files):
            if name.endswith('.part'):
                os.remove(os.path.join(files, name))
        pinned = pins()
        needed = wanted(pinned)
        fetched = []
        for file in needed:
            source = found(directory, file)
            target = os.path.join(files, file['name'])
            if source is None:
                fetched.append(file)
            elif source != target:
                os.replace(source, target)
        progress = Progress(sum(file['size'] for file in fetched))
        for file in fetched:
            download(file, os.path.join(files, file['name']), progress)
        unpack(directory, [file for file in needed if file['name'].endswith('.whl')])
        with open(os.path.join(directory, 'ready'), 'w', encoding='utf-8') as marker:
            marker.write(pinned['version'])
        for sibling in siblings(directory):
            shutil.rmtree(sibling, ignore_errors=True)
    return {}


def download(file, target, progress):
    part = f'{target}.part'
    host = host_of(file['url'])
    digest = hashlib.sha256()
    request = urllib.request.Request(file['url'], headers={'User-Agent': 'Murmur'})
    complete = False
    try:
        with urllib.request.urlopen(request, timeout=30) as response, open(part, 'wb') as out:
            while True:
                chunk = response.read(CHUNK_BYTES)
                if not chunk:
                    break
                out.write(chunk)
                digest.update(chunk)
                progress.add(len(chunk))
        complete = True
    except urllib.error.HTTPError as error:
        raise Refusal(f'{host} answered {error.code}') from error
    except (urllib.error.URLError, ConnectionError, TimeoutError) as error:
        raise Refusal(f"Couldn't reach {host}") from error
    except OSError as error:
        if error.errno == errno.ENOSPC:
            raise Refusal("Couldn't save: the disk is full") from error
        raise
    finally:
        if not complete and os.path.exists(part):
            os.remove(part)
    if digest.hexdigest() != file['sha256']:
        os.remove(part)
        raise Refusal(f'The download from {host} was damaged')
    os.replace(part, target)


def unpack(directory, wheels):
    site = os.path.join(directory, 'site')
    fresh = f'{site}.partial'
    shutil.rmtree(fresh, ignore_errors=True)
    for wheel in wheels:
        with zipfile.ZipFile(os.path.join(directory, 'files', wheel['name'])) as archive:
            archive.extractall(fresh)
    shutil.rmtree(site, ignore_errors=True)
    os.replace(fresh, site)
    for wheel in wheels:
        os.remove(os.path.join(directory, 'files', wheel['name']))


def engine(directory):
    site = os.path.join(directory, 'site')
    if os.path.isdir(site):
        sys.path.insert(0, site)
    try:
        import transcribe_cpp
    except Exception as error:
        raise Refusal(f"The engine doesn't run here: {error}") from error
    transcribe_cpp.set_log_callback(None)
    return transcribe_cpp


def status(request):
    transcribe = engine(request['engine'])
    graphics = next(
        (device for device in transcribe.backends() if device.device_type in GRAPHICS), None)
    return {
        'device': graphics.description if graphics else None,
        'version': transcribe.__version__,
    }


def reason(error):
    text = re.sub(r'\s*\(status \d+\)$', '', str(error))
    return text.rsplit(': ', 1)[-1]


def load(transcribe, path, backend='auto'):
    name = os.path.basename(path)
    if not os.path.isfile(path):
        raise Refusal(f'{path} is gone')
    try:
        model = transcribe.Model(path, backend=backend)
    except (transcribe.OutOfMemory, transcribe.BackendError):
        if backend == 'cpu':
            raise
        return load(transcribe, path, 'cpu')
    except transcribe.TranscribeError as error:
        raise Refusal(f"{name} isn't a speech model the engine can run") from error
    if transcribe.Role.ASR not in model.roles:
        model.close()
        raise Refusal(f"{name} isn't a speech model the engine can run")
    return model


def on_processor(model):
    return model.device.device_type not in GRAPHICS


def device_of(model):
    return None if on_processor(model) else model.device.description


def subclasses(cls):
    for subclass in cls.__subclasses__():
        yield subclass
        yield from subclasses(subclass)


def families(transcribe, model):
    accepted = []
    for family in subclasses(transcribe.FamilyExtension):
        if family._slot not in FAMILY_SLOTS:
            continue
        try:
            if model.accepts(family()):
                accepted.append(family)
        except transcribe.TranscribeError:
            continue
    return accepted


def kind_of(ctype):
    if ctype is ctypes.c_bool:
        return 'switch'
    if ctype in (ctypes.c_double, ctypes.c_float):
        return 'number'
    if ctype is ctypes.c_char_p:
        return 'text'
    if ctype in INTEGERS:
        return 'integer'
    return None


def plain(value, kind):
    if kind == 'text':
        return value.decode('utf-8', 'replace') if value else ''
    if kind == 'number':
        return float(f'{value:.6g}')
    return value


def fields_of(family):
    built = family()._build()
    types = dict(built._fields_)
    for name, parameter in inspect.signature(family.__init__).parameters.items():
        kind = kind_of(types.get(name))
        if parameter.kind is inspect.Parameter.KEYWORD_ONLY and kind:
            yield name, kind, plain(getattr(built, name), kind)


def setting(name, kind, default, live=False, choices=None):
    described = {'default': default, 'kind': kind, 'live': live, 'name': name}
    if choices is not None:
        described['choices'] = choices
    return described


def settings_of(transcribe, model):
    capabilities = model.capabilities
    described = []
    if len(capabilities.languages) > 1:
        described.append(setting('language', 'choice', '', choices=list(capabilities.languages)))
    if capabilities.supports_streaming:
        described.append(setting('live', 'switch', True))
        described.append(setting('settle', 'switch', False, live=True))
    for name in ('pnc', 'itn'):
        if model.supports(name):
            described.append(setting(name, 'choice', '', choices=['on', 'off']))
    for family in families(transcribe, model):
        for name, kind, default in fields_of(family):
            described.append(
                setting(f'{family.__name__}.{name}', kind, default, live=family._slot == 'stream'))
    return described


def coerced(value, kind):
    if kind == 'switch':
        return bool(value)
    if kind == 'integer':
        return int(value)
    if kind == 'number':
        return float(value)
    return str(value)


class Options:
    def __init__(self, transcribe, model, settings, terms):
        shared = {}
        language = settings.get('language')
        if isinstance(language, str) and language:
            shared['language'] = language
        for name in ('pnc', 'itn'):
            if settings.get(name) in ('on', 'off') and model.supports(name):
                shared[name] = settings[name]
        if terms and model.supports('vocabulary'):
            shared['vocabulary'] = list(terms)
        elif terms and model.supports('context_prompt'):
            shared['prompt'] = ', '.join(terms)
        self.run = dict(shared)
        self.stream = dict(shared)
        for family in families(transcribe, model):
            values = {
                name: coerced(settings[f'{family.__name__}.{name}'], kind)
                for name, kind, _ in fields_of(family)
                if f'{family.__name__}.{name}' in settings
            }
            if values:
                getattr(self, family._slot)['family'] = family(**values)
        self.settle = bool(settings.get('settle', False))
        if self.settle:
            self.stream['commit_policy'] = 'stable_prefix'
        self.streams = model.capabilities.supports_streaming and settings.get('live', True) is not False


def check(transcribe, model, options):
    silence = array.array('f', bytes(4 * SAMPLE_RATE))
    try:
        with model.session() as session:
            session.run(silence, timestamps='none', **options.run)
            if options.streams:
                with session.stream(**options.stream) as stream:
                    stream.feed(silence)
                    stream.finalize()
    except transcribe.TranscribeError as error:
        raise Refusal(f'The model refused it: {reason(error)}') from error


def describe(request):
    transcribe = engine(request['engine'])
    with load(transcribe, request['model']) as model:
        capabilities = model.capabilities
        options = Options(transcribe, model, request.get('settings', {}), request.get('terms', []))
        try:
            check(transcribe, model, options)
            problem = None
        except Refusal as refusal:
            problem = str(refusal)
        return {
            'device': device_of(model),
            'languages': list(capabilities.languages),
            'problem': problem,
            'settings': settings_of(transcribe, model),
            'streams': capabilities.supports_streaming,
            'terms': model.supports('vocabulary') or model.supports('context_prompt'),
        }


def probe(request):
    transcribe = engine(request['engine'])
    with load(transcribe, request['model']) as model:
        check(transcribe, model, Options(
            transcribe, model, request.get('settings', {}), request.get('terms', [])))
    return {}


def samples_of(data):
    samples = array.array('h')
    samples.frombytes(data)
    if sys.byteorder == 'big':
        samples.byteswap()
    return array.array('f', [sample / 32768 for sample in samples])


class Microphone:
    def __init__(self):
        self.heard = array.array('f')
        self.queue = queue.Queue()
        threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        rest = b''
        while True:
            data = sys.stdin.buffer.read1(CHUNK_BYTES)
            if not data:
                break
            data = rest + data
            whole = len(data) - len(data) % 2
            rest = data[whole:]
            self.queue.put(samples_of(data[:whole]))
        self.queue.put(None)

    def chunks(self):
        while True:
            chunk = self.queue.get()
            if chunk is None:
                self.queue.put(None)
                return
            self.heard.extend(chunk)
            yield chunk

    def everything(self):
        for _ in self.chunks():
            pass
        return self.heard


def speech_in(transcribe, directory, pcm, longest_ms):
    with transcribe.Model(file_for(directory, 'speech'), backend='cpu') as model:
        with transcribe.VadSession(model) as session:
            found_speech = session.run(pcm, max_speech_ms=longest_ms).segments
    return [(segment.start_sample, segment.end_sample) for segment in found_speech]


def speaker_turns(transcribe, directory, pcm, backend='auto'):
    try:
        with transcribe.Model(file_for(directory, 'speakers'), backend=backend) as model:
            options = transcribe.SortformerDiarizeOptions(preset=SPEAKER_PRESET)
            family = options if model.accepts(options) else None
            with transcribe.DiarizeSession(model) as session:
                turns = session.run(pcm, family=family)
    except (transcribe.OutOfMemory, transcribe.BackendError):
        if backend == 'cpu':
            raise
        return speaker_turns(transcribe, directory, pcm, 'cpu')
    per_ms = SAMPLE_RATE // 1000
    return sorted(
        (turn.t0_ms * per_ms, turn.t1_ms * per_ms, str(turn.speaker_id))
        for turn in turns if turn.t1_ms > turn.t0_ms)


def speaker_at(start, end, turns):
    if not turns:
        return None
    overlaps = [(min(end, turn_end) - max(start, turn_start), speaker)
                for turn_start, turn_end, speaker in turns]
    overlap, speaker = max(overlaps, key=lambda pair: pair[0])
    if overlap > 0:
        return speaker
    middle = (start + end) / 2
    nearest = min(turns, key=lambda turn: min(abs(middle - turn[0]), abs(middle - turn[1])))
    return nearest[2]


def spans_of(stretches, turns, longest):
    pieces = []
    for start, end in stretches:
        cuts = sorted({start, end, *(edge for turn in turns for edge in turn[:2] if start < edge < end)})
        pieces.extend((first, last, speaker_at(first, last, turns))
                      for first, last in zip(cuts, cuts[1:]))
    pause = PAUSE_MS * SAMPLE_RATE // 1000
    spans = []
    for start, end, speaker in pieces:
        previous = spans[-1] if spans else None
        if (previous and previous[2] == speaker and start - previous[1] < pause and
                end - previous[0] <= longest):
            spans[-1] = (previous[0], end, speaker)
        else:
            spans.append((start, end, speaker))
    return spans


def words_from(timed, text, start, end, speaker, turns):
    per_ms = SAMPLE_RATE / 1000
    if not timed:
        text = text.strip()
        return [{'end': end / SAMPLE_RATE, 'speaker': speaker, 'start': start / SAMPLE_RATE,
                 'text': text}] if text else []
    words = []
    for said, first_ms, last_ms in timed:
        first = start + first_ms * per_ms
        last = start + last_ms * per_ms
        words.append({
            'end': last / SAMPLE_RATE,
            'speaker': speaker_at(first, last, turns) if turns else speaker,
            'start': first / SAMPLE_RATE,
            'text': said.strip(),
        })
    return [word for word in words if word['text']]


def timestamps_for(model):
    kind = model.capabilities.max_timestamp_kind
    if kind in ('token', 'word'):
        return 'word'
    return 'segment' if kind == 'segment' else 'none'


def result_of(transcribe, session, pcm, options, timestamps):
    try:
        return session.run(pcm, timestamps=timestamps, **options.run)
    except transcribe.OutputTruncated as error:
        return error.partial_result


def recorded(transcribe, directory, model, options, pcm, speakers):
    longest = min(LONGEST_STRETCH_MS, model.capabilities.max_audio_ms or LONGEST_STRETCH_MS)
    stretches = speech_in(transcribe, directory, pcm, longest)
    turns = speaker_turns(transcribe, directory, pcm) if speakers and stretches else []
    timestamps = timestamps_for(model)
    words = []
    with model.session() as session:
        for start, end, speaker in spans_of(stretches, turns, longest * SAMPLE_RATE // 1000):
            try:
                result = result_of(transcribe, session, pcm[start:end], options, timestamps)
            except transcribe.InputTooShort:
                continue
            timed = [(word.text, word.t0_ms, word.t1_ms) for word in result.words if word.t1_ms > 0]
            timed = timed or [(segment.text, segment.t0_ms, segment.t1_ms)
                              for segment in result.segments if segment.t1_ms > 0]
            words.extend(words_from(timed, result.text, start, end, speaker, turns))
    return words


def read_wave(path):
    with wave.open(path, 'rb') as audio:
        if audio.getframerate() != SAMPLE_RATE or audio.getnchannels() != 1 or audio.getsampwidth() != 2:
            raise Refusal(f'{os.path.basename(path)} is not 16 kHz mono')
        return samples_of(audio.readframes(audio.getnframes()))


def recording(request):
    directory = request['engine']
    transcribe = engine(directory)
    pcm = read_wave(request['audio'])
    settings = request.get('settings', {})
    terms = request.get('terms', [])
    model = load(transcribe, request['model'])
    try:
        try:
            options = Options(transcribe, model, settings, terms)
            words = recorded(transcribe, directory, model, options, pcm, request.get('speakers', False))
        except (transcribe.OutOfMemory, transcribe.BackendError):
            if on_processor(model):
                raise
            model.close()
            model = load(transcribe, request['model'], 'cpu')
            options = Options(transcribe, model, settings, terms)
            words = recorded(transcribe, directory, model, options, pcm, request.get('speakers', False))
    finally:
        model.close()
    return {'words': words}


def streamed(model, options, microphone):
    shown = ''
    with model.session() as session, session.stream(**options.stream) as stream:
        for chunk in microphone.chunks():
            update = stream.feed(chunk)
            if not (update.result_changed or update.committed_changed or update.tentative_changed):
                continue
            text = stream.text()
            partial = (text.committed if options.settle else text.display).strip()
            if partial != shown:
                shown = partial
                say(partial=partial)
        stream.finalize()
        return stream.text().display.strip()


def whole(transcribe, directory, model, options, pcm):
    if not pcm:
        return ''
    stretches = [(0, len(pcm))]
    longest = model.capabilities.max_audio_ms
    if longest and len(pcm) * 1000 // SAMPLE_RATE > longest:
        stretches = speech_in(transcribe, directory, pcm, longest)
    with model.session() as session:
        texts = [result_of(transcribe, session, pcm[start:end], options, 'none').text.strip()
                 for start, end in stretches]
    return ' '.join(text for text in texts if text)


def dictation(request):
    microphone = Microphone()
    directory = request['engine']
    transcribe = engine(directory)
    settings = request.get('settings', {})
    terms = request.get('terms', [])
    model = load(transcribe, request['model'])
    try:
        options = Options(transcribe, model, settings, terms)
        try:
            if options.streams:
                text = streamed(model, options, microphone)
            else:
                text = whole(transcribe, directory, model, options, microphone.everything())
        except (transcribe.OutOfMemory, transcribe.BackendError):
            if on_processor(model):
                raise
            model.close()
            model = load(transcribe, request['model'], 'cpu')
            options = Options(transcribe, model, settings, terms)
            text = whole(transcribe, directory, model, options, microphone.everything())
    finally:
        model.close()
    return {'text': text}


def transcribe_audio(request):
    return recording(request) if request.get('mode') == 'recording' else dictation(request)


COMMANDS = {
    'describe': describe,
    'install': install,
    'plan': plan,
    'probe': probe,
    'status': status,
    'transcribe': transcribe_audio,
}


def main():
    command = sys.argv[1] if len(sys.argv) > 1 else ''
    if command not in COMMANDS:
        say(error=f'No command is named {command}')
        return 1
    try:
        result = COMMANDS[command](json.loads(sys.argv[2]) if len(sys.argv) > 2 else {})
    except Refusal as refusal:
        say(error=str(refusal))
        return 1
    except Exception as error:
        name = type(error).__module__
        say(error=f'The engine failed: {reason(error)}' if name.startswith('transcribe_cpp')
            else f'{type(error).__name__}: {error}')
        return 1
    say(result=result)
    return 0


if __name__ == '__main__':
    sys.exit(main())
