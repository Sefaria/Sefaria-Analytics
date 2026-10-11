// jsdom (the fake browser the tests run in) has no IntersectionObserver, because it doesn't lay
// anything out on a screen. This stand-in records what is observed, and `scrollIntoView(element)`
// tells every observer watching that element that it is now visible.
import { afterEach } from 'vitest';

const observers = new Set();

class FakeIntersectionObserver {
    constructor(callback, options = {}) {
        this.callback = callback;
        this.options = options;
        this.elements = new Set();
        observers.add(this);
    }
    observe(element) { this.elements.add(element); }
    unobserve(element) { this.elements.delete(element); }
    disconnect() { this.elements.clear(); observers.delete(this); }
}

globalThis.IntersectionObserver = FakeIntersectionObserver;

globalThis.scrollIntoView = function scrollIntoView(element) {
    for (const observer of [...observers]) {
        if (observer.elements.has(element)) {
            observer.callback([{ target: element, isIntersecting: true }], observer);
        }
    }
};

globalThis.intersectionObservers = observers;

afterEach(() => {
    observers.clear();
    document.body.innerHTML = '';
});
