// Two kinds of test. The fast ones put a FAKE catalog where the launcher
// looks — a real git repo whose update.py echoes what it received — so they
// need no network and test only what the launcher owns: passing arguments
// through untouched, returning the exit code, keeping its clone whole and on
// the contract it speaks. The end-to-end one clones the REAL catalog from
// GitHub and runs bootstrap, check and update through the launcher; it runs
// when LOCAL_HERO_E2E=1 (CI sets it), and asserts exit codes and the install
// stamp, never update.py's wording, which belongs to the catalog.
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

test("passes every argument to update.py untouched and returns its exit code", () => {
  const box = sandbox();
  fakeCatalog(box, fakeUpdater(1));
  const args = ["bootstrap", "--all", "--tool", "claude", "--", "a b", "--weird=1"];
  const run = launch(box.env, ...args);
  assert.strictEqual(run.status, 7, run.stderr);
  assert.deepStrictEqual(JSON.parse(run.stdout), args);
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
  for (const sub of ["bootstrap", "check", "update"]) {
    assert.ok(!new RegExp(`["'\`]${sub}["'\`]`).test(source), `launcher code handles \`${sub}\``);
  }
});

test("end to end against the real catalog", { skip: process.env.LOCAL_HERO_E2E !== "1" }, () => {
  const box = sandbox();
  // What a Ctrl-C during an earlier first run leaves: a side folder whose
  // process is gone. A successful clone sweeps it.
  const leftover = `${box.clone}.partial-999999`;
  fs.mkdirSync(path.join(leftover, ".git"), { recursive: true });
  const boot = launch(box.env, "bootstrap", "--all", "--tool", "claude", "--on-conflict", "overwrite");
  assert.strictEqual(boot.status, 0, boot.stderr);
  const stamp = path.join(box.home, ".claude", ".local-agents.json");
  assert.ok(fs.existsSync(stamp), "bootstrap wrote no install stamp");
  assert.ok(!fs.existsSync(leftover), "a dead first run's side folder was not swept");
  assert.strictEqual(fs.realpathSync(JSON.parse(fs.readFileSync(stamp, "utf8")).catalog_path),
                     fs.realpathSync(box.clone), "the install is not stamped with the managed clone");
  const check = launch(box.env, "check");
  assert.strictEqual(check.status, 0, check.stderr);
  const update = launch(box.env, "update");
  assert.strictEqual(update.status, 0, update.stderr);
});
