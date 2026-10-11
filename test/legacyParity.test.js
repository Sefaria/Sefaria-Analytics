/**
 * The package must send GA4 exactly the same events as Sefaria-Project's old
 * static/js/analyticsEventTracker.js, so that no existing GA4 report breaks.
 *
 * Each scenario below builds the same page twice: once with the old tracker attached and once with the
 * package attached, performs the same user actions, and compares every gtag call and every warning.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { BASE_ALLOWED_PARAMS, createAnalytics } from '../src/index.js';

const legacySource = readFileSync(join(import.meta.dirname, 'fixtures', 'legacyAnalyticsEventTracker.js'), 'utf8');

// The original tracker's allowed list (analyticsEventTracker.js lines 2-8).
const LEGACY_ALLOWED_PARAMS = [
    'project', 'panel_type', 'panel_number', 'item_id', 'version', 'content_lang',
    'content_id', 'content_type', 'panel_name', 'panel_category', 'position', 'ai',
    'text', 'experiment', 'feature_name', 'from', 'to', 'action', 'engagement_value',
    'engagement_type', 'logged_in', 'site_lang', 'traffic_type', 'promotion_name', 'link_type',
    'form_name', 'form_destination',
];

// What Sefaria-Project passes as `extraAllowedParams` (static/js/client.jsx).
const SEFARIA_EXTRA_PARAMS = [
    'project', 'panel_type', 'panel_number', 'item_id', 'version', 'content_lang',
    'panel_name', 'panel_category', 'ai', 'site_lang', 'traffic_type', 'promotion_name',
    'form_name', 'form_destination',
];

const SELECTOR = '#s2, #staticContentWrapper';
const EVENT_TYPES = ['click', 'scrollIntoView', 'toggle', 'mouseover', 'input', 'inputStart'];

const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));

function attachLegacy(gtag) {
    const AnalyticsEventTracker = new Function('gtag', `${legacySource}\nreturn AnalyticsEventTracker;`)(gtag);
    AnalyticsEventTracker.attach(SELECTOR, EVENT_TYPES);
}

function attachPackage(gtag) {
    createAnalytics({ extraAllowedParams: SEFARIA_EXTRA_PARAMS, gtag }).attach(SELECTOR, EVENT_TYPES);
}

async function record(attachTracker, html, actions) {
    document.body.innerHTML = html;
    const gtag = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
        attachTracker(gtag);
        await actions();
        await nextTask();
        return { gtagCalls: gtag.mock.calls, warnings: warn.mock.calls };
    } finally {
        warn.mockRestore();
    }
}

async function expectSameEvents(html, actions) {
    const legacy = await record(attachLegacy, html, actions);
    const shared = await record(attachPackage, html, actions);
    expect(shared).toEqual(legacy);
    return shared;
}

const $ = selector => document.querySelector(selector);
const click = element => element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
const mouseover = element => element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
function type(input, value) {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('same events as the old analyticsEventTracker.js', () => {
    it('allows exactly the same parameters', () => {
        expect(new Set([...BASE_ALLOWED_PARAMS, ...SEFARIA_EXTRA_PARAMS])).toEqual(new Set(LEGACY_ALLOWED_PARAMS));
    });

    it('click gathers params from the element and its parents, lower ones winning', async () => {
        const { gtagCalls } = await expectSameEvents(`
            <div id="s2"><div>
              <div data-anl-feature_name="outer" data-anl-project="library">
                <section data-anl-feature_name="inner" data-anl-panel_number="2">
                  <button data-anl-event="button_clicked:click" data-anl-text="Go"><span id="label">Go</span></button>
                </section>
              </div>
            </div></div>`,
            () => click($('#label')));
        expect(gtagCalls).toEqual([['event', 'button_clicked',
            { text: 'Go', feature_name: 'inner', panel_number: '2', project: 'library' }]]);
    });

    it('reads data-anl-batch JSON', async () => {
        await expectSameEvents(`
            <div id="s2"><div>
              <a id="link" data-anl-event="link_clicked:click" data-anl-batch='{"position": 3, "content_type": "sheet"}'>x</a>
            </div></div>`,
            () => click($('#link')));
    });

    it('drops parameters that are not allowed, with a warning', async () => {
        const { warnings } = await expectSameEvents(`
            <div id="s2"><div>
              <button id="b" data-anl-event="button_clicked:click" data-anl-bogus="1" data-anl-text="ok">x</button>
            </div></div>`,
            () => click($('#b')));
        expect(warnings).toEqual([['Invalid analytics key:', 'bogus']]);
    });

    it('sends every event named for the browser event type', async () => {
        await expectSameEvents(`
            <div id="s2"><div>
              <button id="b" data-anl-event="first:click|second:click|hovered:mouseover">x</button>
            </div></div>`,
            () => { click($('#b')); mouseover($('#b')); });
    });

    it('ignores clicks outside any tracked element', async () => {
        const { gtagCalls } = await expectSameEvents(`
            <div id="s2"><div><p id="plain" data-anl-feature_name="unused">nothing</p></div></div>`,
            () => click($('#plain')));
        expect(gtagCalls).toEqual([]);
    });

    it('tracks <details> opening and closing', async () => {
        const { gtagCalls } = await expectSameEvents(`
            <div id="s2"><div>
              <details id="faq" data-anl-event="faq_toggled:toggle" data-anl-feature_name="faq"><summary>Q</summary>A</details>
            </div></div>`,
            async () => {
                $('#faq').open = true;
                await nextTask();
                $('#faq').open = false;
                await nextTask();
            });
        expect(gtagCalls.map(call => call[2])).toEqual([
            { feature_name: 'faq', from: 'closed', to: 'open' },
            { feature_name: 'faq', from: 'open', to: 'closed' },
        ]);
    });

    it('adds `from` when a <details> element is clicked', async () => {
        await expectSameEvents(`
            <div id="s2"><div>
              <details id="d" data-anl-event="details_clicked:click"><summary>Q</summary>A</details>
            </div></div>`,
            () => click($('#d')));
    });

    it('sends typed text for input, and inputStart only once', async () => {
        const { gtagCalls } = await expectSameEvents(`
            <div id="s2"><div>
              <input id="search" data-anl-event="search_typed:input|search_started:inputStart" data-anl-feature_name="search">
            </div></div>`,
            () => { type($('#search'), 'a'); type($('#search'), 'ab'); });
        expect(gtagCalls.map(call => call[1])).toEqual(['search_started', 'search_typed', 'search_typed']);
    });

    it('sends scrollIntoView once per element', async () => {
        await expectSameEvents(`
            <div id="s2"><div>
              <div id="promo" data-anl-event="promo_viewed:scrollIntoView" data-anl-promotion_name="spring"></div>
            </div></div>`,
            () => { scrollIntoView($('#promo')); scrollIntoView($('#promo')); });
    });

    it('tracks elements added to the page after attach', async () => {
        const { gtagCalls } = await expectSameEvents(`<div id="s2"><div id="app"></div></div>`, async () => {
            $('#app').innerHTML = `
                <div id="promo" data-anl-event="promo_viewed:scrollIntoView" data-anl-promotion_name="late"></div>
                <details id="faq" data-anl-event="faq_toggled:toggle"><summary>Q</summary></details>
                <input id="search" data-anl-event="search_started:inputStart">`;
            await nextTask();
            scrollIntoView($('#promo'));
            $('#faq').open = true;
            await nextTask();
            type($('#search'), 'a');
        });
        expect(gtagCalls.map(call => call[1])).toEqual(['promo_viewed', 'faq_toggled', 'search_started']);
    });

    it('also works in #staticContentWrapper', async () => {
        await expectSameEvents(`
            <div id="staticContentWrapper"><main>
              <a id="cta" data-anl-event="cta_clicked:click" data-anl-link_type="donate">Donate</a>
            </main></div>`,
            () => click($('#cta')));
    });
});

describe('known difference from the old tracker', () => {
    // When an element carrying data-anl-* params sits directly inside #s2, the old tracker kept
    // searching past #s2 up to `document`, crashed on `document.attributes`, and sent nothing.
    // The package stops at #s2 and sends the event. This only changes events that were being lost.
    it('sends the event the old tracker crashed on', async () => {
        const html = `
            <div id="s2">
              <div data-anl-feature_name="top"><button id="b" data-anl-event="button_clicked:click">x</button></div>
            </div>`;
        const legacy = await record(attachLegacy, html, () => {
            const errors = [];
            const onError = event => { errors.push(event.error); event.preventDefault(); };
            window.addEventListener('error', onError);
            click($('#b'));
            window.removeEventListener('error', onError);
            expect(errors[0]).toBeInstanceOf(TypeError);
        });
        const shared = await record(attachPackage, html, () => click($('#b')));
        expect(legacy.gtagCalls).toEqual([]);
        expect(shared.gtagCalls).toEqual([['event', 'button_clicked', { feature_name: 'top' }]]);
    });
});
