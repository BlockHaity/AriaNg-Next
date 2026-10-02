/**
 * The two **command routes** — AriaNg's command-line API.
 *
 * ```
 * #!/new/task?url=<base64url>&<aria2 option>=<value>…     add a task
 * #!/settings/rpc/set?protocol=&host=&port=&interface=&secret=
 * ```
 *
 * Neither renders anything. Both perform their side effect and redirect, which
 * is exactly how AriaNg behaved (`$routeProvider.when(…, { template: '' })`
 * plus a `resolve` that navigated away).
 *
 * ## Rules kept from AriaNg
 *
 * 1. **`#!/new?url=…` only prefills the form** — creating the task is
 *    `#!/new/task?url=…`. This route therefore only handles `/new/task`.
 * 2. **Every other query key that is a valid aria2 option key is a task
 *    option** (`isOptionKeyValid`), so `?dir=/tmp&seed-time=3600` works.
 * 3. **`pause=true` adds the task paused**, and a paused task is answered by
 *    `tellWaiting` — hence the redirect to `/waiting`, not `/downloading`.
 * 4. **The query string wins over the path parameters**, so
 *    `/settings/rpc/set/http/host/6800/jsonrpc/<secret>` may override any of
 *    them.
 * 5. Every failure shows the translated AriaNg message and redirects.
 *
 * ## Run-once guard
 *
 * The work happens in an effect, and React 19's StrictMode mounts effects twice
 * in development. A naive effect would create **two** tasks. The ref guard below
 * is per component instance (StrictMode reuses it across its double mount), so
 * the command runs exactly once per navigation.
 */
import { useEffect, useRef } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';

import { DEFAULT_ROUTE, Routes as RoutePaths } from './route-paths';
import { activateRpcProfile } from './shell';
import { isOptionKeyValid } from '@/config/aria2-options';
import { DEFAULT_RPC_PROFILE, rpcProfilesEqual } from '@/config/defaults';
import { DEFAULT_RPC_INTERFACE, DEFAULT_RPC_PORT } from '@/config/rpc-constants';
import type { RpcProfile, RpcProtocol } from '@/config/types';
import { useTranslate } from '@/i18n';
import { getAria2ClientOrNull } from '@/rpc';
import { notifyInPage } from '@/store/notifications';
import { decodeBase64Url } from '@/utils/base64';

/** The aria2 protocols a profile may use, per AriaNg's `protocol` validation. */
const RPC_PROTOCOLS: readonly RpcProtocol[] = ['http', 'https', 'ws', 'wss'];

/** Minimal structural type for `useNavigate()`'s return value. */
type Navigate = (to: string, options?: { replace?: boolean }) => void;

/** `'true'` / `'1'` / `'yes'` — AriaNg accepted any of these as "add paused". */
function isTruthy(value: string): boolean {
  return value === 'true' || value === '1' || value === 'yes';
}

/** base64url (or standard base64) that decodes to something. Empty is fine. */
function isBase64UrlEncoded(value: string): boolean {
  return value === '' || decodeBase64Url(value) !== '';
}

/**
 * AriaNg's `$mdToast.show(message)` for a failed command.
 *
 * `delay: 0` keeps it up until the user dismisses it — the redirect happens
 * immediately, so a 2 s toast would be missed.
 */
function report(message: string): void {
  notifyInPage({ title: message, type: 'error', delay: 0 });
}

/* -------------------------------------------------------------------------- */
/* #!/new/task                                                                */
/* -------------------------------------------------------------------------- */

/**
 * `#!/new/task?url=<base64url>[&option=value…]`
 *
 * Redirects to `/waiting` when the task was added paused, `/downloading`
 * otherwise. AriaNg's `afterCreatingNewTask` setting does not apply to a
 * command — there is no user to ask.
 */
