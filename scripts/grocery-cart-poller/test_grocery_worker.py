import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import grocery_worker as worker
from provider import ProviderError, read_cart


def row(pk, name="Turkey", count="1"):
    return {"id": pk, "revision": 1, "current_revision": 1, "current_status": "needed",
            "name": name, "quantity": count, "notes": "", "attempts": []}


def line(qty, pid="201", name="Turkey breast"):
    return {"product_id": pid, "name": name, "size": "16 oz", "quantity": qty}


class Fixture:
    def __init__(self, before, after):
        self.before, self.after = before, after
        self.changes = []

    def call(self, tool, args, on_reply=None):
        if tool != "cart":
            raise AssertionError(tool)
        store = args["retailer_name"]
        raw = {"retailer": {"name": store}, "cart": {"items": self.before if store == "Wegmans" else []}}
        if on_reply:
            self.changes.append(args)
            raw["cart"]["items"] = self.after
            raw["addresses"] = [{"private": "never-store-this"}]
            on_reply({"structuredContent": {"tool": "cart", "artifacts": raw}})
        return raw


class GroceryWorkerTests(unittest.TestCase):
    def test_held_untrusted_empty_and_attention_never_start_provider(self):
        with tempfile.TemporaryDirectory() as tmp:
            create = Mock(side_effect=AssertionError("unexpected provider"))
            queue = Mock()
            with patch.object(worker, "helper", queue):
                self.assertEqual(worker.poll(create, True, Path(tmp)), "held")
                queue.assert_not_called()
                queue.side_effect = lambda _, run: {"ok": True, "run_id": run, "requests": [row("one")]}
                self.assertEqual(worker.poll(create, False, Path(tmp)), "queue_unavailable")
                for rows in [[], [{**row("one"), "current_status": "needs_attention"}],
                             [{**row("one"), "attempts": [{"requires_reconciliation": True, "lease_expires_at": "2099-01-01T00:00:00Z"}]}]]:
                    queue.side_effect = lambda _, run: {"ok": True, "queue_policy": worker.POLICY,
                                                       "run_id": run, "requests": rows}
                    self.assertEqual(worker.poll(create, False, Path(tmp)), "idle")

    def test_units_and_package_counts(self):
        self.assertEqual(worker.intent(row("a")), ("Turkey", 1, None))
        self.assertEqual(worker.intent(row("a", "milk", "2 cartons")), ("milk", 2, None))
        for name, qty, query, size in [("a dozen eggs","1","eggs",(12,"ct")),
            ("a gallon of milk","2","milk",(1,"gal")),("milk","half gallon","milk",(.5,"gal")),
            ("flour","16 oz","flour",(16,"oz"))]:
            self.assertEqual(worker.intent(row("r", name, qty))[::2], (query, size))
        with self.assertRaises(ValueError):
            worker.intent(row("x","milk","two more"))

    def test_replayed_prepare_cannot_write(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(worker, "write_progress", return_value={"ok": True, "may_add": False}):
            fixture = Fixture([], [line(1)])
            worker.shop("cart-replay", [row("one")], fixture, Path(tmp))
            self.assertEqual(fixture.changes, [])

    def test_realistic_batch_uses_delta_and_exact_receipt_on_restart(self):
        fixture = Fixture([line(2)], [line(5)])
        operations = []
        def progress(run, item, store, phase, **fields):
            operations.append((phase, item["id"], fields))
            return {"ok": True, "may_add": True, "lease_expires_at": "2099-01-01T00:00:00Z"}
        with tempfile.TemporaryDirectory() as tmp, patch.object(worker, "write_progress", side_effect=progress):
            path = Path(tmp)
            worker.shop("cart-test", [row("one"), row("two", count="2")], fixture, path)
            self.assertEqual(fixture.changes, [{"retailer_name": "Wegmans", "quick_add_search_queries": [{"query":"Turkey","quantity":3}]}])
            results = [f for phase, _, f in operations if phase == "complete"]
            self.assertEqual([f["product"]["quantity"] for f in results], [1,2])
            self.assertTrue(all(f["outcome"] == "in_cart" and "shows 5" in f["reason"] for f in results))
            journal = worker.load_private(path/"cart-test.dpapi")
            self.assertNotIn("never-store-this", json.dumps(journal))
            self.assertNotIn(b"Turkey", (path/"cart-test.dpapi").read_bytes())
            worker.finalize(journal, path/"cart-test.dpapi")
            self.assertEqual(len(operations), 4)

    def test_ambiguous_or_missing_delta_goes_to_attention(self):
        fixture = Fixture([], [line(1),line(1,"202","Milk")])
        replies = []
        def progress(run, item, store, phase, **fields):
            replies.append(fields)
            return {"ok":True,"may_add":True,"lease_expires_at":"2099-01-01T00:00:00Z"}
        with tempfile.TemporaryDirectory() as tmp, patch.object(worker,"write_progress",side_effect=progress):
            worker.shop("cart-test",[row("one")],fixture,Path(tmp))
        self.assertEqual(fixture.changes[0]["retailer_name"],"Morton Williams Supermarket")
        self.assertEqual(replies[-1]["outcome"],"needs_attention")

    def test_lost_completion_replays_exact_cached_operation(self):
        calls = []
        def reply(action, run, operation=None, retry_id=None):
            if action == "Progress":
                calls.append(operation["operation_id"])
                return {"ok":False,"code":"use_retry"}
            self.assertEqual(retry_id,calls[-1])
            return {"ok":True}
        with patch.object(worker,"helper",side_effect=reply):
            for _ in range(2):
                worker.complete("cart-retry",row("one"),"Wegmans","needs_attention",reason="Missing evidence")
        self.assertEqual(calls[0],calls[1])

    def test_cart_read_failure_bounds_calls(self):
        provider = Mock()
        provider.call.side_effect = ProviderError("Unavailable")
        with patch.object(worker, "complete") as complete:
            worker.shop("cart-x", [row("one")], provider, Path("."))
        self.assertEqual(provider.call.call_count, 2)
        self.assertEqual(complete.call_args.args[-1], "needs_attention")
        with self.assertRaises(ProviderError):
            read_cart({"retailer":{"name":"Somewhere else"},"cart":{"items":[]}},"Wegmans")

    def test_stale_ambiguous_reconciliation_is_read_once_per_revision(self):
        prior = {"attempt_id":"old","retailer":"Wegmans","revision":1,"requires_reconciliation":True}
        edited = {**row("item"),"revision":2,"current_revision":2,"attempts":[prior]}
        with tempfile.TemporaryDirectory() as tmp, patch.object(worker,"complete",return_value={
                "ok":False,"code":"revision_conflict","evidence_recorded":True}):
            path = Path(tmp)
            fixture = Fixture([], [])
            worker.shop("cart-stale", [edited], fixture, path)
            queue = lambda _,run: {"ok":True,"queue_policy":worker.POLICY,"run_id":run,"requests":[edited]}
            with patch.object(worker,"helper",side_effect=queue):
                self.assertEqual(worker.poll(Mock(side_effect=AssertionError("unexpected read")),False,path),"idle")
            self.assertFalse(worker.recovery_marker({**edited,"revision":3}, prior, path).exists())


if __name__ == "__main__":
    unittest.main()
