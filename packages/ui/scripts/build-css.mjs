// Writes dist/tokens.css from the compiled token definitions.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { tokensToCss } = require('../dist/index.js');
const out = join(import.meta.dirname, '../dist/tokens.css');
writeFileSync(out, tokensToCss());
console.log(`wrote ${out}`);
