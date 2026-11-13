type Evidence = {line: number | null; path: string};

type Finding = {
    evidence: Evidence[];
    message: string;
    rule_id: string;
    severity: string;
};

type Report = {findings: Finding[]; summary: {input_path: string}};

const EXPECTED: Record<string, string> = {
    'EGO-A-005': 'clipboard access',
};

const [version = ''] = Bun.argv.slice(2);
const report: Report = await Bun.stdin.json();
const {findings, summary} = report;
const expected = findings.filter(finding => Object.hasOwn(EXPECTED, finding.rule_id));
const unexpected = findings.filter(finding => !Object.hasOwn(EXPECTED, finding.rule_id));

function plural(count: number): string {
    return `${count} notice${count === 1 ? '' : 's'}`;
}

function place({line, path}: Evidence): string {
    const within = path.startsWith(summary.input_path)
        ? path.slice(summary.input_path.length + 1)
        : path;
    return line === null ? within : `${within}:${line}`;
}

for (const finding of unexpected) {
    const places = finding.evidence.map(place).join(', ');
    console.error(`${finding.rule_id}  ${finding.severity}  ${places}`);
    console.error(`  ${finding.message}`);
}

if (unexpected.length > 0) {
    console.error(`error: ${plural(unexpected.length)} the site would show above the review`);
    process.exit(1);
}

const named = expected.map(finding => `${finding.rule_id} ${EXPECTED[finding.rule_id]}`);
const known = named.length > 0 ? ` (${[...new Set(named)].join(', ')})` : '';
console.log(`shexli ${version}: ${plural(findings.length)}, ${expected.length} expected${known}`);
