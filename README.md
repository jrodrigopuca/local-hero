# local-hero

Installs and updates the [local-agents](https://github.com/jrodrigopuca/local-agents)
catalog — specialized agents and skills for Claude Code, opencode, Kiro CLI,
Codex and Antigravity CLI — with one command, without cloning anything by hand.

```bash
npx github:jrodrigopuca/local-hero bootstrap --all --tool claude   # first time
npx github:jrodrigopuca/local-hero check                          # what changed upstream — writes nothing
npx github:jrodrigopuca/local-hero update                         # pull it and refresh every install
```

`bootstrap` takes the same arguments as the catalog's `install.py`
(`--list`, `--all --tool <tool>`, `--agent <name>`, `--dry-run`…); see the
catalog's [INSTALL.md](https://github.com/jrodrigopuca/local-agents/blob/main/INSTALL.md).

**Requirements:** node 18+, git, Python 3.9+. No npm dependencies, no Python
packages. macOS and Linux are tested in CI; Windows is not supported yet,
because nobody has measured it.

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
