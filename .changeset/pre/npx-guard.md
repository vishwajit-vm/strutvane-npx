---
'strutvane': minor
---

`npx strutvane`, the v2 npx guard. Inside a Strutvane project (the nearest folder whose
package.json lists `@strutvane/framework`) it runs exactly what `node strut <args>` runs: the
project's own `strut.js`, or without one the `strutvane` program of the project's installed
`@strutvane/framework`, with the same Node, no shell, and the exit code or signal passed back.
Outside a project it only prints: help and `--version` exit 0, `new`/`create`/`init` point to
`npm create strutvane`, anything else exits 2. It never installs or downloads anything, refuses a
`strut.js` without the framework in package.json, a project root that is a link, and a framework,
`strut.js` or bin whose real location is outside the project, and never looks above your home
folder. Zero dependencies; Node 24.3 or newer.
