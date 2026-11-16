// Two kinds of test. The fast ones put a FAKE catalog where the launcher
// looks — a real git repo whose update.py echoes what it received — so they
// need no network and test only what the launcher owns: passing arguments
// through untouched, returning the exit code, keeping its clone whole and on
// the contract it speaks. The end-to-end one clones the REAL catalog from
// GitHub and runs install, check, update, status and uninstall through the
// launcher; it runs when LOCAL_HERO_E2E=1 (CI sets it), and asserts exit codes
// and the install record, never update.py's wording, which belongs to the
// catalog. The one thing it reads from the output is whether a suggested
// command starts the way this launcher was typed: that is the launcher's half.
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LAUNCHER = path.join(__dirname, "..", "bin", "launcher.js");

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "local-hero-"));
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    XDG_DATA_HOME: path.join(root, "data"),
    XDG_CONFIG_HOME: path.join(root, "config"),
    GIT_CONFIG_GLOBAL: os.devnull,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
  };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.CODEX_HOME;
  return { root, home, env, clone: path.join(root, "data", "local-agents") };
}

function git(env, ...args) {
  const r = spawnSync("git", args, { env, encoding: "utf8" });
  assert.strictEqual(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
}

// update.py that answers the contract with `api`, and otherwise prints the
// arguments it got and exits 7 — or kills itself with `signal`.
function fakeUpdater(api, signal) {
  return [
    "import json, os, signal, sys",
    "if sys.argv[1:] == ['--launcher-api']:",
    `    print('${api}'); sys.exit(0)`,
    signal ? `os.kill(os.getpid(), signal.${signal})` : "",
    "print(json.dumps(sys.argv[1:]))",
    "sys.exit(7)",
    "",
  ].join("\n");
}

function commitUpdater(env, repo, source, message) {
  fs.writeFileSync(path.join(repo, "update.py"), source);
  git(env, "-C", repo, "add", "update.py");
  git(env, "-C", repo, "commit", "--quiet", "-m", message);
}

// A whole clone, as the launcher would have left it.
function fakeCatalog(box, source) {
  git(box.env, "init", "--quiet", box.clone);
  commitUpdater(box.env, box.clone, source, "fake catalog");
}

function launch(env, ...args) {
  return spawnSync(process.execPath, [LAUNCHER, ...args], { env, encoding: "utf8", timeout: 600000 });
}

// A PATH holding only the tools named, so the rest are "not installed". Not on
// Windows: py.exe lives in the system folder, which is searched regardless.
function withTools(box, ...tools) {
  const bin = path.join(box.root, "bin");
  fs.mkdirSync(bin, { recursive: true });
  for (const tool of tools) {
    const real = spawnSync("which", [tool], { encoding: "utf8" }).stdout.trim();
    fs.symlinkSync(real, path.join(bin, tool));
  }
  return { ...box.env, PATH: bin };
}
const NO_PATH_GAMES = { skip: process.platform === "win32" };

test("missing git is named, with how to get it", NO_PATH_GAMES, () => {
  const box = sandbox();
  const run = launch(withTools(box, "python3"), "check");
  assert.strictEqual(run.status, 1);
  assert.match(run.stderr, /git is required/);
  assert.doesNotMatch(run.stderr, /Python/);
  assert.match(run.stderr, /macOS|package manager/);
});

test("missing Python is named, with how to get it", NO_PATH_GAMES, () => {
  const box = sandbox();
  const run = launch(withTools(box, "git"), "check");
  assert.strictEqual(run.status, 1);
  assert.match(run.stderr, /Python 3\.9\+ is required/);
  assert.doesNotMatch(run.stderr, /git is required/);
});

test("missing git and Python are both reported in one run", NO_PATH_GAMES, () => {
  const box = sandbox();
  const run = launch(withTools(box), "check");
  assert.strictEqual(run.status, 1);
  assert.match(run.stderr, /git is required/);
  assert.match(run.stderr, /Python 3\.9\+ is required/);
});

test("passes every argument to update.py untouched and returns its exit code", () => {
  const box = sandbox();
  fakeCatalog(box, fakeUpdater(1));
  const args = ["install", "--all", "--tool", "claude", "--", "a b", "--weird=1"];
  const run = launch(box.env, ...args);
  assert.strictEqual(run.status, 7, run.stderr);
  assert.deepStrictEqual(JSON.parse(run.stdout), args);
});

// update.py that prints how it was told the launcher was typed.
function frontEcho() {
  return [
    "import os, sys",
    "if sys.argv[1:] == ['--launcher-api']:",
    "    print('1'); sys.exit(0)",
    "print(os.environ.get('LOCAL_AGENTS_FRONT', '(unset)'))",
    "",
  ].join("\n");
}

function frontSeenBy(extra) {
  const box = sandbox();
  fakeCatalog(box, frontEcho());
  const env = { ...box.env, ...extra };
  for (const [k, v] of Object.entries(extra)) if (v === undefined) delete env[k];
  const run = launch(env, "status");
  assert.strictEqual(run.status, 0, run.stderr);
  return run.stdout.trim();
}

// The catalog suggests commands ("Try: … update"). It can only suggest one the
// person is able to type if the launcher says how it was typed.
test("run through npx, it says so to what it runs", () => {
  assert.strictEqual(frontSeenBy({ npm_command: "exec", LOCAL_AGENTS_FRONT: undefined }),
                     "npx github:jrodrigopuca/local-hero");
});

test("installed globally, it is its own name", () => {
  assert.strictEqual(frontSeenBy({ npm_command: undefined, LOCAL_AGENTS_FRONT: undefined }),
                     "local-hero");
  // inside someone's `npm run`, it was still typed as local-hero
  assert.strictEqual(frontSeenBy({ npm_command: "run-script", LOCAL_AGENTS_FRONT: undefined }),
                     "local-hero");
});

test("a wrapper that already said its name is left alone", () => {
  assert.strictEqual(frontSeenBy({ npm_command: "exec", LOCAL_AGENTS_FRONT: "my-wrapper" }),
                     "my-wrapper");
});

test("an older contract in its own clone is fixed by fast-forwarding the clone", () => {
  const box = sandbox();
  const work = path.join(box.root, "work"), bare = path.join(box.root, "remote.git");
  git(box.env, "init", "--quiet", work);
  commitUpdater(box.env, work, fakeUpdater(0), "api 0");
  git(box.env, "clone", "--quiet", "--bare", work, bare);
  git(box.env, "clone", "--quiet", bare, box.clone);
  commitUpdater(box.env, work, fakeUpdater(1), "api 1");
  git(box.env, "-C", work, "push", "--quiet", bare, "HEAD:refs/heads/" +
      spawnSync("git", ["-C", work, "branch", "--show-current"], { encoding: "utf8" }).stdout.trim());
  const run = launch(box.env, "check");
  assert.strictEqual(run.status, 7, run.stderr);
  assert.deepStrictEqual(JSON.parse(run.stdout), ["check"]);
  assert.match(run.stderr, /older than this launcher; updating it/);
});

test("a newer contract says to replace the launcher, and how", () => {
  const box = sandbox();
  fakeCatalog(box, fakeUpdater(99));
  const run = launch(box.env, "check");
  assert.strictEqual(run.status, 1);
  assert.match(run.stderr, /speaks launcher API 1, the catalog speaks 99/);
  assert.match(run.stderr, /npx --prefer-online github:jrodrigopuca\/local-hero/);
});

test("a failing --launcher-api shows why instead of a wrong number", () => {
  const box = sandbox();
  fakeCatalog(box, "raise SystemExit('boom: update.py is broken')\n");
  const run = launch(box.env, "check");
  assert.strictEqual(run.status, 1);
  assert.match(run.stderr, /boom: update.py is broken/);
});

test("an interrupted first clone is refused, never taken for a clone", () => {
  const box = sandbox();
  git(box.env, "init", "--quiet", box.clone);  // .git, but no commit and no update.py
  const run = launch(box.env, "check");
  assert.strictEqual(run.status, 2);
  assert.match(run.stderr, /incomplete clone.*Delete it/s);
});

test("a relative XDG_DATA_HOME is ignored, as update.py ignores it", () => {
  const box = sandbox();
  const home = path.join(box.home, ".local", "share", "local-agents");
  fs.mkdirSync(path.dirname(home), { recursive: true });
  fakeCatalog({ ...box, clone: home }, fakeUpdater(1));
  const run = launch({ ...box.env, XDG_DATA_HOME: "relative/data" }, "check");
  assert.strictEqual(run.status, 7, run.stderr);
});

test("refuses to clone into a folder that holds something else", () => {
  const box = sandbox();
  fs.mkdirSync(box.clone, { recursive: true });
  fs.writeFileSync(path.join(box.clone, "notes.txt"), "mine\n");
  const run = launch(box.env, "check");
  assert.strictEqual(run.status, 2);
  assert.match(run.stderr, /not empty and is not a clone/);
});

test("an unreachable repository is reported as offline (3) and leaves nothing behind", () => {
  const box = sandbox();
  const run = launch({ ...box.env, LOCAL_AGENTS_REPO: path.join(box.root, "nowhere.git") }, "check");
  assert.strictEqual(run.status, 3);
  assert.match(run.stderr, /could not clone/);
  assert.deepStrictEqual(fs.existsSync(path.dirname(box.clone)) ? fs.readdirSync(path.dirname(box.clone)) : [], []);
});

test("update.py killed by a signal exits 128+n and says so", { skip: process.platform === "win32" }, () => {
  const box = sandbox();
  fakeCatalog(box, fakeUpdater(1, "SIGTERM"));
  const run = launch(box.env, "check");
  assert.strictEqual(run.status, 128 + os.constants.signals.SIGTERM);
  assert.match(run.stderr, /stopped by SIGTERM/);
});

// The launcher must stay dumb: no catalog vocabulary in its code. An alarm,
// not a proof — the pass-through test above is the real guarantee.
test("the launcher holds no catalog logic", () => {
  const source = fs.readFileSync(LAUNCHER, "utf8").replace(/^\s*\/\/.*$/gm, "");
  const lower = source.toLowerCase();
  for (const word of ["install.py", "--tool", "--refresh", "claude", "opencode", "kiro",
                      "codex", "antigravity", "skill.md", "agents.md", ".local-agents.json"]) {
    assert.ok(!lower.includes(word), `launcher code mentions \`${word}\``);
  }
  // Interpreting a subcommand would show up as its name in a string literal.
  for (const sub of ["install", "check", "update", "status", "list", "uninstall", "default"]) {
    assert.ok(!new RegExp(`["'\`]${sub}["'\`]`).test(source), `launcher code handles \`${sub}\``);
  }
});

test("end to end against the real catalog", { skip: process.env.LOCAL_HERO_E2E !== "1" }, () => {
  const box = sandbox();
  // What a Ctrl-C during an earlier first run leaves: a side folder whose
  // process is gone. A successful clone sweeps it.
  const leftover = `${box.clone}.partial-999999`;
  fs.mkdirSync(path.join(leftover, ".git"), { recursive: true });
  const boot = launch(box.env, "install", "--all", "--tool", "claude", "--on-conflict", "overwrite");
  assert.strictEqual(boot.status, 0, boot.stderr);
  const stamp = path.join(box.home, ".claude", ".local-agents.json");
  assert.ok(fs.existsSync(stamp), "install wrote no install record");
  assert.ok(!fs.existsSync(leftover), "a dead first run's side folder was not swept");
  // .native: on Windows only it expands 8.3 short names (RUNNER~1), which the
  // temp dir arrives in from one side and as "runneradmin" from the other.
  assert.strictEqual(fs.realpathSync.native(JSON.parse(fs.readFileSync(stamp, "utf8")).catalog_path),
                     fs.realpathSync.native(box.clone), "the install is not stamped with the managed clone");
  const check = launch(box.env, "check");
  assert.strictEqual(check.status, 0, check.stderr);
  const update = launch(box.env, "update");
  assert.strictEqual(update.status, 0, update.stderr);
  // The verbs that are the catalog's own scripts go through the same way.
  const status = launch({ ...box.env, npm_command: "exec" }, "status");
  assert.strictEqual(status.status, 0, status.stderr);
  assert.ok(status.stdout.includes("npx github:jrodrigopuca/local-hero status"),
            `a suggested command does not start the way the launcher was typed:\n${status.stdout}`);
  const uninstall = launch(box.env, "uninstall");
  assert.strictEqual(uninstall.status, 0, uninstall.stderr);
  assert.ok(!fs.existsSync(stamp), "uninstall left the install record");
  assert.ok(fs.existsSync(path.join(box.clone, "update.py")), "uninstall took the catalog copy too");
});

// Runs the launcher with a real terminal on the other side (a pty) and reports
// whether it was still waiting for the person after `waitSeconds`, then types
// "q" and reports how it ended. Behaviour only, no wording: a menu waits for
// an answer, a script-style message exits by itself.
const PTY_DRIVER = [
  "import json, os, pty, select, sys, time",
  "node, launcher, wait = sys.argv[1], sys.argv[2], float(sys.argv[3])",
  "pid, fd = pty.fork()",
  "if pid == 0:",
  "    os.execv(node, [node, launcher, *sys.argv[4:]])",
  "deadline = time.time() + wait",
  "while time.time() < deadline:",
  "    if select.select([fd], [], [], 0.2)[0]:",
  "        try: os.read(fd, 65536)",
  "        except OSError: break",
  "waiting = os.waitpid(pid, os.WNOHANG) == (0, 0)",
  "if waiting:",
  "    os.write(fd, b'q\\n')",
  "    deadline = time.time() + 30",
  "    while time.time() < deadline:",
  "        done, status = os.waitpid(pid, os.WNOHANG)",
  "        if done: break",
  "        if select.select([fd], [], [], 0.2)[0]:",
  "            try: os.read(fd, 65536)",
  "            except OSError: pass",
  "    else:",
  "        os.kill(pid, 9); os.waitpid(pid, 0); status = -1",
  "    code = os.waitstatus_to_exitcode(status) if status != -1 else -1",
  "else:",
  "    code = None",
  "print(json.dumps({'waiting': waiting, 'exit': code}))",
  "",
].join("\n");

test("install with nothing after it: a script gets the next steps, a person gets the menu",
     { skip: process.env.LOCAL_HERO_E2E !== "1" }, () => {
  const box = sandbox();
  const stamp = path.join(box.home, ".claude", ".local-agents.json");

  // No terminal (stdio is piped here, as in a script or CI): it must not wait
  // for anyone, must succeed, and must install nothing.
  const script = launch(box.env, "install");
  assert.strictEqual(script.status, 0, script.stderr);
  assert.ok(!fs.existsSync(stamp), "install with no arguments installed something");
  assert.ok(fs.existsSync(path.join(box.clone, "update.py")), "the catalog was not cloned");
  assert.ok(script.stdout.trim().length > 0, "it said nothing about what to do next");
});

test("install with nothing after it, in a terminal, waits for an answer",
     { skip: process.env.LOCAL_HERO_E2E !== "1" || process.platform === "win32" }, () => {
  const box = sandbox();
  // Clone first, so the run below does not spend its wait on the network.
  assert.strictEqual(launch(box.env, "install").status, 0);
  const run = spawnSync("python3", ["-I", "-c", PTY_DRIVER, process.execPath, LAUNCHER, "4", "install"],
                        { env: box.env, encoding: "utf8", timeout: 120000 });
  assert.strictEqual(run.status, 0, run.stderr);
  const seen = JSON.parse(run.stdout);
  assert.strictEqual(seen.waiting, true, "with a terminal it exited instead of asking");
  assert.strictEqual(seen.exit, 0, "answering q did not end cleanly");
  assert.ok(!fs.existsSync(path.join(box.home, ".claude", ".local-agents.json")),
            "quitting the menu installed something");
});
