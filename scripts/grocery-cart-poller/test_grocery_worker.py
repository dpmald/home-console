import json
from decimal import Decimal
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import grocery_worker as worker
import recover_receipt as recovery
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
    def test_actual_weight_shape_with_fractional_existing_lines(self):
        weighted = lambda pid, name, qty: {"product_id":pid,"name":name,"quantity":qty,"quantity_type":"weight"}
        other = weighted("17","Seasonal fruit",Decimal("0.5"))
        expected = weighted("44","Sliced turkey",Decimal("1.0"))
        fixture = Fixture([other], [other, expected])
        log = []
        def progress(run, item, store, phase, **fields):
            log.append(fields)
            return {"ok":True,"may_add":True,"lease_expires_at":"2099-01-01T00:00:00Z"}
        with tempfile.TemporaryDirectory() as tmp, patch.object(worker, "write_progress", side_effect=progress):
            worker.shop("cart-weight", [row("one")], fixture, Path(tmp))
            receipt = log[-1]["product"]
            self.assertEqual(receipt, {"product_id":"44","name":"Sliced turkey","quantity":1,"size":"sold by weight"})
            self.assertEqual(fixture.changes[0]["quick_add_search_queries"], [{"query":"Turkey","quantity":1}])
            self.assertNotIn("package",log[-1]["reason"])
            before = weighted("44","Sliced turkey",Decimal("0.3"))
            after = weighted("44","Sliced turkey",Decimal("1.3"))
            worker.shop("cart-fraction", [row("two")], Fixture([before],[after]), Path(tmp), weighted=True)
            self.assertEqual(log[-2]["observed_cart"][0]["quantity"], 0.3)
            self.assertEqual(log[-1]["product"], {"product_id":"44","name":"Sliced turkey","quantity":1,"quantity_type":"weight"})
            self.assertEqual(worker.load_private(Path(tmp)/"cart-fraction.dpapi")["before"]["44"]["quantity"],"0.3")
            guessed = {**expected,"quantity_type":"other"}
            missing = read_cart({"retailer":{"name":"Wegmans"},"cart":{"items":[guessed]}},"Wegmans")["44"]
            self.assertEqual(worker.queue_line(missing,False)["size"],"size not provided")
            guessed["quantity_type"] = "each"
            each = read_cart({"retailer":{"name":"Wegmans"},"cart":{"items":[guessed]}},"Wegmans")["44"]
            self.assertEqual(worker.queue_line(each,False)["size"],"each")
            for bad in [0, -0.5, True, "nan", "Infinity"]:
                with self.assertRaises(ProviderError):
                    read_cart({"retailer":{"name":"Wegmans"},"cart":{"items":[{**expected,"quantity":bad}]}},"Wegmans")

    def test_recover_saved_weighted_reply_only_for_original_claim(self):
        request = row("one")
        claim = {"attempt_id":"old","run_id":"cart-proof","retailer":"Wegmans","revision":1,
                 "requires_reconciliation":True,"lease_expires_at":"2000-01-01T00:00:00Z",
                 "intent":{"quick_add":{"query":"Turkey","quantity":1}}}
        request.update(current_status="needs_attention", attempts=[claim])
        store = "Wegmans"
        group = {"product_id":None,"query":"Turkey","count":1,"rows":[{"id":"one","revision":1,"count":1}]}
        raw = {"structuredContent":{"tool":"cart","artifacts":{"retailer":{"name":store},"cart":{"items":[
            {"product_id":"44","name":"Test poultry","quantity":1.0,"quantity_type":"weight"}]}}}}
        journal = {"run":"cart-proof","store":store,"before":{},"groups":{"query:turkey":group},"raw":raw,
                   "reply_at":"2026-11-22T15:00:00Z","completed":["one"]}
        snapshots = []
        def snapshot(action, run):
            self.assertEqual(action,"List")
            snapshots.append(run)
            return {"ok":True,"run_id":run,"weighted_observations":True,"requests":[request]}
        with tempfile.TemporaryDirectory() as tmp, patch.object(recovery, "helper", side_effect=snapshot), patch.object(
                recovery,"write_progress",return_value={"ok":True}) as complete:
            path = Path(tmp)
            worker.save_private(path/"cart-proof.dpapi",journal)
            claim["retailer"] = "Other"
            self.assertEqual(recovery.reconcile("cart-proof",path)["skipped"],1)
            claim["retailer"] = store
            with patch.object(recovery.time,"time",return_value=0):
                self.assertGreater(recovery.reconcile("cart-proof",path)["retry_after_seconds"],0)
            self.assertFalse(complete.called)
            self.assertEqual(recovery.reconcile("cart-proof",path)["recorded"],1)
            evidence = complete.call_args.kwargs
            self.assertEqual(evidence["recovery_attempt_id"],"old")
            self.assertEqual(evidence["observed_at"],journal["reply_at"])
            self.assertEqual(evidence["product"]["quantity"],1)
            request["attempts"] = [{"run_id":snapshots[-1],"retailer":store,"outcome":"already_in_cart",
                                    "evidence":{"product":evidence["product"],"recovery_attempt_id":"old"}}]
            self.assertEqual(recovery.reconcile("cart-proof",path)["already_recorded"],1)
            complete.assert_called_once()
            self.assertEqual(len(set(snapshots)),1)

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
