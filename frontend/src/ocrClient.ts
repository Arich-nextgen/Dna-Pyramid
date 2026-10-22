import { createWorker, OEM, PSM, type LoggerMessage, type Worker } from "tesseract.js";

export const OCR_MAX_BYTES = 8 * 1024 * 1024;
export const OCR_MAX_SIDE = 4096;
export const OCR_ACCEPT = ["image/png", "image/jpeg", "image/webp"];

export type OcrProgress = { progress: number; status: string };
export type OcrCrop = { left: number; top: number; right: number; bottom: number };
export type OcrQuality = "good" | "review" | "poor";
export type OcrResult = {
  text: string; rawText: string; confidence: number; elapsedMs: number;
  normalizations: string[]; quality: OcrQuality; qualityReasons: string[];
  rotation: number; retriedOrientations: boolean; preparedWidth: number; preparedHeight: number;
};
type PreparedImage = { blob: Blob; width: number; height: number; corrections: string[] };
type QualityAssessment = { quality: OcrQuality; score: number; reasons: string[] };

const fullImage: OcrCrop = { left: 0, top: 0, right: 1, bottom: 1 };
let mixedWorkerPromise: Promise<Worker> | undefined;
let kazWorkerPromise: Promise<Worker> | undefined;
let activeLogger: ((progress: OcrProgress) => void) | undefined;

function asset(path: string): string { return `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`; }
function logger(message: LoggerMessage) {
  activeLogger?.({ progress: Math.max(0, Math.min(1, message.progress || 0)), status: message.status });
}
function normalizeRotation(value: number) { return ((Math.round(value / 90) * 90) % 360 + 360) % 360; }
function normalizeCrop(crop?: OcrCrop): OcrCrop {
  if (!crop) return fullImage;
  const left = Math.min(0.98, Math.max(0, crop.left));
  const top = Math.min(0.98, Math.max(0, crop.top));
  return { left, top, right: Math.min(1, Math.max(left + 0.02, crop.right)), bottom: Math.min(1, Math.max(top + 0.02, crop.bottom)) };
}

function exifOrientation(bytes: ArrayBuffer): number {
  if (bytes.byteLength < 12) return 1;
  const view = new DataView(bytes);
  if (view.getUint16(0, false) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1), size = view.getUint16(offset + 2, false);
    if (size < 2 || offset + 2 + size > view.byteLength) break;
    if (marker === 0xe1 && size >= 10 && view.getUint32(offset + 4, false) === 0x45786966 && view.getUint16(offset + 8, false) === 0) {
      const tiff = offset + 10;
      if (tiff + 8 > view.byteLength) return 1;
      const little = view.getUint16(tiff, false) === 0x4949;
      if (view.getUint16(tiff + 2, little) !== 42) return 1;
      const ifd = tiff + view.getUint32(tiff + 4, little);
      if (ifd + 2 > view.byteLength) return 1;
      for (let i = 0, count = view.getUint16(ifd, little); i < count; i += 1) {
        const entry = ifd + 2 + i * 12;
        if (entry + 12 > view.byteLength) return 1;
        if (view.getUint16(entry, little) === 0x0112) {
          const value = view.getUint16(entry + 8, little);
          return [1, 3, 6, 8].includes(value) ? value : 1;
        }
      }
    }
    offset += 2 + size;
  }
  return 1;
}
function orientationRotation(orientation: number) { return orientation === 3 ? 180 : orientation === 6 ? 90 : orientation === 8 ? 270 : 0; }
async function rawBitmap(file: File): Promise<{ bitmap: ImageBitmap; exifApplied: boolean }> {
  try { return { bitmap: await createImageBitmap(file, { imageOrientation: "none" }), exifApplied: false }; }
  catch { return { bitmap: await createImageBitmap(file), exifApplied: true }; }
}
function invertDarkTheme(context: CanvasRenderingContext2D, width: number, height: number) {
  const image = context.getImageData(0, 0, width, height), step = Math.max(1, Math.floor(Math.max(width, height) / 160));
  let total = 0, samples = 0;
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) {
    const index = (y * width + x) * 4;
    total += image.data[index] * .2126 + image.data[index + 1] * .7152 + image.data[index + 2] * .0722;
    samples += 1;
  }
  if (total / Math.max(1, samples) > 105) return false;
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = 255 - image.data[index]; image.data[index + 1] = 255 - image.data[index + 1]; image.data[index + 2] = 255 - image.data[index + 2];
  }
  context.putImageData(image, 0, 0); return true;
}

