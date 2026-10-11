/**
 * Attribute-based tracking: mark up HTML, and matching browser events are sent to GA4 without
 * any JavaScript in the component.
 *
 *   <div data-anl-feature_name="sidebar">
 *     <button data-anl-event="sidebar_click:click" data-anl-text="Share">Share</button>
 *   </div>
 *
 * Clicking the button sends `sidebar_click` with {feature_name: "sidebar", text: "Share"}.
 *
 * This is Sefaria-Project's static/js/analyticsEventTracker.js, moved here with three changes:
 * 1. It walks `event.composedPath()` instead of `parentNode`, so it also works inside a shadow DOM.
 * 2. `attach` accepts elements as well as a CSS selector (a selector can't reach inside a shadow DOM).
 * 3. The custom events it dispatches are `composed`, so they cross a shadow DOM wall too.
 * For a page with no shadow DOM, the events sent to GA4 are unchanged; test/legacyParity.test.js checks this.
 */
import { elementPathBelowListener, originalTarget, resolveTargets } from './dom.js';

const TOGGLE_NODE_SELECTOR = 'details';
const NON_BUBBLING_EVENT_DELEGATES = {
    'bubblingToggle': 'toggle',
};

/**
 * `send(eventName, params)` is called for each analytics event found.
 * `eventAttribute` and `paramAttributePrefix` let an app use its own attribute names.
 */
