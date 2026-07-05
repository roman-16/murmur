import GLib from 'gi://GLib';

// dotool tiers to try, best first. dotoolc talks to a running dotoold; the
// one-shot dotool opens /dev/uinput itself. Both fail before emitting any input
// when unavailable (dotoolc errors when no daemon reads the pipe; dotool opens
// uinput at startup), so callers can try them in order and fall through safely.
export function dotoolCandidates() {
    const candidates = [];
    const dotoolc = GLib.find_program_in_path('dotoolc');
    if (dotoolc)
        candidates.push({bin: dotoolc, mode: 'daemon'});
    const dotool = GLib.find_program_in_path('dotool');
    if (dotool)
        candidates.push({bin: dotool, mode: 'oneshot'});
    return candidates;
}
