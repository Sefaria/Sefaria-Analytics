import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAnalytics, findLimitProblems } from '../src/index.js';

const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
const click = element => element.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

afterEach(() => {
    vi.restoreAllMocks();
    delete window.gtag;
});

describe('track', () => {
    it('sends allowed params plus common params', () => {
        const gtag = vi.fn();
        const analytics = createAnalytics({ gtag, extraAllowedParams: ['length'], commonParams: () => ({ is_staff: 'false' }) });
        analytics.track('assistant_message_sent', { length: 42 });
        expect(gtag).toHaveBeenCalledWith('event', 'assistant_message_sent', { length: 42, is_staff: 'false' });
    });

    it('reads common params again for every event', () => {
        const gtag = vi.fn();
        let isStaff = 'false';
        const analytics = createAnalytics({ gtag, commonParams: () => ({ is_staff: isStaff }) });
        analytics.track('a');
        isStaff = 'true';
        analytics.track('b');
        expect(gtag.mock.calls.map(call => call[2].is_staff)).toEqual(['false', 'true']);
    });

    it('common params win over event params with the same name', () => {
        const gtag = vi.fn();
        const analytics = createAnalytics({ gtag, extraAllowedParams: ['la_version'], commonParams: () => ({ la_version: '1.0.0' }) });
        analytics.track('a', { la_version: 'other' });
        expect(gtag.mock.calls[0][2]).toEqual({ la_version: '1.0.0' });
    });

    it('drops params that are not allowed, with a warning', () => {
        const gtag = vi.fn();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        createAnalytics({ gtag }).track('a', { feature_name: 'x', secret: 'y' });
        expect(gtag.mock.calls[0][2]).toEqual({ feature_name: 'x' });
        expect(warn).toHaveBeenCalledWith('Invalid analytics key:', 'secret');
    });

    it('uses window.gtag, looked up when the event is sent', () => {
        const analytics = createAnalytics();
        window.gtag = vi.fn();
        analytics.track('a');
        expect(window.gtag).toHaveBeenCalledWith('event', 'a', {});
    });

    it('does nothing, quietly, when gtag is not loaded', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        expect(() => createAnalytics().track('a', { secret: 1 })).not.toThrow();
        expect(warn).not.toHaveBeenCalled();
        expect(log).not.toHaveBeenCalled();
    });

    it('logs every event in debug mode, even without gtag', () => {
        const log = vi.spyOn(console, 'log').mockImplementation(() => {});
        createAnalytics({ debug: true }).track('a', { text: 'hi' });
        expect(log).toHaveBeenCalledWith('[analytics]', 'a', { text: 'hi' });
    });

    it('still sends events that break GA4 limits, with a warning', () => {
        const gtag = vi.fn();
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        createAnalytics({ gtag }).track('a', { text: 'א'.repeat(150) });
        expect(gtag).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledWith('Analytics event "a": parameter "text" is 150 characters; GA4 cuts it to 100');
    });
});

describe('findLimitProblems', () => {
    it('accepts an event within the limits', () => {
        expect(findLimitProblems('ok_event', { text: 'short', empty: null })).toEqual([]);
    });

    it('reports each kind of problem', () => {
        const tooMany = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`p${i}`, i]));
        expect(findLimitProblems('e'.repeat(41), {})).toHaveLength(1);
        expect(findLimitProblems('a', tooMany)).toEqual(['event has 26 parameters; GA4 keeps at most 25']);
        expect(findLimitProblems('a', { ['k'.repeat(41)]: 1 })).toHaveLength(1);
    });

    it('does not count params gtag leaves out', () => {
        const nulls = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, null]));
        expect(findLimitProblems('a', nulls)).toEqual([]);
    });
});

function makeShadowHost(innerHtml) {
    const host = document.createElement('lc-chatbot');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = innerHtml;
    return { host, shadow };
}

