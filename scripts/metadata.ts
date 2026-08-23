import {latest, read} from './changelog.ts';

const metadata = await Bun.file(new URL('../metadata.json', import.meta.url)).json();
const version = latest(await read()).version;

console.log(JSON.stringify({...metadata, 'version-name': version}, null, 2));
