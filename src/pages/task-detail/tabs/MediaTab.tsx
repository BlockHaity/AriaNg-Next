/**
 * Media tab — the aria2-next addition (`/task/detail/:gid?tab=media`).
 *
 * Everything on this tab comes from aria2-next's `media` view on `tellStatus`
 * (`TaskMediaView`); nothing here is invented. Four rules are load-bearing and
 * are the reason the tab exists at all:
 *
 * 1. **Progress is measured in media time**, not bytes. `completedDuration /
 *    duration` is the only meaningful number for a task whose output size is not
 *    known yet.
 * 2. **An unknown output length is not 0 %.** aria2 reports
 *    `lengthKnown: 'false'` until the remuxer has produced a final container, and
 *    `progress` is then `null`. Treating that as "0 % complete" would show a
 *    stalled task that is in fact downloading fine, so an indeterminate
 *    `mdui-linear-progress` is shown together with the absolute
 *    `completedDuration` / `downloadedLength`.
 * 3. **Track ids are opaque.** They come from the server, only exist at runtime,
 *    and are never parsed or synthesised here — they are submitted verbatim to
 *    `media-video` / `media-audio` / `media-subtitles` through `changeOption`.
 * 4. **Retry keeps the GID.** `aria2.retryMedia` resumes the same task with its
 *    native recovery data (partial segments, playlist position); removing the
 *    task and re-adding the URL (`retryTask`) would throw all of that away. The
 *    Retry button therefore calls `retryMedia`, never `remove` + `addUri`.
 */

import { useMemo, useState } from 'react';

import { MediaErrorCode, MediaPhase } from '@/config/rpc-constants';
import type { MediaTrackView, NormalizedTask, TaskMediaView } from '@/domain/types';
import { changeTaskOption } from '@/store/commands';
import { getAria2ClientOrNull } from '@/rpc';
import { formatDuration, readableVolume } from '@/i18n/format';
import { useTranslate } from '@/i18n/react';
import { confirmDialog, MduiButton, MduiChip, MduiDivider, MduiIcon, MduiProgressBar, MduiSelect, snackbarMessage } from '@/ui/mdui';

/** `MediaErrorCode` -> readable sentence. */
const MEDIA_ERROR_MESSAGES: Record<MediaErrorCode, string> = {
  [MediaErrorCode.UnsupportedSource]:
    'The source could not be recognised as HLS, DASH or a media collection.',
  [MediaErrorCode.AuthenticationRequired]:
    'The source requires authentication; add a header or a media-request-context.',
  [MediaErrorCode.ProtectedMedia]: 'The media is DRM-protected and cannot be remuxed.',
  [MediaErrorCode.UnsupportedSelection]:
    'The selected track combination cannot be written to the chosen container. Try MKV.',
  [MediaErrorCode.ProbeFailed]: 'Probing the manifest failed; the playlist or MPD could not be read.',
};

export interface MediaErrorInfo {
  code?: string;
  message?: string;
}

/** Human-readable reason for a `media.errorCode`, falling back to the raw one. */
export function describeMediaError(error: MediaErrorInfo | undefined): string {
  if (!error || (!error.code && !error.message)) return '';

  const known = MEDIA_ERROR_MESSAGES[error.code as MediaErrorCode];
  if (known) return known;

  return error.message ?? error.code ?? '';
}

/** Short label of a media phase, used for the chip. */
export function mediaPhaseLabel(phase: MediaPhase | undefined): string {
  switch (phase) {
    case MediaPhase.Waiting:
      return 'Waiting';
    case MediaPhase.Probing:
      return 'Probing';
    case MediaPhase.AwaitingSelection:
      return 'Awaiting track selection';
    case MediaPhase.Downloading:
      return 'Downloading';
    case MediaPhase.Recording:
      return 'Recording';
    case MediaPhase.Finalizing:
      return 'Finalizing';
    case MediaPhase.Paused:
      return 'Paused';
    case MediaPhase.Complete:
      return 'Completed';
    case MediaPhase.Error:
      return 'Error';
    case MediaPhase.Removed:
      return 'Removed';
    default:
      return 'Unknown';
  }
}

