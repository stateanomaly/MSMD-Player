from __future__ import annotations

import json
import os
import socket
import sys
import threading
import time
import traceback
from pathlib import Path


HOST = "127.0.0.1"
PORT = 41797


ROOT = Path(__file__).resolve().parents[2]
ADDON_DIR = ROOT / "addon"
if str(ADDON_DIR) not in sys.path:
    sys.path.insert(0, str(ADDON_DIR))


def fail(message: str) -> int:
    print(f"FAIL: {message}")
    return 1


def enable_addon() -> None:
    import addon_utils

    module = addon_utils.enable("msmd_guided", default_set=False)
    if module is None:
        raise RuntimeError("addon_utils.enable returned None")


class Companion:
    def __init__(self) -> None:
        self.sock = socket.create_connection((HOST, PORT), timeout=5.0)
        self.sock.settimeout(0.2)
        self.messages: list[dict] = []
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    def send(self, message: dict) -> None:
        payload = json.dumps(message, separators=(",", ":")).encode("utf-8") + b"\n"
        self.sock.sendall(payload)

    def close(self) -> None:
        self._stop.set()
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass
        self._thread.join(timeout=1.0)

    def snapshot_count(self) -> int:
        with self._lock:
            return len(self.messages)

    def wait_for(self, predicate, watcher, timeout: float = 5.0, start_index: int = 0):
        deadline = time.time() + timeout
        while time.time() < deadline:
            watcher.tick()
            with self._lock:
                for message in self.messages[start_index:]:
                    if predicate(message):
                        return message
            time.sleep(0.05)
        return None

    def _read_loop(self) -> None:
        buffer = b""
        while not self._stop.is_set():
            try:
                chunk = self.sock.recv(65536)
            except socket.timeout:
                continue
            except OSError:
                return
            if not chunk:
                return
            buffer += chunk
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                try:
                    message = json.loads(line.decode("utf-8"))
                except Exception as exc:
                    message = {"type": "reader_error", "message": str(exc), "raw": repr(line)}
                with self._lock:
                    self.messages.append(message)


def pump_until(condition, watcher, timeout: float = 5.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        watcher.tick()
        if condition():
            return True
        time.sleep(0.05)
    return False


def port_can_bind() -> bool:
    probe = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        probe.bind((HOST, PORT))
        return True
    except OSError:
        return False
    finally:
        probe.close()


def wait_for_optional_operator_event(
    companion: Companion,
    watcher,
    *,
    start_index: int,
    timeout: float = 2.0,
):
    op_event = companion.wait_for(
        lambda msg: msg.get("type") == "operator_event",
        watcher,
        timeout=timeout,
        start_index=start_index,
    )
    if not op_event:
        print(
            "SKIP: operator_event assertions "
            "(wm.operators does not populate in --background; GUI E2E covers operator sensing)"
        )
    return op_event


def main() -> int:
    companion: Companion | None = None
    try:
        import bpy

        enable_addon()
        import msmd_guided
        import msmd_guided.watcher as watcher

        msmd_guided.unregister()
        if not port_can_bind():
            return fail("unregister did not free port 41797")

        msmd_guided.register()
        companion = Companion()

        hello = companion.wait_for(
            lambda msg: msg.get("type") == "hello" and msg.get("role") == "addon",
            watcher,
        )
        if not hello:
            return fail("addon hello not received")
        companion.send({"type": "hello", "role": "companion", "version": 1})

        companion.send(
            {
                "type": "quest_load",
                "quest_id": "protocol-bg",
                "harmless_ops": [],
                "steps": [
                    {"id": "s0", "check": {"type": "scene_missing", "name": "Cube"}},
                    {
                        "id": "s1",
                        "check": {
                            "any": [
                                {"type": "operator", "id": "mesh.primitive_uv_sphere_add"},
                                {"type": "scene_exists", "name": "Sphere"},
                            ]
                        },
                    },
                ],
            }
        )
        loaded = companion.wait_for(
            lambda msg: msg.get("type") == "quest_loaded"
            and msg.get("quest_id") == "protocol-bg"
            and msg.get("ok") is True,
            watcher,
        )
        if not loaded:
            return fail("quest_loaded ok:true not received")

        snapshot_index = companion.snapshot_count()
        companion.send({"type": "snapshot_request"})
        snapshot = companion.wait_for(
            lambda msg: msg.get("type") == "state_snapshot",
            watcher,
            start_index=snapshot_index,
        )
        if not snapshot:
            return fail("state_snapshot not received")
        if "window" not in snapshot:
            return fail("state_snapshot missing window key")

        companion.send({"type": "step_begin", "step_id": "s0"})
        if not pump_until(lambda: watcher._active_step_id == "s0", watcher):
            return fail("step s0 did not become active")

        start_index = companion.snapshot_count()
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.object.delete()
        wait_for_optional_operator_event(companion, watcher, start_index=start_index)
        verified_s0 = companion.wait_for(
            lambda msg: msg.get("type") == "step_verified" and msg.get("step_id") == "s0",
            watcher,
            start_index=start_index,
        )
        if not verified_s0:
            return fail("step_verified s0 not received")

        companion.send({"type": "step_begin", "step_id": "s1"})
        if not pump_until(lambda: watcher._active_step_id == "s1", watcher):
            return fail("step s1 did not become active")

        start_index = companion.snapshot_count()
        bpy.ops.mesh.primitive_uv_sphere_add()
        wait_for_optional_operator_event(companion, watcher, start_index=start_index)
        verified_s1 = companion.wait_for(
            lambda msg: msg.get("type") == "step_verified" and msg.get("step_id") == "s1",
            watcher,
            start_index=start_index,
        )
        if not verified_s1:
            return fail("step_verified s1 not received")
        complete = companion.wait_for(
            lambda msg: msg.get("type") == "quest_complete"
            and msg.get("quest_id") == "protocol-bg",
            watcher,
            start_index=start_index,
        )
        if not complete:
            return fail("quest_complete not received")

        companion.close()
        companion = None
        msmd_guided.unregister()
        msmd_guided.unregister()
        if not port_can_bind():
            return fail("second unregister did not free port 41797")

        print("PASS")
        return 0
    except Exception:
        traceback.print_exc()
        return fail("unexpected exception")
    finally:
        if companion is not None:
            companion.close()
        try:
            import msmd_guided

            msmd_guided.unregister()
        except Exception:
            pass


if __name__ == "__main__":
    result = main()
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(result)
