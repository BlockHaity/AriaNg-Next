/**
 * The keyword box plus the Advanced request-options section.
 *
 * `aria2.ed2kSearch([secret], keyword[, options])` takes the same request options
 * as any other aria2 call, which is what makes a per-search override possible
 * without touching the daemon's global configuration: the three discovery
 * options the manual documents — `--ed2k-server` (a comma-separated `HOST:PORT`
 * list), `--ed2k-server-list` (a local eMule `server.met`) and `--ed2k-node-list`
 * (a local eMule `nodes.dat`) — are all accepted here.
 *
 * Blank fields are stripped before the call (`compactOptions` in the hook), so
 * leaving the section untouched sends `{}` and the daemon falls back to its
 * globals. Those **current global values** are shown as the placeholders, so
 * "unset" is visible rather than mysterious.
 *
 * The control semantics deliberately mirror the option editor: one text field
 * holding the whole value, with the comma separator described in the helper text
 * instead of a separate input per item.
 */

import { useCallback, useEffect, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { getOptionMeta } from '@/config/aria2-options';
import type { Aria2Client } from '@/rpc/contract';
import { useRpcStore } from '@/store/rpc-store';
import { MduiButton, MduiCollapse, MduiCollapseItem, MduiTextField } from '@/ui/mdui';
import { ED2K_SEARCH_OPTION_KEYS, optionHint, optionLabel, useLocalTranslate } from './index';

export interface SearchFormProps {
  keyword: string;
  onKeywordChange: (keyword: string) => void;
  /** Advanced option values keyed by aria2 option name; blank entries allowed. */
  options: Record<string, string>;
  onOptionsChange: (options: Record<string, string>) => void;
  onSubmit: () => void;
  onStop: () => void;
  onClear: () => void;
  status: 'idle' | 'starting' | 'searching' | 'done' | 'error';
  /** Disables everything (the page uses it while the daemon is unsupported). */
  disabled?: boolean;
  /** GID of the running search, shown under the box. */
  gid?: string | null;
}

/**
 * The aria2-next notes are authored in reStructuredText for the manual, so they
 * arrive with `` `` `` and `**` markup. Those are stripped before display —
 * English text must never be rendered as-is from a markup source.
 */
function plainText(markup: string | undefined): string | undefined {
  if (!markup) {
    return undefined;
  }
  const plain = markup.replace(/``/g, '').replace(/\*\*/g, '').trim();
  return plain === '' ? undefined : plain;
}

/**
 * Helper line of one advanced option: what the option is, then what the daemon
 * will fall back to when the field is left blank.
 */
function describeOption(
  key: string,
  t: (key: string, params?: Record<string, string | number | boolean>) => string,
  global: string | undefined,
): string | undefined {
  const parts: string[] = [];

  const note = plainText(getOptionMeta(key)?.aria2NextNote);
  if (note) {
    parts.push(note);
  }

  const hint = optionHint(key, t);
  if (hint) {
    parts.push(hint);
  }

  if (global) {
    parts.push(t('ed2k.usingGlobal', { value: global }));
  }

  return parts.length > 0 ? parts.join(' ') : undefined;
}

export function SearchForm(props: SearchFormProps) {
  const {
    keyword,
    onKeywordChange,
    options,
    onOptionsChange,
    onSubmit,
    onStop,
    onClear,
    status,
    disabled = false,
    gid = null,
  } = props;

  const t = useLocalTranslate();
  const client = useRpcStore((state) => state.client);
  const [expanded, setExpanded] = useState<string[]>([]);
  /** The daemon's global options for the *currently attached* client. */
  const [loaded, setLoaded] = useState<{ client: Aria2Client; options: Record<string, string> } | null>(null);

  const running = status === 'starting' || status === 'searching';

  // Derived rather than reset in an effect: a hot profile swap must not leave
  // the previous profile's servers sitting in the placeholders.
  const globals = loaded && loaded.client === client ? loaded.options : {};

  // Re-read whenever the daemon changes.
  useEffect(() => {
    if (!client) {
      return;
    }

    let cancelled = false;

    void client.getGlobalOption().then((result) => {
      if (cancelled || !result.success) {
        return;
      }
      setLoaded({ client, options: result.data ?? {} });
    });

    return () => {
      cancelled = true;
    };
  }, [client]);

  const setOption = useCallback(
    (key: string, value: string) => {
      onOptionsChange({ ...options, [key]: value });
    },
    [options, onOptionsChange],
  );

  const submit = useCallback(() => {
    if (!disabled && !running) {
      onSubmit();
    }
  }, [disabled, running, onSubmit]);

  /**
   * Enter submits from anywhere in the form.
   *
   * `MduiTextField.onEnter` covers the keyword box itself (mdui forwards
   * `keydown` across the shadow boundary); this handler covers the Advanced
   * fields, which are ordinary light-DOM mdui text fields.
   */
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      submit();
    },
    [submit],
  );

  return (
    <section
      className="ed2k-form"
      aria-label={t('ed2k.keyword')}
      onKeyDown={onKeyDown}
      data-testid="ed2k-search-form"
    >
      <div className="ed2k-form__row">
        <MduiTextField
          className="ed2k-form__keyword"
          value={keyword}
          type="search"
          label={t('ed2k.keyword')}
          placeholder={t('ed2k.keywordPlaceholder')}
          icon="search"
          variant="outlined"
          disabled={disabled}
          clearable
          onInput={onKeywordChange}
          onEnter={(value) => {
            onKeywordChange(value);
            submit();
          }}
        />

        <MduiButton
          className="ed2k-form__submit"
          variant="filled"
          icon={running ? undefined : 'search'}
          disabled={disabled || running}
          onClick={submit}
        >
          {status === 'starting' ? (
            // `mdui-circular-progress` without a `value` is the indeterminate
            // spinner. The label is replaced rather than appended so the button
            // keeps a stable width, and `aria-label` carries the announcement.
            <mdui-circular-progress aria-label={t('ed2k.searching')} />
          ) : (
            t('ed2k.search')
          )}
        </MduiButton>

        {running ? (
          <MduiButton variant="outlined" icon="stop" disabled={disabled} onClick={onStop}>
            {t('ed2k.stop')}
          </MduiButton>
        ) : (
          <MduiButton variant="text" icon="close" disabled={disabled} onClick={onClear}>
            {t('ed2k.clear')}
          </MduiButton>
        )}
      </div>

      {gid ? (
        <p className="ed2k-form__gid" data-testid="ed2k-search-gid">
          <span className="ed2k-form__gid-label">{t('ed2k.results')}</span>
          <code>{gid}</code>
        </p>
      ) : null}

      <MduiCollapse className="ed2k-form__advanced" value={expanded} onExpandChange={setExpanded}>
        <MduiCollapseItem value="advanced" header={t('ed2k.advanced')}>
          <p className="ed2k-form__hint">{t('ed2k.advanced.hint')}</p>

          {ED2K_SEARCH_OPTION_KEYS.map((key) => {
            const global = globals[key];

            return (
              <MduiTextField
                key={key}
                className="ed2k-form__option"
                value={options[key] ?? ''}
                label={optionLabel(key, t)}
                placeholder={global || undefined}
                helperText={describeOption(key, t, global)}
                variant="outlined"
                disabled={disabled}
                onInput={(value) => setOption(key, value)}
              />
            );
          })}

          </MduiCollapseItem>
      </MduiCollapse>
    </section>
  );
}

export default SearchForm;
