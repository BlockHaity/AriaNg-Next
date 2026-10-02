/**
 * The new-task page (`/new`) — AriaNg's `views/new.html` +
 * `scripts/controllers/new.js`.
 *
 * Two tabs whose first label follows the task kind (`Links` / `Torrent File` /
 * `Metalink File`, plus aria2-next's `Media` and `ED2K`), a toolbar with the
 * 📂 file dropdown and the "Download Now / Download Later" pair, and the option
 * editor driven by {@link OptionRow}.
 *
 * Everything that could be a pure function lives in `./new-task/validation.ts`;
 * what is left here is state, RPC and navigation.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { getOptionMeta } from '@/config/aria2-options';
import { Routes } from '@/app/route-paths';
import { getAria2ClientOrNull } from '@/rpc';
import type { RpcError } from '@/rpc/contract';
import type { Aria2OptionMap } from '@/rpc/types';
import { useTranslate } from '@/i18n/react';
import { openFile } from '@/utils/files';
import { addSettingHistory } from '@/store/history';
import { useTranslateSetting } from '@/store/hooks';
import { notifyInPage } from '@/store/notifications';
import { useUiStore } from '@/store/ui';
import { LinksTab } from './new-task/LinksTab';
import { NewTaskOptionsTab } from './new-task/NewTaskOptionsTab';
import { TaskTypeTabs } from './new-task/TaskTypeTabs';
import { ExportCommandApiDialog } from './new-task/ExportCommandApiDialog';
import type { ExportableNewTask } from './new-task/ExportCommandApiDialog';
import { DEFAULT_OPTION_FILTERS } from './new-task/OptionFilters';
import type { OptionFilterState } from './new-task/OptionFilters';
import {
  buildAddUriEntries,
  coerceOptionsForRpc,
  detectKindFromUrls,
  isDraftValid,
  parsePrefillUrl,
  validateUrls,
} from './new-task/validation';
import type { NewTaskDraft, NewTaskKind } from './new-task/validation';
import './new-task/styles.css';

/** A file loaded through the 📂 dropdown. */
interface LoadedFile {
  kind: 'torrent' | 'metalink';
  name: string;
  base64: string;
}

type TabName = 'links' | 'options';

/** The two tabs, in swipe order — `getVisibleTabOrders()` in AriaNg. */
const TABS: readonly TabName[] = ['links', 'options'];

/** `ariaNgFileService.fileFilter` for the two file kinds. */
const TORRENT_FILE_FILTER = '.torrent';
const METALINK_FILE_FILTER = '.meta4,.metalink';

/**
 * The `?url=` prefill of AriaNg's command API, read once on mount.
 *
 * Prefill **only**: `#!/new/task?url=…` is the command route the shell owns, so
 * this page never creates a task from the query string by itself — it only
 * offers the link in the textarea.
 */
function readPrefillFromLocation(): string {
  if (typeof window === 'undefined') {
    return '';
  }

  return parsePrefillUrl(window.location.hash) ?? parsePrefillUrl(window.location.search) ?? '';
}

/** The first tab's label, AriaNg's nested ternary plus the aria2-next kinds. */
function linksTabLabelKey(kind: NewTaskKind): string {
  switch (kind) {
    case 'torrent':
      return 'Torrent File';
    case 'metalink':
      return 'Metalink File';
    case 'media':
      return 'Media';
    case 'ed2k':
      return 'ED2K';
    case 'urls':
    default:
      return 'Links';
  }
}

/**
 * One `addUri` entry per link line, blanks skipped, with the coerced option bag
 * and `pause` merged in (`getDownloadTasksByLinks` + `buildRequestOptions`).
 */
function addUriEntriesForRpc(urls: string[], options: Aria2OptionMap, pause: boolean) {
  return buildAddUriEntries({ kind: 'urls', urls, options: {} }, pause).map((entry) => ({
    urls: entry.urls,
    options: { ...entry.options, ...options },
  }));
}

/** AriaNg showed `error.tipTextKey` when the RPC layer recognised the failure. */
function describeFailure(error: RpcError): string {
  return error.tipTextKey ?? error.message;
}

