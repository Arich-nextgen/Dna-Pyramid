import assert from 'node:assert/strict';
import { readUtf8TextFile } from '../src/textImport.ts';

const file = (name, bytes) => new File([bytes], name, { type: 'text/plain' });

const utf8 = await readUtf8TextFile(file('ru-kz.txt', new TextEncoder().encode('Взнос 5 000 ₸, жарна 5 000 теңге.')));
assert.equal(utf8, 'Взнос 5 000 ₸, жарна 5 000 теңге.');
const bom = await readUtf8TextFile(file('bom.txt', new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Сәлем')])));
assert.equal(bom, 'Сәлем');
await assert.rejects(() => readUtf8TextFile(file('bad.txt', new Uint8Array([0xc3, 0x28]))), /UTF-8/);
await assert.rejects(() => readUtf8TextFile(file('wrong.csv', new TextEncoder().encode('text'))), /\.txt/);
await assert.rejects(() => readUtf8TextFile(file('large.txt', new Uint8Array(100_001))), /100 КБ/);
await assert.rejects(() => readUtf8TextFile(file('long.txt', new TextEncoder().encode('я'.repeat(10_001)))), /10 000 символов/);
await assert.rejects(() => readUtf8TextFile(file('binary.txt', new Uint8Array([65, 0, 66]))), /нулевые байты/);
console.log('TXT import checks: UTF-8, UTF-8 BOM, RU/KZ, unsupported encoding, extension, byte/character limits and binary input passed.');