/** Which `changeOption` key a track type writes to. */
function optionKeyForType(type: string): string | null {
  switch (type.toLowerCase()) {
    case 'video':
      return 'media-video';
    case 'audio':
      return 'media-audio';
    case 'subtitle':
    case 'subtitles':
      return 'media-subtitles';
    default:
      return null;
  }
}

function trackLabel(track: MediaTrackView): string {
  const parts = [track.type];

  if (track.label) parts.push(track.label);
  else if (track.language) parts.push(track.language);
  else if (track.bandwidth) parts.push(`${track.bandwidth}`);
  else parts.push(track.id);

  return parts.filter((part) => !!part).join(' · ');
}

export interface MediaTabProps {
  task: NormalizedTask;
}

export function MediaTab({ task }: MediaTabProps) {
  const t = useTranslate();
  const media = task.media as TaskMediaView | undefined;
  const [busy, setBusy] = useState(false);

  const errorText = useMemo(() => describeMediaError(media ? { code: media.errorCode, message: media.error } : undefined), [media]);

  /**
   * `null` means "the total is unknown", which is deliberately **not** rendered
   * as 0 %: see rule (2) in the module comment.
   */
  const progress = media?.progress ?? null;
  const indeterminate = !media?.lengthKnown || !media?.duration;

  const isLive = media?.live === true;
  const isRecording =
    isLive && (task.status === 'active' || task.status === 'paused') && media?.state !== MediaPhase.Error;

  const canFinish = isLive && (task.status === 'active' || task.status === 'paused');

  const client = getAria2ClientOrNull();

  const selectTrack = async (track: MediaTrackView, selected: boolean): Promise<void> => {
    const key = optionKeyForType(track.type);
    if (!key) return;

    // Opaque id, submitted verbatim.
    const ok = await changeTaskOption(task.gid, key, selected ? track.id : 'none');
    if (!ok) snackbarMessage({ message: `changeOption(${key}) was rejected by aria2` });
  };

  const onFinish = async (): Promise<void> => {
    if (!client) return;

    const confirmed = await confirmDialog({
      heading: 'Finish recording',
      text: 'Stop the live recording and finalise the output file now?',
      okText: 'Finish',
      cancelText: t('Cancel'),
      icon: 'stop',
    });
    if (!confirmed) return;

    setBusy(true);
    const result = await client.finishMedia(task.gid);
    setBusy(false);

    if (!result.success) snackbarMessage({ message: result.error.message });
  };

  const onRetry = async (): Promise<void> => {
    if (!client) return;

    // Deliberately NOT remove + addUri: retryMedia keeps this GID and the native
    // recovery data (partial segments, playlist position).
    const confirmed = await confirmDialog({
      heading: 'Retry media task',
      text: 'Retry this media task? The same task (GID) resumes with its saved recovery data.',
      okText: t('Retry'),
      cancelText: t('Cancel'),
      icon: 'restart-alt',
    });
    if (!confirmed) return;

    setBusy(true);
    const result = await client.retryMedia(task.gid);
    setBusy(false);

    if (!result.success) snackbarMessage({ message: result.error.message });
  };

  if (!media) return null;

  return (
    <div className="ariang-task-detail">
      <div className="ariang-media-chips">
        <MduiChip variant="assist" icon="movie">
          {media.protocol ? String(media.protocol) : 'unknown'}
        </MduiChip>
        <MduiChip variant="assist" icon="schedule">
          {mediaPhaseLabel(media.state)}
        </MduiChip>
        {isLive ? <span className="ariang-media-live-badge">LIVE</span> : null}
        <MduiButton variant="filled" icon="refresh" disabled={busy} onClick={() => void onRetry()}>
          {t('Retry')}
        </MduiButton>
        {canFinish ? (
          <MduiButton variant="tonal" icon="stop" disabled={busy || !isRecording} onClick={() => void onFinish()}>
            Finish
          </MduiButton>
        ) : null}
      </div>

      {errorText ? (
        <div className="ariang-warning-row" role="alert">
          <MduiIcon name="error" size="1.25rem" />
          <span>{errorText}</span>
        </div>
      ) : null}

      <section aria-label="Media progress">
        {indeterminate || progress === null ? (
          <>
            {/* Unknown output size: never render a fake 0 %. In mdui 2.x a
                `<mdui-linear-progress>` with no `value` *is* the indeterminate
                state, which is why this is the raw element and not
                `<MduiProgressBar>`. */}
            <mdui-linear-progress role="progressbar" aria-label="Media progress" />
            <div className="ariang-media-absolute">
              <span>{`Media time: ${formatDuration(media.completedDuration ?? 0, 'HH:mm:ss')}`}</span>
              <span>{`Retained payload: ${readableVolume(media.downloadedLength)}`}</span>
            </div>
          </>
        ) : (
          <>
            <MduiProgressBar
              value={progress * 100}
              height={8}
              label="Media progress"
            />
            <div className="ariang-media-absolute">
              <span>{`${formatPercentOfProgress(progress)} of ${formatDuration(media.duration ?? 0, 'HH:mm:ss')}`}</span>
              <span>{`Retained payload: ${readableVolume(media.downloadedLength)}`}</span>
            </div>
          </>
        )}
      </section>

      <MduiDivider />

      <section aria-label="Tracks" className="ariang-track-list">
        {media.tracks.length === 0 ? (
          <p className="ariang-empty-state">{mediaPhaseLabel(media.state)}</p>
        ) : (
          groupTracks(media.tracks).map(([optionKey, tracks]) => (
            <div key={optionKey} data-track-group={optionKey}>
              <MduiSelect
                value={tracks.find((track) => track.selected)?.id ?? 'none'}
                label={optionKey.replace('-', ' ')}
                items={[
                  { value: 'none', label: 'none' },
                  { value: 'best', label: 'best' },
                  ...tracks.map((track) => ({ value: track.id, label: trackLabel(track) })),
                ]}
                onChange={(value) => {
                  const track = tracks.find((candidate) => candidate.id === value);
                  if (track) void selectTrack(track, true);
                  else void changeTaskOption(task.gid, optionKey, value);
                }}
              />
              {tracks.map((track) => (
                <div key={track.id} className="ariang-track-row" data-selected={track.selected ? 'true' : 'false'}>
                  <MduiIcon name={track.type === 'video' ? 'movie' : track.type === 'audio' ? 'music-note' : 'subtitles'} size="1.125rem" />
                  <span>{trackLabel(track)}</span>
                  <span className="ariang-track-meta">
                    {[track.language, track.bandwidth, track.frameRate, track.width && track.height ? `${track.width}x${track.height}` : '']
                      .filter((part) => !!part)
                      .join(' · ')}
                  </span>
                  {track.selected ? <MduiIcon name="check" size="1rem" /> : null}
                </div>
              ))}
            </div>
          ))
        )}
      </section>

      <p className="ariang-helper-text">
        Live progress is measured in media time (completedDuration / duration), not in output bytes.
        MP4 cannot represent every subtitle and codec combination — choose MKV when it cannot. The
        output byte length stays unknown until remuxing finishes, so the absolute retained payload is
        shown above instead of a byte percentage.
      </p>
    </div>
  );
}

/** `0.5` -> `50%`. */
function formatPercentOfProgress(progress: number): string {
  const percent = Math.round(progress * 10000) / 100;
  return `${percent}%`;
}

/** Groups the track list by the option that writes it. */
function groupTracks(tracks: readonly MediaTrackView[]): [string, MediaTrackView[]][] {
  const groups = new Map<string, MediaTrackView[]>();

  for (const track of tracks) {
    const key = optionKeyForType(track.type);
    if (!key) continue;

    const bucket = groups.get(key);
    if (bucket) bucket.push(track);
    else groups.set(key, [track]);
  }

  return [...groups.entries()];
}

export default MediaTab;