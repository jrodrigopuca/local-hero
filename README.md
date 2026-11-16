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
npx github:jrodrigopuca/local-hero install                       # first time: a menu asks what to install and into which tool
npx github:jrodrigopuca/local-hero install --all --tool <tool>   # or say it up front (claude, opencode, kiro, codex, antigravity, shared)
npx github:jrodrigopuca/local-hero check                         # is there something new upstream? writes nothing
npx github:jrodrigopuca/local-hero update                        # bring it and refresh every install
npx github:jrodrigopuca/local-hero status                        # what is installed on this machine, and whether it is current
npx github:jrodrigopuca/local-hero uninstall                     # take out what was installed, and only that
```

Not everyone has Claude Code: the menu lists the tools with the state of each,
and with flags you pick the `<tool>` you actually use. The examples below say
`claude` only because it is one of the six. In a script or CI (no terminal)
`install` with nothing after it does not ask; it prints the next commands to
run.

Or install it once and drop the prefix (the command is `local-hero`):

```bash
npm install -g github:jrodrigopuca/local-hero
local-hero update
```

A global install does not update itself; if local-hero says the catalog is
newer than it is, re-run the `npm install -g` above, or use
`npx --prefer-online github:jrodrigopuca/local-hero …`.

### The commands

| Command | What it does |
|---|---|
| `install [ARGS]` | Installs. Makes sure the catalog is cloned, then hands everything after it to the catalog's `install.py`: which agents, which tool, what to do on a conflict. With nothing after it, it opens the menu |
| `check` | Asks the remote whether there is something new for what you have installed. Writes nothing |
| `update` | Brings the catalog up to date, then refreshes every tool that holds an install |
| `status [--verbose]` | What is installed on this machine and whether it matches its copy of the catalog. No network |
| `list` | What the catalog holds, and which tools were found |
| `uninstall [ARGS]` | Removes what was installed, and only that: a file you edited, and anything that is not from the catalog, stays |
| `default [ARGS]` | The agent a session starts with: `default --set generalist`, `default --restore` |

So the first run is `install`, because you have to say what you want and where
(by answering the menu, or with flags). After that, `update` is enough: each
install leaves a small record in its tool's folder (`.local-agents.json`), and
`update` refreshes all of them. Running `check` before installing is harmless;
it says nothing is installed yet, and how to install.

`status` and `check` answer two different questions. `status` is this machine
against its own copy of the catalog: `out of date` there is fixed without the
network. `check` is that copy against the remote: `update available` is what
`update` brings.

If a command is not recognized, the copy of the catalog on your machine is
older than the command: run `update` once, and it is there.

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

`list` shows each one as `available` when its config folder was found on your
machine, or `not detected` when it was not (you can still install into it; the
menu asks first).

To equip a second tool, run `install` again with its key; `update` then
refreshes both. The catalog is already cloned by then, so that run only installs.

### What it looks like

See what is available before writing anything. `list` shows the agents with
their skills, and which tools were found:

```bash
npx github:jrodrigopuca/local-hero list
```

```
Agents (15)
  apple-dev        4 skills of its own, 22 installed with it
                   lh-code-review, lh-debugging, lh-shipping,
                   lh-state-architecture
  architect        3 skills of its own, 7 installed with it
                   lh-design-review, lh-mentoring, lh-tradeoffs
  ...

Tools
  claude        available       agents and skills
  opencode      not detected    agents and skills
  ...
```

Preview one agent with `--dry-run`, which changes nothing and says so twice:

```bash
npx github:jrodrigopuca/local-hero install --agent architect --tool claude --dry-run
```

```
Dry run: nothing is written.

Installing agent architect into claude (~/.claude)

  skills   would install 7
  agents   would install 1

Done (dry run): would install 8 files in claude.
Dry run: nothing was written. Run again without --dry-run to apply.
```

Then install the whole catalog (every agent and skill) and check on it later:

```bash
npx github:jrodrigopuca/local-hero install --all --tool claude
npx github:jrodrigopuca/local-hero check
```

```
Installing the whole catalog into claude (~/.claude)

  skills   51 installed
  agents   15 installed