export function createAttributeTracker({ send, eventAttribute = 'data-anl-event', paramAttributePrefix = 'data-anl-' }) {
    const BATCH_ATTR = `${paramAttributePrefix}batch`;
    const SCROLL_INTO_VIEW_SELECTOR = `[${eventAttribute}*=":scrollIntoView"]`;
    const INPUT_START_SELECTOR = `[${eventAttribute}*=":inputStart"]`;

    function _parseEventAttr(value) {
        /**
         * the value of the event attribute is of the form `<event_name1>:<event_type1>|<event_name2>:<event_type2>...`
         * Returns this data parsed into a list of objects with each object having keys `name` and `type`.
         */
        if (!value) { return [{name: "", type: ""}]; }
        return value.split("|").map(_parseSingleEventAttr);
    }

    function _parseSingleEventAttr(value) {
        /**
         * the value of a single event in the event attribute is of the form `<event name>:<event type>`
         * Returns this data parsed into an object with keys `name` and `type`.
         */
        const [eventName, eventType] = value.split(':');
        if (!eventName?.length) {
            console.warn(`Event name is invalid for \`${eventAttribute}\` value:`, value);
        }
        if (!eventType?.length) {
            console.warn(`Event type is invalid for \`${eventAttribute}\` value:`, value);
        }
        return {name: eventName, type: eventType};
    }

    function _getEventTargetByCondition(event, condition, startAfter = null) {
        /**
         * Searches the event's path, from the element where it started up to (not including) the element
         * the listener is on, for the first element where `condition(element)` returns true.
         * If `startAfter` is passed, the search starts at the element just above it in the path.
         * Returns null if no element matches.
         */
        const path = elementPathBelowListener(event);
        const start = startAfter ? path.indexOf(startAfter) + 1 : 0;
        if (startAfter && start === 0) { return null; }
        for (let i = start; i < path.length; i++) {
            if (condition(path[i])) { return path[i]; }
        }
        return null;
    }

    function _getAnalyticsEventArray(event) {
        /**
         * Return an array of objects of form {name, type} if this JS event should be treated as an analytics event
         * Looks for an element in the event's path that has the event attribute
         * If this JS event doesn't match a registered analytics event, return `null`
         */
        const eventType = _delegatedEventTypeToOriginal(event.type);
        const element = _getEventTargetByCondition(
            event,
            element => {
                const value = element.getAttribute(eventAttribute);
                return _parseEventAttr(value).some(({ type }) => type === eventType);
            }
        );
        if (!element) { return null; }
        return _parseEventAttr(element.getAttribute(eventAttribute)).filter(({ type }) => type === eventType);
    }

    function _getAnlDataFromElement(element) {
        if (!element) { return {}; }
        return Array.from(element.attributes).reduce((attrsAggregated, currAttr) => {
            const attrName = currAttr.name;
            if (attrName === eventAttribute) {
                // the event attribute names the event; it isn't a parameter
            } else if (attrName.startsWith(paramAttributePrefix)) {
                if (attrName === BATCH_ATTR) {
                    attrsAggregated = {...attrsAggregated, ...JSON.parse(currAttr.value)};
                } else {
                    const anlFieldName = attrName.replace(paramAttributePrefix, '');
                    attrsAggregated[anlFieldName] = currAttr.value;
                }
            }
            return attrsAggregated;
        }, {});
    }

    function _mergeObjectsWithoutOverwrite(a, b) {
        /**
         * merges a into b but doesn't overwrite fields in b that already exist
         */
        for (let key in a) {
            if (!(key in b)) {
                b[key] = a[key];
            }
        }
        return b;
    }

    function _delegatedEventTypeToOriginal(eventType) {
        return NON_BUBBLING_EVENT_DELEGATES?.[eventType] || eventType;
    }

    function _getDerivedData(event) {
        /**
         * Return data that can be derived directly from `event`
         */
        const eventType = _delegatedEventTypeToOriginal(event.type);
        const target = originalTarget(event);
        if (eventType === "toggle") {
            return {
                from: target.open ? "closed" : "open",
                to: target.open ? "open" : "closed"
            };
        } else if (target.tagName === 'DETAILS') {
            return {
                from: target.open ? "open" : "closed",
            };
        } else if (eventType === "input") {
            return {
                text: target.value,
            };
        }
        return {};
    }

    function _handleAnalyticsEvent(event) {
        const anlEventArray = _getAnalyticsEventArray(event);
        if (!anlEventArray) { return; }
        let anlEventData = {};
        let currElem = null;
        do {
            currElem = _getEventTargetByCondition(
                event,
                element => Object.keys(_getAnlDataFromElement(element)).length > 0,
                currElem
            );
            const currAnlEventData = _getAnlDataFromElement(currElem);
            // make sure that analytics fields that are defined lower down aren't overwritten by ones defined higher in the DOM tree
            anlEventData = _mergeObjectsWithoutOverwrite(currAnlEventData, anlEventData);
        } while (currElem);

        anlEventData = {...anlEventData, ..._getDerivedData(event)};

        anlEventArray.forEach(anlEvent => {
            send(anlEvent.name, anlEventData);
        });
    }

    function _addToggleListener(element) {
        const delegatedToggle = Object.keys(NON_BUBBLING_EVENT_DELEGATES)[0];
        element.addEventListener('toggle', function(event) {
            const bubblingToggle = new CustomEvent(delegatedToggle, {
                bubbles: true,
                composed: true,
                detail: { originalEvent: event }
            });
            event.target.dispatchEvent(bubblingToggle);
        });
    }

    function _addInputStartListener(element) {
        const handleInputStart = function(event) {
            const inputStartEvent = new CustomEvent('inputStart', {
                bubbles: true,
                composed: true,
                detail: { originalEvent: event }
            });
            event.target.dispatchEvent(inputStartEvent);
            // remove it after first input so it doesn't fire again
            element.removeEventListener('input', handleInputStart);
        }
        element.addEventListener('input', handleInputStart);
    }

    function _runFunctionOnSelector(root, selector, fn) {
        /**
         * Runs `fn(node)` on any node that matches `selector`.
         * Search includes `root` and all its children
         */
        if (root.matches?.(selector)) { fn(root); }
        root.querySelectorAll(selector).forEach(fn);
    }

    function _runFunctionsOnAddedNodes(roots, initialRoots, functions) {
        /**
         * Runs `functions` on `initialRoots` now, and on every node later added inside `roots`
         */
        // Run on existing elements
        initialRoots.forEach(root => functions.forEach(fn => fn(root)));

        const observer = new MutationObserver(mutations => {
            mutations.forEach(mutation => {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType !== Node.ELEMENT_NODE) { return; }
                    functions.forEach(fn => fn(node));
                });
            });
        });

        roots.forEach(element => {
            observer.observe(element, { childList: true, subtree: true });
        });
    }

    function _createScrollIntoViewObserver() {
        return new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const scrollIntoViewEvent = new CustomEvent('scrollIntoView', {bubbles: true, composed: true});
                    entry.target.dispatchEvent(scrollIntoViewEvent);
                    observer.unobserve(entry.target); // Stop observing the node
                }
            });
        });
    }

    /**
     * Listens for analytics events inside `target` (a CSS selector, an element, or a list of elements).
     * `eventTypes` is a list of event types to listen for: any browser event type such as 'click',
     * 'mouseover' or 'input', plus three extras this tracker adds:
     *   'scrollIntoView' - the element scrolled into view (fires once per element)
     *   'toggle'         - a <details> element opened or closed
     *   'inputStart'     - the first time someone types into the element
     * Any element inside `target` with the event attribute (default `data-anl-event`) whose value names
     * one of these types sends an analytics event. E.g. <div data-anl-event="promo_clicked:click">.
     * The data sent with the event is gathered from the param attributes (default `data-anl-<param>`) on the
     * element where the event started and every element above it, up to `target`. Lower attributes win.
     */
    function attach(target, eventTypes) {
        const elements = resolveTargets(target);
        // Where to look for elements that need extra listeners (<details>, scrollIntoView, inputStart):
        // inside each target, and inside its shadow DOM if it has an open one, such as <lc-chatbot>.
        const watchedRoots = elements.flatMap(element => element.shadowRoot ? [element, element.shadowRoot] : [element]);
        // A selector is searched for in the whole document, as the original tracker did.
        const initialRoots = typeof target === 'string' ? [document] : watchedRoots;

        const onMutationFns = [];
        let scrollIntoViewObserver = null;
        for (let eventType of eventTypes) {
            if (eventType === 'toggle') {
                onMutationFns.push(node => _runFunctionOnSelector(node, TOGGLE_NODE_SELECTOR, _addToggleListener));
                eventType = Object.keys(NON_BUBBLING_EVENT_DELEGATES)[0];
            } else if (eventType === 'scrollIntoView') {
                scrollIntoViewObserver = _createScrollIntoViewObserver();
                const observer = scrollIntoViewObserver;
                onMutationFns.push(node => _runFunctionOnSelector(node, SCROLL_INTO_VIEW_SELECTOR, element => observer.observe(element)));
            } else if (eventType === 'inputStart') {
                onMutationFns.push(node => _runFunctionOnSelector(node, INPUT_START_SELECTOR, _addInputStartListener));
            }
            elements.forEach(element => {
                element.addEventListener(eventType, _handleAnalyticsEvent);
            });
        }
        _runFunctionsOnAddedNodes(watchedRoots, initialRoots, onMutationFns);
    }

    return { attach };
}
