# @sefaria/analytics

Shared GA4 (Google Analytics 4) tracking for Sefaria's web apps. Sefaria-Project and the AI Chatbot
(Library Assistant) both use it, so they send events the same way.

It gives each app:

- **`track(name, params)`**: send one event from code.
- **Attribute-based tracking**: add `data-anl-*` attributes to HTML, and clicks, scrolls into view, typing and so on are sent without any JavaScript in the component.
- **An allowed-parameter list**: parameters that aren't on it are dropped, with a console warning.
- **Common parameters**: details added to every event, such as `is_staff`.
- **GA4 size-limit warnings**: GA4 quietly cuts values longer than 100 characters. The package warns in the console instead.
- **Shadow DOM support**: tracking works inside web components such as `<lc-chatbot>`.
- **Debug mode**: every event is logged to the console.

It only sends events to the page's `gtag` function. Loading Google's `gtag.js` and calling
`gtag('config', ...)` stays in each app.

## Install

Until the package is on the npm registry, install it from GitHub, pinned to a release tag or commit:

```bash
npm install github:Sefaria/Sefaria-Analytics#v0.1.0
```

It is plain modern JavaScript (ES modules) with no build step. Webpack 5 (Sefaria-Project) and Vite (the
chatbot) both bundle it as-is.

## Use

```js
import { createAnalytics } from '@sefaria/analytics';

const analytics = createAnalytics({
  extraAllowedParams: ['link_url', 'search_text'],                    // this app's own parameter names
  commonParams: () => ({ is_staff: isStaff, la_version: APP_VERSION }), // added to every event
  debug: false,
});

analytics.track('assistant_message_sent', { length: 42 });
analytics.attach('#app', ['click', 'scrollIntoView']);
```

### `createAnalytics(options)`

| Option | Default | What it does |
| --- | --- | --- |
| `extraAllowedParams` | `[]` | Parameter names this app may send, on top of `BASE_ALLOWED_PARAMS` ([src/allowedParams.js](src/allowedParams.js)). Anything else is dropped with a warning. |
| `commonParams` | `() => ({})` | A function returning parameters to add to every event. It's a function so values that change while the page is open (like `is_staff`) are read fresh each time. These skip the allowed-list check, and win over an event's own parameter with the same name. |
| `eventAttribute` | `'data-anl-event'` | The attribute that names events, for `attach`. |
| `paramAttributePrefix` | `'data-anl-'` | The prefix of attributes that hold parameters, for `attach`. |
| `gtag` | `window.gtag` | The function events are sent to, looked up when each event is sent. If there isn't one, nothing is sent and nothing breaks. |
| `debug` | `false` | Log every event to the console as `[analytics] name {params}`, even when `gtag` isn't loaded. |

It returns `{ track, attach, listen, observeFirstSeen, elementPath, allowedParams }`.

### Attribute-based tracking: `attach(target, eventTypes)`

`target` is a CSS selector, an element, or a list of elements. Use an element to reach inside a shadow DOM:
a CSS selector can't.

```html
<div data-anl-feature_name="sidebar">
  <button data-anl-event="sidebar_click:click" data-anl-text="Share">Share</button>
</div>
```

Clicking the button sends `sidebar_click` with `{feature_name: "sidebar", text: "Share"}`.

- `data-anl-event="<event name>:<event type>"`. Several events are separated by `|`, e.g. `promo_viewed:scrollIntoView|promo_clicked:click`.
- `data-anl-<param>="<value>"` on the element or any element above it (up to `target`) adds a parameter. If two elements set the same parameter, the one lower down wins.
- `data-anl-batch='{"position": 3}'` sets several parameters at once from JSON.
- Event types: any browser event (`click`, `mouseover`, `input`, ...), plus:
  - `scrollIntoView`: the element came into view (once per element).
  - `toggle`: a `<details>` element opened or closed (adds `from` and `to`).
  - `inputStart`: the first time someone types into the element.
- `input` events add the typed `text`.
- Elements added to the page later are tracked too.

### Sending from code: `track(name, params)`

```js
analytics.track('assistant_search_submitted', { source: 'header', search_text: query });
```

Always use `track()` instead of calling `gtag` directly. A direct call skips the allowed list, the common
parameters and the size checks.

### Custom rules: `listen` and `observeFirstSeen`

