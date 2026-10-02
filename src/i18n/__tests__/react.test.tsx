import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { createI18n } from '../i18n';
import { getLocaleLoaderFor } from '../locales';
import { I18nProvider, useI18n, useTranslate } from '../react';

/** Renders a translated string through both hooks. */
function Probe(): React.JSX.Element {
  const i18n = useI18n();
  const t = useTranslate();

  return (
    <div>
      <span data-testid="task">{t('Task Name')}</span>
      <span data-testid="locale">{i18n.locale}</span>
      <span data-testid="pattern">{i18n.longDatePattern}</span>
      <span data-testid="locales">{i18n.availableLocales.length}</span>
      <span data-testid="body">{t('format.settings.file-count', { count: 3 })}</span>
    </div>
  );
}

/** A button that switches locale, to exercise the `localechange` subscription. */
function Switcher({ target }: { target: string }): React.JSX.Element {
  const i18n = useI18n();

  return (
    <button type="button" onClick={() => void i18n.setLocale(target)}>
      switch
    </button>
  );
}

describe('I18nProvider / useI18n / useTranslate', () => {
  it('renders English strings and re-renders on a locale change', async () => {
    const store = createI18n({ loader: getLocaleLoaderFor('single'), syncMdui: false });

    await store.ready();

    render(
      <I18nProvider i18n={store}>
        <Probe />
        <Switcher target="ru_RU" />
      </I18nProvider>,
    );

    expect(screen.getByTestId('task')).toHaveTextContent('Task Name');
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
    expect(screen.getByTestId('pattern')).toHaveTextContent('MM/DD/YYYY HH:mm:ss');
    expect(screen.getByTestId('locales')).toHaveTextContent('11');
    expect(screen.getByTestId('body')).toHaveTextContent('(3 Files)');

    await act(async () => {
      screen.getByRole('button', { name: 'switch' }).click();
    });

    expect(store.locale).toBe('ru_RU');
    expect(screen.getByTestId('task')).toHaveTextContent('Имя задачи');
    expect(screen.getByTestId('locale')).toHaveTextContent('ru_RU');
    expect(screen.getByTestId('pattern')).toHaveTextContent('DD/MM/YYYY HH:mm:ss');
    expect(screen.getByTestId('body')).toHaveTextContent('(3 файлов)');
  });

  it('interpolates params from the component that renders the string', () => {
    const store = createI18n({ loader: getLocaleLoaderFor('single'), syncMdui: false });

    render(
      <I18nProvider i18n={store}>
        <Probe />
      </I18nProvider>,
    );

    // Rendered as a text child, so translation markup is never interpreted.
    expect(screen.getByTestId('task').innerHTML).toBe('Task Name');
  });

  it('falls back to the default singleton outside a provider', () => {
    render(<Probe />);

    expect(screen.getByTestId('task')).toHaveTextContent('Task Name');
    expect(screen.getByTestId('locale')).toHaveTextContent('en');
  });

  it('never renders undefined for an unknown key', () => {
    function Unknown(): React.JSX.Element {
      return <span data-testid="x">{useTranslate()('No Such Key')}</span>;
    }

    const store = createI18n({ loader: getLocaleLoaderFor('single'), syncMdui: false });

    render(
      <I18nProvider i18n={store}>
        <Unknown />
      </I18nProvider>,
    );

    expect(screen.getByTestId('x')).toHaveTextContent('No Such Key');
  });
});