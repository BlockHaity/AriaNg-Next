/**
 * Clipboard helpers.
 *
 * `navigator.clipboard` is **unavailable on insecure origins**. AriaNg is very
 * frequently served over plain `http://` from a LAN address (`http://nas:6800`,
 * `http://192.168.1.10/ariang`), and in that case `navigator.clipboard` is
 * `undefined` — so a clipboard that only used the async API would silently do
 * nothing on exactly the setups this app is built for. Hence the
 * `document.execCommand('copy')` fallback through a hidden textarea, which
 * still works there.
 *
 * Both entry points **never throw**: they resolve `false` when the copy could
 * not be performed, so a caller can fall back to "show the text in a dialog"
 * without a try/catch of its own.
 */

/**
 * Legacy copy path: a hidden `<textarea>` + `execCommand('copy')`.
 *
 * The element must be in the document and focused, and the selection must
 * cover the text, otherwise `execCommand` returns `false`. It is removed again
 * in a `finally`, even when the call throws.
 */
export function copyToClipboard(text: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (typeof document === 'undefined' || typeof document.execCommand !== 'function') {
      resolve(false);
      return;
    }

    const area = document.createElement('textarea');
    // Kept in the layout (not `display: none`, which cannot be selected) but
    // pushed off-screen so the user never sees the textarea flash.
    area.value = text ?? '';
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-9999px';
    area.style.left = '-9999px';
    area.style.opacity = '0';

    const previous = document.activeElement;
    let copied = false;

    try {
      document.body.appendChild(area);
      area.focus();
      area.select();
      area.setSelectionRange(0, area.value.length);
      copied = document.execCommand('copy') === true;
    } catch {
      copied = false;
    } finally {
      area.remove();
      // Keep the caret where the user left it (e.g. inside a settings input).
      if (previous instanceof HTMLElement) {
        try {
          previous.focus();
        } catch {
          /* the element may have been detached in the meantime */
        }
      }
    }

    resolve(copied);
  });
}

/**
 * Preferred copy path: the async Clipboard API, falling back to
 * {@link copyToClipboard}.
 *
 * The API is only reached when the page is a secure context *and* the browser
 * exposes it; otherwise the promise is not even created.
 */
export async function copyText(text: string): Promise<boolean> {
  const value = text ?? '';

  try {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      await clipboard.writeText(value);
      return true;
    }
  } catch {
    // Permission denied / document not focused -> use the legacy path.
  }

  return copyToClipboard(value);
}
