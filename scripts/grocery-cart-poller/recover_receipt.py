"""Record a previously saved successful cart reply on Home Console, with no shopping tools."""
import argparse
import json
import re
import time
import uuid

from grocery_worker import ROOT, helper, load_private, queue_line, until, verified_reply, write_progress


def matches_intent(claim, group, count):
    intent = claim.get("intent") or {}
    if group["product_id"] is None:
        return intent.get("quick_add") == {"query": group["query"], "quantity": count}
    selected = intent.get("product") or {}
    return selected.get("product_id") == group["product_id"] and selected.get("quantity") == count


def previously_recorded(attempt, manual, store, product):
    evidence = attempt.get("evidence") or {}
    prior = evidence.get("product") or {}
    return (attempt.get("run_id") == manual and attempt.get("retailer") == store and
            attempt.get("outcome") == "already_in_cart" and bool(evidence.get("recovery_attempt_id")) and
            all(prior.get(key) == product[key] for key in ("product_id", "name", "quantity")))


def reconcile(original_run, directory):
    if not re.fullmatch(r"cart-[A-Za-z0-9_-]{1,64}", original_run):
        raise ValueError("Expected an original cart run ID.")
    journal = load_private(directory / (original_run + ".dpapi"))
    if journal.get("run") != original_run:
        raise ValueError("Saved receipt belongs to another run.")
    verified = verified_reply(journal)
    result = {"recorded": 0, "already_recorded": 0, "skipped": 0, "retry_after_seconds": 0}
    if not verified:
        result["skipped"] = sum(len(g["rows"]) for g in journal["groups"].values())
        return result

    manual = "manual-receipt-" + uuid.uuid5(uuid.NAMESPACE_OID, original_run).hex
    snapshot = helper("List", manual)
    if not snapshot.get("ok") or snapshot.get("run_id") != manual or not isinstance(snapshot.get("requests"), list):
        raise RuntimeError("Home Console could not confirm the recovery snapshot.")
    weighted = snapshot.get("weighted_observations") is True
    for key, group in journal["groups"].items():
        for row in group["rows"]:
            same = [r for r in snapshot["requests"] if r.get("id") == row["id"] and
                    r.get("revision") == r.get("current_revision") == row["revision"] and not r.get("stale")]
            if key not in verified or len(same) != 1:
                result["skipped"] += 1
                continue
            request = same[0]
            evidence = queue_line(verified[key], weighted, row["count"])
            attempts = request.get("attempts", [])
            if any(previously_recorded(a, manual, journal["store"], evidence) for a in attempts):
                result["already_recorded"] += 1
                continue
            claims = [a for a in attempts if a.get("requires_reconciliation")]
            if len(claims) != 1 or request.get("current_status") not in ("needed", "needs_attention"):
                result["skipped"] += 1
                continue
            claim = claims[0]
            if (not matches_intent(claim, group, row["count"]) or claim.get("run_id") != original_run or claim.get("retailer") != journal["store"]
                    or claim.get("revision") != row["revision"] or not claim.get("attempt_id") or not claim.get("lease_expires_at")):
                result["skipped"] += 1
                continue
            wait = until(claim["lease_expires_at"]) - time.time()
            if wait > 0:
                result["retry_after_seconds"] = max(result["retry_after_seconds"], int(wait) + 1)
                continue
            reply = write_progress(manual, row, journal["store"], "complete", outcome="already_in_cart",
                                   recovery_attempt_id=claim["attempt_id"], product=evidence,
                                   observed_at=journal["reply_at"], reason="Verified against the original saved Instacart cart change.")
            if not reply.get("ok"):
                raise RuntimeError("Home Console did not acknowledge the saved receipt. Repeat the same recovery command.")
            result["recorded"] += 1
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run_id")
    result = reconcile(parser.parse_args().run_id, ROOT / "receipts")
    print(json.dumps(result))
