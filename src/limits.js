/**
 * GA4's size limits for events sent with gtag. GA4 does not reject an event that breaks them;
 * it silently cuts the value short or drops the parameter. These checks only warn, so the
 * problem shows up in the console during development instead of in a report months later.
 * https://support.google.com/analytics/answer/9267744
 */
export const GA4_LIMITS = Object.freeze({
    eventNameLength: 40,
    paramNameLength: 40,
    paramValueLength: 100,
    paramsPerEvent: 25,
});

/**
 * Returns a list of human-readable problems with this event. An empty list means the event fits.
 * `null`/`undefined` values are ignored, since gtag leaves them out of the event.
 */
export function findLimitProblems(eventName, params) {
    const problems = [];
    if (String(eventName).length > GA4_LIMITS.eventNameLength) {
        problems.push(`event name "${eventName}" is longer than ${GA4_LIMITS.eventNameLength} characters`);
    }
    const sent = Object.entries(params).filter(([, value]) => value !== null && value !== undefined);
    if (sent.length > GA4_LIMITS.paramsPerEvent) {
        problems.push(`event has ${sent.length} parameters; GA4 keeps at most ${GA4_LIMITS.paramsPerEvent}`);
    }
    for (const [key, value] of sent) {
        if (key.length > GA4_LIMITS.paramNameLength) {
            problems.push(`parameter name "${key}" is longer than ${GA4_LIMITS.paramNameLength} characters`);
        }
        if (typeof value === 'string' && value.length > GA4_LIMITS.paramValueLength) {
            problems.push(`parameter "${key}" is ${value.length} characters; GA4 cuts it to ${GA4_LIMITS.paramValueLength}`);
        }
    }
    return problems;
}

export function warnAboutLimits(eventName, params) {
    for (const problem of findLimitProblems(eventName, params)) {
        console.warn(`Analytics event "${eventName}": ${problem}`);
    }
}
