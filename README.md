# strutvane

**`npx strutvane`**: run Strutvane project commands with npx.

**Package:** `strutvane` · **Part of:** [Strutvane](https://github.com/vishwajit-vm/strutvane) · **Docs:** https://vishwajit-vm.github.io/strutvane-docs/ · **License:** MIT

## What it does

Inside a Strutvane app, these two commands do exactly the same thing:

```text
node strut migrate
npx strutvane migrate
```

`npx strutvane <command>` finds your project and runs its own `strut.js` with your arguments, using
the `@strutvane/framework` version your project has installed. It never runs a second copy of the
framework, so what you get always matches your `package.json`.

Outside a project there is nothing to run, so it tells you how to make one:

```text
$ npx strutvane
No Strutvane project was found in /home/ana or the folders above it.

Create a new app:
  npm create strutvane@latest my-app
```

(While Strutvane is in pre-release, it says `@next` instead of `@latest`.)

## Commands outside a project

| You type | What happens | Exit code |
|---|---|---|
| `npx strutvane`, `help`, `--help`, `-h` | Prints help and how to create a project | 0 |
| `npx strutvane --version`, `-v` | Prints this package's version | 0 |
| `npx strutvane new my-app` (or `create`, `init`) | Prints the `npm create strutvane` command to run | 2 |
| Anything else | Explains that the command needs a project | 2 |

Inside a project, **every** argument goes to the project, `--version` and `help` included, just like
`node strut`.

## How it finds your project

From the folder you are in, it looks upwards for the nearest folder that has a `strut.js` or a
`package.json` listing `@strutvane/framework`. That folder is your project when its `package.json`
lists `@strutvane/framework`. The command then runs from the project folder, as `node strut` does.

In a project without a `strut.js`, it runs the `strutvane` program of the installed
`@strutvane/framework` instead (what `strut.js` itself runs for framework commands).

## Safe by design

`strutvane` is a guard: it runs only your project's own code, and only after checking it.

- **Never installs or downloads anything.** It has no dependencies, and outside a project it only
  prints.
- **Never looks too far up.** The search stops at your home folder, the temp folder and drive
  roots, so a `strut.js` someone left in a shared folder above you is never run. On Linux and macOS
  the project folder must also belong to you.
- **A `strut.js` alone is not enough.** If the nearest one sits in a folder whose `package.json`
  does not list `@strutvane/framework`, nothing runs and you are told why.
- **Nothing outside the project runs.** It refuses a project folder that is a link (it shows you the
  real folder to open instead), a `strut.js` that is a link, and a
  `node_modules/@strutvane/framework` (or its program) whose real location is outside the project.
- **No shell.** Your arguments go to Node as a list, so `a&b`, `$(x)` or `%PATH%` arrive as plain
  text on every platform, and `--import=...` is an argument for your command, never a Node option.
- **Exit codes and signals pass through.** Your command's exit code comes back unchanged. If it is
  stopped by a signal, `strutvane` stops with the same signal (on Windows, with exit code 128 + n).
  A `kill` sent to `strutvane` reaches your command; Ctrl+C at a terminal is not sent twice.

When it refuses, it exits with code 1 and says how to fix it.

## Do not add it to your project

Use it through `npx` only. A Strutvane app already has the `strutvane` program, from
`@strutvane/framework`; adding this package as a dependency would put two owners on the same
command, and `node strut doctor` reports it.

## Requirements

Node.js 24.3 or newer.

## Contributing

npm only. `npm ci`, then `npm run ci` (lint, type check, tests with coverage, build). See the
[Strutvane hub](https://github.com/vishwajit-vm/strutvane) for the ecosystem rules.
