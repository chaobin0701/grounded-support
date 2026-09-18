import { join } from 'node:path';

export const DOCUMENTS_DIR = join(process.env.UPLOAD_ROOT ?? '/data/uploads', 'documents');

export function documentPath(storageKey: string): string {
  if (!/^[a-f0-9-]{36}\.(md|docx|pdf)$/.test(storageKey)) throw new Error('Invalid storage key');
  return join(DOCUMENTS_DIR, storageKey);
}
