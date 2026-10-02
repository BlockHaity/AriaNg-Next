/**
 * `/task/detail/:gid` — AriaNg's largest view.
 *
 * ## URL / deep links
 *
 * The route is `/task/detail/:gid` (see `src/app/route-paths.ts`); the tab is a
 * **query parameter**, so a tab is shareable without changing the route table:
 *
 * ```
 * #!/task/detail/<gid>            -> the first visible tab (Overview)
 * #!/task/detail/<gid>?tab=files  -> the Files tab
 * #!/task/detail/<gid>?tab=peers  -> the Peers tab (active torrents only)
 * ```
 *
 * A stale deep link (a tab the task no longer has, because it finished) is
 * clamped to the first visible tab instead of rendering an empty panel.
 *
 * ## What this page owns
 *
 * AriaNg's controller owned six things; they are reproduced one to one:
 *
 * | AriaNg                              | here                                                   |
 * |-------------------------------------|--------------------------------------------------------|
 * | `processTask` → `taskContext.list`  | `selection` store: this gid is selected so the global toolbar acts on it |
 * | `processTask` → `recordStat(gid)`   | `recordTaskStat(gid, …)` on every task update            |
 * | `$interval(refreshDownloadTask)`    | `scheduler.register({ id: 'task-detail:<gid>' })`         |
 * | `$interval.cancel` on a terminal status | the poll is unregistered as soon as the status is terminal |
 * | `pauseDownloadTaskRefresh`          | `FilesTab`'s exported `isFileSelectionActive()` latch     |
 * | `extendLeft/RightSwipe`             | `uiStore.registerSwipeAction` guarded by `settings.swipeGesture` |
 *
 * AriaNg also reset the speed history on entry (`getEmptyStatsData(gid)`); the
 * chart is only meaningful for the session, so `resetStats(gid)` is called on
 * mount instead — see the note in `store/monitor.ts`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { Routes } from '@/app/route-paths';
import { isTerminalStatus } from '@/config/rpc-constants';
import { estimateHealthPercentFromPeers } from '@/domain/health';
import type { HealthPeer } from '@/domain/health';
import type { NormalizedTask, TaskPeer } from '@/domain/types';
import { useTranslate } from '@/i18n/react';
import { removeTasks, retryMediaTask } from '@/store/commands';
import { recordTaskStat, resetStats } from '@/store/monitor';
import { scheduler } from '@/store/scheduler';
import { useSelectionStore } from '@/store/selection';
import { useSettingsStore } from '@/store/settings';
import { useTasksStore } from '@/store/tasks';
import { useUiStore } from '@/store/ui';
import { confirmDialog, MduiIcon, snackbarMessage } from '@/ui/mdui';
import { bitfieldFromRuns } from './task-detail/PieceMap';
import { FilesTab, isFileSelectionActive } from './task-detail/tabs/FilesTab';
import { MediaTab } from './task-detail/tabs/MediaTab';
import { OptionsTab } from './task-detail/tabs/OptionsTab';
import { OverviewTab } from './task-detail/tabs/OverviewTab';
import { PeersTab } from './task-detail/tabs/PeersTab';
import { PiecesTab } from './task-detail/tabs/PiecesTab';
import {
  TAB_QUERY_PARAM,
  adjacentTab,
  getVisibleTabs,
  resolveTab,
} from './task-detail/tabs/visibility';
import type { DetailTabValue } from './task-detail/tabs/visibility';
import './task-detail/styles.css';

/** Peers are only needed while the Peers tab can be open at all. */
function peersWanted(status: string, isBittorrent: boolean): boolean {
  return status === 'active' && isBittorrent;
}

