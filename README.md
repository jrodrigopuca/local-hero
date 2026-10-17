# local-hero

Installs and updates the [local-agents](https://github.com/jrodrigopuca/local-agents)
catalog — specialized agents and skills for Claude Code, opencode, Kiro CLI,
Codex and Antigravity CLI — with one command, without cloning anything by hand.

## Requirements

| You need | Version | Get it |
|---|---|---|
| node (with npm) | 24+ (ships npm 11) | [nodejs.org](https://nodejs.org) |
| git | any | macOS: `xcode-select --install` · Windows: `winget install Git.Git` · Linux: your package manager |
| Python | 3.9+ | macOS: `xcode-select --install` · Windows: `winget install Python.Python.3.12` · Linux: your package manager |

No npm dependencies, no Python packages. macOS, Linux and Windows are tested in
CI. On Windows, Python is found as `python3`, `python` or the `py -3` launcher;
open a new terminal after installing so it is on your `PATH`.

If git or Python is missing, local-hero says which one and how to get it. node
itself it cannot check, because it is a node program (see
[node too old](#node-too-old)).

## Install and use

Nothing to install: `npx` runs it straight from this repo.

```bash
npx github:jrodrigopuca/local-hero bootstrap --list                # first time: what is there, and which of your tools were detected
npx github:jrodrigopuca/local-hero bootstrap --all --tool <tool>   # then install into the tool you use (claude, opencode, kiro, codex, antigravity, shared)
npx github:jrodrigopuca/local-hero check                          # what changed upstream — writes nothing
npx github:jrodrigopuca/local-hero update                         # pull it and refresh every install
```

Not everyone has Claude Code: pick the `<tool>` you actually use. The examples
below say `claude` only because it is one of the six.

Or install it once and drop the prefix (the command is `local-hero`):

```bash
npm install -g github:jrodrigopuca/local-hero
local-hero update
```

A global install does not update itself; if local-hero says the catalog is
newer than it is, re-run the `npm install -g` above, or use
`npx --prefer-online github:jrodrigopuca/local-hero …`.

### Why `bootstrap` the first time

The three commands do different jobs:

- **`bootstrap`** is the only one that *installs* something. It makes sure the
  catalog is cloned and then hands everything you typed after it to the
  catalog's `install.py`: which agents, which tool, what to do on a conflict.
- **`check`** and **`update`** only look after what is *already installed*.
  `update` fast-forwards the catalog and then refreshes every tool that holds an
  install; with nothing installed there is nothing for it to refresh.
  `check` reports the same state and writes nothing.

So the first run is `bootstrap` because you have to say what you want and where.
After that, `update` is enough: it remembers each install (a small
`.local-agents.json` stamp in each tool's folder) and refreshes all of them.
Running `check` before `bootstrap` is harmless; it says `installs none`.

### Which tools

`--tool` takes one of these keys, one tool per run:

| `--tool` | Installs into |
|---|---|
| `claude` | Claude Code |
| `opencode` | opencode |
| `kiro` | Kiro CLI |
| `codex` | Codex |
| `antigravity` | Antigravity CLI |
| `shared` | `~/.agents`, skills read by both opencode and Codex |

`bootstrap --list` marks each one `[available]` when its config folder was
found on your machine, or `[not detected]` when it was not (you can still
install into it).

To equip a second tool, run `bootstrap` again with its key; `update` then
refreshes both. The catalog is already cloned by then, so that run only installs.

### What it looks like

See what is available before writing anything. `--list` shows the agents with
their skills, and which tools were detected:

```bash
npx github:jrodrigopuca/local-hero bootstrap --list
```

```
Agents:
  architect  — 3 own skills (7 installed with inheritance): lh-design-review, lh-mentoring, lh-tradeoffs
  qa         — 3 own skills (…): lh-bug-reporting, lh-flow-hunting, lh-test-design
  …
Skills: 48 total (address as agent:skill)

Tools:
  claude       Claude Code    [available, agents+skills]
  …
```

Preview one agent with `--dry-run`, which changes nothing:

```bash
npx github:jrodrigopuca/local-hero bootstrap --agent architect --tool claude --dry-run
```

```
=== DRY RUN — no files will be written ===

  Installing agent 'architect' → Claude Code
    deps   → inherits (reasoning inlined): generalist
    skill  → ~/.claude/skills/lh-design-review
    skill  → ~/.claude/skills/lh-mentoring
    …
    agent  → ~/.claude/agents/architect.md
    stamp  → .local-agents.json @ fc0d994
```

Then install the whole suite (every agent and skill) and check on it later:

```bash
npx github:jrodrigopuca/local-hero bootstrap --all --tool claude
npx github:jrodrigopuca/local-hero check
```

```
catalog  ~/.local/share/local-agents
remote   origin/main @ fc0d994
clone    up to date
installs claude: up to date
```

Agents reference each other, so `--all` is the recommended install; a single
`--agent` also pulls in the agents and skills it depends on, as the dry run
above shows. Other flags worth knowing: `--project` installs into a project
checkout instead of your home folder (the setup travels with the repo), and
`--status` shows what each tool holds and whether it is current.

`bootstrap` takes the same arguments as the catalog's `install.py`
(`--list`, `--all --tool <tool>`, `--agent <name>`, `--dry-run`…); see the
catalog's [INSTALL.md](https://github.com/jrodrigopuca/local-agents/blob/main/INSTALL.md).

### Help

The help comes from the catalog, since local-hero passes everything through:
`local-hero --help` lists the commands (its heading says `update.py`), and
`local-hero bootstrap --help` lists every install option. On a machine that has
never run local-hero, either one clones the catalog first.

### node too old

`npx github:…` needs npm 11. npm 10, which ships with node 22 and earlier,
fails inside npm, before local-hero gets to run (measured 2026-10-13):

```
GitFetcher requires an Arborist constructor to pack a tarball
```

Install node 24, or just upgrade npm on the node you have:
`npm install -g npm@11`.

## How it works

local-hero is a shim, on purpose. It does four things and nothing else:

1. checks that git and Python 3.9+ are there, and says what to install if not;
2. clones the catalog once, into `$XDG_DATA_HOME/local-agents` (by default
   `~/.local/share/local-agents`; a relative `XDG_DATA_HOME` is ignored), with
   `--filter=blob:none`. It clones into a side folder and renames it only when
   git is done, so a Ctrl-C mid-clone never leaves something that looks like a
   clone;
3. checks that the clone speaks the launcher contract it knows
   (`update.py --launcher-api`). The clone is local-hero's own, so if it is
   older, local-hero fast-forwards it; if it is newer, local-hero is the old
   one, and it tells you how to run a current one
   (`npx --prefer-online github:jrodrigopuca/local-hero …`);
4. runs the catalog's `update.py` with your arguments **exactly as you typed
   them**, and exits with its exit code.

Everything else — which clone your installs came from, what changed, when to
refuse, how to install — lives in the catalog's `update.py`, versioned with
the catalog it updates. local-hero holds no catalog logic: no agent names, no
hosts, no `install.py` flags (a test enforces it). So a new `update.py`
subcommand works here without a new local-hero.

If you installed from your own clone of the catalog, `update` still works on
that clone: `update.py` finds it through the install stamps, and refuses to
touch it if it has uncommitted changes or unpushed commits.

## The contract with the catalog

Two things, both stated next to `LAUNCHER_API` in the catalog's `update.py`:
the contract number (`1`) and the managed clone's path. Changing either one is
a new contract number, and a new local-hero.

Exit codes are the catalog's: `0` done · `1` error · `2` refused, nothing
touched · `3` the remote could not be reached.

## Development

```bash
npm test                       # fast tests against a fake catalog, no network
LOCAL_HERO_E2E=1 npm test      # plus end to end against the real catalog (clones from GitHub)
```

Not published to npm yet; `npx github:…` runs it straight from this repo.
