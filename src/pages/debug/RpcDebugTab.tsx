/**
 * "Aria2 RPC Debug" — the second tab of `/debug`.
 *
 * A 1:1 port of the `rpc` tab-pane in `views/debug.html` plus
 * `AriaNgDebugController.executeAria2Method`:
 *
 * - the method dropdown is filled from `system.listMethods`, loaded when the
 *   tab is opened (AriaNg only fetched it on `changeTab('rpc')`);
 * - the parameters textarea holds JSON, defaulting to `{}`;
 * - the response textarea is readonly and carries the pretty-printed answer;
 * - **Execute** is a promise button, disabled until the form validates;
 * - `⌘/Ctrl + Enter` executes (AriaNg's `isCtrlEnterPressed`).
 *
 * Two additions over AriaNg, both about making a protocol mismatch debuggable:
 * the **raw request envelope** that was sent is displayed next to the answer,
 * and a failure renders `describeError`, i.e. the translated tip when the error
 * is a known one and the raw message otherwise.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { useTranslate } from '@/i18n';
import { describeError } from '@/rpc/errors';
import { generateUniqueId } from '@/utils/base64';
import { isCtrlEnterPressed } from '@/utils/keyboard';
import { notifyInPage } from '@/store/notifications';
import { useRpcStore } from '@/store/rpc-store';
import { MduiButton, MduiSelect, MduiTextarea } from '@/ui/mdui';
import type { MduiSelectItem } from '@/ui/mdui';

import { buildInvokeContext, validateRpcForm } from './rpc-form';
import type { RpcFormState } from './rpc-form';
import './debug.css';

/** The JSON-RPC version every request carries; see `rpc/constants`. */
const JSONRPC_VERSION = '2.0';

/** AriaNg's `context.rpcRequestParameters`. */
const DEFAULT_PARAMS = '{}';

/** The envelope as it goes on the wire (minus the injected token). */
interface RawRequest {
  jsonrpc: string;
  id: string;
  method: string;
  params: unknown[];
}

export interface RpcDebugTabProps {
  /**
   * Whether this tab is the visible one. The method list is only fetched when
   * the tab is opened, exactly like AriaNg's `changeTab`.
   */
  active: boolean;
}

export function RpcDebugTab({ active }: RpcDebugTabProps) {
  const t = useTranslate();
  const client = useRpcStore((state) => state.client);

  const [form, setForm] = useState<RpcFormState>({ method: '', paramsText: DEFAULT_PARAMS });
  const [methods, setMethods] = useState<string[]>([]);
  const [response, setResponse] = useState('');
  const [rawRequest, setRawRequest] = useState<RawRequest | null>(null);
  const [busy, setBusy] = useState(false);

  // The dropdown has no "no selection" entry, so an empty value would render as
  // a blank field; the first method stands in until the user picks one. Derived
  // rather than written back into state — nothing to reconcile.
  const method = form.method || methods[0] || '';
  const state = useMemo<RpcFormState>(() => ({ method, paramsText: form.paramsText }), [form.paramsText, method]);

  const invokeContext = buildInvokeContext(state);

  /* --- method list ------------------------------------------------------- */

  useEffect(() => {
    if (!active) return;
    // AriaNg cached the list in the controller, so re-opening the tab is free.
    if (methods.length > 0) return;

    let cancelled = false;
    void (async () => {
      const result = await client?.listMethods();
      if (cancelled || !result || !result.success) return;
      setMethods(result.data.filter((entry): entry is string => typeof entry === 'string'));
    })();

    return () => {
      cancelled = true;
    };
  }, [active, client, methods.length]);

  /* --- execute ----------------------------------------------------------- */

  const execute = useCallback(async () => {
    const context = buildInvokeContext(state);
    if (!context || !client) {
      const validation = validateRpcForm(state);
      // Surfaced as a toast, exactly like AriaNg's
      // `ariaNgCommonService.showError`. The Execute button is disabled while
      // the form is invalid, so this is only reachable through ⌘/Ctrl+Enter.
      notifyInPage({
        title: t('Error'),
        content: t(validation.ok ? 'Cannot connect to aria2!' : validation.messageKey),
        type: 'error',
      });
      return;
    }

    setBusy(true);
    try {
      const sent: RawRequest = {
        jsonrpc: JSONRPC_VERSION,
        id: generateUniqueId(),
        method: context.method,
        params: context.params,
      };
      // The token the client injects is deliberately **not** shown here: this
      // block exists so it can be pasted into a public issue.
      setRawRequest(sent);

      const result = await client.invoke({
        method: context.method,
        params: context.params,
        silent: context.silent,
      });
      setResponse(
        result.success
          ? JSON.stringify(result.data, null, 2)
          : JSON.stringify({ error: describeError(result.error) }, null, 2),
      );
    } finally {
      setBusy(false);
    }
  }, [client, state, t]);

  /* --- keyboard ---------------------------------------------------------- */

  const onParamsKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // ⌘/Ctrl + Enter, scoped to the parameters field exactly like AriaNg's
      // `ng-keydown="requestParametersTextboxKeyDown($event)"`.
      if (!isCtrlEnterPressed(event.nativeEvent) || !invokeContext || busy) return;
      event.preventDefault();
      void execute();
    },
    [busy, execute, invokeContext],
  );

  /* --- render ------------------------------------------------------------ */

  const methodItems = useMemo<MduiSelectItem[]>(
    () => methods.map((entry) => ({ value: entry, label: entry })),
    [methods],
  );

  return (
    <>
      <div className="ariang-settings-grid">
        <div className="ariang-setting-key">{t('Aria2 RPC Request Method')}</div>
        <div className="ariang-setting-value">
          <MduiSelect
            className="ariang-rpc-method-select"
            value={method}
            items={methodItems}
            label={t('Aria2 RPC Request Method')}
            variant="outlined"
            onChange={(next) => setForm((current) => ({ ...current, method: next }))}
          />
        </div>

        <div className="ariang-setting-key">{t('Aria2 RPC Request Parameters')}</div>
        <div className="ariang-setting-value" onKeyDown={onParamsKeyDown}>
          <MduiTextarea
            className="ariang-rpc-params"
            value={form.paramsText}
            rows={6}
            label={t('Aria2 RPC Request Parameters')}
            variant="outlined"
            onInput={(next) => setForm((current) => ({ ...current, paramsText: next }))}
          />
        </div>

        <div className="ariang-setting-key">{t('Aria2 RPC Response')}</div>
        <div className="ariang-setting-value ariang-rpc-response">
          {/* mdui has no readonly text field; `disabled` is the closest match
              and keeps the (selectable) text copyable, which a debug console
              needs far more than editable focus. */}
          <MduiTextarea
            className="ariang-rpc-response-field"
            value={response}
            rows={10}
            label={t('Aria2 RPC Response')}
            variant="outlined"
            disabled
          />
        </div>

        <div className="ariang-setting-value ariang-setting-value--full">
          <MduiButton
            variant="filled"
            icon="terminal"
            loading={busy}
            disabled={busy || !invokeContext}
            onClick={() => {
              void execute();
            }}
          >
            {t('Execute')}
          </MduiButton>
        </div>
      </div>

      {rawRequest ? (
        <div className="ariang-settings-grid ariang-settings-grid--stacked">
          <div className="ariang-setting-key">{t('Aria2 RPC Request')}</div>
          <pre className="ariang-rpc-request">{JSON.stringify(rawRequest, null, 2)}</pre>
        </div>
      ) : null}
    </>
  );
}