export default function TaskDetailPage() {
  const t = useTranslate();
  const navigate = useNavigate();
  const params = useParams<{ gid: string }>();
  const gid = params.gid ?? '';

  const [searchParams, setSearchParams] = useSearchParams();
  const task = useTasksStore((state) => (gid ? state.byGid[gid] : undefined));
  const refreshDetail = useTasksStore((state) => state.refreshDetail);
  const loadPeers = useTasksStore((state) => state.loadPeers);

  const swipeGesture = useSettingsStore((state) => state.settings.swipeGesture);
  const downloadTaskRefreshInterval = useSettingsStore(
    (state) => state.settings.downloadTaskRefreshInterval,
  );
  const includePrefixWhenCopying = useSettingsStore(
    (state) => state.settings.includePrefixWhenCopyingFromTaskDetails,
  );
  const piecesSetting = useSettingsStore((state) => state.settings.showPiecesInfoInTaskDetailPage);
  const confirmTaskRemoval = useSettingsStore((state) => state.settings.confirmTaskRemoval);

  const [peers, setPeers] = useState<TaskPeer[]>([]);

  /* ---------------------------------------------------------------- */
  /* refs the poll closure reads                                        */
  /* ---------------------------------------------------------------- */

  /*
   * The scheduler callback and the swipe handlers outlive a single render, so
   * they cannot close over `task` / `gid` directly. The mirrors are written in
   * an effect (never during render) and are always fresh by the time the first
   * tick fires — the poll interval is at least a second.
   */
  const taskRef = useRef<NormalizedTask | undefined>(undefined);
  const gidRef = useRef(gid);

  useEffect(() => {
    taskRef.current = task;
    gidRef.current = gid;
  }, [task, gid]);

  const isBittorrent = task?.bittorrent !== undefined;
  const status = task?.status ?? '';
  const terminal = task ? isTerminalStatus(task.status) : false;

  const visibleTabs = useMemo(
    () =>
      getVisibleTabs({
        status,
        isBittorrent,
        numPieces: task?.numPieces ?? 0,
        piecesSetting,
        hasMedia: task?.media !== undefined,
      }),
    [status, isBittorrent, task?.numPieces, task?.media, piecesSetting],
  );

  const requestedTab = searchParams.get(TAB_QUERY_PARAM);
  const activeTab = resolveTab(requestedTab, {
    status,
    isBittorrent,
    numPieces: task?.numPieces ?? 0,
    piecesSetting,
    hasMedia: task?.media !== undefined,
  });

  const setTab = useCallback(
    (tab: DetailTabValue) => {
      const next = new URLSearchParams(searchParams);
      next.set(TAB_QUERY_PARAM, tab);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const peersWantedNow = peersWanted(status, isBittorrent) && activeTab === 'peers';

  const withPeersRef = useRef(peersWantedNow);
  useEffect(() => {
    withPeersRef.current = peersWantedNow;
  }, [peersWantedNow]);

  /* ---------------------------------------------------------------- */
  /* selection registration (the global toolbar acts on this task)      */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!gid) return;

    // AriaNg: `$rootScope.taskContext.selected[$scope.task.gid] = true`, so the
    // toolbar's pause / remove / retry buttons target this one task.
    if (!useSelectionStore.getState().isSelected(gid)) {
      useSelectionStore.getState().toggle(gid);
    }

    return () => {
      const state = useSelectionStore.getState();
      if (state.isSelected(gid)) state.toggle(gid);
    };
  }, [gid]);

  /* ---------------------------------------------------------------- */
  /* speed history                                                     */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    // AriaNg primed the chart with a flat zeroed baseline so it did not render
    // as a single dot; `resetStats` starts it empty instead, which renders the
    // `No Data` state until the first sample arrives.
    resetStats(gid);
  }, [gid]);

  useEffect(() => {
    if (!task) return;

    recordTaskStat(gid, {
      downloadSpeed: task.downloadSpeed,
      uploadSpeed: task.uploadSpeed,
      // Media tasks report retained payload rather than a network speed.
      ...(task.media ? { mediaDownloadedLength: task.media.downloadedLength } : {}),
    });
  }, [gid, task]);

  /* ---------------------------------------------------------------- */
  /* polling                                                           */
  /* ---------------------------------------------------------------- */

  // First load.
  useEffect(() => {
    if (!gid) return;
    void refreshDetail(gid, { withPeers: false, addVirtualFileNode: true });
  }, [gid, refreshDetail]);

  // The recurring poll. AriaNg cancelled its `$interval` as soon as the status
  // reached complete / error / removed, so the effect is keyed on `terminal`
  // and simply unregisters.
  useEffect(() => {
    if (!gid || downloadTaskRefreshInterval <= 0 || terminal) return;

    return scheduler.register({
      id: `task-detail:${gid}`,
      intervalMs: downloadTaskRefreshInterval,
      run: () => {
        // AriaNg's `pauseDownloadTaskRefresh`: while the user is mid-selection
        // in the Files tab, no poll may overwrite their local edits.
        if (isFileSelectionActive()) return;
        return refreshDetail(gidRef.current, {
          withPeers: withPeersRef.current,
          addVirtualFileNode: true,
        });
      },
    });
  }, [gid, downloadTaskRefreshInterval, terminal, refreshDetail]);

  // Peers: only while the tab is visible and the swarm is live.
  useEffect(() => {
    if (!gid || !peersWantedNow) return;

    let cancelled = false;

    void loadPeers(gid, { includeLocalPeer: true }).then((loaded) => {
      if (!cancelled) setPeers(loaded);
    });

    return () => {
      cancelled = true;
    };
  }, [gid, peersWantedNow, loadPeers, task?.gid, task?.status, task?.numPieces, task?.bitfield]);

  /* ---------------------------------------------------------------- */
  /* health                                                           */
  /* ---------------------------------------------------------------- */

  const healthPercent = useMemo(() => {
    if (!task) return 0;

    // `normalizePeers` stores the run-length encoded map, `domain/health` wants
    // the hex bitfield, and `TaskPeer.completePercent` is 0..1 where the health
    // input is 0..100. This is the whole adapter.
    const healthPeers: HealthPeer[] = peers.map((peer) => ({
      bitfield: bitfieldFromRuns(peer.pieces ?? []),
      completePercent: peer.completePercent * 100,
      isLocal: peer.isLocal,
    }));

    return estimateHealthPercentFromPeers({
      bitfield: task.bitfield,
      numPieces: task.numPieces,
      completedPercent: task.completePercent,
      peers: healthPeers,
    });
  }, [task, peers]);

  /* ---------------------------------------------------------------- */
  /* keyboard shortcuts (the shell's toolbar acts on this one task)      */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!gid || !task) return;

    const ui = useUiStore.getState();

    // `⌘/Ctrl + A` — AriaNg's detail page put exactly this one task in the
    // list, so "select all" means "select this task".
    const offSelectAll = ui.registerKeyAction('selectAll', () => {
      if (!useSelectionStore.getState().isSelected(gid)) {
        useSelectionStore.getState().toggle(gid);
      }
    });

    const offDelete = ui.registerKeyAction('delete', () => {
      void (async () => {
        const current = taskRef.current;
        if (!current) return;

        if (confirmTaskRemoval) {
          const ok = await confirmDialog({
            heading: t('Confirm Task Removal'),
            text: current.taskName,
            okText: t('Confirm'),
            cancelText: t('Cancel'),
            danger: true,
            icon: 'delete',
          });
          if (!ok) return;
        }

        const outcome = await removeTasks([current]);
        // `removeTasks` is typed as `BatchOutcome`; only `CommandOutcome` carries
        // the failure text, which is what the toast needs.
        const failure = (outcome as { message?: string }).message;
        if (outcome.hasError && failure) {
          snackbarMessage({ message: failure });
          return;
        }
        // The detail page is meaningless without its task.
        navigate(Routes.Downloading);
      })();
    });

    return () => {
      offSelectAll();
      offDelete();
    };
  }, [gid, task, confirmTaskRemoval, navigate, t]);

  /* ---------------------------------------------------------------- */
  /* swipe gestures                                                    */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    if (!gid) return;

    const input = () => ({
      status: taskRef.current?.status ?? '',
      isBittorrent: taskRef.current?.bittorrent !== undefined,
      numPieces: taskRef.current?.numPieces ?? 0,
      piecesSetting,
      hasMedia: taskRef.current?.media !== undefined,
    });

    const ui = useUiStore.getState();

    // AriaNg's `extendLeftSwipe` / `extendRightSwipe`: walk the visible tab
    // order, return false at the edge so the shell can use the gesture itself
    // (opening the navigation drawer).
    const offLeft = ui.registerSwipeAction('left', () => {
      if (!swipeGesture) return false;
      const next = adjacentTab(activeTab, 1, input());
      if (!next) return false;
      setTab(next);
      return true;
    });

    const offRight = ui.registerSwipeAction('right', () => {
      if (!swipeGesture) return false;
      const previous = adjacentTab(activeTab, -1, input());
      if (!previous) return false;
      setTab(previous);
      return true;
    });

    return () => {
      offLeft();
      offRight();
    };
  }, [gid, activeTab, piecesSetting, swipeGesture, setTab]);

  /* ---------------------------------------------------------------- */
  /* rendering                                                         */
  /* ---------------------------------------------------------------- */

  if (!gid) {
    return <p className="ariang-task-detail">{t('Unknown')}</p>;
  }

  if (!task) {
    return (
      <div className="ariang-task-detail">
        <p className="ariang-empty-state">{t('Loading')}</p>
        <ReloadButton onRetry={() => void refreshDetail(gid, { addVirtualFileNode: true })} />
      </div>
    );
  }

  return (
    <div className="ariang-task-detail">
      <div className="ariang-tablist" role="tablist" aria-label={`${t('Task Name')}: ${task.taskName}`}>
        {visibleTabs.map((tab) => (
          <TabButton
            key={tab.value}
            value={tab.value}
            label={t(tab.labelKey)}
            icon={tab.icon}
            selected={tab.value === activeTab}
            panelId={`task-detail-panel-${tab.value}`}
            tabId={`task-detail-tab-${tab.value}`}
            onSelect={() => setTab(tab.value)}
            onArrow={(direction) => {
              const next = adjacentTab(tab.value, direction, {
                status,
                isBittorrent,
                numPieces: task.numPieces,
                piecesSetting,
                hasMedia: task.media !== undefined,
              });
              if (next) setTab(next);
            }}
          />
        ))}
      </div>

      <div
        className="ariang-tabpanel"
        role="tabpanel"
        id={`task-detail-panel-${activeTab}`}
        aria-labelledby={`task-detail-tab-${activeTab}`}
        tabIndex={0}
      >
        {activeTab === 'overview' ? (
          <OverviewTab
            task={task}
            healthPercent={healthPercent}
            refreshInterval={downloadTaskRefreshInterval}
            includePrefixWhenCopying={includePrefixWhenCopying}
            onGoToFiles={() => setTab('files')}
          />
        ) : null}

        {activeTab === 'pieces' ? <PiecesTab task={task} /> : null}

        {activeTab === 'files' ? (
          <FilesTab
            task={task}
            onRequestRefresh={() => {
              void refreshDetail(gid, {
                withPeers: peersWantedNow,
                addVirtualFileNode: true,
              });
            }}
          />
        ) : null}

        {activeTab === 'peers' ? (
          <PeersTab
            peers={peers}
            numPieces={task.numPieces}
            healthPercent={healthPercent}
            connectingPeers={task.bittorrent?.connectingPeers}
            handshakingPeers={task.bittorrent?.handshakingPeers}
            error={
              task.bittorrent?.errorKind
                ? {
                    code: task.bittorrent.errorCode,
                    kind: task.bittorrent.errorKind,
                    category: task.bittorrent.errorCategory,
                    message: task.bittorrent.errorMessage,
                    recoverable: task.bittorrent.errorRecoverable,
                  }
                : undefined
            }
          />
        ) : null}

        {activeTab === 'options' ? (
          <OptionsTab
            gid={gid}
            status={task.status}
            isBittorrent={isBittorrent}
            fileSelectionState={task.bittorrent?.fileSelectionState}
          />
        ) : null}

        {activeTab === 'media' ? <MediaTab task={task} /> : null}
      </div>

      <RetryMediaNotice gid={gid} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* tab button                                                         */
/* ------------------------------------------------------------------ */

interface TabButtonProps {
  value: DetailTabValue;
  label: string;
  icon?: string;
  selected: boolean;
  tabId: string;
  panelId: string;
  onSelect: () => void;
  onArrow: (direction: -1 | 1) => void;
}

/**
 * A real `<button role="tab">` rather than `<mdui-tab>`.
 *
 * The MD3 tab pattern requires `aria-selected` on the tab, `aria-controls`
 * pointing at its panel and arrow-key navigation with a roving `tabindex`. mdui's
 * own tab element keeps all of that inside its shadow root, which a React
 * accessibility layer cannot inspect, so the strip is plain buttons styled with
 * MD3 tokens instead.
 */
function TabButton({ value, label, icon, selected, tabId, panelId, onSelect, onArrow }: TabButtonProps) {
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        onArrow(1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        onArrow(-1);
        break;
      case 'Home': {
        event.preventDefault();
        onArrow(-1);
        break;
      }
      case 'End': {
        event.preventDefault();
        onArrow(1);
        break;
      }
      default:
        break;
    }
  };

  return (
    <button
      type="button"
      role="tab"
      id={tabId}
      className="ariang-tab"
      value={value}
      aria-selected={selected}
      aria-controls={panelId}
      tabIndex={selected ? 0 : -1}
      title={label}
      onClick={onSelect}
      onKeyDown={onKeyDown}
    >
      {icon ? <MduiIcon name={icon} size="1.125rem" /> : null}
      <span>{label}</span>
    </button>
  );
}

