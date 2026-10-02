/**
 * "Export Command API" — AriaNg's `ng-export-command-api-dialog`
 * (`scripts/directives/exportCommandApiDialog.js` +
 * `views/export-command-api-dialog.html`).
 *
 * Generates the two deep links AriaNg documents:
 *
 * - `#!/new/task?url=<base64url>[&pause=true][&<opt>=<value> …]`, one line per
 *   task, so a whole batch can be pasted into a shell script;
 * - `#!/settings/rpc/set?protocol=…&host=…&port=…&interface=…&secret=<base64url>`,
 *   so a fresh AriaNg install can be pointed at an aria2 by clicking a link.
 *
 * The url builders are pure and exported, which is what makes the two formats
 * testable without a dialog.
 */

import { useEffect, useMemo, useState } from 'react';

import { useTranslate } from '@/i18n/react';
import type { RpcProfile } from '@/config/types';
import { Routes, appUrl, basePageUrl } from '@/app/route-paths';
import { copyText } from '@/utils/clipboard';
import { encodeBase64Url } from '@/utils/base64';
import { saveFileContent } from '@/utils/files';
import { alertDialog, snackbarMessage } from '@/ui/mdui';
import { MduiButton, MduiDialog, MduiSelect, MduiTextarea } from '@/ui/mdui';

/** One `addUri` task, as `getDownloadTasksByLinks` produced it. */
export interface ExportableNewTask {
  urls: string[];
  options?: Record<string, string>;
}

/** AriaNg's `options` binding: a discriminator plus the payload. */
export type ExportCommandApiOptions =
  | { type: 'new-task'; data: ExportableNewTask[] }
  | { type: 'setting'; data: RpcProfile };

/** Name AriaNg gives its exported settings blob. */
const EXPORT_FILE_NAME = 'AriaNgConfig.json';

/** How long the inline `Copied` badge stays next to the "Command API Url" key. */
const COPIED_FEEDBACK_MS = 2000;

/**
 * `#!/new/task?…` for one task.
 *
 * `url` is base64url (unpadded, URL-safe) so a magnet or a percent-encoded HTTP
 * link survives a query string. Options are appended in insertion order, like
 * AriaNg did; unlike AriaNg they go through `URLSearchParams`, so a `header`
 * value containing newlines cannot break the url.
 */
export function buildNewTaskCommandUrl(baseUrl: string, task: ExportableNewTask, pause: boolean): string {
  const query: Record<string, string | undefined> = { url: encodeBase64Url(task.urls?.[0] ?? '') };

  if (pause) {
    query.pause = 'true';
  }

  for (const [key, value] of Object.entries(task.options ?? {})) {
    query[key] = value;
  }

  return `${baseUrl}${appUrl(Routes.NewCommand, query)}`;
}

/** One url per line — AriaNg's `getNewTasksCommandAPIUrl`. */
export function buildNewTasksCommandUrl(baseUrl: string, tasks: ExportableNewTask[], pause: boolean): string {
  return (tasks ?? []).map((task) => buildNewTaskCommandUrl(baseUrl, task, pause)).join('\n');
}

/** `#!/settings/rpc/set?…` for one RPC profile. */
export function buildRpcProfileCommandUrl(baseUrl: string, profile: RpcProfile): string {
  const query: Record<string, string | undefined> = {
    protocol: profile.protocol,
    host: profile.rpcHost,
    port: profile.rpcPort,
    interface: profile.rpcInterface,
  };

  if (profile.secret) {
    query.secret = encodeBase64Url(profile.secret);
  }

  return `${baseUrl}${appUrl(Routes.RpcSetCommand, query)}`;
}

/**
 * The url AriaNg prefilled the dialog with.
 *
 * `basePageUrl()` is already `getFullPageUrl()` minus the fragment (it is built
 * from `location.protocol/host/pathname/search`), which is what the command
 * links are appended to.
 */
export function defaultExportBaseUrl(): string {
  return basePageUrl();
}

export interface ExportCommandApiDialogProps {
  open: boolean;
  /** `null` while nothing is being exported; the dialog renders inert. */
  options: ExportCommandApiOptions | null;
  onClose: () => void;
}

/**
 * Mount the dialog only while something is being exported (AriaNg reset the
 * whole dialog state on `hidden.bs.modal`); that way the `useState` initialisers
 * already are the reset and no effect is needed.
 */
export function ExportCommandApiDialog({ open, options, onClose }: ExportCommandApiDialogProps) {
  const t = useTranslate();
  const [baseUrl, setBaseUrl] = useState(defaultExportBaseUrl);
  /** AriaNg's dialog defaults to `true` ("Pause After Task Created"). */
  const [pauseOnAdded, setPauseOnAdded] = useState(true);
  const [copied, setCopied] = useState(false);

  const commandApiUrl = useMemo(() => {
    if (!options) {
      return '';
    }

    return options.type === 'new-task'
      ? buildNewTasksCommandUrl(baseUrl, options.data, pauseOnAdded)
      : buildRpcProfileCommandUrl(baseUrl, options.data);
  }, [options, baseUrl, pauseOnAdded]);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timer = setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleCopy = async (): Promise<void> => {
    const copiedOk = await copyText(commandApiUrl);

    if (!copiedOk) {
      await alertDialog({ heading: t('Failed to load file!'), text: t('error.unknown') });
      return;
    }

    setCopied(true);
    snackbarMessage({ message: t('Copied'), timeout: COPIED_FEEDBACK_MS });
  };

  const handleSave = (): void => {
    const saved = saveFileContent(
      JSON.stringify({ 'commandAPIUrl': commandApiUrl }, null, 2),
      EXPORT_FILE_NAME,
      'application/json',
    );

    if (!saved) {
      void alertDialog({ heading: t('Failed to load file!'), text: t('error.unknown') });
    }
  };

  return (
    <MduiDialog
      open={open && options !== null}
      className="export-command-api"
      headline={t('Export Command API')}
      closeOnEsc
      closeOnOverlayClick
      onCancel={onClose}
      actions={
        <>
          <MduiButton variant="text" onClick={onClose}>
            {t('Cancel')}
          </MduiButton>
          <MduiButton variant="outlined" icon="save" onClick={handleSave}>
            {t('Save')}
          </MduiButton>
          <MduiButton variant="filled" icon="content-copy" onClick={() => void handleCopy()}>
            {t('Copy')}
          </MduiButton>
        </>
      }
    >
      <div className="export-command-api__rows">
        <MduiTextarea value={baseUrl} label={t('AriaNg Url')} rows={1} onInput={setBaseUrl} />

        {options?.type === 'new-task' ? (
          <MduiSelect
            value={pauseOnAdded ? 'true' : 'false'}
            items={[
              { value: 'true', label: t('Enabled') },
              { value: 'false', label: t('Disabled') },
            ]}
            label={t('Pause After Task Created')}
            onChange={(value) => setPauseOnAdded(value === 'true')}
          />
        ) : null}

        <div className="export-command-api__output">
          <MduiTextarea value={commandApiUrl} label={t('Command API Url')} rows={4} disabled />
          {copied ? (
            <span className="export-command-api__copied" role="status" aria-live="polite">
              {t('Copied')}
            </span>
          ) : null}
        </div>
      </div>
    </MduiDialog>
  );
}