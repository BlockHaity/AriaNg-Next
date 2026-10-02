/**
 * One aria2 option group (`/settings/aria2/:group`) — AriaNg's
 * `settings-aria2.html`, which was eight lines of pure data:
 *
 * ```html
 * <ng-setting ng-repeat="option in context.availableOptions" option="option"
 *             ng-model="context.globalOptions[option.key]" … />
 * ```
 *
 * Everything that varies per row now lives in the shared `OptionRow`, so this
 * component only does the three things the page cannot do for it:
 *
 * 1. render the keys the route asked for (`getGlobalOptionKeys`, which already
 *    dropped the options aria2-next retired);
 * 2. own the "save failed" message, because `OptionRow` deliberately draws no
 *    message of its own — AriaNg's `optionStatus.setFailed(response.data.message)`
 *    had none either;
 * 3. keep AriaNg's alternating error-tooltip placement (`top` for every row but
 *    the first, `bottom` for the first).
 */

import { getOptionMeta } from '@/config/aria2-options';
import { useTranslate } from '@/i18n/react';
import { OptionRow } from '@/components/option-row';

export interface OptionGroupViewProps {
  /** Option keys of this route, in the order `getGlobalOptionKeys` returned them. */
  keys: readonly string[];
  /** Current value per key, seeded from `aria2.getGlobalOption`. */
  values: Readonly<Record<string, string>>;
  /**
   * Failed-save message per key.
   *
   * `OptionRow` shows a warning glyph for a rejected save; this is the text, and
   * it is what the tooltip (and the live region) announces.
   */
  errors: Readonly<Record<string, string>>;
  /** Called with the coerced value and the key. */
  onChange: (key: string, value: string) => void;
}

export function OptionGroupView(props: OptionGroupViewProps) {
  const { keys, values, errors, onChange } = props;
  const t = useTranslate();

  return (
    <div className="aria2-settings__group">
      {keys.map((key, index) => {
        const error = errors[key] ?? '';
        // AriaNg: `error-tooltip-placement="{{$index > 0 ? 'top': 'bottom'}}"` —
        // the first row's tooltip opens downwards so it does not leave the
        // viewport at the top of the scroll area, every other row upwards.
        const placement = index > 0 ? 'top' : 'bottom';

        return (
          <div key={key} className="aria2-settings__card" data-placement={placement}>
            <OptionRow
              optionKey={key}
              value={values[key]}
              // AriaNg passed `default-value="option.defaultValue"`, which the
              // directive used as the input's placeholder.
              globalValue={getOptionMeta(key)?.defaultValue}
              lazySaveTimeout={0}
              onChange={(value) => {
                onChange(key, value);
              }}
            />

            {requiresAria2Next(key) ? (
              <p className="aria2-settings__note">
                {t('This option requires aria2-next, or a newer version of aria2.')}
              </p>
            ) : null}

            {/*
              The tooltip is always in the DOM so its placement can be asserted
              and read by assistive technology; only the message is conditional.
            */}
            <div
              className={`aria2-settings__error aria2-settings__error--${placement}`}
              role="tooltip"
              data-placement={placement}
            >
              {error}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * `since === 'aria2-next'` marks an option the connected daemon may not know.
 *
 * AriaNg had no equivalent (its catalogue was aria2-only); the option table
 * already distinguishes `'aria2-next'` from a concrete version, so the two cases
 * get two different sentences.
 */
export function requiresAria2Next(key: string): boolean {
  return getOptionMeta(key)?.since === 'aria2-next';
}

export default OptionGroupView;