/** Loading-state escape hatch: the first poll failed or aria2 has no task. */
function ReloadButton({ onRetry }: { onRetry: () => void }) {
  const t = useTranslate();

  return (
    <button type="button" className="ariang-sort-button" onClick={onRetry}>
      <MduiIcon name="refresh" size="1.125rem" />
      <span>{t('Refresh')}</span>
    </button>
  );
}

/**
 * Surfaces a failed media task.
 *
 * `retryTask` refuses a media task with `RETRY_MEDIA_MESSAGE` on purpose, so the
 * page offers the right call (`retryMedia`, which keeps the GID) instead of the
 * remove + re-add flow a user would expect from the task list.
 */
function RetryMediaNotice({ gid }: { gid: string }) {
  const t = useTranslate();
  const task = useTasksStore((state) => state.byGid[gid]);
  const show = task?.status === 'error' && task.media !== undefined;

  if (!show) return null;

  return (
    <div className="ariang-warning-row" role="status">
      <MduiIcon name="warning" size="1.25rem" />
      <span>{t('This media task failed. Retry keeps the same task and its recovery data.')}</span>
      <button
        type="button"
        className="ariang-sort-button"
        onClick={() => {
          void retryMediaTask(gid).then((result) => {
            if (!result.ok && result.error) snackbarMessage({ message: result.error });
          });
        }}
      >
        {t('Retry')}
      </button>
    </div>
  );
}