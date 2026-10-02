/**
 * `/status` — Aria2 status / about.
 *
 * A 1:1 port of `views/status.html` + `controllers/status.js`: the RPC
 * address, the coloured connection state, the version, the enabled-feature list
 * and the daemon operations. AriaNg refreshed the version from a `$watch` on
 * `taskContext.rpcStatus`; here the same rule is an effect keyed on
 * `connection.status`.
 *
 * On top of that this screen is the "About" page for **aria2-next**, which is
 * the whole point of re-implementing it:
 *
 * - `getVersion().product` / `rpcVersion` are shown so the user can tell at a
 *   glance whether they are talking to aria2-next or to upstream aria2 (the
 *   two have a visibly different feature set);
 * - `downloadFeatures` / `mediaFeatures` get their own chip groups;
 * - `getSessionInfo().sessionId` is surfaced — it is what bug reports need;
 * - an **Engine capabilities** section explains, in the user's language, which
 *   UI features the connected daemon can actually drive;
 * - **Copy Diagnostics** produces a small JSON blob for a bug report. The RPC
 *   secret is **redacted**: that blob is meant to be pasted into a public
 *   issue, and the secret is the one value in the app that grants full control
 *   of the daemon.
 *
 * Every colour comes from an `--mdui-color-*` token. MD3 has no dedicated
 * "success" role, so a *positive* state is expressed with the tertiary role
 * (the palette's affirmative accent), which is the same mapping the rest of the
 * app uses for "it worked".
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { RpcStatus } from '@/config/rpc-constants';
import { useTranslate } from '@/i18n';
import { copyText } from '@/utils/clipboard';
import { notifyInPage } from '@/store/notifications';
import { isWebSocketProfile, rpcProfileDisplayName, rpcProfileUrl, useProfilesStore } from '@/store/profiles';
import { saveSession, shutdownAria2 } from '@/store/commands';
import { useRpcStore } from '@/store/rpc-store';
import type { Aria2SessionInfo } from '@/rpc/types';
import { confirmDialog } from '@/ui/mdui';
import {
  MduiButton,
  MduiCard,
  MduiCheckbox,
  MduiChip,
  MduiDivider,
  MduiTooltip,
} from '@/ui/mdui';

/* ------------------------------------------------------------------ */
/* presentation helpers                                                 */
/* ------------------------------------------------------------------ */

/** Placeholder AriaNg used wherever a value cannot be read. */
const DASH = '-';

/**
 * The placeholder the diagnostics blob shows instead of the secret.
 *
 * MANDATORY: {@link diagnosticsBlob} output is meant to be pasted into a
 * *public* bug report. The RPC secret authenticates every request to the
 * daemon, so it must never reach the clipboard. Only its presence is
 * interesting to a maintainer, which is why a fixed marker is emitted rather
 * than the value (or a hash of it).
 */
export const REDACTED_SECRET = '***redacted***';

/**
 * How the connection state is coloured — straight from `status.html`'s
 * `ng-class` map: primary while connecting, neutral while waiting out the
 * reconnect delay, affirmative once connected, error role once disconnected.
 */
export type RpcStatusTone = 'primary' | 'neutral' | 'success' | 'danger';

export function rpcStatusTone(status: string): RpcStatusTone {
  switch (status) {
    case RpcStatus.Connecting:
    case RpcStatus.Reconnecting:
      return 'primary';
    case RpcStatus.Connected:
      return 'success';
    case RpcStatus.Disconnected:
      return 'danger';
    default:
      // `Waiting to reconnect` — nothing is wrong yet, nothing is working.
      return 'neutral';
  }
}

/** AriaNg only offered the reconnect button while the link was really down. */
function canReconnect(status: string): boolean {
  return status === RpcStatus.Disconnected || status === RpcStatus.WaitingToReconnect;
}

/** Spinner while a call may still answer, `-` while there is no link at all. */
function isConnecting(status: string): boolean {
  return status === RpcStatus.Connecting || status === RpcStatus.Reconnecting || status === RpcStatus.Connected;
}

