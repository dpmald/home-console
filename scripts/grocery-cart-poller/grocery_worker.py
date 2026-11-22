"""Two-minute household cart poll. Runtime resources live under the signed-in user's LocalAppData."""
import ctypes
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from ctypes import wintypes
from datetime import datetime, timezone
from pathlib import Path

from provider import Provider, ProviderError, read_cart, search_results, stamp

ROOT = Path(os.environ.get("LOCALAPPDATA", ".")) / "HomeConsole" / "GroceryCartWorker"
STORES = ("Wegmans", "Morton Williams Supermarket")
POLICY = "authorized-revision-v1"
CATALOG_UNITS = {
    "oz": "oz", "ounce": "oz", "ounces": "oz", "lb": "lb", "lbs": "lb", "pound": "lb",
    "pounds": "lb", "g": "g", "gram": "g", "grams": "g", "kg": "kg", "ml": "ml",
    "l": "l", "liter": "l", "liters": "l", "gallon": "gal", "gallons": "gal", "gal": "gal",
    "quart": "qt", "quarts": "qt", "qt": "qt", "pint": "pt", "pints": "pt", "pt": "pt",
    "fl oz": "fl oz", "fluid ounces": "fl oz", "count": "ct", "ct": "ct", "pack": "ct",
}
MEASURE = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)\s*[- ]?\s*(" +
    "|".join(sorted(CATALOG_UNITS, key=len, reverse=True)) + r")\b", re.I)


def write_atomic(path, data):
    tmp = path.with_suffix(path.suffix + "." + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


class Blob(ctypes.Structure):
    _fields_ = [("size", wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_char))]


def private_blob(value, decrypt=False):
    source = ctypes.create_string_buffer(value)
    incoming = Blob(len(value), ctypes.cast(source, ctypes.POINTER(ctypes.c_char)))
    outgoing = Blob()
    fn = (ctypes.windll.crypt32.CryptUnprotectData if decrypt else ctypes.windll.crypt32.CryptProtectData)
    if not fn(ctypes.byref(incoming), None, None, None, None, 1, ctypes.byref(outgoing)):
        raise OSError("Windows could not access the private receipt.")
    try:
        return ctypes.string_at(outgoing.data, outgoing.size)
    finally:
        ctypes.windll.kernel32.LocalFree(ctypes.cast(outgoing.data, ctypes.c_void_p))


def save_private(path, value):
    write_atomic(path, private_blob(json.dumps(value, ensure_ascii=False).encode("utf-8")))


def load_private(path):
    return json.loads(private_blob(path.read_bytes(), decrypt=True))


