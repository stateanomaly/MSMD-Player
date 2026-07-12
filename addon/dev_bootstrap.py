"""Enable the local MSMD Guided add-on in Blender."""

from __future__ import annotations

import os
import sys
import traceback


def main() -> int:
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    addon_dir = os.path.join(repo_root, "addon")
    if addon_dir not in sys.path:
        sys.path.insert(0, addon_dir)

    import addon_utils

    try:
        module = addon_utils.enable("msmd_guided", default_set=False)
        if module is None:
            raise RuntimeError("addon_utils.enable returned None")
    except Exception:
        print("FAIL: MSMD Guided add-on did not enable")
        traceback.print_exc()
        return 1

    print("OK: MSMD Guided add-on enabled")
    return 0


if __name__ == "__main__":
    _code = main()
    try:
        import bpy
        _background = bpy.app.background
    except ImportError:
        _background = True
    if _background and _code != 0:
        raise SystemExit(_code)
