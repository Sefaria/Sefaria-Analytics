/**
 * Event parameters that any Sefaria app may send.
 *
 * GA4 only lets you filter or group reports by a parameter after a GA4 admin registers it,
 * and it treats a parameter's name as its identity. So the list of names is kept short and
 * deliberate: anything not on it (or on the app's own `extraAllowedParams`) is dropped with
 * a console warning instead of being sent.
 *
 * App-specific names (Sefaria's `panel_type`, the chatbot's `link_url`, ...) are NOT added
 * here. Each app passes them to `createAnalytics({ extraAllowedParams })`.
 */
export const BASE_ALLOWED_PARAMS = Object.freeze([
    'feature_name',
    'text',
    'from',
    'to',
    'action',
    'position',
    'content_id',
    'content_type',
    'link_type',
    'engagement_type',
    'engagement_value',
    'experiment',
    'logged_in',
]);

/**
 * Returns a copy of `params` without any key that isn't in `allowed`, warning once per dropped key.
 * Returns `params` itself when nothing needs dropping.
 */
export function filterParams(params, allowed) {
    const invalidKeys = Object.keys(params).filter(key => !allowed.has(key));
    if (invalidKeys.length === 0) { return params; }
    for (const key of invalidKeys) {
        console.warn("Invalid analytics key:", key);
    }
    return Object.fromEntries(Object.entries(params).filter(([key]) => !invalidKeys.includes(key)));
}