When an app's rule doesn't fit `data-anl-*` (for example "if there's no label, use the link text"), it writes the
rule itself on top of these two helpers. Both work across a shadow DOM wall.

```js
// handler(event, path): path is every element the event passed through, innermost first.
const stop = analytics.listen(host, 'click', (event, path) => {
  const labelled = path.find(el => el.getAttribute('data-feature-name'));
  if (labelled) analytics.track('assistant_click', { feature_name: labelled.getAttribute('data-feature-name') });
});

// Calls onSeen(element) the first time each matching element scrolls into view, including ones added later.
const stopWatching = analytics.observeFirstSeen(messageList, '[data-element-shown-name]', el =>
  analytics.track('assistant_element_shown', { feature_name: el.getAttribute('data-element-shown-name') }),
  { root: messageList, threshold: 0.5 },
);
```

Both return a function that stops them.

## Naming rules

GA4 treats a name as an identity. Renaming an event or parameter doesn't move its history; GA4 sees a brand-new
name, and every saved report on the old name stops getting data. Also, a parameter can't be used in reports
until a GA4 admin registers it as a "custom dimension", and registration doesn't apply to events sent before it.

1. **Never rename an existing event or parameter** in a change that's meant to keep behavior the same.
2. Names are lowercase `snake_case`, at most 40 characters.
3. Start event names with the app's prefix when the event belongs to one app (the chatbot uses `assistant_`).
4. Reuse a name in `BASE_ALLOWED_PARAMS` when it means the same thing. Add a new name only when nothing fits.
5. **Version of the code that sent the event**: `<app>_version`, e.g. `site_version` (Sefaria) and
   `la_version` (Library Assistant). Don't use `app_version`: GA4 already collects that name automatically.
6. **Staff marker**: an app that marks staff traffic sends `is_staff` with the text `"true"` or `"false"`. The
   package doesn't require it.
7. Values longer than 100 characters are cut by GA4. Shorten them before sending, or accept the cut.
8. Ask a GA4 admin to register any new parameter you want to filter or group reports by.

## Moving an app onto the package

The rule: GA4 must receive exactly the same events, with the same names and parameters, before and after.

1. Install the package and create one analytics object for the app.
2. Put every parameter name the app sends today into `extraAllowedParams`, or the package will drop it.
3. Move details the app adds to every event into `commonParams`.
4. Replace hand-written tracking code with `attach`, `track`, `listen` and `observeFirstSeen`.
5. Check it: record the events from the same pages before and after (GA4's DebugView shows them live, or turn on
   `debug`), and compare.

Worked examples:

- **Sefaria-Project.** It used `static/js/analyticsEventTracker.js`, loaded by a `<script>` tag in
  `templates/base.html` and attached there. Now `static/js/client.jsx` calls
  `createAnalytics({ extraAllowedParams: [...] }).attach('#s2, #staticContentWrapper', [...])`. Its
  page-wide details (`user_id`, `site_version`, ...) stay in `gtag('config', ...)` in `base.html`.
  [test/legacyParity.test.js](test/legacyParity.test.js) runs the old file and the package side by side and
  checks that they send the same events.
- **AI Chatbot.** It had its own `track()` and two listeners in `LCChatbot.svelte`. Now `track()` calls the
  package with `commonParams: () => ({ is_staff, la_version })`. The click listener uses `listen` and keeps the
  chatbot's own rules (`data-feature-name`, then a response link, then the nearest `aria-label`). The
  "element shown" listener uses `observeFirstSeen`.

## Development

```bash
npm install
npm test            # run the tests once
npm run test:watch  # re-run on every change
```

Tests use [Vitest](https://vitest.dev) with jsdom, a fake browser that runs without a window. They replace `gtag`
with a fake that records each call.

## Versions and releases

Version numbers follow semantic versioning, so the number says how big a change is:

- **Major** (`2.0.0`): could break an app using the package, for example a removed option or a changed event.
- **Minor** (`1.1.0`): a new feature that doesn't change existing behavior.
- **Patch** (`1.0.1`): a bug fix.

To release, bump `version` in `package.json`, merge to `main`, and tag the merge commit `v<version>`. Apps
then update the `#v<version>` in their `package.json`. Publishing to the npm registry as `@sefaria/analytics`
will come later, once someone with access to the `@sefaria` npm organization owns releases.

## License

GPL-3.0, the same as Sefaria-Project.
