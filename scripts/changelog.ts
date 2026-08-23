const CATEGORIES = ['Added', 'Changed', 'Deprecated', 'Removed', 'Fixed', 'Security'];
const HEADING = /^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})( \[YANKED\])?$/;
const SOURCE = new URL('../CHANGELOG.md', import.meta.url);
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export type Section = {
    category: string;
    entries: string[];
};

export type Release = {
    body: string;
    changes: Section[];
    date: string;
    heading: number;
    version: string;
    yanked: boolean;
};

export type Changelog = {
    releases: Release[];
};

export function parse(path: string, source: string): Changelog {
    const at = (index: number, message: string) => new Error(`${path}:${index + 1}: ${message}`);
    const lines = source.replaceAll('\r\n', '\n').split('\n');
    if (lines[0] !== '# Changelog')
        throw at(0, 'the file must start with "# Changelog"');

    const releases: Release[] = [];
    let body: string[] = [];
    let bullets = 0;
    let category = -1;
    let categoryAt = 0;
    let current: Release | null = null;

    const endCategory = (release: Release) => {
        if (category >= 0 && bullets === 0)
            throw at(categoryAt, `${CATEGORIES[category]} in [${release.version}] has no entries`);
    };

    const endRelease = () => {
        if (!current)
            return;
        endCategory(current);
        const trimmed = trimBlank(body);
        if (trimmed.length === 0)
            throw at(current.heading, `[${current.version}] has no entries`);
        releases.push({...current, body: trimmed.join('\n')});
        body = [];
        bullets = 0;
        category = -1;
        current = null;
    };

    for (const [index, line] of lines.entries()) {
        if (line.startsWith('## ')) {
            endRelease();
            current = openRelease(line, index, at);
            continue;
        }

        const release = current;
        if (!release)
            continue;

        if (line.startsWith('### ')) {
            const name = line.slice(4);
            const next = CATEGORIES.indexOf(name);
            if (next < 0)
                throw at(index, `"${name}" is not one of ${CATEGORIES.join(', ')}`);
            endCategory(release);
            if (next <= category)
                throw at(index, `${name} in [${release.version}] belongs above ${CATEGORIES[category]}: the order is ${CATEGORIES.join(', ')}`);
            body.push(line);
            bullets = 0;
            category = next;
            categoryAt = index;
            release.changes.push({category: name, entries: []});
        } else if (line.startsWith('- ')) {
            if (category < 0)
                throw at(index, `entry in [${release.version}] sits outside a category`);
            const text = line.slice(2).trim();
            if (!text)
                throw at(index, `empty entry in [${release.version}]`);
            body.push(line);
            bullets++;
            release.changes.at(-1)?.entries.push(text);
        } else if (line.trim() === '') {
            body.push(line);
        } else if (line.startsWith('  ') && bullets > 0) {
            body.push(line);
            const entries = release.changes.at(-1)?.entries ?? [];
            entries[entries.length - 1] += ` ${line.trim()}`;
        } else {
            throw at(index, `unexpected line in [${release.version}]: "${line}"`);
        }
    }
    endRelease();

    for (const [index, older] of releases.entries()) {
        if (index === 0)
            continue;
        const newer = releases[index - 1]!;
        if (!successors(older.version).includes(newer.version))
            throw at(newer.heading, `[${newer.version}] does not follow [${older.version}], which is followed by ${successors(older.version).join(', ')}`);
    }

    return {releases};
}

// A yank withdraws a release, so republishing it is the one thing a rule that
// converges on this file must never do.
export function releasable(changelog: Changelog): Release | undefined {
    const [newest] = changelog.releases;
    return newest?.yanked ? undefined : newest;
}

// The version the tree is at, which is what a build stamps into metadata.json.
export function latest(changelog: Changelog): Release {
    const [newest] = changelog.releases;
    if (!newest)
        throw new Error('CHANGELOG.md carries no version');
    return newest;
}

export async function read(): Promise<Changelog> {
    return parse('CHANGELOG.md', await Bun.file(SOURCE).text());
}

function openRelease(
    line: string, index: number, at: (index: number, message: string) => Error): Release {
    if (line === '## [Unreleased]')
        throw at(index, 'an [Unreleased] section: a section is a release, so there is nowhere to park an entry');

    const match = HEADING.exec(line);
    if (!match)
        throw at(index, `expected "## [X.Y.Z] - YYYY-MM-DD", got "${line}"`);

    const [, version = '', date = '', yanked] = match;
    // extensions.gnome.org allows only letters, digits, spaces and dots in a
    // version name, so a version this file names has to be three numbers.
    if (!VERSION.test(version))
        throw at(index, `[${version}] is not a version this project can ship: three numbers, and no pre-release`);
    if (!isDay(date))
        throw at(index, `[${version}] is dated ${date}, which is not a day`);

    return {body: '', changes: [], date, heading: index, version, yanked: yanked !== undefined};
}

// The versions semantic versioning allows after this one. There are three,
// which is what makes a slip of the finger catchable: 1.30.0 is not one of them,
// and a version once tagged cannot be taken back.
function successors(version: string): string[] {
    const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
    return [`${major}.${minor}.${patch + 1}`, `${major}.${minor + 1}.0`, `${major + 1}.0.0`];
}

function isDay(date: string): boolean {
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date);
}

function trimBlank(lines: string[]): string[] {
    let start = 0;
    let end = lines.length;
    while (start < end && lines[start]?.trim() === '')
        start++;
    while (end > start && lines[end - 1]?.trim() === '')
        end--;
    return lines.slice(start, end);
}

if (import.meta.main) {
    try {
        const target = releasable(await read());
        if (process.argv.includes('--notes')) {
            if (!target)
                throw new Error('CHANGELOG.md declares no version to release');
            console.log(target.body);
        } else if (target) {
            console.log(target.version);
        }
    } catch (error) {
        console.error(`changelog: ${error instanceof Error ? error.message : error}`);
        process.exit(1);
    }
}
