// A running time as a clock shows it: 4:07 under an hour, 1:04:07 past one.
export function clock(seconds: number): string {
    const minutes = Math.floor(seconds / 60);
    const tail = String(seconds % 60).padStart(2, '0');
    if (minutes < 60)
        return `${minutes}:${tail}`;
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${tail}`;
}

// A length as a sentence says it: 42 s, 7 min, 1 h 12 min.
export function duration(seconds: number): string {
    if (seconds < 60)
        return `${seconds} s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60)
        return `${minutes} min`;
    const rest = minutes % 60;
    return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${Math.floor(minutes / 60)} h`;
}
