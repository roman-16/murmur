import {expect, test} from 'bun:test';

import {latest, parse, read, releasable} from './changelog.ts';

const document = (...sections: string[]) =>
    `# Changelog\n\nProse above the first section is not part of any release.\n\n${sections.join('\n\n')}\n`;

const shipped = `## [1.4.0] - 2026-08-19

### Added

- A setting for the thing.

### Fixed

- The thing no longer does the other thing.`;

const rejects = (source: string, message: RegExp) =>
    expect(() => parse('CHANGELOG.md', source)).toThrow(message);

test('reads a release', () => {
    const [release] = parse('CHANGELOG.md', document(shipped)).releases;

    expect(release?.version).toBe('1.4.0');
    expect(release?.date).toBe('2026-08-19');
    expect(release?.yanked).toBe(false);
    expect(release?.changes).toEqual([
        {category: 'Added', entries: ['A setting for the thing.']},
        {category: 'Fixed', entries: ['The thing no longer does the other thing.']},
    ]);
    expect(release?.body).toBe(shipped.split('\n').slice(1).join('\n').trim());
});

test('folds a wrapped entry into one line', () => {
    const [release] = parse('CHANGELOG.md', document(`## [1.4.0] - 2026-08-19

### Added

- A sentence
  broken across lines.`)).releases;

    expect(release?.changes[0]?.entries).toEqual(['A sentence broken across lines.']);
});

test('releases the newest version, and nothing when it is yanked', () => {
    const published = parse('CHANGELOG.md', document(shipped));
    expect(releasable(published)?.version).toBe('1.4.0');

    const withdrawn = parse('CHANGELOG.md', document(`## [1.4.0] - 2026-08-19 [YANKED]

### Fixed

- Never mind.`));
    expect(releasable(withdrawn)).toBeUndefined();
    expect(latest(withdrawn).version).toBe('1.4.0');
});

test('an empty file releases nothing', () => {
    const changelog = parse('CHANGELOG.md', '# Changelog\n');

    expect(changelog.releases).toEqual([]);
    expect(releasable(changelog)).toBeUndefined();
    expect(() => latest(changelog)).toThrow(/carries no version/);
});

test('rejects a file that is not a changelog', () => {
    rejects('# Release notes\n', /must start with "# Changelog"/);
});

test('rejects an [Unreleased] section', () => {
    rejects(document('## [Unreleased]\n\n### Added\n\n- Someday.'), /nowhere to park an entry/);
});

test('rejects a version this project cannot ship', () => {
    rejects(document('## [1.4.0-rc.1] - 2026-08-19\n\n### Added\n\n- A thing.'), /no pre-release/);
    rejects(document('## [1.4] - 2026-08-19\n\n### Added\n\n- A thing.'), /no pre-release/);
});

test('rejects a date that is not a day', () => {
    rejects(document('## [1.4.0] - 2026-02-30\n\n### Added\n\n- A thing.'), /not a day/);
});

test('rejects a category outside the six, or out of order', () => {
    rejects(document('## [1.4.0] - 2026-08-19\n\n### Improved\n\n- A thing.'), /is not one of Added/);
    rejects(
        document('## [1.4.0] - 2026-08-19\n\n### Fixed\n\n- A thing.\n\n### Added\n\n- Another.'),
        /Added in \[1\.4\.0\] belongs above Fixed/);
});

test('rejects a section with nothing in it', () => {
    rejects(document('## [1.4.0] - 2026-08-19\n\n### Added\n\n### Fixed\n\n- A thing.'),
        /Added in \[1\.4\.0\] has no entries/);
    rejects(document('## [1.4.0] - 2026-08-19'), /\[1\.4\.0\] has no entries/);
    rejects(document('## [1.4.0] - 2026-08-19\n\n### Added\n\n- '), /empty entry in \[1\.4\.0\]/);
});

test('rejects an entry outside a category, and a line that is neither', () => {
    rejects(document('## [1.4.0] - 2026-08-19\n\n- A thing.'), /sits outside a category/);
    rejects(document('## [1.4.0] - 2026-08-19\n\n### Added\n\n- A thing.\n\nA paragraph.'),
        /unexpected line in \[1\.4\.0\]/);
});

test('rejects a version that does not follow the one below it', () => {
    const older = '## [1.4.0] - 2026-08-18\n\n### Added\n\n- A thing.';
    const skips = '## [1.6.0] - 2026-08-19\n\n### Added\n\n- Another.';
    const repeats = '## [1.4.0] - 2026-08-19\n\n### Added\n\n- Another.';

    rejects(document(skips, older), /\[1\.6\.0\] does not follow \[1\.4\.0\].*1\.4\.1, 1\.5\.0, 2\.0\.0/);
    rejects(document(repeats, older), /does not follow/);
    rejects(document(older, skips), /does not follow/);
});

test('accepts every step a version may take', () => {
    const releases = [
        '## [2.0.0] - 2026-08-21\n\n### Added\n\n- A thing.',
        '## [1.5.0] - 2026-08-20\n\n### Added\n\n- A thing.',
        '## [1.4.1] - 2026-08-19\n\n### Fixed\n\n- A thing.',
        '## [1.4.0] - 2026-08-18\n\n### Added\n\n- A thing.',
    ];

    expect(parse('CHANGELOG.md', document(...releases)).releases.map(release => release.version))
        .toEqual(['2.0.0', '1.5.0', '1.4.1', '1.4.0']);
});

test('the repository can be released from its own changelog', async () => {
    expect(latest(await read()).version).toMatch(/^\d+\.\d+\.\d+$/);
});
