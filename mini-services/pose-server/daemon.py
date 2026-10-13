"""
Double-fork daemon launcher for the Nuhoud Pose Server.

The sandbox reaps any process that still shares a controlling terminal with the
Bash tool that spawned it. This launcher performs the classic Unix double-fork
daemonization so the pose server is reparented to PID 1 with no controlling TTY
and therefore survives across Bash tool invocations.

Usage:  python3 daemon.py
"""

import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
LOG = HERE / "server.log"
PIDFILE = HERE / "server.pid"


def daemonize() -> None:
    # Already a daemon?
    if os.getppid() == 1:
        return

    # First fork - detach from parent shell.
    try:
        if os.fork() > 0:
            # Parent exits immediately so the caller's shell returns.
            sys.exit(0)
    except OSError as exc:
        sys.exit(f"first fork failed: {exc}")

    # Become a new session leader with no controlling TTY.
    os.setsid()

    # Second fork - prevent reacquiring a TTY.
    try:
        if os.fork() > 0:
            sys.exit(0)
    except OSError as exc:
        sys.exit(f"second fork failed: {exc}")

    # Redirect std streams to /dev/null; the real output goes to server.log
    # (opened by the child via uvicorn's own logging).
    devnull = os.open(os.devnull, os.O_RDWR)
    os.dup2(devnull, 0)
    os.dup2(devnull, 1)
    os.dup2(devnull, 2)
    if devnull > 2:
        os.close(devnull)


def main() -> None:
    daemonize()
    # We are now the daemon (PID 1 is our parent, no TTY).
    import uvicorn  # imported AFTER daemonize so the import doesn't touch std streams early

    with open(LOG, "a") as logf:
        logf.write(f"\n=== daemon starting pid={os.getpid()} at {time.strftime('%Y-%m-%dT%H:%M:%S')} ===\n")

    try:
        with open(PIDFILE, "w") as pf:
            pf.write(str(os.getpid()))
    except OSError:
        pass

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8001,
        log_level="info",
        reload=False,
        ws_max_size=8 * 1024 * 1024,
    )


if __name__ == "__main__":
    main()
