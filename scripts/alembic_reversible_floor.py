"""Print the newest revision that automation may still downgrade to.

The CI round-trip check (upgrade -> downgrade -> upgrade) must never execute
the ``downgrade()`` of a migration marked ``IRREVERSIBLE = True`` (for example
``0174_project_role_conversion``: the employee cutover cannot be losslessly
mapped back to a single global role).  Walking from head towards base, this
script prints the ``down_revision`` of the first irreversible migration, i.e.
the highest revision whose downgrade chain is fully reversible.  When every
migration is reversible it prints the current head, which keeps the round-trip
identical to a plain ``downgrade base``.

The printed floor is intended for a *disposable* database (CI service
container): callers ``alembic stamp <floor>`` to skip the irreversible
conversions — no-ops on a freshly upgraded empty database — before running
``alembic downgrade base`` and ``alembic upgrade head`` again.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

from alembic.config import Config
from alembic.script import ScriptDirectory
from alembic.util import load_python_file


def main() -> int:
    script_dir = Path(__file__).resolve().parent.parent / "apps" / "api"
    config = Config(str(script_dir / "alembic.ini"))
    config.set_main_option("script_location", str(script_dir / "alembic"))
    script = ScriptDirectory.from_config(config)

    for revision in script.walk_revisions():  # head -> base
        directory, filename = os.path.split(revision.path)
        loaded = load_python_file(directory, filename)
        module = getattr(loaded, "module", loaded)
        if not getattr(module, "IRREVERSIBLE", False):
            continue
        floor = revision.down_revision
        if floor is None:
            print(
                "alembic-reversible-floor: base revision "
                f"{revision.revision} is irreversible; nothing to downgrade",
                file=sys.stderr,
            )
            return 1
        if isinstance(floor, (list, tuple)):
            print(
                "alembic-reversible-floor: irreversible revision "
                f"{revision.revision} has a merged down_revision; refusing to guess",
                file=sys.stderr,
            )
            return 1
        print(floor)
        return 0

    print(script.get_current_head())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
