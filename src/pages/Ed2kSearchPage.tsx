/**
 * The aria2-next ED2K search page (`#!/ed2k/search`).
 *
 * This page has no AriaNg counterpart: upstream aria2 has no ED2K support at
 * all, so neither `aria2.ed2kSearch` nor `aria2.getEd2kSearchResults` exists in
 * stock aria2. Everything here is driven by the aria2-next RPC contract:
 *
 * ```
 * aria2.ed2kSearch([secret], keyword[, options])
 *     -> gid of the *search task*
 * aria2.getEd2kSearchResults([secret], gid)
 *     -> { gid, moreResults, results[] }
 * ```
 *
 * The GID returned by `ed2kSearch` identifies a **search**, not a download, so it
 * is deliberately never pushed into the task store — it would show up as a
 * phantom task in the download list.
 *
 * ## Server-side gate
 *
 * Both methods are aria2-next-only. Rather than let the user press Search and
 * read "Method not found", the page asks `getVersion()` first and renders a
 * disabled state when `product !== 'aria2-next'` or `enabledFeatures` does not
 * include `ED2K`.
 *
 * ## Deep links
 *
 * The page is shareable: `#!/ed2k/search?keyword=ubuntu%20iso` runs the search
 * on arrival (see `format.parseKeywordFromHash`).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Routes, appUrl, aria2SettingsRoute } from '@/app/route-paths';
import { MduiIcon } from '@/ui/mdui';
import { parseKeywordFromHash } from './ed2k-search/format';
import { SearchForm } from './ed2k-search/SearchForm';
import { ResultsTable } from './ed2k-search/ResultsTable';
import { useEd2kSearch } from './ed2k-search/useEd2kSearch';
import { useLocalTranslate } from './ed2k-search/index';
import type { Ed2kSupportReason } from './ed2k-search/useEd2kSearch';
import './ed2k-search/styles.css';

/** The explanation shown for each way the gate can fail. */
function unsupportedReasonKey(reason: Ed2kSupportReason | undefined): string {
  switch (reason) {
    case 'feature-disabled':
      return 'ed2k.unsupported.featureDisabled';
    case 'unauthorized':
      return 'ed2k.unsupported.unauthorized';
    case 'version-failed':
      return 'ed2k.unsupported.versionFailed';
    case 'not-aria2-next':
      return 'ed2k.unsupported.notAria2Next';
    default:
      return 'ed2k.unsupported.noDaemon';
  }
}

export default function Ed2kSearchPage() {
  const t = useLocalTranslate();
  const search = useEd2kSearch();
  const { start, stop, clear, support, supportReason, status, keyword, results, moreResults, error } = search;

  const [keywordInput, setKeywordInput] = useState(() =>
    parseKeywordFromHash(typeof window === 'undefined' ? undefined : window.location.hash) ?? '',
  );
  const [options, setOptions] = useState<Record<string, string>>({});

  /** The deep link must fire once per keyword, not on every re-render. */
  const autoStartedFor = useRef<string | null>(null);

  const supported = support === 'supported';

  /* ---------------------------------------------------------------- */
  /* deep link                                                        */
  /* ---------------------------------------------------------------- */

  useEffect(() => {
    const deepLink = parseKeywordFromHash(
      typeof window === 'undefined' ? undefined : window.location.hash,
    );

    if (!deepLink || !supported) {
      return;
    }
    if (autoStartedFor.current === deepLink) {
      return;
    }

    autoStartedFor.current = deepLink;
    setKeywordInput(deepLink);
    void start(deepLink);
  }, [supported, start]);

  /* ---------------------------------------------------------------- */
  /* commands                                                         */
  /* ---------------------------------------------------------------- */

  const onSubmit = useCallback(() => {
    void start(keywordInput, options);
  }, [keywordInput, options, start]);

  const onClear = useCallback(() => {
    clear();
    setKeywordInput('');
    setOptions({});
    autoStartedFor.current = null;
  }, [clear]);

  // A finished or failed search has nothing left to poll; re-running it needs a
  // fresh `ed2kSearch`, and the form's Search button is available again.
  const onRetry = useCallback(() => {
    if (keyword.trim() !== '') {
      void start(keyword, options);
    }
  }, [keyword, options, start]);

  const tableState = useMemo(
    () => ({ status, error, results, moreResults, keyword }),
    [status, error, results, moreResults, keyword],
  );

  /* ---------------------------------------------------------------- */
  /* render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <div className="ed2k-page">
      <header className="ed2k-page__header">
        <h1 className="ed2k-page__title">{t('ed2k.title')}</h1>
        <p className="ed2k-page__subtitle">{t('ed2k.subtitle')}</p>
      </header>

      {support === 'unknown' ? (
        <p className="ed2k-page__checking" role="status" data-testid="ed2k-checking">
          <MduiIcon name="refresh" size="1.25rem" />
          {t('ed2k.checking')}
        </p>
      ) : null}

      {support === 'unsupported' ? (
        <section className="ed2k-page__unsupported" data-testid="ed2k-unsupported" aria-labelledby="ed2k-unsupported-title">
          <MduiIcon name="block" size="2rem" />
          <h2 id="ed2k-unsupported-title" className="ed2k-page__unsupported-title">
            {t('ed2k.unsupported.title')}
          </h2>
          <p className="ed2k-page__unsupported-body">{t(unsupportedReasonKey(supportReason))}</p>
          <a className="ed2k-page__link" href={appUrl(Routes.Status)}>
            {t('ed2k.unsupported.statusPage')}
          </a>
        </section>
      ) : null}

      {supported ? (
        <>
          <SearchForm
            keyword={keywordInput}
            onKeywordChange={setKeywordInput}
            options={options}
            onOptionsChange={setOptions}
            onSubmit={onSubmit}
            onStop={stop}
            onClear={onClear}
            status={status}
            gid={search.gid}
          />

          {/* Explains the one behaviour that is otherwise baffling: nothing
              appears instantly, and a thin result set is normal. */}
          <section className="ed2k-page__how" aria-labelledby="ed2k-how-title">
            <h2 id="ed2k-how-title" className="ed2k-page__how-title">
              {t('ed2k.how.title')}
            </h2>
            <p className="ed2k-page__how-body">{t('ed2k.how.body')}</p>
            <p className="ed2k-page__how-links">
              <a className="ed2k-page__link" href={appUrl(aria2SettingsRoute('ed2k'))}>
                {t('ed2k.how.settings')}
              </a>
              <span className="ed2k-page__how-share">{t('ed2k.how.share')}</span>
            </p>
          </section>

          <ResultsTable state={tableState} options={options} onRetry={onRetry} />
        </>
      ) : null}
    </div>
  );
}
