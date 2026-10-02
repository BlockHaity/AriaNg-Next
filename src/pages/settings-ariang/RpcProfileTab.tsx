/**
 * One **RPC profile** tab of `/settings/ariang` — AriaNg's per-`rpcSetting`
 * `tab-pane`.
 *
 * The eight rows are 1:1 with `settings-ariang.html`: alias, the composite
 * address, protocol, HTTP method, request headers, secret token, the Export
 * Command API button and the Activate / tip footer.
 *
 * ## Hot-apply instead of reload
 *
 * AriaNg called `$window.location.reload()` from `updateRpcSetting`,
 * `addNewRpcSetting`, `removeRpcSetting` and `setDefaultRpcSetting`, because its
 * RPC service was constructed once at bootstrap. Here `Activate` calls
 * `useRpcStore.getState().applyProfile(...)`, which swaps the transport in
 * place, clears the caches that belonged to the old server and re-requests the
 * version — so the connection changes without the page blinking.
 */

import { useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { RpcHttpMethod, RpcProfile, RpcProtocol } from '@/config/types';
import { rpcProfileDisplayName } from '@/config/defaults';
import { useTranslate } from '@/i18n/react';
import { useProfilesStore } from '@/store/profiles';
import { useRpcStore } from '@/store/rpc-store';
import { useSettingsStore } from '@/store/settings';
import {
  MduiButton,
  MduiIconButton,
  MduiSelect,
  MduiTextarea,
  MduiTextField,
  MduiTooltip,
} from '@/ui/mdui';
import type { MduiSelectItem } from '@/ui/mdui';

import './styles.css';

/**
 * Window event the page dispatches when the user asks for the Export Command
 * API dialog.
 *
 * The dialog itself belongs to another page (it is also reachable from the
 * new-task page), so this page never imports it. A host that owns the dialog
 * listens for this event; a host that prefers props passes
 * {@link RpcProfileTabProps.onExportCommandApi} instead and ignores the event.
 */
export const EXPORT_COMMAND_API_EVENT = 'ariang:export-command-api';

export interface ExportCommandApiDetail {
  profile: RpcProfile;
  /** Where the action was triggered from. */
  source: 'settings';
}

/** Protocol list, in AriaNg's order. */
const PROTOCOLS: readonly RpcProtocol[] = ['http', 'https', 'ws', 'wss'];

/** HTTP methods aria2 accepts. */
const HTTP_METHODS: readonly RpcHttpMethod[] = ['POST', 'GET'];

/**
 * Strict `name: value` parse of the request-header block.
 *
 * AriaNg's `aria2HttpRpcService` split each line on `:` and **skipped any line
 * that did not yield exactly two parts** — so a value may not contain a colon,
 * and the same rule is reproduced in `rpc/transport/http.ts`. The UI shows the
 * rejected lines so the user knows which ones will be silently dropped.
 */
export function parseRequestHeaderLines(raw: string): { accepted: string[]; rejected: string[] } {
  const accepted: string[] = [];
  const rejected: string[] = [];

  for (const line of (raw ?? '').split('\n')) {
    if (line.trim() === '') continue;
    if (line.split(':').length === 2) {
      accepted.push(line);
    } else {
      rejected.push(line);
    }
  }

  return { accepted, rejected };
}

export interface RpcProfileTabProps {
  profile: RpcProfile;
  /** Ask the host to open the Export Command API dialog for this profile. */
  onExportCommandApi?: (profile: RpcProfile) => void;
  /** True when this profile is the one currently connected. */
  active?: boolean;
}

export function RpcProfileTab({ profile, onExportCommandApi, active = false }: RpcProfileTabProps) {
  const t = useTranslate();
  const update = useProfilesStore((state) => state.update);
  const setDefault = useProfilesStore((state) => state.setDefault);
  const isProtocolDisabled = useProfilesStore((state) => state.isProtocolDisabled);
  const webSocketReconnectInterval = useSettingsStore((state) => state.settings.webSocketReconnectInterval);

  const [showSecret, setShowSecret] = useState(false);

  const write = useCallback(
    (patch: Partial<RpcProfile>) => {
      update(profile, patch);
    },
    [profile, update],
  );

  const isHttp = profile.protocol === 'http' || profile.protocol === 'https';

  const protocolItems: MduiSelectItem[] = useMemo(
    () =>
      PROTOCOLS.map((protocol) => {
        // AriaNg appended ` (Disabled)` to the label as well as setting the
        // attribute, so the reason is readable without hovering.
        const disabled = isProtocolDisabled(protocol);
        const base =
          protocol === 'http'
            ? 'Http'
            : protocol === 'https'
              ? 'Https'
              : protocol === 'ws'
                ? 'WebSocket'
                : 'WebSocket (Security)';
        return {
          value: protocol,
          disabled,
          label: disabled ? `${base} (Disabled)` : base,
        };
      }),
    [isProtocolDisabled],
  );

  const headerLines = useMemo(() => parseRequestHeaderLines(profile.rpcRequestHeaders), [profile.rpcRequestHeaders]);

  /**
   * Activate: promote this profile to the default one and connect to it.
   *
   * `keepPreviousAsEntry` is AriaNg's behaviour (`setDefaultRpcSetting` pushed
   * the outgoing default into the list), so switching profiles is reversible.
   *
   * The profile passed to `applyProfile` is the one being activated, not the
   * previously active entry: `setDefault` copies the stored profile into the
   * top-level slot, so both describe the same connection.
   */
  const activate = useCallback(() => {
    if (profile.isDefault) return;
    setDefault(profile, { keepPreviousAsEntry: true });
    useRpcStore.getState().applyProfile(profile, webSocketReconnectInterval);
  }, [profile, setDefault, webSocketReconnectInterval]);

  const exportCommandApi = useCallback(() => {
    onExportCommandApi?.(profile);

    if (typeof window === 'undefined') return;
    const detail: ExportCommandApiDetail = { profile, source: 'settings' };
    window.dispatchEvent(new CustomEvent<ExportCommandApiDetail>(EXPORT_COMMAND_API_EVENT, { detail }));
  }, [onExportCommandApi, profile]);

  const aliasPlaceholder = profile.rpcHost ? `${profile.rpcHost}:${profile.rpcPort}` : '';

  return (
    <div className="settings-ariang__rpc">
      <MduiCardish>
        <SettingRow
          label={t('Aria2 RPC Alias')}
          hint={profile.isDefault ? t('Default') : rpcProfileDisplayName(profile)}
        >
          <MduiTextField
            value={profile.rpcAlias}
            label={t('Aria2 RPC Alias')}
            placeholder={aliasPlaceholder}
            variant="outlined"
            onInput={(next) => write({ rpcAlias: next })}
            clearable
          />
        </SettingRow>

        <SettingRow label={t('Aria2 RPC Address')}>
          <div className="rpc-address">
            {/* AriaNg rendered the scheme here as a static input-group addon and
                kept the editable protocol select one row below. The brief asks
                for a select here, so it is the same bound field twice: handy on
                a narrow screen, and never out of sync because both write
                `profile.protocol`. */}
            <MduiSelect
              value={profile.protocol}
              items={protocolItems}
              label={t('Aria2 RPC Protocol')}
              variant="outlined"
              onChange={(next) => write({ protocol: next as RpcProtocol })}
            />
            <MduiTextField
              className="rpc-address__host"
              value={profile.rpcHost}
              label={t('Host')}
              variant="outlined"
              onInput={(next) => write({ rpcHost: next })}
            />
            <span className="rpc-address__separator" aria-hidden="true">
              :
            </span>
            <MduiTextField
              className="rpc-address__port"
              value={profile.rpcPort}
              label={t('Port')}
              variant="outlined"
              onInput={(next) => write({ rpcPort: next })}
            />
            <span className="rpc-address__separator" aria-hidden="true">
              /
            </span>
            <MduiTextField
              className="rpc-address__interface"
              value={profile.rpcInterface}
              label={t('Interface')}
              variant="outlined"
              onInput={(next) => write({ rpcInterface: next })}
            />
          </div>
        </SettingRow>

        <SettingRow
          label={t('Aria2 RPC Protocol')}
          tooltip={t('Http and WebSocket would be disabled when accessing AriaNg via Https.')}
        >
          <MduiSelect
            value={profile.protocol}
            items={protocolItems}
            label={t('Aria2 RPC Protocol')}
            variant="outlined"
            onChange={(next) => write({ protocol: next as RpcProtocol })}
          />
        </SettingRow>

        {isHttp ? (
          <SettingRow
            label={t('Aria2 RPC Http Request Method')}
            tooltip={t('POST method only supports aria2 v1.15.2 and above.')}
          >
            <MduiSelect
              value={profile.httpMethod}
              items={HTTP_METHODS.map((method) => ({ value: method, label: t(method) }))}
              label={t('Aria2 RPC Http Request Method')}
              variant="outlined"
              onChange={(next) => write({ httpMethod: next as RpcHttpMethod })}
            />
          </SettingRow>
        ) : null}

        {isHttp ? (
          <SettingRow label={t('Aria2 RPC Request Headers')}>
            <div className="title-editor">
              <MduiTextarea
                value={profile.rpcRequestHeaders}
                rows={4}
                label={t('Aria2 RPC Request Headers')}
                placeholder={t(
                  'Support multiple request headers, one header per line, each line containing "header name: header value".',
                )}
                onInput={(next) => write({ rpcRequestHeaders: next })}
              />
              {headerLines.rejected.length > 0 ? (
                <p className="settings-row__hint settings-row__hint--error" role="status">
                  {t('Ignored line(s) — each header line must contain exactly one ":" and the value may not contain one:')}{' '}
                  {headerLines.rejected.join(', ')}
                </p>
              ) : null}
            </div>
          </SettingRow>
        ) : null}

        <SettingRow label={t('Aria2 RPC Secret Token')}>
          <div className="secret-field">
            <MduiTextField
              value={profile.secret}
              type={showSecret ? 'text' : 'password'}
              label={t('Aria2 RPC Secret Token')}
              variant="outlined"
              onInput={(next) => write({ secret: next })}
              clearable
            />
            <MduiIconButton
              icon="visibility"
              variant="standard"
              toggle
              selected={showSecret}
              selectedIcon="key"
              label={t(showSecret ? 'Hide Secret' : 'Show Secret')}
              onClick={() => setShowSecret((current) => !current)}
            />
          </div>
        </SettingRow>

        <SettingRow label={t('Export Command API')}>
          <MduiButton variant="outlined" icon="terminal" onClick={exportCommandApi}>
            {t('Export')}
          </MduiButton>
        </SettingRow>

        <div className="settings-tips">
          {active ? (
            <span role="status" className="settings-row__hint">
              {t('Connected')}
            </span>
          ) : null}
          <div className="settings-tips__buttons">
            <MduiButton
              variant="text"
              icon="check"
              disabled={Boolean(profile.isDefault)}
              onClick={activate}
            >
              {t('Activate')}
            </MduiButton>
          </div>
        </div>
      </MduiCardish>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* row helpers                                                        */
/* ------------------------------------------------------------------ */

/**
 * The RPC rows are not grouped into titled cards in AriaNg (one flat table per
 * tab), so this is a plain bordered section rather than `<mdui-card>`.
 */
function MduiCardish({ children }: { children: ReactNode }) {
  return <div className="settings-section settings-ariang__rpc-rows">{children}</div>;
}

function SettingRow(props: {
  label: string;
  hint?: string;
  tooltip?: string;
  children: ReactNode;
}) {
  const { label, hint, tooltip, children } = props;

  return (
    <div className="settings-row">
      <div className="settings-row__key">
        <span className="settings-row__label">{label}</span>
        {hint ? <span className="settings-row__hint">{hint}</span> : null}
        {tooltip ? (
          <MduiTooltip content={tooltip} placement="top" trigger="hover">
            <MduiIconButton icon="info" variant="standard" label={tooltip} />
          </MduiTooltip>
        ) : null}
      </div>
      <div className="settings-row__value settings-row__value--stack">{children}</div>
    </div>
  );
}

export default RpcProfileTab;