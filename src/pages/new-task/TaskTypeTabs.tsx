/**
 * The navigation toolbar of the new-task page — `views/new.html`'s
 * `ul.nav.nav-tabs`, tabs plus the three action groups:
 *
 * ```text
 * [ Links | Options ]   📂 ▾   [ Download Now ] [ ˅ ▾ ]
 * ```
 *
 * The 📂 dropdown offers the two file kinds (both switch to the Options tab
 * afterwards), and the caret dropdown carries "Download Later" plus, for plain
 * link tasks only, "Export Command API" — AriaNg's `ng-if="taskType === 'urls'`.
 */

import { useTranslate } from '@/i18n/react';
import {
  MduiButton,
  MduiDivider,
  MduiDropdown,
  MduiIconButton,
  MduiMenu,
  MduiMenuItem,
  MduiTab,
  MduiTabs,
} from '@/ui/mdui';

export type NewTaskTab = 'links' | 'options';

export interface TaskTypeTabsProps {
  /** `Links` / `Torrent File` / `Metalink File` / `Media` / `ED2K`. */
  linksLabel: string;
  activeTab: NewTaskTab;
  onTabChange: (tab: NewTaskTab) => void;
  /** `isNewTaskValid()` — disables both submit affordances. */
  canSubmit: boolean;
  /** A create request is in flight; the buttons show a spinner. */
  submitting?: boolean;
  /** `Export Command API` is only offered for plain link tasks. */
  showExportCommandApi: boolean;
  onOpenTorrent: () => void;
  onOpenMetalink: () => void;
  onDownloadNow: () => void;
  onDownloadLater: () => void;
  onExportCommandApi: () => void;
}

export function TaskTypeTabs(props: TaskTypeTabsProps) {
  const {
    linksLabel,
    activeTab,
    onTabChange,
    canSubmit,
    submitting = false,
    showExportCommandApi,
    onOpenTorrent,
    onOpenMetalink,
    onDownloadNow,
    onDownloadLater,
    onExportCommandApi,
  } = props;
  const t = useTranslate();

  return (
    <div className="new-task-toolbar">
      <MduiTabs
        className="new-task-toolbar__tabs"
        activeTab={activeTab}
        variant="primary"
        onTabChange={(value) => onTabChange(value === 'options' ? 'options' : 'links')}
      >
        <MduiTab value="links" label={linksLabel} icon="link" />
        <MduiTab value="options" label={t('Options')} icon="tune" />
      </MduiTabs>

      <div className="new-task-toolbar__actions">
        <MduiDropdown
          className="new-task-toolbar__files"
          trigger={<MduiIconButton icon="folder-open" label={t('Open Torrent File')} />}
          items={[
            <MduiMenu key="files">
              <MduiMenuItem icon="archive" onClick={onOpenTorrent}>
                {t('Open Torrent File')}
              </MduiMenuItem>
              <MduiMenuItem icon="insert-drive-file" onClick={onOpenMetalink}>
                {t('Open Metalink File')}
              </MduiMenuItem>
            </MduiMenu>,
          ]}
        />

        <MduiButton
          variant="filled"
          icon="download"
          disabled={!canSubmit}
          loading={submitting}
          onClick={onDownloadNow}
        >
          {t('Download Now')}
        </MduiButton>

        <MduiDropdown
          className="new-task-toolbar__more"
          trigger={
            <MduiIconButton
              icon="expand-more"
              variant="filled"
              label={t('Download Later')}
              disabled={!canSubmit || submitting}
            />
          }
          items={[
            <MduiMenu key="more">
              <MduiMenuItem icon="schedule" onClick={onDownloadLater}>
                {t('Download Later')}
              </MduiMenuItem>
              {showExportCommandApi ? (
                <>
                  <MduiDivider inset middle />
                  <MduiMenuItem icon="content-copy" onClick={onExportCommandApi}>
                    {t('Export Command API')}
                  </MduiMenuItem>
                </>
              ) : null}
            </MduiMenu>,
          ]}
        />
      </div>
    </div>
  );
}