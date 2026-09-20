// The golden schema is loaded via createRequire at runtime, so tsc does not
// emit it. Copy it into dist as part of every build.
import { cp, mkdir } from 'node:fs/promises';

await mkdir('dist/schemas', { recursive: true });
await cp('src/schemas/record.schema.json', 'dist/schemas/record.schema.json');
console.log('assets copied to dist/schemas');
