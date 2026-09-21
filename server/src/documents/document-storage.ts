import { join } from 'node:path';
import { AppConfigService } from '../config/config.service';

export function documentsDir(config: AppConfigService): string {
  return join(config.uploadRoot, 'documents');
}

export function documentPath(storageKey: string, config: AppConfigService): string {
  if (!/^[a-f0-9-]{36}\.(md|docx|pdf)$/.test(storageKey)) throw new Error('Invalid storage key');
  return join(config.uploadRoot, 'documents', storageKey);
}