def helper(action, run, operation=None, retry_id=None):
    alias = Path(os.environ["LOCALAPPDATA"]) / "Microsoft/WindowsApps/pwsh.exe"
    shell = str(alias) if alias.is_file() else shutil.which("pwsh.exe")
    if not shell:
        raise OSError("PowerShell 7 is unavailable.")
    args = [shell, "-NoProfile", "-NonInteractive", "-File", str(ROOT / "Read-QueueUtf8.ps1"),
            "-Action", action, "-RunId", run]
    if retry_id:
        args.extend(["-OperationId", retry_id])
    req = json.dumps(operation, ensure_ascii=True) if operation is not None else None
    call = subprocess.run(args, input=req, capture_output=True, encoding="utf-8", errors="replace",
                          timeout=35, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    return json.loads(call.stdout.lstrip("\ufeff"))


def write_progress(run, row, store, phase, **fields):
    key = f'{run}/{row["id"]}/{row["revision"]}/{phase}'
    op = {"phase": phase, "operation_id": uuid.uuid5(uuid.NAMESPACE_OID, key).hex, "request_id": row["id"],
          "revision": row["revision"], "retailer": store, "observed_at": stamp(), **fields}
    try:
        result = helper("Progress", run, op)
        if result.get("code") == "use_retry":
            return helper("Retry", run, retry_id=op["operation_id"])
        return result
    except (OSError, ValueError, subprocess.SubprocessError):
        # A missing prepare reply never grants permission to add. Exact replay can recover a receipt.
        return helper("Retry", run, retry_id=op["operation_id"])


def measure(text):
    m = MEASURE.search(text)
    return (float(m[1]), CATALOG_UNITS[m[2].lower()]) if m else None


def expand_measures(text):
    text = re.sub(r"\bhalf[- ]+(?:a |an )?(gallons?|gal|pounds?|lb|liters?)\b", r"0.5 \1", text, flags=re.I)
    text = re.sub(r"\b(?:(\d+|a|one)\s+)?dozen\b",
                  lambda m: str(12 * (int(m[1]) if (m[1] or "").isdigit() else 1)) + " ct", text, flags=re.I)
    text = re.sub(r"\b(?:a|an|one)\s+(" + "|".join(CATALOG_UNITS) + r")\b", r"1 \1", text, flags=re.I)
    return text


def intent(row):
    name = row["name"].strip()
    quantity = str(row.get("quantity") or "").strip().lower()
    notes = str(row.get("notes") or "").strip()
    if notes:
        name += " " + notes
    name = expand_measures(name)
    quantity = expand_measures(quantity)
    if quantity in CATALOG_UNITS:
        quantity = "1 " + quantity
    number = re.fullmatch(r"(\d+)(?:\s*(?:packages?|units?|bags?|bottles?|boxes?|cans?|cartons?))?", quantity)
    if not quantity or number:
        count = int(number[1]) if number else 1
        size = measure(name)
    elif MEASURE.fullmatch(quantity):
        count, size = 1, measure(quantity)
        if measure(name) and measure(name) != size:
            raise ValueError("The request specifies two different package sizes.")
    else:
        raise ValueError("The requested quantity could not be converted to a package count or package size.")
    if count < 1 or count > 100:
        raise ValueError("The requested package count is outside the cart’s supported range.")
    if not size and re.search(r"\b(?:gallons?|quarts?|pints?|ounces?|pounds?|liters?|lb|lbs|oz|kg|ml|dozen)\b", name, re.I):
        raise ValueError("The requested package size could not be established.")
    query = re.sub(r"^of\s+", "", MEASURE.sub("", name).strip(" ,;-/"), flags=re.I) if size else name
    if not query.strip() or len(query) > 250:
        raise ValueError("The request needs a product name that Instacart can search.")
    return query, count, size


def until(iso):
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() if iso else 0


def candidates(snapshot):
    return [r for r in snapshot.get("requests", []) if r.get("current_status") == "needed"
            and r.get("revision") == r.get("current_revision") and not r.get("stale")]


def recovery_marker(row, attempt, directory):
    key = f'{row["id"]}/{row["revision"]}/{attempt.get("attempt_id")}'
    return directory / (hashlib.sha256(key.encode()).hexdigest() + ".reviewed")


def tokens(text):
    return {word for word in re.findall(r"[^\W_]+", text.casefold()) if len(word) > 1}


def receipts(before, after, groups):
    remaining = {pid: line["quantity"] - before.get(pid, {}).get("quantity", 0)
                 for pid, line in after.items()}
    remaining = {pid: qty for pid, qty in remaining.items() if qty}
    if any(pid not in after for pid in before) or any(qty < 0 for qty in remaining.values()):
        return {}
    matches = {}
    for key, group in groups.items():
        expected = group.get("product_id")
        choices = [pid for pid, delta in remaining.items() if delta == group["count"] and
                   (pid == expected if expected else bool(tokens(group["query"]) & tokens(after[pid]["name"])))]
        if len(choices) == 1:
            matches[key] = choices[0]
    # A single authorized quick-add and a single delta identify its actual top match, including brand synonyms.
    if len(groups) == len(remaining) == 1:
        key, group = next(iter(groups.items()))
        pid, qty = next(iter(remaining.items()))
        if qty == group["count"] and group.get("product_id") in (None, pid):
            matches[key] = pid
    if len(groups) != len(remaining) or len(set(matches.values())) != len(groups):
        return {}
    return {key: after[pid] for key, pid in matches.items()}


def complete(run, row, store, outcome, **fields):
    result = write_progress(run, row, store, "complete", outcome=outcome, **fields)
    if not result.get("ok") and not result.get("evidence_recorded"):
        raise RuntimeError("Receipt not acknowledged")
    return result


def get_cart(provider, store):
    return read_cart(provider.call("cart", {"retailer_name": store}), store)


def finalize(journal, path):
    if journal.get("raw") is None:
        return False
    try:
        raw = journal["raw"]
        data = raw.get("structuredContent") or {}
        if raw.get("isError") or data.get("tool") != "cart":
            raise ProviderError("Unconfirmed cart response.")
        after = read_cart(data["artifacts"], journal["store"])
        verified = receipts(journal["before"], after, journal["groups"])
    except (KeyError, TypeError, ValueError, ProviderError):
        verified = {}
    for key, group in journal["groups"].items():
        for row in group["rows"]:
            if row["id"] in journal["completed"]:
                continue
            if key in verified:
                line = verified[key]
                complete(journal["run"], row, journal["store"], "in_cart",
                         product={**line, "quantity": row["count"]}, observed_at=journal["reply_at"],
                         reason=f'Added {row["count"]} package(s) for this request. Instacart now shows {line["quantity"]} in this cart line.')
            else:
                complete(journal["run"], row, journal["store"], "needs_attention",
                         reason="Instacart’s reply did not identify an unambiguous product and quantity change. The addition will not be repeated.")
            journal["completed"].append(row["id"])
            save_private(path, journal)
    return True


def shop(run, rows, provider, journal_dir):
    # An earlier prepared add is never sent again, including after a crash or an edited row.
    new = []
    for row in rows:
        unresolved = [a for a in row.get("attempts", []) if a.get("requires_reconciliation")]
        if not unresolved:
            new.append(row)
            continue
        old = unresolved[0]
        if until(old.get("lease_expires_at")) > time.time():
            continue
        if old["retailer"] not in STORES:
            continue
        observed = get_cart(provider, old["retailer"])
        expected = (old.get("intent") or {}).get("product") or {}
        pid = expected.get("product_id")
        baseline = {p["product_id"]: p["quantity"] for p in (old.get("intent") or {}).get("observed_cart", [])}
        fields = {"recovery_attempt_id": old["attempt_id"]}
        if pid in observed and observed[pid]["quantity"] == baseline.get(pid, 0) + expected.get("quantity", 0):
            complete(run, row, old["retailer"], "already_in_cart", product=observed[pid], **fields)
        else:
            result = complete(run, row, old["retailer"], "needs_attention",
                              reason="A previous add was interrupted. The original cart could not confirm it safely.", **fields)
            if result.get("evidence_recorded") and result.get("code") == "revision_conflict":
                # The newer row remains needed; the kiosk exposes the older claim for household review.
                write_atomic(recovery_marker(row, old, journal_dir), b"")
    if not new:
        return
    store = STORES[0]
    try:
        try:
            before = get_cart(provider, store)
        except ProviderError:
            before = get_cart(provider, store)
        if not before:
            store = STORES[1]
            before = get_cart(provider, store)
    except ProviderError:
        for row in new:
            complete(run, row, store, "needs_attention",
                     reason="Instacart did not return a verified itemized cart. No addition was attempted.")
        return
    read_at = stamp()
    groups = {}
    for row in new:
        try:
            query, count, size = intent(row)
            selected = None
            if size:
                choices = search_results(provider.call("search_products", {"retailer_name": store, "query": query}))
                selected = next((p for p in choices.values() if measure(p["size"]) == size), None)
                if not selected:
                    raise ValueError("Instacart returned no product with the requested package size.")
            key = "sku:" + selected["product_id"] if selected else "query:" + query.casefold()
            group = groups.setdefault(key, {"query": query, "count": 0, "rows": [], "selected": selected,
                                            "product_id": selected["product_id"] if selected else None})
            group["count"] += count
            group["rows"].append({"id": row["id"], "revision": row["revision"], "count": count})
        except (ValueError, ProviderError) as err:
            complete(run, row, store, "needs_attention", reason=str(err))
    prepared = {}
    expires = []
    blocked_until = 0
    for key, group in groups.items():
        selected = group["selected"]
        pid = group["product_id"]
        base_qty = before.get(pid, {}).get("quantity", 0)
        if group["count"] + base_qty > 100:
            for row in group["rows"]:
                complete(run, row, store, "needs_attention", reason="The combined quantity exceeds the supported cart quantity.")
            continue
        accepted = []
        action = uuid.uuid4().hex
        for row in group["rows"]:
            relevant = ([before[pid]] if pid in before else []) if selected else [
                p for p in before.values() if tokens(group["query"]) & tokens(p["name"])]
            if len(relevant) > 20:
                complete(run, row, store, "needs_attention", reason="Too many existing cart lines match this request.")
                continue
            intended = {"product": {**selected, "quantity": row["count"]}} if selected else {
                "quick_add": {"query": group["query"], "quantity": row["count"]}}
            claim = write_progress(run, row, store, "prepare", observed_at=read_at,
                                   observed_cart=relevant, cart_action_id=action, **intended)
            if claim.get("code") == "cart_busy":
                # A parallel Saturday run or another device holds this retailer's lease.
                blocked_until = max(blocked_until, until(claim.get("lease_expires_at")),
                                    time.time() + int(claim.get("retry_after_seconds") or 1))
            if claim.get("ok") and claim.get("may_add") and until(claim.get("lease_expires_at")) > time.time() + 10:
                accepted.append(row)
                expires.append(until(claim["lease_expires_at"]))
        if accepted:
            prepared[key] = {**group, "rows": accepted, "count": sum(r["count"] for r in accepted)}
    if blocked_until:
        write_atomic(journal_dir / "busy.json", json.dumps(min(blocked_until, time.time() + 16 * 60)).encode())
    if not prepared or min(expires) <= time.time() + 10:
        return
    args = {"retailer_name": store}
    quick = [{"query": g["query"], "quantity": g["count"]} for g in prepared.values() if not g["selected"]]
    updates = [{"product_id": g["product_id"], "quantity": before.get(g["product_id"], {}).get("quantity", 0) + g["count"]}
               for g in prepared.values() if g["selected"]]
    if quick:
        args["quick_add_search_queries"] = quick
    if updates:
        args["item_updates"] = updates
    path = journal_dir / (run + ".dpapi")
    journal = {"run": run, "store": store, "before": before, "groups": prepared, "completed": [], "raw": None}
    save_private(path, journal)
    if min(expires) <= time.time() + 10:
        return
    def record_reply(raw):
        def obj(value):
            return value if isinstance(value, dict) else {}
        raw = obj(raw)
        data = obj(raw.get("structuredContent"))
        artifacts = obj(data.get("artifacts"))
        cart = obj(artifacts.get("cart"))
        retailer = obj(artifacts.get("retailer"))
        # Retain original product-line evidence, omit saved addresses, account details, and payment data.
        receipt = {"isError": raw.get("isError"), "structuredContent": {"tool": data.get("tool"),
            "artifacts": {"cart": {"items": cart.get("items")}, "retailer": {"name": retailer.get("name")}}}}
        structure = {"result_fields": sorted(raw), "structured_fields": sorted(data),
                     "artifact_fields": sorted(artifacts), "cart_fields": sorted(cart)}
        journal.update(raw=receipt, reply_at=stamp(), response_fields=structure)
        save_private(path, journal)
    try:
        provider.call("cart", args, on_reply=record_reply)
    except ProviderError:
        if journal["raw"] is None:
            record_reply({"unconfirmed": True})
    finalize(journal, path)


def poll(provider_factory, held, journal_dir):
    if held:
        return "held"
    # Reapply a stored provider reply to Home Console if acknowledgement was interrupted.
    pending_file = journal_dir / "pending.json"
    if pending_file.exists():
        journal_path = journal_dir / (json.loads(pending_file.read_text()) + ".dpapi")
        if journal_path.exists():
            journal = load_private(journal_path)
            if journal.get("raw") is not None:
                finalize(journal, journal_path)
        pending_file.unlink()
    run = "cart-" + uuid.uuid4().hex
    snapshot = helper("List", run)
    if not snapshot.get("ok") or snapshot.get("queue_policy") != POLICY or snapshot.get("run_id") != run:
        return "queue_unavailable"
    rows = candidates(snapshot)
    ready = [row for row in rows if not any(a.get("requires_reconciliation") and
             (until(a.get("lease_expires_at")) > time.time() or recovery_marker(row, a, journal_dir).exists())
             for a in row.get("attempts", []))]
    if not ready:
        return "idle"
    busy = journal_dir / "busy.json"
    if busy.exists() and json.loads(busy.read_text()) > time.time():
        return "cart_busy"
    write_atomic(pending_file, json.dumps(run).encode())
    try:
        provider = provider_factory()
    except (ProviderError, OSError):
        for row in ready:
            if not any(a.get("requires_reconciliation") for a in row.get("attempts", [])):
                complete(run, row, STORES[0], "needs_attention",
                         reason="The Instacart session on the grocery worker was unavailable. No addition was attempted.")
        pending_file.unlink(missing_ok=True)
        return "provider_unavailable"
    try:
        shop(run, ready, provider, journal_dir)
    finally:
        provider.close()
    pending_file.unlink(missing_ok=True)
    return "processed"


def main():
    import msvcrt
    ROOT.mkdir(parents=True, exist_ok=True)
    with (ROOT / "poll.lock").open("a+b") as lock:
        try:
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            return 0
        try:
            journals = ROOT / "receipts"
            journals.mkdir(exist_ok=True)
            codex = shutil.which("codex.exe") or str(Path(os.environ["LOCALAPPDATA"]) / "Programs/OpenAI/Codex/bin/codex.exe")
            status = poll(lambda: Provider(codex, ROOT), not (ROOT / "enabled").is_file(), journals)
        except Exception as err:
            # Log class only. Provider results, household input and identifiers stay out of status/logs.
            status = "error_" + type(err).__name__
        write_atomic(ROOT / "status.json", json.dumps({"checked_at": stamp(), "status": status}).encode())
        return 1 if status.startswith(("error_", "queue_unavailable")) else 0


if __name__ == "__main__":
    sys.exit(main())
