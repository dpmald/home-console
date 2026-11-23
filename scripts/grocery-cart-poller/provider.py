"""The two Instacart operations used by the household worker, via the public Codex app-server API."""
import json
import queue
import subprocess
import threading
import time
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation


class ProviderError(Exception):
    pass


def stamp():
    return datetime.now(timezone.utc).isoformat()


class Provider:
    def __init__(self, codex, cwd):
        self.proc = subprocess.Popen(
            [codex, "app-server", "--listen", "stdio://"], cwd=cwd,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            encoding="utf-8", creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        self.messages = queue.Queue()
        self.sequence = 0
        threading.Thread(target=self.read, daemon=True).start()
        try:
            self.rpc("initialize", {"clientInfo": {"name": "home_console_grocery_worker", "version": "1"}})
            self.send({"method": "initialized"})
            thread = self.rpc("thread/start", {"ephemeral": True, "model": "gpt-6.1-sol",
                "cwd": str(cwd), "approvalPolicy": "never", "sandbox": "read-only"})
            self.thread = thread["thread"]["id"]
        except Exception:
            self.close()
            raise

    def read(self):
        try:
            for line in self.proc.stdout:
                self.messages.put(json.loads(line, parse_float=Decimal))
        finally:
            self.messages.put(None)

    def send(self, message):
        self.proc.stdin.write(json.dumps(message) + "\n")
        self.proc.stdin.flush()

    def rpc(self, method, params):
        self.sequence += 1
        self.send({"method": method, "params": params, "id": self.sequence})
        until = time.monotonic() + 65
        while time.monotonic() < until:
            try:
                message = self.messages.get(timeout=max(.01, until - time.monotonic()))
            except queue.Empty:
                break
            if message is None:
                break
            if "method" in message and "id" in message:
                # Any new authorization or interactive input is left to the account owner.
                self.send({"id": message["id"], "error": {"code": -32603, "message": "User input unavailable."}})
            elif message.get("id") == self.sequence:
                if "result" in message:
                    return message["result"]
                break
        raise ProviderError("Instacart could not confirm this operation.")

    def call(self, tool, args, on_reply=None):
        if tool not in ("cart", "search_products"):
            raise ValueError("Unsupported operation")
        result = self.rpc("mcpServer/tool/call", {"threadId": self.thread, "server": "codex_apps",
            "tool": "instacart." + tool, "arguments": args})
        if on_reply:
            on_reply(result)
        data = result.get("structuredContent") or {}
        if result.get("isError") or data.get("tool") != tool or not isinstance(data.get("artifacts"), dict):
            raise ProviderError("Instacart did not return confirmed cart or product data.")
        return data["artifacts"]

    def close(self):
        self.proc.terminate()
        try:
            self.proc.wait(3)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def product(item, cart):
    if not isinstance(item, dict):
        return None
    detail = item.get("product") if isinstance(item.get("product"), dict) else item
    pid = detail.get("product_id", detail.get("id"))
    name = detail.get("name", detail.get("product_name"))
    size = detail.get("size", detail.get("size_text"))
    kind = item.get("quantity_type", detail.get("quantity_type"))
    value = item.get("quantity") if cart else 1
    try:
        qty = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if (not isinstance(pid, (str, int)) or isinstance(pid, bool) or not str(pid).strip()
            or not isinstance(name, str) or not name.strip()
            or not qty.is_finite() or qty <= 0):
        return None
    # Fractional cart totals stay exact in the private journal. Prepare and mutation
    # parameters still honor their individual numeric schemas.
    amount = int(qty) if qty == qty.to_integral_value() else str(qty)
    line = {"product_id": str(pid), "name": name, "quantity": amount}
    if isinstance(size, str) and size.strip():
        line["size"] = size
    if kind in ("weight", "each"):
        line["quantity_type"] = kind
    return line


def read_cart(artifacts, retailer):
    if (artifacts.get("retailer") or {}).get("name", "").casefold() != retailer.casefold():
        raise ProviderError("Instacart returned a different or unidentified retailer.")
    items = (artifacts.get("cart") or {}).get("items")
    if not isinstance(items, list):
        raise ProviderError("Instacart did not return an itemized cart.")
    lines = [product(item, True) for item in items]
    if any(line is None for line in lines) or len({line["product_id"] for line in lines}) != len(lines):
        raise ProviderError("Instacart returned incomplete or ambiguous cart lines.")
    return {line["product_id"]: line for line in lines}


def search_results(artifacts):
    found = {}
    def collect(value):
        if isinstance(value, list):
            for entry in value:
                collect(entry)
        elif isinstance(value, dict):
            line = product(value, False)
            if line:
                found[line["product_id"]] = line
            else:
                for key in ("products", "results", "search_results", "items", "sections", "product"):
                    if key in value:
                        collect(value[key])
    collect(artifacts)
    return found
