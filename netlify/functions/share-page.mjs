/**
 * SSR share page with per-chain Open Graph tags.
 * GET /c/:id  (and /.netlify/functions/share-page?id=)
 */

import {
  UUID_RE,
  escapeHtml,
  fetchSharedChainRow,
  shareMeta,
  siteOrigin,
  targetLabel,
} from "./_shared/supabase.mjs";

function extractId(event) {
  const q = event.queryStringParameters || {};
  if (q.id && UUID_RE.test(q.id)) return q.id.trim();
  const path = String(event.path || event.rawUrl || "");
  const m = path.match(/\/c\/([0-9a-f-]{36})/i);
  if (m) return m[1];
  const m2 = path.match(/\/share-page\/?$/i);
  if (m2 && q.id) return String(q.id).trim();
  return "";
}

function buildHtml({ origin, id, row, meta }) {
  const ogImage = `${origin}/api/og/${encodeURIComponent(id)}`;
  const canonical = `${origin}/c/${encodeURIComponent(id)}`;
  const bootstrap = JSON.stringify({ id, row });
  const why =
    row.payload?.honesty ||
    row.payload?.estimateNote ||
    "Reverse-engineered with Chainprint — open each processor in order and set the values below.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${escapeHtml(meta.pageTitle)}</title>
  <meta name="description" content="${escapeHtml(meta.ogDescription)}" />
  <meta name="robots" content="noindex, follow" />
  <meta name="theme-color" content="#000000" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="/assets/favicon-32.png" type="image/png" sizes="32x32" />
  <link rel="apple-touch-icon" href="/assets/apple-touch-icon.png" sizes="180x180" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Chainprint" />
  <meta property="og:title" content="${escapeHtml(meta.ogTitle)}" />
  <meta property="og:description" content="${escapeHtml(meta.ogDescription)}" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:image" content="${escapeHtml(ogImage)}" />
  <meta property="og:image:type" content="image/svg+xml" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="${escapeHtml(meta.ogTitle)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(meta.ogTitle)}" />
  <meta name="twitter:description" content="${escapeHtml(meta.ogDescription)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImage)}" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=JetBrains+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap" />
  <link rel="stylesheet" href="/css/chassis.css" />
  <link rel="stylesheet" href="/css/logo.css" />
  <link rel="stylesheet" href="/css/share.css" />
</head>
<body>
  <div class="share-page">
    <div class="share-shell">
      <header class="share-top">
        <a class="logo" href="/" aria-label="Chainprint home">
          <span class="logo-mark" aria-hidden="true"></span>
          <span class="logo-word">Chainprint</span>
        </a>
        <a class="share-cta-btn is-solid" href="/analyze/">Analyze your own</a>
      </header>

      <div class="share-loading hidden" data-share-loading>
        <p>Loading chain…</p>
      </div>

      <div class="share-error hidden" data-share-error>
        <h1>Chain not found</h1>
        <p data-share-error-msg>This link may have been deleted, or it never existed.</p>
        <a class="share-cta-btn is-solid" href="/analyze/">Analyze your own reference</a>
      </div>

      <article class="share-card" data-share-card>
        <header class="share-head">
          <img class="share-art hidden" data-share-art alt="" />
          <div class="share-head-copy">
            <p class="share-kicker" data-share-kicker>${escapeHtml(targetLabel(row.target))}</p>
            <h1 class="share-title" data-share-title>${escapeHtml(row.track_name || "Reference mix")}</h1>
            <p class="share-chips" data-share-chips></p>
          </div>
        </header>

        <p class="share-why" data-share-why>${escapeHtml(String(why).slice(0, 280))}</p>

        <div class="share-strip" data-share-strip aria-label="Chain stages"></div>

        <div class="share-cta-row" data-share-cta-row>
          <a class="share-cta-btn is-solid" href="/auth/?mode=signup&amp;next=/analyze/">Try Chainprint free</a>
          <a class="share-cta-btn" href="/analyze/">Open in studio</a>
          <a class="share-cta-btn" data-share-ableton-help href="/help/ableton-mcp/">Open in Ableton</a>
        </div>

        <div class="share-columns">
          <section class="share-col">
            <h2>Inserts</h2>
            <div class="share-stack" data-share-inserts></div>
          </section>
          <section class="share-col">
            <h2>Sends</h2>
            <div class="share-stack" data-share-sends></div>
          </section>
        </div>

        <footer class="share-foot">
          <div>
            <p class="share-foot-title">Want this on your own track?</p>
            <p class="share-foot-sub">Drop in a reference — Chainprint dials the whole chain and lets you hear it.</p>
          </div>
          <a class="share-cta-btn is-solid" href="/auth/?mode=signup&amp;next=/analyze/">Try Chainprint free</a>
        </footer>

        <section class="share-mcp" data-share-mcp>
          <header class="share-mcp-head">
            <h2>Have AI mix it in Ableton</h2>
            <p>
              Paste this share link into Claude or Cursor — it loads stock Live devices and dials them in.
              One-time setup: <a href="/help/ableton-mcp/">Ableton + AI guide</a>.
            </p>
          </header>
          <label class="share-mcp-field">
            <span class="share-mcp-label">Share link</span>
            <div class="share-mcp-row">
              <input type="text" readonly data-share-mcp-url value="${escapeHtml(canonical)}" />
              <button type="button" class="share-cta-btn" data-share-mcp-copy>Copy</button>
            </div>
          </label>
          <details class="share-mcp-config">
            <summary>One-time setup for Claude or Cursor</summary>
            <pre class="share-mcp-code"><code>{
  "mcpServers": {
    "chainprint": {
      "command": "uvx",
      "args": ["chainprint-mcp"]
    }
  }
}</code></pre>
          </details>
        </section>
      </article>
    </div>
  </div>
  <script type="application/json" id="share-bootstrap">${bootstrap.replace(/</g, "\\u003c")}</script>
  <script type="module" src="/js/ui/chain-view.js"></script>
</body>
</html>`;
}

function notFoundHtml(origin, message) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chain not found · Chainprint</title>
  <meta name="robots" content="noindex" />
  <meta property="og:title" content="Chain not found · Chainprint" />
  <meta property="og:image" content="${origin}/assets/og-card.png?v=20260726b" />
  <link rel="stylesheet" href="/css/chassis.css" />
  <link rel="stylesheet" href="/css/logo.css" />
  <link rel="stylesheet" href="/css/share.css" />
</head>
<body>
  <div class="share-page"><div class="share-shell">
    <header class="share-top">
      <a class="logo" href="/"><span class="logo-mark"></span><span class="logo-word">Chainprint</span></a>
    </header>
    <div class="share-error">
      <h1>Chain not found</h1>
      <p>${escapeHtml(message)}</p>
      <a class="share-cta-btn is-solid" href="/analyze/">Analyze your own reference</a>
    </div>
  </div></div>
</body>
</html>`;
}

export async function handler(event) {
  const origin = siteOrigin(event);
  const id = extractId(event);

  if (!UUID_RE.test(id)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      body: notFoundHtml(origin, "That share link looks malformed."),
    };
  }

  try {
    const row = await fetchSharedChainRow(id);
    const meta = shareMeta(row);
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "public, max-age=120, s-maxage=300",
      },
      body: buildHtml({ origin, id, row, meta }),
    };
  } catch (err) {
    const status = err.status || 500;
    return {
      statusCode: status,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      body: notFoundHtml(origin, err.message || "Could not load that chain."),
    };
  }
}
