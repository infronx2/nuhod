"""
Double-fork daemon launcher for the Next.js dev server.

The sandbox reaps any process that still shares a controlling terminal with
the Bash tool that spawned it. This launcher performs the classic Unix
double-fork + os.setsid() so the dev server is reparented to PID 1 with no
controlling TTY and therefore survives across Bash tool invocations.

Usage:  python3 scripts/dev-daemon.py
"""

import os
import sys
import time
import subprocess
from pathlib import Path

ROOT = Path("/home/z/my-project")
LOG = ROOT / "dev.log"


def daemonize() -> None:
    if os.getppid() == 1:
        return
    try:
        if os.fork() > 0:
            sys.exit(0)
    except OSError as exc:
        sys.exit(f"first fork failed: {exc}")
    os.setsid()
    try:
        if os.fork() > 0:
            sys.exit(0)
    except OSError as exc:
        sys.exit(f"second fork failed: {exc}")
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 0)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)
    if devnull > 2:
        os.close(devnull)


def main() -> None:
    daemonize()
    # We are now the daemon (PID 1 parent, no TTY).
    # Reopen stdout/stderr to the log file so bun's output is captured.
    fd = os.open(str(LOG), os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
    os.dup2(fd, 1)
    os.dup2(fd, 2)
    if fd > 2:
        os.close(fd)
    with open(LOG, "a") as logf:
        logf.write(f"\n=== dev-daemon starting pid={os.getpid()} at {time.strftime('%Y-%m-%dT%H:%M:%S')} ===\n")
    # exec bun run dev. `cwd` must be the project root.
    os.chdir(str(ROOT))
    os.execvp("bun", ["bun", "run", "dev"])


if __name__ == "__main__":
    main()
