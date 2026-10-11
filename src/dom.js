/**
 * DOM helpers that work the same inside and outside a shadow DOM.
 *
 * A shadow DOM walls a web component's HTML off from the page (the chatbot's <lc-chatbot> uses
 * one). A listener on the page only sees "something inside <lc-chatbot> was clicked": both
 * `event.target` and the `parentNode` chain stop at the wall. `event.composedPath()` is the
 * browser's list of every element the event passed through, including the ones behind the wall,
 * so everything here is built on it.
 */

/**
 * Turns a CSS selector, an element, or a list of elements into an array of elements.
 * A selector is looked up in `document`, so it cannot reach inside a shadow DOM; pass the
 * element itself for that.
 */
export function resolveTargets(target) {
    if (typeof target === 'string') { return Array.from(document.querySelectorAll(target)); }
    if (!target) { return []; }
    if (typeof target[Symbol.iterator] === 'function') { return Array.from(target); }
    return [target];
}

/**
 * Every Element the event passed through, innermost first, including elements behind a shadow
 * DOM wall and the page's elements above it. Non-element entries (the shadow root, `document`,
 * `window`) are left out.
 * Must be called while the event is being handled: browsers empty `composedPath()` afterwards.
 */
export function elementPath(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    if (path.length === 0) {
        // Fallback for environments without composedPath: walk up the parent chain.
        const elements = [];
        for (let node = event.target; node; node = node.parentNode) { elements.push(node); }
        return elements.filter(node => node instanceof Element);
    }
    return path.filter(node => node instanceof Element);
}

/**
 * Like `elementPath`, but only the elements strictly inside the element the listener is on
 * (`event.currentTarget`). The listener's own element and everything above it are left out.
 */
export function elementPathBelowListener(event) {
    const path = elementPath(event);
    const listenerIndex = path.indexOf(event.currentTarget);
    return listenerIndex === -1 ? path : path.slice(0, listenerIndex);
}

/**
 * The element the event really started on, even when it started behind a shadow DOM wall
 * (where `event.target` would only give the web component's tag).
 */
export function originalTarget(event) {
    return elementPath(event)[0] || event.target;
}

/**
 * Calls `handler(event, path)` for every `eventType` event on `target`, where `path` is
 * `elementPath(event)`. Returns a function that removes the listener.
 *
 *   const stop = analytics.listen(host, 'click', (event, path) => {
 *     const button = path.find(el => el.hasAttribute('data-feature-name'));
 *     if (button) analytics.track('assistant_click', {feature_name: button.getAttribute('data-feature-name')});
 *   });
 */
export function listen(target, eventType, handler) {
    const elements = resolveTargets(target);
    const onEvent = event => handler(event, elementPath(event));
    elements.forEach(element => element.addEventListener(eventType, onEvent));
    return () => elements.forEach(element => element.removeEventListener(eventType, onEvent));
}

/**
 * Calls `onSeen(element)` the first time each element matching `selector` inside `container`
 * scrolls into view, once per element. Elements added to `container` later (for example, a
 * message streamed in after the page loaded) are picked up automatically.
 * `intersectionOptions` goes straight to `IntersectionObserver` (`root`, `threshold`, `rootMargin`).
 * Returns a function that stops watching.
 */
export function observeFirstSeen(container, selector, onSeen, intersectionOptions = {}) {
    const seen = new WeakSet();
    const intersectionObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) { continue; }
            const element = entry.target;
            intersectionObserver.unobserve(element);
            if (seen.has(element)) { continue; }
            seen.add(element);
            onSeen(element);
        }
    }, intersectionOptions);

    function observe(node) {
        if (!(node instanceof Element)) { return; }
        if (node.matches(selector) && !seen.has(node)) { intersectionObserver.observe(node); }
        node.querySelectorAll(selector).forEach(element => {
            if (!seen.has(element)) { intersectionObserver.observe(element); }
        });
    }

    observe(container);
    const mutationObserver = new MutationObserver(mutations => {
        for (const mutation of mutations) { mutation.addedNodes.forEach(observe); }
    });
    mutationObserver.observe(container, { childList: true, subtree: true });

    return () => {
        intersectionObserver.disconnect();
        mutationObserver.disconnect();
    };
}