export function NewTaskCommand() {
  const t = useTranslate();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    const encoded = searchParams.get('url');
    if (encoded === null || encoded === '') {
      report(t('Parameter is invalid!'));
      navigate(DEFAULT_ROUTE, { replace: true });
      return;
    }

    const url = decodeBase64Url(encoded);
    if (!url) {
      report(t('URL is not base64 encoded!'));
      navigate(RoutePaths.Downloading, { replace: true });
      return;
    }

    // Rule 2: every other key is an aria2 option.
    const options: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      if (key === 'url') {
        return;
      }
      if (isOptionKeyValid(key)) {
        options[key] = value;
      }
    });
    const paused = isTruthy(searchParams.get('pause') ?? '');
    if (paused) {
      options['pause'] = 'true';
    }

    void addUri(url, options, paused, navigate);
  }, [navigate, searchParams, t]);

  return null;
}

async function addUri(
  url: string,
  options: Record<string, string>,
  paused: boolean,
  navigate: Navigate,
): Promise<void> {
  const client = getAria2ClientOrNull();
  if (!client) {
    // Not bootstrapped yet (or shut down). The list the user lands on shows the
    // connection error the RPC store reports, so there is nothing to add here.
    navigate(paused ? RoutePaths.Waiting : RoutePaths.Downloading, { replace: true });
    return;
  }

  const result = await client.addUri([url], options);
  if (!result.success) {
    report(result.error.message);
  }
  navigate(paused ? RoutePaths.Waiting : RoutePaths.Downloading, { replace: true });
}

/* -------------------------------------------------------------------------- */
/* #!/settings/rpc/set                                                        */
/* -------------------------------------------------------------------------- */

/**
 * `#!/settings/rpc/set?protocol=&host=&port=&interface=&secret=`
 *
 * The `secret` is base64url encoded in the url, exactly like AriaNg's — it is
 * the only way a link can carry an RPC secret without leaking it in plain text.
 */
export function RpcSetCommand() {
  const t = useTranslate();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;

    // Rule 4: the query string wins over the path parameters.
    const read = (key: string): string | null => searchParams.get(key) ?? params[key] ?? null;

    const protocol = read('protocol') ?? DEFAULT_RPC_PROFILE.protocol;
    const host = read('host') ?? '';
    const port = read('port') ?? DEFAULT_RPC_PORT;
    const rpcInterface = read('interface') ?? DEFAULT_RPC_INTERFACE;
    const secret = read('secret') ?? '';

    if (!RPC_PROTOCOLS.includes(protocol as RpcProtocol)) {
      fail(t('Protocol is invalid!'), navigate);
      return;
    }
    if (host.trim() === '') {
      fail(t('RPC host cannot be empty!'), navigate);
      return;
    }
    if (!isBase64UrlEncoded(secret)) {
      fail(t('RPC secret is not base64 encoded!'), navigate);
      return;
    }

    const profile: RpcProfile = {
      rpcAlias: '',
      rpcHost: host.trim(),
      rpcPort: port,
      rpcInterface,
      protocol: protocol as RpcProtocol,
      // A command line cannot carry the http method or custom headers; AriaNg
      // kept the built-in values here and so does this.
      httpMethod: DEFAULT_RPC_PROFILE.httpMethod,
      rpcRequestHeaders: '',
      // Decoded: the stores keep the secret in plain text at runtime.
      secret: secret === '' ? '' : decodeBase64Url(secret),
    };

    // AriaNg skipped the write when the url described the built-in default.
    if (!rpcProfilesEqual(profile, DEFAULT_RPC_PROFILE)) {
      activateRpcProfile(profile);
    }

    navigate(DEFAULT_ROUTE, { replace: true });
  }, [navigate, params, searchParams, t]);

  return null;
}

/** Show `message`, then land on `/downloading` (AriaNg's failure path). */
function fail(message: string, navigate: Navigate): void {
  report(message);
  navigate(DEFAULT_ROUTE, { replace: true });
}

/* -------------------------------------------------------------------------- */
/* unknown command path                                                       */
/* -------------------------------------------------------------------------- */

/**
 * AriaNg's `otherwise`, with its notice: an unrecognised path says
 * `Parameter is invalid!` and then redirects to the task list.
 */
export function CommandFallback() {
  const t = useTranslate();
  const reported = useRef(false);

  useEffect(() => {
    if (reported.current) {
      return;
    }
    reported.current = true;
    report(t('Parameter is invalid!'));
  }, [t]);

  return <Navigate to={DEFAULT_ROUTE} replace />;
}