describe('attach inside a shadow DOM', () => {
    it('finds the clicked element behind the shadow DOM wall', () => {
        const gtag = vi.fn();
        const { host, shadow } = makeShadowHost(`
            <div data-anl-feature_name="panel">
              <button data-anl-event="assistant_click:click"><span id="icon">*</span></button>
            </div>`);
        createAnalytics({ gtag }).attach(host, ['click']);
        click(shadow.querySelector('#icon'));
        expect(gtag).toHaveBeenCalledWith('event', 'assistant_click', { feature_name: 'panel' });
    });

    it('tracks scrollIntoView and inputStart for elements added later, when attached to the host', async () => {
        const gtag = vi.fn();
        const { host, shadow } = makeShadowHost('<div id="messages"></div>');
        createAnalytics({ gtag }).attach(host, ['scrollIntoView', 'inputStart']);
        shadow.querySelector('#messages').innerHTML = `
            <div id="topic" data-anl-event="topic_shown:scrollIntoView"></div>
            <textarea id="box" data-anl-event="typing_started:inputStart"></textarea>`;
        await nextTask();
        scrollIntoView(shadow.querySelector('#topic'));
        const box = shadow.querySelector('#box');
        box.value = 'h';
        box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        expect(gtag.mock.calls.map(call => call[1])).toEqual(['topic_shown', 'typing_started']);
    });

    it('works for elements added later when attached to an element inside the shadow root', async () => {
        const gtag = vi.fn();
        const { shadow } = makeShadowHost('<div id="root"><div id="messages"></div></div>');
        createAnalytics({ gtag }).attach(shadow.querySelector('#root'), ['scrollIntoView', 'inputStart', 'click']);
        shadow.querySelector('#messages').innerHTML = `
            <div id="topic" data-anl-event="topic_shown:scrollIntoView" data-anl-feature_name="topics"></div>
            <textarea id="box" data-anl-event="typing_started:inputStart"></textarea>`;
        await nextTask();
        scrollIntoView(shadow.querySelector('#topic'));
        const box = shadow.querySelector('#box');
        box.value = 'h';
        box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        expect(gtag.mock.calls.map(call => call.slice(1))).toEqual([
            ['topic_shown', { feature_name: 'topics' }],
            ['typing_started', {}],
        ]);
    });

    it('accepts custom attribute names', () => {
        const gtag = vi.fn();
        document.body.innerHTML = `
            <div id="app"><nav data-track-feature_name="nav">
              <a id="link" data-track-event="nav_clicked:click">Home</a>
            </nav></div>`;
        createAnalytics({ gtag, eventAttribute: 'data-track-event', paramAttributePrefix: 'data-track-' })
            .attach('#app', ['click']);
        click(document.querySelector('#link'));
        expect(gtag).toHaveBeenCalledWith('event', 'nav_clicked', { feature_name: 'nav' });
    });
});

describe('listen', () => {
    it('gives the handler every element the event passed through, across the shadow DOM wall', () => {
        const { host, shadow } = makeShadowHost('<div aria-label="Chat"><button data-feature-name="send"><b id="b">Send</b></button></div>');
        const seen = [];
        const analytics = createAnalytics();
        const stop = analytics.listen(host, 'click', (event, path) => seen.push(path.map(el => el.tagName)));
        click(shadow.querySelector('#b'));
        stop();
        click(shadow.querySelector('#b'));
        expect(seen).toEqual([['B', 'BUTTON', 'DIV', 'LC-CHATBOT', 'BODY', 'HTML']]);
    });
});

describe('observeFirstSeen', () => {
    it('reports each matching element once, including ones added later', async () => {
        const { shadow } = makeShadowHost('<div id="list"><p id="first" data-element-shown-name="a"></p></div>');
        const list = shadow.querySelector('#list');
        const onSeen = vi.fn();
        const stop = createAnalytics().observeFirstSeen(list, '[data-element-shown-name]', onSeen, { root: list, threshold: 0.5 });
        list.insertAdjacentHTML('beforeend', '<div><p id="second" data-element-shown-name="b"></p></div>');
        await nextTask();
        scrollIntoView(shadow.querySelector('#first'));
        scrollIntoView(shadow.querySelector('#first'));
        scrollIntoView(shadow.querySelector('#second'));
        expect(onSeen.mock.calls.map(([el]) => el.id)).toEqual(['first', 'second']);
        const [observer] = [...intersectionObservers];
        expect(observer.options).toEqual({ root: list, threshold: 0.5 });
        stop();
        expect(intersectionObservers.size).toBe(0);
    });
});
