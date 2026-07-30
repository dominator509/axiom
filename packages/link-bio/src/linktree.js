/**
 * LinktreeProvider integrates with the Linktree API to manage a model's
 * Linktree profile and retrieve click analytics.
 *
 * Linktree is a popular hosted link-in-bio service. This provider wraps
 * its public (or partner) API.
 *
 * Stub implementation — real API calls would use a configured API token.
 */
export class LinktreeProvider {
    kind = 'linktree';
    enabled = false;
    baseUrl;
    apiToken;
    constructor(baseUrl = 'https://api.linktr.ee', apiToken) {
        this.baseUrl = baseUrl;
        this.apiToken = apiToken;
    }
    // -----------------------------------------------------------------------
    // LinkInBioProvider implementation
    // -----------------------------------------------------------------------
    async getProfile(modelId) {
        // Fetch the Linktree profile for this model.
        const headers = { 'Content-Type': 'application/json' };
        if (this.apiToken) {
            headers['Authorization'] = `Bearer ${this.apiToken}`;
        }
        const response = await fetch(`${this.baseUrl}/profiles/${modelId}`, {
            method: 'GET',
            headers,
        });
        if (!response.ok) {
            throw new Error(`Linktree API error: ${response.status} ${response.statusText}`);
        }
        return response.json();
    }
    async updateProfile(modelId, config) {
        // Update the Linktree profile — links, bio, appearance, etc.
        const headers = { 'Content-Type': 'application/json' };
        if (this.apiToken) {
            headers['Authorization'] = `Bearer ${this.apiToken}`;
        }
        const response = await fetch(`${this.baseUrl}/profiles/${modelId}`, {
            method: 'PUT',
            headers,
            body: JSON.stringify(config),
        });
        if (!response.ok) {
            throw new Error(`Linktree update error: ${response.status} ${response.statusText}`);
        }
        this.enabled = true;
    }
    async getAnalytics(modelId) {
        // Fetch click analytics from Linktree.
        const headers = { 'Content-Type': 'application/json' };
        if (this.apiToken) {
            headers['Authorization'] = `Bearer ${this.apiToken}`;
        }
        try {
            const response = await fetch(`${this.baseUrl}/profiles/${modelId}/analytics`, {
                method: 'GET',
                headers,
            });
            if (!response.ok) {
                return [];
            }
            const data = (await response.json());
            return data.map((entry) => ({
                clicks: entry.clicks ?? 0,
                views: entry.views ?? 0,
                date: entry.date ?? new Date().toISOString().slice(0, 10),
                source: 'linktree',
            }));
        }
        catch {
            return [];
        }
    }
    getKind() {
        return this.kind;
    }
    isEnabled() {
        return this.enabled;
    }
}
//# sourceMappingURL=linktree.js.map