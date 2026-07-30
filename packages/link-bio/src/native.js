/**
 * NativeLinkBioProvider renders a self-hosted link-in-bio HTML page for
 * any AXIOM model profile. Click tracking is done via the post_metric table.
 *
 * This is the fallback provider that requires no external service — every
 * model gets a working page at /link/:handle by default.
 */
export class NativeLinkBioProvider {
    kind = 'native';
    enabled = true;
    // -----------------------------------------------------------------------
    // LinkInBioProvider implementation
    // -----------------------------------------------------------------------
    async getProfile(_modelId) {
        // In a real implementation we'd query the model_profile table for
        // displayName, handle, avatarUrl, bio, and the model's links/assets.
        // For now we return a static HTML page as a demo.
        return renderProfilePage(_modelId);
    }
    async updateProfile(_modelId, config) {
        // Persist native profile customisations (colors, links, layout).
        // Stub — in production this writes to a link_bio_config table.
        this.enabled = true;
        if (config.enabled === false) {
            this.enabled = false;
        }
    }
    async getAnalytics(_modelId) {
        // Query post_metric rows for this model's posts and aggregate into
        // daily click/view counts.
        // Stub — returns empty analytics.
        return [
            {
                clicks: 0,
                views: 0,
                date: new Date().toISOString().slice(0, 10),
                source: 'native',
            },
        ];
    }
    getKind() {
        return this.kind;
    }
    isEnabled() {
        return this.enabled;
    }
}
// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------
function renderProfilePage(modelId) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(modelId)} — AXIOM Link</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);
      color: #f0f0f0;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
    }
    .profile {
      text-align: center;
      max-width: 480px;
      width: 100%;
    }
    .avatar {
      width: 96px;
      height: 96px;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
      margin: 0 auto 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 2.5rem;
    }
    h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }
    .bio { color: rgba(255,255,255,0.7); font-size: 0.9rem; margin-bottom: 1.5rem; }
    .links { display: flex; flex-direction: column; gap: 0.75rem; }
    .link-card {
      display: block;
      padding: 0.85rem 1.25rem;
      background: rgba(255,255,255,0.08);
      border-radius: 12px;
      text-decoration: none;
      color: #f0f0f0;
      font-weight: 500;
      transition: background 0.2s, transform 0.15s;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .link-card:hover { background: rgba(255,255,255,0.16); transform: translateY(-1px); }
    .footer { margin-top: 2rem; font-size: 0.75rem; color: rgba(255,255,255,0.35); }
  </style>
</head>
<body>
  <div class="profile">
    <div class="avatar">👤</div>
    <h1>${escapeHtml(modelId)}</h1>
    <p class="bio">Powered by AXIOM</p>
    <div class="links">
      <a href="#" class="link-card" onclick="trackClick(this)">Coming soon</a>
    </div>
    <div class="footer">AXIOM Link-in-Bio &mdash; Native</div>
  </div>
  <script>
    function trackClick(el) {
      // Click tracking stub — would POST to /api/v1/analytics/click
      console.log('Click tracked:', el.textContent);
    }
  </script>
</body>
</html>`;
}
function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
//# sourceMappingURL=native.js.map