/**
 * What the window shows when the web app can't load (no network, Wi-Fi
 * captive portal, Vercel down), in place of Chromium's own error page. It
 * reloads by itself when the computer comes back online, and has a button for
 * when it doesn't notice.
 */

/** Signet's background (`packages/theme/src/signet.ts`, surface.background). */
export const WINDOW_BACKGROUND = "#050505";

export function offlinePageHtml(appUrl: string): string {
  // The URL goes into a script as a JSON string, so a quote can't break out.
  const target = JSON.stringify(appUrl).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>Frapp</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: ${WINDOW_BACKGROUND}; color: #f5f5f5;
    font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { max-width: 320px; text-align: center; padding: 24px; }
  h1 { font-size: 16px; font-weight: 600; margin: 0 0 4px; }
  p { margin: 0 0 16px; color: rgba(255,255,255,0.64); }
  button {
    font: inherit; color: inherit; background: #262626; cursor: pointer;
    border: 1px solid rgba(255,255,255,0.14); border-radius: 8px; padding: 6px 14px;
  }
  button:hover { background: #313131; }
</style>
</head>
<body>
<main>
  <h1>Can't reach Frapp</h1>
  <p>Check your connection. Frapp reloads when you're back online.</p>
  <button type="button" id="retry">Try again</button>
</main>
<script>
  const target = ${target};
  const retry = () => { location.href = target; };
  document.getElementById("retry").addEventListener("click", retry);
  window.addEventListener("online", retry);
</script>
</body>
</html>`;
}