export default function NewTaskPage() {
  const t = useTranslate();
  const navigate = useNavigate();

  const keyboardShortcuts = useTranslateSetting('keyboardShortcuts');
  const swipeGesture = useTranslateSetting('swipeGesture');
  const afterCreatingNewTask = useTranslateSetting('afterCreatingNewTask');

  /* ---- draft state ---------------------------------------------------- */
  const [tab, setTab] = useState<TabName>('links');
  // Read once: `readPrefillFromLocation` is the deep-link prefill.
  const [urlsText, setUrlsText] = useState(readPrefillFromLocation);
  const [loadedFile, setLoadedFile] = useState<LoadedFile | null>(null);
  const [options, setOptions] = useState<Record<string, string>>({});
  const [filters, setFilters] = useState<OptionFilterState>(DEFAULT_OPTION_FILTERS);
  const [globalOptions, setGlobalOptions] = useState<Record<string, string> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [exportData, setExportData] = useState<ExportableNewTask[] | null>(null);

  /* ---- derived -------------------------------------------------------- */
  const urlResult = useMemo(() => validateUrls(urlsText), [urlsText]);

  /**
   * A pasted `.torrent` link is still submitted with `addUri` — aria2 fetches the
   * metainfo itself — so the detected kind only refines the label, and a loaded
   * *file* is what turns the task into an `addTorrent` one.
   */
  const detectedKind = useMemo(() => detectKindFromUrls(urlResult.urls), [urlResult.urls]);
  const kind: NewTaskKind = loadedFile ? loadedFile.kind : detectedKind === 'torrent' ? 'urls' : detectedKind;

  const draft: NewTaskDraft = useMemo(
    () => ({
      kind,
      urls: urlResult.urls,
      file: loadedFile ? { name: loadedFile.name, base64: loadedFile.base64 } : undefined,
      options,
    }),
    [kind, urlResult.urls, loadedFile, options],
  );

  const canSubmit = isDraftValid(draft);

  /* ---- lazy global options -------------------------------------------- */
  const loadGlobalOptions = useCallback(() => {
    if (globalOptions) {
      return;
    }

    const client = getAria2ClientOrNull();
    if (!client) {
      return;
    }

    void client.getGlobalOption().then((result) => {
      if (result.success) {
        setGlobalOptions({ ...result.data });
      }
    });
  }, [globalOptions]);

  const changeTab = useCallback(
    (next: TabName) => {
      // AriaNg's `changeTab('options')` -> `loadDefaultOption()`: the global
      // options are fetched when the tab is first opened, and only once.
      if (next === 'options') {
        loadGlobalOptions();
      }

      setTab(next);
    },
    [loadGlobalOptions],
  );

  /* ---- swipe gestures -------------------------------------------------- */
  // Re-registered whenever the tab changes, so the handler always steps from the
  // tab that is on screen (AriaNg re-read `$scope.context.currentTab` on every
  // swipe and returned `false` at the ends of the list).
  useEffect(() => {
    if (!swipeGesture) {
      return;
    }

    const store = useUiStore.getState();
    const step = (delta: number) => () => {
      const next = TABS.indexOf(tab) + delta;

      if (next < 0 || next >= TABS.length) {
        return false;
      }

      changeTab(TABS[next]);
      return true;
    };

    const unregisterLeft = store.registerSwipeAction('left', step(1));
    const unregisterRight = store.registerSwipeAction('right', step(-1));

    return () => {
      unregisterLeft();
      unregisterRight();
    };
  }, [changeTab, swipeGesture, tab]);

  /* ---- file loading ---------------------------------------------------- */
  const loadFile = useCallback(
    async (fileKind: 'torrent' | 'metalink', fileFilter: string) => {
      try {
        const opened = await openFile({ fileFilter, binary: true });
        setLoadedFile({ kind: fileKind, name: opened.fileName, base64: opened.base64Content ?? '' });
        // AriaNg switched to the Options tab right after a successful pick.
        setTab('options');
        loadGlobalOptions();
      } catch (error) {
        notifyInPage({
          title: t('Failed to load file!'),
          content: error instanceof Error ? error.message : t('error.unknown'),
          type: 'error',
        });
      }
    },
    [loadGlobalOptions, t],
  );

  /* ---- submission ------------------------------------------------------ */
  const submit = useCallback(
    async (pause: boolean) => {
      if (submitting || !canSubmit) {
        return;
      }

      const client = getAria2ClientOrNull();

      if (!client) {
        notifyInPage({ title: t('Cannot connect to aria2!'), type: 'error' });
        return;
      }

      // `header` becomes a real array; cleared rows disappear entirely.
      const rpcOptions = coerceOptionsForRpc(draft.options, getOptionMeta) as Aria2OptionMap;

      if (pause) {
        rpcOptions.pause = 'true';
      }

      setSubmitting(true);
      let firstGid: string | undefined;

      try {
        if (loadedFile && loadedFile.kind === 'torrent') {
          const result = await client.addTorrent(loadedFile.base64, [], rpcOptions);

          if (!result.success) {
            notifyInPage({ title: t('error.unknown'), content: describeFailure(result.error), type: 'error' });
            return;
          }

          firstGid = result.data;
        } else if (loadedFile && loadedFile.kind === 'metalink') {
          const result = await client.addMetalink(loadedFile.base64, rpcOptions);

          if (!result.success) {
            notifyInPage({ title: t('error.unknown'), content: describeFailure(result.error), type: 'error' });
            return;
          }

          firstGid = result.data;
        } else {
          const result = await client.addUriMany(addUriEntriesForRpc(draft.urls, rpcOptions, pause));

          if (!result.success) {
            notifyInPage({ title: t('error.unknown'), content: describeFailure(result.error), type: 'error' });
            return;
          }

          firstGid = result.data.gids[0];

          if (result.data.hasError) {
            notifyInPage({
              title: t('Failed to change some tasks state.'),
              content: `${result.data.successCount}/${result.data.successCount + result.data.failedCount}`,
              type: 'warning',
            });
          }
        }

        // AriaNg's `saveDownloadPath`: remember the directory for the next task.
        if (draft.options.dir) {
          addSettingHistory('dir', draft.options.dir);
        }

        if (afterCreatingNewTask === 'task-detail' && firstGid) {
          navigate(Routes.TaskDetail.replace(':gid', firstGid));
          return;
        }

        navigate(pause ? Routes.Waiting : Routes.Downloading);
      } finally {
        setSubmitting(false);
      }
    },
    [afterCreatingNewTask, canSubmit, draft, loadedFile, navigate, submitting, t],
  );

  /* ---- toolbar actions -------------------------------------------------- */
  // The dialog owns its own "Pause After Task Created" toggle, so the exported
  // tasks themselves carry no `pause`.
  const showExportDialog = useCallback(() => {
    const rpcOptions = coerceOptionsForRpc(draft.options, getOptionMeta) as Aria2OptionMap;
    setExportData(addUriEntriesForRpc(draft.urls, rpcOptions, false));
  }, [draft]);

  const handleOptionChange = useCallback((key: string, value: string) => {
    setOptions((previous) => ({ ...previous, [key]: value }));
  }, []);

  return (
    <section className="new-task">
      <TaskTypeTabs
        linksLabel={t(linksTabLabelKey(kind))}
        activeTab={tab}
        onTabChange={changeTab}
        canSubmit={canSubmit}
        submitting={submitting}
        showExportCommandApi={!loadedFile}
        onOpenTorrent={() => void loadFile('torrent', TORRENT_FILE_FILTER)}
        onOpenMetalink={() => void loadFile('metalink', METALINK_FILE_FILTER)}
        onDownloadNow={() => void submit(false)}
        onDownloadLater={() => void submit(true)}
        onExportCommandApi={showExportDialog}
      />

      {tab === 'links' ? (
        <LinksTab
          kind={kind}
          urlsText={urlsText}
          result={urlResult}
          file={draft.file}
          keyboardShortcuts={keyboardShortcuts}
          onUrlsChange={setUrlsText}
          onSubmit={() => void submit(false)}
          onClearFile={() => setLoadedFile(null)}
        />
      ) : (
        <NewTaskOptionsTab
          kind={kind}
          filters={filters}
          onFiltersChange={setFilters}
          options={draft.options}
          globalOptions={globalOptions}
          onOptionChange={handleOptionChange}
        />
      )}

      {exportData ? (
        <ExportCommandApiDialog
          open
          options={{ type: 'new-task', data: exportData }}
          onClose={() => setExportData(null)}
        />
      ) : null}
    </section>
  );
}