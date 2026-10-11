import { BASE_ALLOWED_PARAMS, filterParams } from './allowedParams.js';
import { createAttributeTracker } from './attributeTracker.js';
import { warnAboutLimits } from './limits.js';
import { elementPath, listen, observeFirstSeen } from './dom.js';

export { BASE_ALLOWED_PARAMS } from './allowedParams.js';
export { GA4_LIMITS, findLimitProblems } from './limits.js';
export { elementPath, listen, observeFirstSeen } from './dom.js';

/**
 * Creates one app's analytics object.
 *
 *   const analytics = createAnalytics({
 *     extraAllowedParams: ['link_url'],                      // this app's own parameter names
 *     commonParams: () => ({ is_staff: isStaff }),           // added to every event, read each time
 *   });
 *   analytics.attach('#app', ['click', 'scrollIntoView']);  // attribute-based tracking
 *   analytics.track('assistant_message_sent', { length: 42 });
 *
 * Options:
 *   extraAllowedParams   Parameter names this app may send on top of BASE_ALLOWED_PARAMS.
 *                        Any other parameter is dropped with a console warning.
 *   commonParams         A function returning parameters to add to every event. It is a function,
 *                        not an object, so values that change while the page is open stay current.
 *                        These are not checked against the allowed list.
 *   eventAttribute       Attribute that names events for `attach` (default 'data-anl-event').
 *   paramAttributePrefix Prefix of attributes that hold parameters for `attach` (default 'data-anl-').
 *   gtag                 The function events are sent to. Defaults to `window.gtag`, looked up when
 *                        each event is sent. If there is none, events are quietly not sent.
 *   debug                When true, every event is also logged to the console, even when gtag is missing.
 */
export function createAnalytics({
    extraAllowedParams = [],
    commonParams = () => ({}),
    eventAttribute = 'data-anl-event',
    paramAttributePrefix = 'data-anl-',
    gtag = null,
    debug = false,
} = {}) {
    const allowedParams = new Set([...BASE_ALLOWED_PARAMS, ...extraAllowedParams]);

    function getGtag() {
        if (gtag) { return gtag; }
        return typeof window !== 'undefined' && typeof window.gtag === 'function' ? window.gtag : null;
    }

    /**
     * Sends one GA4 event. Parameters not on the allowed list are dropped (with a warning), then
     * `commonParams()` is added. Events that break GA4's size limits are still sent, with a warning.
     */
    function track(eventName, params = {}) {
        const sendGtag = getGtag();
        if (!sendGtag && !debug) { return; }
        const eventParams = { ...filterParams(params, allowedParams), ...commonParams() };
        warnAboutLimits(eventName, eventParams);
        if (debug) { console.log('[analytics]', eventName, eventParams); }
        if (sendGtag) { sendGtag('event', eventName, eventParams); }
    }

    const { attach } = createAttributeTracker({ send: track, eventAttribute, paramAttributePrefix });

    return {
        track,
        attach,
        listen,
        observeFirstSeen,
        elementPath,
        allowedParams,
    };
}
