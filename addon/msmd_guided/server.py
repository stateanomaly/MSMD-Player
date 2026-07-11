"""TCP JSON-lines transport for MSMD Guided."""

from __future__ import annotations

import json
import queue
import select
import socket
import threading
from typing import Any


HOST = "127.0.0.1"
PORT = 41797
PROTOCOL_VERSION = 1

_INBOUND_TYPES = {
    "hello",
    "quest_load",
    "step_begin",
    "snapshot_request",
    "ping",
    "pong",
}


class JsonLineServer:
    def __init__(
        self,
        host: str = HOST,
        port: int = PORT,
        blender_version: str = "",
    ) -> None:
        self.host = host
        self.port = port
        self.blender_version = blender_version
        self.inbox: queue.Queue[dict[str, Any]] = queue.Queue()
        self.outbox: queue.Queue[dict[str, Any]] = queue.Queue()
        self.stop_event = threading.Event()
        self._listen_sock: socket.socket | None = None
        self._client_sock: socket.socket | None = None
        self._recv_buffer = b""
        self._thread: threading.Thread | None = None
        self._sock_lock = threading.Lock()

    def start(self) -> None:
        listen_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listen_sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listen_sock.bind((self.host, self.port))
        listen_sock.listen(4)
        listen_sock.setblocking(False)
        self._listen_sock = listen_sock

        self._thread = threading.Thread(
            target=self._run,
            name="MSMD Guided TCP",
            daemon=True,
        )
        self._thread.start()

    def stop(self, timeout: float = 2.0) -> None:
        self.stop_event.set()
        with self._sock_lock:
            self._close_socket(self._listen_sock)
            self._listen_sock = None
            self._close_socket(self._client_sock)
            self._client_sock = None
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=timeout)

    def enqueue(self, message: dict[str, Any]) -> None:
        self.outbox.put(message)

    def is_alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def _run(self) -> None:
        while not self.stop_event.is_set():
            self._drain_outbox()
            sockets = []
            with self._sock_lock:
                if self._listen_sock is not None:
                    sockets.append(self._listen_sock)
                if self._client_sock is not None:
                    sockets.append(self._client_sock)

            if not sockets:
                self.stop_event.wait(0.05)
                continue

            try:
                readable, _, _ = select.select(sockets, [], [], 0.05)
            except (OSError, ValueError):
                continue

            for ready_sock in readable:
                if self.stop_event.is_set():
                    break
                with self._sock_lock:
                    listen_sock = self._listen_sock
                    client_sock = self._client_sock
                if ready_sock is listen_sock:
                    self._accept_client()
                elif ready_sock is client_sock:
                    self._read_client()

        with self._sock_lock:
            self._close_socket(self._client_sock)
            self._client_sock = None
            self._close_socket(self._listen_sock)
            self._listen_sock = None

    def _accept_client(self) -> None:
        with self._sock_lock:
            listen_sock = self._listen_sock
        if listen_sock is None:
            return

        try:
            client_sock, _addr = listen_sock.accept()
        except OSError:
            return

        client_sock.setblocking(False)
        with self._sock_lock:
            self._close_socket(self._client_sock)
            self._client_sock = client_sock
            self._recv_buffer = b""

        self._send_direct(
            {
                "type": "hello",
                "role": "addon",
                "version": PROTOCOL_VERSION,
                "blender_version": self.blender_version,
            }
        )

    def _read_client(self) -> None:
        with self._sock_lock:
            client_sock = self._client_sock
        if client_sock is None:
            return

        try:
            chunk = client_sock.recv(65536)
        except BlockingIOError:
            return
        except OSError:
            self._drop_client()
            return

        if not chunk:
            self._drop_client()
            return

        self._recv_buffer += chunk
        while b"\n" in self._recv_buffer:
            line, self._recv_buffer = self._recv_buffer.split(b"\n", 1)
            self._handle_line(line)

    def _handle_line(self, line: bytes) -> None:
        try:
            text = line.decode("utf-8")
            message = json.loads(text)
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_error("malformed JSON line")
            return

        if not isinstance(message, dict) or not isinstance(message.get("type"), str):
            self._send_error("malformed JSON line")
            return

        message_type = message["type"]
        if message_type not in _INBOUND_TYPES:
            self._send_error(f"unknown type: {message_type}")
            return

        if message_type == "ping":
            self._send_direct({"type": "pong", "t": message.get("t")})
            return

        self.inbox.put(message)

    def _drain_outbox(self) -> None:
        try:
            message = self.outbox.get(timeout=0.01)
        except queue.Empty:
            return

        self._send_direct(message)
        for _ in range(99):
            try:
                message = self.outbox.get_nowait()
            except queue.Empty:
                return
            self._send_direct(message)

    def _send_direct(self, message: dict[str, Any]) -> None:
        with self._sock_lock:
            client_sock = self._client_sock
        if client_sock is None:
            return

        try:
            payload = json.dumps(message, separators=(",", ":"), ensure_ascii=False)
            client_sock.sendall(payload.encode("utf-8") + b"\n")
        except OSError:
            self._drop_client()

    def _send_error(self, message: str) -> None:
        self._send_direct({"type": "error", "message": message})

    def _drop_client(self) -> None:
        with self._sock_lock:
            self._close_socket(self._client_sock)
            self._client_sock = None
            self._recv_buffer = b""

    @staticmethod
    def _close_socket(sock: socket.socket | None) -> None:
        if sock is None:
            return
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            sock.close()
        except OSError:
            pass


def start_server(
    host: str = HOST,
    port: int = PORT,
    blender_version: str = "",
) -> JsonLineServer:
    server = JsonLineServer(host=host, port=port, blender_version=blender_version)
    try:
        server.start()
    except Exception:
        server.stop()
        raise
    return server
