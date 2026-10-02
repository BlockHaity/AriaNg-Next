import { describe, expect, it } from 'vitest';

import { createI18n } from '../i18n';
import { ARIA2_NEXT_STRINGS } from '../extensions';
import { getLocaleLoaderFor } from '../locales';

/**
 * The overlay exists because AriaNg predates ED2K and native media, so those
 * keys cannot exist in any of its locale files. These tests pin the two
 * behaviours that matter: the keys resolve to real copy, and a locale inherits
 * them through the English fallback without losing its own translations.
 */
describe('aria2-next translation overlay', () => {
  it('resolves keys AriaNg never had', async () => {
    const i18n = createI18n({ loader: getLocaleLoaderFor('single'), syncMdui: false });
    await i18n.ready();

    // Keys whose copy differs from the key itself, so a miss is detectable.
    expect(i18n.t('options.ed2k-server.name')).toBe('ED2K Server');
    expect(i18n.t('options.media-video.name')).toBe('Media Video Track');
    expect(i18n.t('options.bt-encryption.name')).toBe('Peer Encryption');
    expect(i18n.t('options.filename-hint.name')).toBe('File Name Hint');
    expect(i18n.t('format.media.duration-unknown')).toContain('total duration');

    for (const key of Object.keys(ARIA2_NEXT_STRINGS)) {
      expect(i18n.t(key), key).not.toBe('');
    }
  });

  it('covers every aria2-next-only option with a name', async () => {
    const i18n = createI18n({ loader: getLocaleLoaderFor('single'), syncMdui: false });
    await i18n.ready();

    // Every option key that is new in aria2-next must have an editor label;
    // otherwise the option row falls back to a title-cased key, which reads as
    // untranslated even in English.
    const aria2NextOnly = [
      'filename-hint',
      'filename-hint-source',
      'stream-max-connections',
      'stream-max-range-size',
      'state-dir',
      'select-file',
      'bt-encryption',
      'bt-disk-io',
      'bt-user-agent',
      'detach-share-only',
      'ed2k-server',
      'ed2k-piece-selector',
      'media',
      'media-format',
      'media-video',
      'media-audio',
      'media-subtitles',
      'media-pause-after-probe',
      'media-request-contexts',
      'media-record-time',
      'media-start-time',
      'media-end-time',
      'media-input',
    ];

    for (const key of aria2NextOnly) {
      expect(i18n.t(`options.${key}.name`), key).not.toBe(`options.${key}.name`);
    }
  });

  it('is inherited by every locale through the English fallback', async () => {
    const i18n = createI18n({ loader: getLocaleLoaderFor('single'), syncMdui: false });
    await i18n.ready();
    await i18n.setLocale('zh_Hans');

    // Inherited from English...
    expect(i18n.t('options.ed2k-server.name')).toBe('ED2K Server');
    expect(i18n.t('format.media.retry-hint')).toContain('GID');

    // ...while the locale's own translations are untouched.
    expect(i18n.t('File Name')).not.toBe('File Name');
    expect(i18n.t('Task Name')).not.toBe('Task Name');
  });
});