async function prepareOcrImage(file: File, manualRotation = 0, crop?: OcrCrop): Promise<PreparedImage> {
  await validateOcrImage(file);
  const bytes = file.type === "image/jpeg" ? await file.arrayBuffer() : undefined;
  const orientation = bytes ? exifOrientation(bytes) : 1, source = await rawBitmap(file);
  try {
    const bounds = normalizeCrop(crop), sourceWidth = Math.max(1, Math.round(source.bitmap.width * (bounds.right - bounds.left))), sourceHeight = Math.max(1, Math.round(source.bitmap.height * (bounds.bottom - bounds.top)));
    const baseRotation = source.exifApplied ? 0 : orientationRotation(orientation), rotation = normalizeRotation(baseRotation + manualRotation);
    const longest = Math.max(sourceWidth, sourceHeight), scale = longest < 1500 ? Math.min(2, 1500 / longest) : longest > 2800 ? 2800 / longest : 1;
    const drawWidth = Math.max(1, Math.round(sourceWidth * scale)), drawHeight = Math.max(1, Math.round(sourceHeight * scale)), sideways = rotation === 90 || rotation === 270;
    const width = sideways ? drawHeight : drawWidth, height = sideways ? drawWidth : drawHeight;
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Не удалось подготовить изображение для OCR.");
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    if (rotation === 90) { context.translate(width, 0); context.rotate(Math.PI / 2); }
    else if (rotation === 180) { context.translate(width, height); context.rotate(Math.PI); }
    else if (rotation === 270) { context.translate(0, height); context.rotate(-Math.PI / 2); }
    context.drawImage(source.bitmap, Math.round(source.bitmap.width * bounds.left), Math.round(source.bitmap.height * bounds.top), sourceWidth, sourceHeight, 0, 0, drawWidth, drawHeight);
    const darkInverted = invertDarkTheme(context, width, height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Не удалось подготовить изображение для OCR.")), "image/png"));
    const corrections = [
      ...(baseRotation ? ["EXIF-ориентация применена к пикселям"] : []),
      ...(manualRotation ? [`Поворот ${normalizeRotation(manualRotation)}° применён к пикселям`] : []),
      ...(scale > 1.02 ? ["Мелкий текст увеличен перед распознаванием"] : []),
      ...(scale < .98 ? ["Изображение уменьшено без изменения пропорций"] : []),
      ...(darkInverted ? ["Тёмная тема инвертирована для читаемости"] : []),
      ...(crop && (bounds.left || bounds.top || bounds.right < 1 || bounds.bottom < 1) ? ["Распознана выбранная область изображения"] : []),
    ];
    return { blob, width, height, corrections };
  } finally { source.bitmap.close(); }
}
function readableQuality(text: string, confidence: number): QualityAssessment {
  const compact = text.replace(/\s/g, ""), tokens = text.match(/\S+/gu) ?? [];
  const wordTokens = tokens.filter((token) => /^[\p{L}][\p{L}'’\-]{1,}$/u.test(token));
  const vowelWords = wordTokens.filter((token) => /[аеёиоуыэюяәғқңөұүһіaeiouy]/iu.test(token));
  const mixedNoise = tokens.filter((token) => /(?=.*\p{L})(?=.*\d)/u.test(token)).length, readableRatio = vowelWords.length / Math.max(1, tokens.length);
  const score = Math.max(0, Math.min(1, confidence / 100 * .56 + readableRatio * .38 + (compact.length > 16 ? .06 : 0) - mixedNoise / Math.max(1, tokens.length) * .25));
  const reasons: string[] = [];
  if (confidence < 55) reasons.push("низкая уверенность OCR"); if (readableRatio < .35) reasons.push("мало распознаваемых слов"); if (mixedNoise) reasons.push("есть смешанные буквенно-цифровые последовательности"); if (compact.length < 12) reasons.push("слишком мало распознанного текста");
  return { quality: score < .48 || !compact ? "poor" : score < .7 ? "review" : "good", score, reasons };
}
function kazakhStrength(text: string) {
  const special = (text.match(/[әғқңөұүһі]/giu) ?? []).length * 2;
  const cues = (text.match(/\b(?:жарна|тенге|теңге|күн|кун|адам|шақыр|арқылы|ақша|ұсыныс)/giu) ?? []).length;
  return special + cues;
}
function likelyKazakh(text: string) { return kazakhStrength(text) >= 3; }
/** Tesseract can read the tenge sign as Cyrillic Т; never change digits or words. */
export function normalizeFinancialOcrText(text: string) {
  let replacements = 0;
  const normalized = text.replace(/(\d(?:[\d\s.,]*\d)?)\s*[ТT](?=[\s.,;:!?]|$)/gu, (_match, amount: string) => { replacements += 1; return `${amount} ₸`; });
  return { text: normalized, normalizations: replacements ? [`Символ валюты восстановлен рядом с суммой: ${replacements}`] : [] };
}
async function worker(kind: "mixed" | "kaz" = "mixed"): Promise<Worker> {
  const current = kind === "kaz" ? kazWorkerPromise : mixedWorkerPromise;
  if (current) return current;
  const created = createWorker(kind === "kaz" ? ["kaz"] : ["rus", "kaz"], OEM.LSTM_ONLY, { workerPath: asset("/ocr/worker.min.js"), corePath: asset("/ocr/core"), langPath: asset("/ocr/lang"), gzip: false, cacheMethod: "write", logger })
    .then(async (instance) => { await instance.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: "1", user_defined_dpi: "300" }); return instance; })
    .catch((error) => { if (kind === "kaz") kazWorkerPromise = undefined; else mixedWorkerPromise = undefined; throw error; });
  if (kind === "kaz") kazWorkerPromise = created; else mixedWorkerPromise = created;
  return created;
}
export async function validateOcrImage(file: File): Promise<{ width: number; height: number }> {
  if (!OCR_ACCEPT.includes(file.type)) throw new Error("Поддерживаются PNG, JPEG и WebP.");
  if (file.size > OCR_MAX_BYTES) throw new Error("Размер изображения не должен превышать 8 МБ.");
  const bitmap = await createImageBitmap(file), dimensions = { width: bitmap.width, height: bitmap.height }; bitmap.close();
  if (!dimensions.width || !dimensions.height) throw new Error("Не удалось прочитать изображение.");
  if (Math.max(dimensions.width, dimensions.height) > OCR_MAX_SIDE) throw new Error(`Сторона изображения не должна превышать ${OCR_MAX_SIDE}px.`);
  return dimensions;
}
export async function previewOcrImage(file: File, rotation = 0, crop?: OcrCrop) { const prepared = await prepareOcrImage(file, rotation, crop); return { url: URL.createObjectURL(prepared.blob), ...prepared }; }
export async function recognizeRuKz(file: File, onProgress: (progress: OcrProgress) => void, options: { rotation?: number; crop?: OcrCrop } = {}): Promise<OcrResult> {
  activeLogger = onProgress; const started = performance.now(), requestedRotation = normalizeRotation(options.rotation ?? 0);
  try {
    const instance = await worker(), attempts = [requestedRotation];
    let best: { rawText: string; confidence: number; prepared: PreparedImage; rotation: number; quality: QualityAssessment } | undefined;
    for (let index = 0; index < attempts.length; index += 1) {
      const rotation = attempts[index], prepared = await prepareOcrImage(file, rotation, options.crop), result = await instance.recognize(prepared.blob);
      const rawText = result.data.text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim(), quality = readableQuality(rawText, result.data.confidence), candidate = { rawText, confidence: result.data.confidence, prepared, rotation, quality };
      if (!best || candidate.quality.score > best.quality.score) best = candidate;
      // Four orientations are tested only after clearly unusable automatic output.
      if (index === 0 && quality.quality === "poor" && requestedRotation === 0) attempts.push(90, 180, 270);
    }
    if (!best) throw new Error("Не удалось распознать изображение.");
    let languageCorrection = "";
    if (likelyKazakh(best.rawText)) {
      const kazResult = await (await worker("kaz")).recognize(best.prepared.blob);
      const rawText = kazResult.data.text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
      const quality = readableQuality(rawText, kazResult.data.confidence);
      if (quality.score >= best.quality.score - .03 && kazakhStrength(rawText) > kazakhStrength(best.rawText) + 1) {
        best = { ...best, rawText, confidence: kazResult.data.confidence, quality };
        languageCorrection = "Казахская модель выбрана для сохранения специальных букв";
      }
    }
    const normalized = normalizeFinancialOcrText(best.rawText);
    return { text: normalized.text, rawText: best.rawText, confidence: best.confidence, elapsedMs: Math.round(performance.now() - started), normalizations: [...best.prepared.corrections, ...(languageCorrection ? [languageCorrection] : []), ...normalized.normalizations], quality: best.quality.quality, qualityReasons: best.quality.reasons, rotation: best.rotation, retriedOrientations: attempts.length > 1, preparedWidth: best.prepared.width, preparedHeight: best.prepared.height };
  } finally { activeLogger = undefined; }
}
export async function disposeOcrWorker(): Promise<void> {
  const workers = [mixedWorkerPromise, kazWorkerPromise].filter(Boolean) as Promise<Worker>[];
  mixedWorkerPromise = undefined; kazWorkerPromise = undefined;
  await Promise.all(workers.map(async (pending) => (await pending).terminate()));
}
