export const MAX_TEXT_FILE_BYTES = 100_000;
export const MAX_ANALYSIS_CHARS = 10_000;

export async function readUtf8TextFile(file: File): Promise<string> {
  if (!file.name.toLocaleLowerCase().endsWith('.txt')) {
    throw new Error('Выберите файл с расширением .txt.');
  }
  if (file.size > MAX_TEXT_FILE_BYTES) {
    throw new Error('Размер TXT-файла не должен превышать 100 КБ.');
  }
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error('Не удалось прочитать файл как UTF-8. Сохраните его в UTF-8 и загрузите снова.');
  }
  if (decoded.includes('\u0000')) {
    throw new Error('В файле обнаружены нулевые байты. Выберите обычный текстовый TXT в UTF-8.');
  }
  if (decoded.length > MAX_ANALYSIS_CHARS) {
    throw new Error('В TXT-файле больше 10 000 символов. Сократите его перед загрузкой.');
  }
  return decoded;
}
