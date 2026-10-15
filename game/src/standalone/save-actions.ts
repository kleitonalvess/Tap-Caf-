import { GAME_VERSION } from '../core/version';
import { localBackend } from '../game/backend';
import type { PendingImport } from '../ui/SettingsModal';
import type { LocalBackend } from './local-backend';
import { parseSaveFile, saveFileName, saveFileText, saveSummary } from './save-transfer';

/** The Configurações buttons of the offline mode: download the café as a
 * .json file, and replace it with a checked file from another device. */
export function offlineSaveActions(): { onExportSave: () => Promise<string>; onImportSave: () => Promise<PendingImport | null> } | null {
  const saves = (localBackend() as LocalBackend | null)?.saves;
  if (!saves) return null;
  return {
    async onExportSave() {
      const record = await saves.exportRecord();
      const name = saveFileName();
      const url = URL.createObjectURL(new Blob([saveFileText(record, GAME_VERSION)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.style.display = 'none';
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      return `Save exportado: ${name}. Guarde o arquivo para continuar em outro aparelho.`;
    },
    async onImportSave() {
      const file = await pickFile();
      if (!file) return null;
      if (file.size > 16 * 1024 * 1024) throw new Error('Este arquivo não é um save do Coffe Mania.');
      const record = parseSaveFile(await file.text());
      return { summary: saveSummary(record), apply: () => saves.importRecord(record) };
    },
  };
}

/** The browser's file picker; null when the player closes it without a file. */
function pickFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    let settled = false;
    const finish = (file: File | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file);
    };
    input.addEventListener('change', () => finish(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    document.body.append(input);
    input.click();
  });
}