Done: 66 files installed in claude, from catalog fda9f5b.
Check any time: npx github:jrodrigopuca/local-hero status
```

```
Everything installed is up to date.

  claude        up to date      15 agents, 51 skills

Catalog fda9f5b, same as origin/main.
```

When the remote has something for what you installed, `check` says so first
and names it, and its last line is the command to run:

```
An update is available.

  upstream    origin/main @ fc0d994
              your catalog is 2 commits behind
  changes     skill lh-verification, agent qa

  claude        update available

Next: npx github:jrodrigopuca/local-hero update
```

Every command the output suggests is one you can type as it is: it starts with
`npx github:jrodrigopuca/local-hero` when you came in through `npx`, and with
`local-hero` when you installed it globally.

Agents reference each other, so `--all` is the recommended install; a single
`--agent` also pulls in the skills it depends on, as the dry run above counts.
Other flags worth knowing: `--project` installs into a project checkout
instead of your home folder (the setup travels with the repo), and `--verbose`
prints one line per file.

`install` takes the same arguments as the catalog's `install.py`
(`--all --tool <tool>`, `--agent <name>`, `--dry-run`…); see the catalog's
[INSTALL.md](https://github.com/jrodrigopuca/local-agents/blob/main/INSTALL.md).

### Taking it back out

```bash
npx github:jrodrigopuca/local-hero uninstall --dry-run     # what would go, nothing removed
npx github:jrodrigopuca/local-hero uninstall               # every tool that holds an install
npx github:jrodrigopuca/local-hero uninstall --tool kiro   # only that one
```

It removes what was installed and is still as it was installed. A file you
edited since is kept, and named; anything that did not come from the catalog
is not touched. What it leaves on the machine is the copy of the catalog
itself, and it says where: delete `~/.local/share/local-agents` to remove
that too.

### The agent a session starts with

A session started without an agent uses the tool's own assistant, which loads
nothing from the catalog. `default` makes one of the installed agents the one
a session starts with, in the tools that have such a setting (Claude Code,
opencode, Kiro CLI), and puts it back:

```bash
npx github:jrodrigopuca/local-hero default                    # what each tool starts with now
npx github:jrodrigopuca/local-hero default --set generalist
npx github:jrodrigopuca/local-hero default --restore
```

It is never done by `install`: which agent a session starts with is your
choice.

### Help

The help comes from the catalog, since local-hero passes everything through:
`local-hero --help` lists the commands, and `local-hero install --help` lists
every install option. Both are headed by the command as you typed it. On a
machine that has never run local-hero, either one clones the catalog first.

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
   them**, and exits with its exit code. It tells it one thing about itself:
   how it was typed (`npx github:jrodrigopuca/local-hero`, or `local-hero`
   when installed globally), in `LOCAL_AGENTS_FRONT`, so that a command the
   catalog suggests is one you can run.

Everything else — which clone your installs came from, what changed, when to
refuse, how to install — lives in the catalog's `update.py`, versioned with
the catalog it updates. local-hero holds no catalog logic: no agent names, no
hosts, no `install.py` flags, no command names (a test enforces it). So a new
`update.py` command works here without a new local-hero: `status`, `list`,
`uninstall` and `default` arrived that way.

If you installed from your own clone of the catalog, `update` still works on
that clone: `update.py` finds it through the install records, and refuses to
touch it if it has uncommitted changes or unpushed commits.

## The contract with the catalog

Two things, both stated next to `LAUNCHER_API` in the catalog's `update.py`:
the contract number (`1`) and the managed clone's path. Changing either one is
a new contract number, and a new local-hero.

Exit codes are the catalog's: `0` done · `1` error · `2` refused, nothing
touched · `3` the remote could not be reached.

`LOCAL_AGENTS_FRONT` is not part of the contract: a catalog that does not
know it ignores it, and a launcher that does not set it gets suggestions with
the command alone (`` `update` ``) instead of the whole line.

## Development

```bash
npm test                       # fast tests against a fake catalog, no network
LOCAL_HERO_E2E=1 npm test      # plus end to end against the real catalog (clones from GitHub)
```

Not published to npm yet; `npx github:…` runs it straight from this repo.
