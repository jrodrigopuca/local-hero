#!/usr/bin/env node
// local-hero: the npx front door to the local-agents catalog.
//
// This file is deliberately dumb. It finds git and Python, makes sure the
// catalog is cloned, checks that the clone speaks the launcher contract it
// knows, and hands every argument to the catalog's update.py untouched. It
// knows nothing about agents, skills, hosts or install.py: that logic lives in
// the catalog and is versioned with it, so a new update.py subcommand works
// here without touching this file.
//
// The contract with the catalog is two things, both stated next to
// LAUNCHER_API in update.py: that number, and where the managed clone lives.
"use strict";

const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const LAUNCHER_API = 1;
const REPO_URL = process.env.LOCAL_AGENTS_REPO || "https://github.com/jrodrigopuca/local-agents.git";
const SELF = "github:jrodrigopuca/local-hero";
const PYTHON_FLOOR = [3, 9];

// Same exit codes as update.py, so a script around either one reads them alike.
const ERROR = 1, REFUSED = 2, OFFLINE = 3;

// A bad https URL would otherwise ask for a username and hang.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

function fail(message, code) {
  process.stderr.write(`local-hero: ${message}\n`);
  process.exit(code);
}

// How to get a missing tool, per platform. On a Mac without the command line
// tools, `git` and `python3` are stubs that fail until the tools are installed;
// "not on PATH" alone would mislead. Linux has too many package managers to
// name one, so it says where to look instead of guessing a command.
function installHint(tool) {
  if (process.platform === "darwin") {
    return " On macOS: `xcode-select --install`, or install it with Homebrew.";
  }
  if (process.platform === "win32") {
    const id = tool === "git" ? "Git.Git" : "Python.Python.3.12";
    return ` On Windows: \`winget install ${id}\`, then open a new terminal.`;
  }
  return " Install it with your distribution's package manager.";
}

// The XDG spec ignores a relative XDG_DATA_HOME; so does update.py.
function managedDir() {
  const xdg = process.env.XDG_DATA_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(os.homedir(), ".local", "share");
  return path.join(base, "local-agents");
}

function git(...args) {
  return spawnSync("git", args, { encoding: "utf8", env: GIT_ENV });
}

// Both finders return a problem to report instead of exiting, so that a
// machine missing git AND Python hears about both at once.
function findGit() {
  const probe = git("--version");
  if (probe.error || probe.status !== 0) {
    return `git is required and does not run here.${installHint("git")}`;
  }
  return null;
}

// `python3` first; `python` covers systems where only that name exists, and
// `py -3` is the launcher Windows installs (on Windows `python3` is often a
// Microsoft Store stub that fails). An old interpreter under one name does not
// stop the search under the other. Returns { python: [command, ...leading
// args] } or { problem }.
function findPython() {
  const check = "import sys; print('%d.%d' % sys.version_info[:2])";
  const tooOld = [];
  for (const candidate of [["python3"], ["python"], ["py", "-3"]]) {
    const [cmd, ...lead] = candidate;
    const probe = spawnSync(cmd, [...lead, "-c", check], { encoding: "utf8" });
    if (probe.error || probe.status !== 0) continue;
    const [major, minor] = probe.stdout.trim().split(".").map(Number);
    if (major > PYTHON_FLOOR[0] || (major === PYTHON_FLOOR[0] && minor >= PYTHON_FLOOR[1])) {
      return { python: candidate };
    }
    tooOld.push(`\`${candidate.join(" ")}\` is ${major}.${minor}`);
  }
  const found = tooOld.length ? ` (${tooOld.join(", ")})` : "";
  return { problem: `Python ${PYTHON_FLOOR.join(".")}+ is required and none runs here${found}.` +
                    installHint("python") };
}

// A clone counts only if it has a commit checked out and the catalog's
// update.py in it. A clone interrupted half way has a .git and neither.
function isWhole(dir) {
  return git("-C", dir, "rev-parse", "--verify", "--quiet", "HEAD").status === 0 &&
    fs.existsSync(path.join(dir, "update.py"));
}