/** Feature-flag verdict shown in the capabilities section. */
export type CapabilityState = 'enabled' | 'disabled' | 'unknown';

/**
 * A missing list means **unknown**, deliberately distinct from `disabled`:
 * upstream aria2 has no such field at all, so "not listed" must never read as
 * "not supported".
 */
export function verdict(flags: readonly string[] | undefined, needles: readonly string[]): CapabilityState {
  if (!flags) return 'unknown';
  return needles.some((needle) => flags.includes(needle)) ? 'enabled' : 'disabled';
}

const ED2K_FEATURES = ['ED2K'];
const MEDIA_FEATURES = ['request-contexts', 'stable-track-ids', 'structured-errors'];
const FILENAME_FEATURES = ['filename-hints', 'filename-resolution'];
const BITTORRENT_FEATURES = ['BitTorrent'];

/* ------------------------------------------------------------------ */
/* token-based styling                                                  */
/* ------------------------------------------------------------------ */

const GRID: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(9rem, 1fr) minmax(0, 2fr)',
  columnGap: '1rem',
  rowGap: '0.75rem',
  alignItems: 'start',
  padding: '1rem',
};

const KEY: CSSProperties = {
  fontFamily: 'var(--mdui-typescale-title-small-font-family)',
  fontSize: 'var(--mdui-typescale-title-small-size)',
  lineHeight: 'var(--mdui-typescale-title-small-line-height)',
  fontWeight: 'var(--mdui-typescale-title-small-font-weight)',
  color: 'rgb(var(--mdui-color-on-surface-variant))',
};

const VALUE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.5rem',
  minWidth: 0,
  fontFamily: 'var(--mdui-typescale-body-medium-font-family)',
  fontSize: 'var(--mdui-typescale-body-medium-size)',
};

const BREAKABLE: CSSProperties = { minWidth: 0, wordBreak: 'break-all' };

const HEADING: CSSProperties = {
  ...KEY,
  fontFamily: 'var(--mdui-typescale-title-medium-font-family)',
  fontSize: 'var(--mdui-typescale-title-medium-size)',
  lineHeight: 'var(--mdui-typescale-title-medium-line-height)',
};

/** A `setting-key` / `setting-value` pair, AriaNg's 4/8 grid row. */
function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="ariang-setting-key" style={KEY}>
        {label}
      </div>
      <div className="ariang-setting-value" style={VALUE}>
        {children}
      </div>
    </>
  );
}

/** A pill whose tone is the only thing that carries meaning. */
function TonePill({ tone, children }: { tone: RpcStatusTone | CapabilityState; children: ReactNode }) {
  const background =
    tone === 'success'
      ? 'rgb(var(--mdui-color-tertiary-container))'
      : tone === 'danger'
        ? 'rgb(var(--mdui-color-error-container))'
        : tone === 'primary'
          ? 'rgb(var(--mdui-color-primary-container))'
          : 'rgb(var(--mdui-color-surface-variant))';

  const foreground =
    tone === 'success'
      ? 'rgb(var(--mdui-color-on-tertiary-container))'
      : tone === 'danger'
        ? 'rgb(var(--mdui-color-on-error-container))'
        : tone === 'primary'
          ? 'rgb(var(--mdui-color-on-primary-container))'
          : 'rgb(var(--mdui-color-on-surface-variant))';

  return (
    <span
      data-tone={tone}
      style={{
        backgroundColor: background,
        color: foreground,
        borderRadius: 'var(--mdui-shape-corner-small)',
        padding: '0.1rem 0.5rem',
        fontFamily: 'var(--mdui-typescale-label-medium-font-family)',
        fontSize: 'var(--mdui-typescale-label-medium-size)',
        lineHeight: 'var(--mdui-typescale-label-medium-line-height)',
      }}
    >
      {children}
    </span>
  );
}

/**
 * The one rule a spinner cannot be expressed with: the rotation.
 *
 * It lives here rather than in `debug.css` because that stylesheet belongs to
 * the debug page and this page must stay self-contained. Motion is already
 * neutralised app-wide by the `prefers-reduced-motion` block in
 * `styles/global.css`.
 */
