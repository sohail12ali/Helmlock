# Blueprint 20: UI libraries and token cost (measured)

Question: is plain JavaScript and CSS too expensive in tokens, and would Bootstrap or another library cost less? Card: F131. Measurements are character counts divided by four (a rough guide) on this machine; library facts come from each project's own site and should be re-checked before relying on them.

## Where tokens actually go

| Cost | When | Who pays |
|---|---|---|
| Writing the design-system CSS | Once | The person or agent building the console |
| Writing widgets (tabs, split panes, tree, dialogs) | Once, plus fixes | Same |
| Writing screen markup | Every screen, every edit | Whoever writes screens |
| Reading CSS and code to change something | Each edit | The agent making the change |
| Reading a vendored library | Never (nobody opens it) | Nobody |

So the CSS is a small one-time cost; the markup per screen and the widgets are the recurring ones.

## Same screen part in each approach

One card: a title, three list rows, a three-row table with status badges, and two buttons.

| Written in | Characters | About tokens | Compared with our own classes |
|---|---|---|---|
| **Our data DSL** (the agent writes data, a program draws it) | 267 | 66 | **45%** |
| Pico CSS (classless) | 534 | 133 | 89% |
| Our own tokens and semantic classes | 599 | 149 | 100% |
| Web Awesome (web components) | 590 | 147 | 98% |
| Bootstrap 5.3 | 1,006 | 251 | **168%** |
| Tailwind (utility classes) | 1,924 | 481 | **321%** |

**What this says.** Bootstrap makes each screen 1.7 times longer and Tailwind 3.2 times longer, because of the class names. Pico and web components are as short as your own markup. The cheapest by far is not writing markup at all: agents write data and the program draws it.

## One-time CSS cost

| Design system | Characters | About tokens |
|---|---|---|
| This plan page (all viewer CSS, including about 45 mockup components) | 22,832 | **5,708** |
| control-center `styles.css` | 115,156 | **28,789** |
| Bootstrap or Tailwind CSS | large, but vendored or generated | Agents never read it |

A small, token-based design system is cheap to write once. The saving a library offers on CSS is real but modest.

## What each library offers (from their sites; verify)

| Library | Facts |
|---|---|
| **Bootstrap 5.3** | Colour modes at runtime through `data-bs-theme`. Radius, fonts and spacing are Sass at build time. Tabs, offcanvas drawer, modal, dropdown included. **No split panes and no tree.** Very mature, models know it well |
| **Tailwind** | Utility classes with a build step. Long markup. No widgets. Very flexible |
| **Pico CSS** | Classless semantic HTML, over 130 CSS variables, about 20 colour themes, dark mode. Basic elements only. **Its site says it is no longer maintained** |
| **Shoelace** | Web components, MIT, split panel, tabs, tree, drawer, dialog, colour picker. **Sunset; Web Awesome succeeds it** |
| **Web Awesome** | Successor to Shoelace. Free MIT core: 50+ accessible components, 10+ themes, CSS custom properties, CDN autoloader with no build step, split panel, tab group, tree, drawer, dialog, colour picker, popover, tooltip, animation. A paid Pro tier adds premium components, a theme builder and support |
| **VSCode Elements** | Web components that look like VS Code, themed by CSS variables, tree, tabs, split layout, table. Built for editor extensions; v2.5 and active |

## My opinion

1. **A library helps, but not for the reason you worry about.** CSS is a small one-time cost. The expensive part is widgets (split panes, tree, drawer, dialog, colour picker) written by hand, plus their accessibility.
2. **Do not pick Bootstrap or Tailwind.** Their markup is much longer per screen, Bootstrap cannot theme radius, fonts and density at runtime without Sass (you asked for exactly that), and neither gives you the control-center look or the resizable layout.
3. **Keep your own token layer** for look and themes. It costs the same markup as anything else and it is the theme system you asked for (F79).
4. **Add a web-component library only for the hard widgets.** Web Awesome (free core) covers split panel, tabs, tree, drawer, dialog and colour picker, needs no build step, and is themed through CSS variables. It is new and has a paid tier, so vendor and pin a version.
5. **The biggest saving is architectural.** Agents write data (records, the mockup DSL), a program renders it. That is 0.45 times the markup, and it is how this plan page is built.

## One-day spike before deciding

1. Vendor Web Awesome into the viewer folder (no CDN).
2. Re-render the Overview mockup with its card, badge, tab group and a split panel, using our theme tokens.
3. Check: all eight themes still work; the font, radius and density tokens reach the components; the split panel resizes by mouse and keyboard; a tree component works; the page still opens by double-click offline; the added size is acceptable.
4. Decide with a rule: if tokens map cleanly and the look can match control-center, adopt it for widgets; otherwise stay with our own components, which already work (the Layout lab).

## Rules for agents either way

- Agents do not write UI markup for features; they write data that a viewer renders.
- A generated component catalog page lists every class and widget with one example, so a model learns the vocabulary cheaply instead of reading CSS.
- Vendored libraries live in a folder that search and agents ignore (F126).