// First run on this machine: clone where the user never has to look. Into a
// side folder first, renamed only once git is done — a Ctrl-C mid-clone must
// not leave something that looks like a clone. The whole history without old
// file contents: update.py counts commits.
function ensureClone(dir) {
  if (fs.existsSync(path.join(dir, ".git"))) {
    if (isWhole(dir)) return;
    fail(`${dir} is an incomplete clone (an interrupted first run?). ` +
         `Delete it and run this again.`, REFUSED);
  }
  if (fs.existsSync(dir) && fs.readdirSync(dir).length > 0) {
    fail(`${dir} exists, is not empty and is not a clone. Move it away, or set ` +
         `XDG_DATA_HOME to clone somewhere else.`, REFUSED);
  }
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const partial = `${dir}.partial-${process.pid}`;
  process.stderr.write(`local-hero: cloning ${REPO_URL} → ${dir}\n`);
  const clone = spawnSync("git", ["clone", "--quiet", "--filter=blob:none", REPO_URL, partial], {
    stdio: ["ignore", "inherit", "inherit"], env: GIT_ENV,
  });
  if (clone.status !== 0) {
    fs.rmSync(partial, { recursive: true, force: true });
    fail(`could not clone ${REPO_URL}.`, OFFLINE);
  }
  fs.rmSync(dir, { recursive: true, force: true });  // an empty folder, if any
  fs.renameSync(partial, dir);
  sweepPartials(dir);
}

// Side folders left by interrupted first runs. Only those whose process is
// gone: one still alive is another first run, cloning right now.
function sweepPartials(dir) {
  const prefix = `${path.basename(dir)}.partial-`;
  for (const name of fs.readdirSync(path.dirname(dir))) {
    if (!name.startsWith(prefix)) continue;
    const pid = Number(name.slice(prefix.length));
    try {
      process.kill(pid, 0);
      continue;  // alive
    } catch (e) {
      if (e.code === "EPERM") continue;  // alive, someone else's
    }
    fs.rmSync(path.join(path.dirname(dir), name), { recursive: true, force: true });
  }
}

// Python's stdout follows the console code page on Windows (cp1252), which
// cannot print every character update.py uses; force UTF-8.
const PY_ENV = { ...process.env, PYTHONUTF8: "1" };

function contractOf(python, updater) {
  const [cmd, ...lead] = python;
  const probe = spawnSync(cmd, [...lead, updater, "--launcher-api"], { encoding: "utf8", env: PY_ENV });
  const n = Number((probe.stdout || "").trim());
  if (probe.status !== 0 || !Number.isInteger(n)) {
    fail(`\`update.py --launcher-api\` failed in ${path.dirname(updater)}:\n` +
         `${(probe.stderr || probe.stdout || "").trim() || "(no output)"}`, ERROR);
  }
  return n;
}

// The managed clone belongs to this launcher, so an older contract there is
// fixed here: fast-forward the clone and ask again. A NEWER contract means
// this launcher is the old one, and only the user can replace it.
function checkContract(python, dir) {
  const updater = path.join(dir, "update.py");
  let theirs = contractOf(python, updater);
  if (theirs < LAUNCHER_API) {
    process.stderr.write(`local-hero: the catalog at ${dir} is older than this launcher; updating it\n`);
    const pull = git("-C", dir, "pull", "--ff-only", "--quiet");
    if (pull.status !== 0) {
      fail(`could not bring ${dir} up to date: ${pull.stderr.trim()}\n` +
           `Delete it and run this again.`, ERROR);
    }
    theirs = contractOf(python, updater);
  }
  if (theirs > LAUNCHER_API) {
    fail(`this local-hero speaks launcher API ${LAUNCHER_API}, the catalog speaks ${theirs}. ` +
         `Run a current one: \`npx --prefer-online ${SELF} <command>\`, or ` +
         `\`npm install -g ${SELF}\` if you installed it globally.`, ERROR);
  }
  if (theirs !== LAUNCHER_API) {
    fail(`the catalog at ${dir} still speaks launcher API ${theirs} after updating it; ` +
         `this local-hero needs ${LAUNCHER_API}.`, ERROR);
  }
}

function main() {
  const found = findPython();
  const problems = [findGit(), found.problem].filter(Boolean);
  if (problems.length) fail(problems.join("\nlocal-hero: "), ERROR);
  const python = found.python;
  const dir = managedDir();
  ensureClone(dir);
  checkContract(python, dir);
  const [cmd, ...lead] = python;
  const run = spawnSync(cmd, [...lead, path.join(dir, "update.py"), ...process.argv.slice(2)],
                        { stdio: "inherit", env: PY_ENV });
  if (run.error) fail(`could not run update.py: ${run.error.message}`, ERROR);
  if (run.signal) {
    // The shell convention for "killed by signal N", so a caller can tell.
    process.stderr.write(`local-hero: update.py was stopped by ${run.signal}\n`);
    process.exit(128 + (os.constants.signals[run.signal] || 0));
  }
  process.exit(run.status);
}

main();
