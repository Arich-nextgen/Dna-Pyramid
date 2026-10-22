#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createWorker, OEM, PSM } from '../frontend/node_modules/tesseract.js/src/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(root, 'tests', 'ocr_fixtures');
const langPath = path.join(root, 'frontend', 'public', 'ocr', 'lang');
const expected = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'expected.json'), 'utf8'));
const initializationStarted = performance.now();
const worker = await createWorker(['rus', 'kaz'], OEM.LSTM_ONLY, { langPath, gzip: false, cacheMethod: 'none' });
const kazWorker = await createWorker(['kaz'], OEM.LSTM_ONLY, { langPath, gzip: false, cacheMethod: 'none' });
await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '300' });
await kazWorker.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1', user_defined_dpi: '300' });
const initializationSeconds = (performance.now() - initializationStarted) / 1000;
const results = [];
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'pdna-ocr-'));
function quality(text, confidence) {
  const tokens = text.match(/\S+/gu) || [];
  const words = tokens.filter((token) => /^[\p{L}][\p{L}'’\-]{1,}$/u.test(token));
  const vowels = words.filter((token) => /[аеёиоуыэюяәғқңөұүһіaeiouy]/iu.test(token));
  const mixed = tokens.filter((token) => /(?=.*\p{L})(?=.*\d)/u.test(token)).length;
  return confidence / 100 * .56 + vowels.length / Math.max(1, tokens.length) * .38 + (text.replace(/\s/g, '').length > 16 ? .06 : 0) - mixed / Math.max(1, tokens.length) * .25;
}
function kazakhStrength(text) {
  return (text.match(/[әғқңөұүһі]/giu) || []).length * 2 + (text.match(/\b(?:жарна|тенге|теңге|күн|кун|адам|шақыр|арқылы|ақша|ұсыныс)/giu) || []).length;
}
for (const item of expected) {
  const input = path.join(fixtureDir, `${item.id}.${item.exif_orientation ? 'jpg' : 'png'}`);
  const started = performance.now();
  const raw = await worker.recognize(input);
  let best = { text: raw.data.text.trim(), confidence: raw.data.confidence, rotation: 0, preprocessing: 'raw', input };
  const variants = item.rotation_degrees ? [90, 180, 270] : item.exif_orientation ? [90] : item.theme === 'dark' ? [0] : [];
  for (const rotation of variants) {
    const candidate = path.join(temporary, `${item.id}-${rotation}.png`);
    const conversion = item.theme === 'dark' ? ['-negate'] : ['-rotate', String(rotation)];
    execFileSync('convert', [input, ...conversion, candidate]);
    const recognized = await worker.recognize(candidate);
    const option = { text: recognized.data.text.trim(), confidence: recognized.data.confidence, rotation, preprocessing: item.theme === 'dark' ? 'dark-inversion' : item.exif_orientation ? 'exif-orientation' : 'rotation', input: candidate };
    if (quality(option.text, option.confidence) > quality(best.text, best.confidence)) best = option;
  }
  if (kazakhStrength(best.text) >= 3) {
    const kaz = await kazWorker.recognize(best.input);
    const option = { text: kaz.data.text.trim(), confidence: kaz.data.confidence };
    if (quality(option.text, option.confidence) >= quality(best.text, best.confidence) - .03 && kazakhStrength(option.text) > kazakhStrength(best.text) + 1) best = { ...best, ...option, preprocessing: `${best.preprocessing}+kaz` };
  }
  results.push({ id:item.id, text:best.text, raw_text:raw.data.text.trim(), confidence:best.confidence, raw_confidence:raw.data.confidence, selected_rotation:best.rotation, preprocessing:best.preprocessing, elapsed_seconds:(performance.now()-started)/1000 });
  process.stdout.write(`${item.id}: ${raw.data.confidence.toFixed(1)}% → ${best.confidence.toFixed(1)}% (${best.preprocessing}${best.rotation ? ` ${best.rotation}°` : ''})\n`);
}
await worker.terminate();
await kazWorker.terminate();
fs.rmSync(temporary, { recursive: true, force: true });
fs.mkdirSync(path.join(root, 'artifacts'), {recursive:true});
fs.writeFileSync(path.join(root, 'artifacts', 'ocr_raw_results.json'), JSON.stringify({initialization_seconds:initializationSeconds, results}, null, 2) + '\n');
