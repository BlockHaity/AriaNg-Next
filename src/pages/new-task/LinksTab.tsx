/**
 * The first tab of the new-task page — `views/new.html`'s first `.tab-pane`.
 *
 * Two mutually exclusive forms, exactly like AriaNg:
 *
 * - a 10-row textarea of links (one URL per line) with live success/error
 *   feedback and the `Ctrl/⌘ + Enter` shortcut, or
 * - a read-only file-name field, once a `.torrent` / metalink file was loaded
 *   through the 📂 dropdown.
 *
 * Validity is owned by the page (it also needs the parsed list to submit);
 * this component only renders it.
 */

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { useTranslate } from '@/i18n/react';
import { MduiButton, MduiIcon, MduiTextField, MduiTextarea } from '@/ui/mdui';
import type { NewTaskFileDraft, NewTaskKind, UrlValidationResult } from './validation';

/** AriaNg's `<textarea rows="10">`. */
const LINK_ROWS = 10;

export interface LinksTabProps {
  kind: NewTaskKind;
  /** Raw textarea contents (the deep-link prefill writes straight into it). */
  urlsText: string;
  /** Result of `validateUrls(urlsText)`. */
  result: UrlValidationResult;
  file?: NewTaskFileDraft;
  /** Mirrors `settings.keyboardShortcuts`; gates the `Ctrl/⌘ + Enter` shortcut. */
  keyboardShortcuts: boolean;
  onUrlsChange: (text: string) => void;
  /** "Download Now" — the page re-checks validity before doing anything. */
  onSubmit: () => void;
  /** Clears a loaded file so the link form comes back. */
  onClearFile?: () => void;
  /** Give the textarea focus on mount (the default for the links form). */
  autoFocus?: boolean;
}

/** AriaNg's `isCtrlEnterPressed`. */
export function isCtrlEnterPressed(event: KeyboardEvent): boolean {
  return event.key === 'Enter' && (event.ctrlKey || event.metaKey);
}

/**
 * mdui owns the real `<textarea>` inside its shadow root, so the host element is
 * what has to be focused; `focus()` only exists once the element is upgraded.
 */
function focusHost(container: HTMLElement | null): void {
  const field = container?.querySelector('mdui-text-field') as (HTMLElement & { focus?: () => void }) | null;
  field?.focus?.();
}

/** The offending line AriaNg highlighted with `has-error`. */
function firstInvalid(result: UrlValidationResult): string {
  return result.invalid[0] ?? '';
}

export function LinksTab(props: LinksTabProps) {
  const { kind, urlsText, result, file, keyboardShortcuts, onUrlsChange, onSubmit, onClearFile, autoFocus } = props;
  const t = useTranslate();
  const [dirty, setDirty] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  const isFileKind = kind === 'torrent' || kind === 'metalink';

  useEffect(() => {
    if (isFileKind || !autoFocus) {
      return;
    }

    focusHost(hostRef.current);
  }, [autoFocus, isFileKind]);

  // `keydown` is composed, so it still crosses mdui's shadow boundary and lands
  // here — the wrapper listener is the only way to see the modifier keys.
  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!keyboardShortcuts || !isCtrlEnterPressed(event)) {
      return;
    }

    event.preventDefault();
    onSubmit();
  };

  if (isFileKind) {
    return (
      <div className="new-task-links" ref={hostRef}>
        <MduiTextField
          value={file?.name ?? ''}
          label={t('File Name')}
          disabled
          helperText={file ? undefined : t('Open Torrent File')}
        />

        {onClearFile ? (
          <MduiButton variant="text" icon="close" onClick={onClearFile}>
            {t('Clear')}
          </MduiButton>
        ) : null}
      </div>
    );
  }

  const invalid = dirty ? firstInvalid(result) : '';

  return (
    <div className="new-task-links" ref={hostRef} onKeyDown={handleKeyDown}>
      <p className="new-task-links__title">{t('format.task.new.download-links', { count: result.urls.length })}</p>

      <div className="new-task-links__field">
        <MduiTextarea
          value={urlsText}
          label={t('Download Links:')}
          rows={LINK_ROWS}
          placeholder={t('Support multiple URLs, one URL per line.')}
          error={invalid || undefined}
          helperText={invalid || t('Support multiple URLs, one URL per line.')}
          onInput={(value) => {
            setDirty(true);
            onUrlsChange(value);
          }}
        />

        {/* AriaNg's `has-success` / `has-error` feedback glyph, shown once dirty. */}
        <span className="new-task-links__feedback" aria-hidden="true">
          {dirty ? (
            result.isValid ? (
              <MduiIcon name="check" className="new-task-links__feedback--ok" />
            ) : (
              <MduiIcon name="error" className="new-task-links__feedback--error" />
            )
          ) : null}
        </span>
      </div>

      {/* Announced as soon as the field turns invalid, not only when the
          textarea's own error slot paints. */}
      <span className="ariang-visually-hidden" role="status" aria-live="polite">
        {invalid}
      </span>
    </div>
  );
}