"""MSMD Guided Blender add-on."""

from __future__ import annotations

import sys


bl_info = {
    "name": "MSMD Guided",
    "blender": (4, 2, 0),
    "category": "System",
    "version": (0, 1, 0),
}

_server_instance = None


def register() -> None:
    global _server_instance

    if _server_instance is not None and _server_instance.is_alive():
        return

    import bpy

    from . import server, watcher

    blender_version = ".".join(str(part) for part in bpy.app.version)
    try:
        _server_instance = server.start_server(blender_version=blender_version)
    except OSError as exc:
        _server_instance = None
        print(
            f"MSMD Guided: could not start TCP server on 127.0.0.1:41797: {exc}",
            file=sys.stderr,
        )
        return

    watcher.register(_server_instance)


def unregister() -> None:
    global _server_instance

    try:
        from . import watcher

        watcher.unregister()
    except Exception as exc:
        print(f"MSMD Guided: watcher shutdown error: {exc}", file=sys.stderr)

    if _server_instance is not None:
        try:
            _server_instance.stop()
        except Exception as exc:
            print(f"MSMD Guided: server shutdown error: {exc}", file=sys.stderr)
        finally:
            _server_instance = None