const SPINNER_CSS = '@keyframes ariang-spin { to { transform: rotate(360deg); } }'
  + '.ariang-spinner { animation: ariang-spin 0.9s linear infinite; }';

const SPINNER_STYLE = <style>{SPINNER_CSS}</style>;

/**
 * Indeterminate spinner.
 *
 * A plain element rather than `<mdui-circular-progress>`: this is the "a call
 * is in flight" affordance of a settings table, it must be readable by
 * assistive tech, and it must not depend on the mdui bundle having booted.
 */
function Spinner({ name }: { name: string }) {
  return (
    <span
      role="progressbar"
      aria-busy="true"
      aria-label={name}
      className="ariang-spinner"
      style={{
        display: 'inline-block',
        width: '1.1rem',
        height: '1.1rem',
        borderRadius: '50%',
        border: '2px solid rgb(var(--mdui-color-primary))',
        borderTopColor: 'rgb(var(--mdui-color-outline-variant))',
      }}
    />
  );
}

function Chips({ values, label }: { values: readonly string[]; label: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }} aria-label={label}>
      {values.map((value) => (
        <MduiChip key={value} variant="assist">
          {value}
        </MduiChip>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                 */
/* ------------------------------------------------------------------ */

export default function StatusPage() {
  const t = useTranslate();

  const connection = useRpcStore((state) => state.connection);
  const client = useRpcStore((state) => state.client);
  const version = useRpcStore((state) => state.version);
  const refreshVersion = useRpcStore((state) => state.refreshVersion);
  const reconnectRpc = useRpcStore((state) => state.reconnect);

  const profile = useProfilesStore((state) => state.profiles[state.activeProfileIndex] ?? state.profiles[0]);

  const [session, setSession] = useState<{ info: Aria2SessionInfo | null; failed: boolean }>({
    info: null,
    failed: false,
  });
  const [busy, setBusy] = useState<'save' | 'shutdown' | 'copy' | null>(null);

  const connected = connection.status === RpcStatus.Connected;
  const pending = isConnecting(connection.status);
  const isWebSocket = isWebSocketProfile(profile);
  const supportsNotifications = client?.supportsNotifications === true;

  /* --- version + session, refreshed on every connection change ------------ */

  // AriaNg's `$watch('taskContext.rpcStatus')`: a fresh `getVersion()` on every
  // transition, and an empty screen while the link is down.
  useEffect(() => {
    void refreshVersion();
  }, [connection.status, refreshVersion]);

  useEffect(() => {
    if (!client || !connected) return undefined;

    let cancelled = false;
    void (async () => {
      const result = await client.getSessionInfo();
      if (cancelled) return;
      setSession(result.success ? { info: result.data, failed: false } : { info: null, failed: true });
    })();

    return () => {
      cancelled = true;
    };
  }, [client, connected]);

  // The effect above only ever *fetches*; whether its answer may be shown is
  // decided here, so a stale session id can never survive a dropped link.
  const sessionInfo = connected ? session.info : null;
  const sessionFailed = connected && session.failed;

  /* --- capabilities ------------------------------------------------------ */

  const capabilities = useMemo(
    () => {
      const websocket: CapabilityState = client
        ? supportsNotifications
          ? 'enabled'
          : 'disabled'
        : 'unknown';

      return [
        {
          key: 'websocket',
          label: t('WebSocket RPC'),
          state: websocket,
          hint: t(
            'Switch the RPC profile to ws:// or wss:// to receive live task notifications instead of polling.',
          ),
        },
        {
          key: 'ed2k',
          label: t('ED2K'),
          state: verdict(version?.enabledFeatures, ED2K_FEATURES),
          hint: t('Enables the ED2K search page and ed2k:// link support in the task list.'),
        },
        {
          key: 'media',
          label: t('Media HLS/DASH'),
          state: verdict(version?.mediaFeatures, MEDIA_FEATURES),
          hint: t(
            'Lets the UI drive native HLS/DASH pipelines: per-request context, stable track ids and structured media errors.',
          ),
        },
        {
          key: 'filename',
          label: t('Filename hints'),
          state: verdict(version?.downloadFeatures, FILENAME_FEATURES),
          hint: t(
            'The daemon can be asked which filename a URL maps to, so the final name is known before the download starts.',
          ),
        },
        {
          key: 'bittorrent',
          label: t('BitTorrent'),
          state: verdict(version?.enabledFeatures, BITTORRENT_FEATURES),
          hint: t('Adds torrent / magnet handling, the peer and piece views and the tracker controls.'),
        },
      ];
    },
    [client, supportsNotifications, t, version?.downloadFeatures, version?.enabledFeatures, version?.mediaFeatures],
  );

  const isAria2Next = version?.product === 'aria2-next';

  /* --- diagnostics ------------------------------------------------------- */

  const diagnosticsBlob = useCallback((): string => {
    const blob: Record<string, unknown> = {
      version: version?.version ?? null,
      product: version?.product ?? null,
      rpcVersion: version?.rpcVersion ?? null,
      enabledFeatures: version?.enabledFeatures ?? [],
      downloadFeatures: version?.downloadFeatures ?? null,
      mediaFeatures: version?.mediaFeatures ?? null,
      sessionId: sessionInfo?.sessionId ?? null,
      connection: {
        status: connection.status,
        attempt: connection.attempt,
        lastError: connection.lastError ?? null,
      },
      profile: {
        displayName: rpcProfileDisplayName(profile),
        // `rpcProfileUrl` never embeds the secret, so the address is safe as-is.
        url: rpcProfileUrl(profile),
        protocol: profile.protocol,
        interface: profile.rpcInterface,
        supportsNotifications,
        // MANDATORY REDACTION — see REDACTED_SECRET.
        secret: profile.secret ? REDACTED_SECRET : null,
      },
    };

    return JSON.stringify(blob, null, 2);
  }, [connection, profile, sessionInfo, supportsNotifications, version]);

  const copyDiagnostics = useCallback(async () => {
    setBusy('copy');
    try {
      const copied = await copyText(diagnosticsBlob());
      notifyInPage({
        title: copied ? t('Operation Succeeded') : t('Error'),
        content: t('Copied'),
        type: copied ? 'success' : 'error',
      });
    } finally {
      setBusy(null);
    }
  }, [diagnosticsBlob, t]);

  /* --- operations -------------------------------------------------------- */

  const onSaveSession = useCallback(async () => {
    if (busy) return;
    setBusy('save');
    try {
      const ok = await saveSession();
      // AriaNg only reported success when aria2 answered exactly `OK`.
      if (ok) {
        notifyInPage({
          title: t('Operation Succeeded'),
          content: t('Session has been saved successfully.'),
          type: 'success',
        });
      }
    } finally {
      setBusy(null);
    }
  }, [busy, t]);

  const onShutdown = useCallback(async () => {
    if (busy) return;

    const confirmed = await confirmDialog({
      heading: t('Confirm Shutdown'),
      text: t('Are you sure you want to shutdown aria2?'),
      okText: t('OK'),
      cancelText: t('Cancel'),
      icon: 'warning',
      danger: true,
    });
    if (!confirmed) return;

    setBusy('shutdown');
    try {
      if (await shutdownAria2()) {
        notifyInPage({
          title: t('Operation Succeeded'),
          content: t('Aria2 has been shutdown successfully.'),
          type: 'success',
        });
      }
    } finally {
      setBusy(null);
    }
  }, [busy, t]);

  /* --- render ------------------------------------------------------------ */

  return (
    <div className="ariang-status-page" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {SPINNER_STYLE}
      <MduiCard variant="outlined">
        <div style={GRID}>
          <SettingRow label={t('Aria2 RPC Address')}>
            <span style={BREAKABLE}>{rpcProfileUrl(profile)}</span>
          </SettingRow>

          <SettingRow label={t('Aria2 Status')}>
            <TonePill tone={rpcStatusTone(connection.status)}>{t(connection.status)}</TonePill>
          </SettingRow>

          <SettingRow label={t('Aria2 Version')}>
            {version ? (
              <span style={BREAKABLE}>{version.version}</span>
            ) : pending ? (
              <Spinner name={t('Aria2 Version')} />
            ) : (
              <span>{DASH}</span>
            )}
          </SettingRow>

          {/* aria2-next identification — upstream aria2 has neither field. */}
          {version?.product ? <SettingRow label={t('Product')}>{version.product}</SettingRow> : null}
          {version?.rpcVersion ? <SettingRow label={t('RPC Version')}>{version.rpcVersion}</SettingRow> : null}

          <SettingRow label={t('Session Info')}>
            {sessionInfo ? (
              <span style={BREAKABLE}>{sessionInfo.sessionId}</span>
            ) : sessionFailed ? (
              <span>{DASH}</span>
            ) : pending ? (
              <Spinner name={t('Session Info')} />
            ) : (
              <span>{DASH}</span>
            )}
          </SettingRow>

          <SettingRow label={t('Enabled Features')}>
            {version ? (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {version.enabledFeatures.map((feature, index) => (
                  <MduiCheckbox key={feature} value={`feature_${index}`} checked disabled label={feature} />
                ))}
              </div>
            ) : pending ? (
              <Spinner name={t('Enabled Features')} />
            ) : (
              <span>{DASH}</span>
            )}
          </SettingRow>

          {version?.downloadFeatures?.length ? (
            <SettingRow label={t('Download Features')}>
              <Chips values={version.downloadFeatures} label={t('Download Features')} />
            </SettingRow>
          ) : null}

          {version?.mediaFeatures?.length ? (
            <SettingRow label={t('Media Features')}>
              <Chips values={version.mediaFeatures} label={t('Media Features')} />
            </SettingRow>
          ) : null}
        </div>
      </MduiCard>

      {isAria2Next ? (
        <MduiCard variant="outlined">
          <div style={{ padding: '1rem 1rem 0.5rem' }}>
            <div className="ariang-setting-key" style={HEADING}>
              {t('Engine capabilities')}
            </div>
          </div>
          <MduiDivider />
          <div style={GRID}>
            {capabilities.map((capability) => (
              <div key={capability.key} data-capability={capability.key} style={{ display: 'contents' }}>
                <SettingRow label={capability.label}>
                  <MduiTooltip content={capability.hint} placement="top">
                    <TonePill tone={capability.state}>
                      {t(capability.state === 'enabled' ? 'Enabled' : capability.state === 'disabled' ? 'Disabled' : 'Unknown')}
                    </TonePill>
                  </MduiTooltip>
                </SettingRow>
              </div>
            ))}
          </div>
        </MduiCard>
      ) : null}

      {/*
        AriaNg hides this card unless the daemon answered or the profile can be
        reconnected. It is always rendered here because it also hosts **Copy
        Diagnostics**, which is needed most exactly when the link is *down*.
      */}
      <MduiCard variant="outlined">
        <div style={GRID}>
          <SettingRow label={t('Operations')}>
            {isWebSocket ? (
              <MduiButton
                variant="filled"
                disabled={!canReconnect(connection.status)}
                onClick={() => reconnectRpc()}
              >
                {t('Reconnect')}
              </MduiButton>
            ) : null}

            {version ? (
              <MduiButton
                variant="filled"
                loading={busy === 'save'}
                disabled={busy !== null && busy !== 'save'}
                onClick={() => {
                  void onSaveSession();
                }}
              >
                {t('Save Session')}
              </MduiButton>
            ) : null}

            {version ? (
              <MduiButton
                variant="filled"
                icon="stop"
                loading={busy === 'shutdown'}
                disabled={busy !== null && busy !== 'shutdown'}
                onClick={() => {
                  void onShutdown();
                }}
              >
                {t('Shutdown Aria2')}
              </MduiButton>
            ) : null}

            <MduiButton
              variant="outlined"
              icon="content-copy"
              loading={busy === 'copy'}
              disabled={busy !== null && busy !== 'copy'}
              onClick={() => {
                void copyDiagnostics();
              }}
            >
              {t('Copy Diagnostics')}
            </MduiButton>
          </SettingRow>
        </div>
      </MduiCard>
    </div>
  );
}