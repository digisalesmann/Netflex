-- Financial truth over convenience: if a customer is charged twice for one order
-- (two tabs, retries), BOTH charges must be recordable as SUCCEEDED. The old
-- one-success-per-order index would have forced the second real charge to be
-- recorded as something it wasn't. Single fulfilment is still guaranteed by the
-- unique subscriptions.orderId; the duplicate becomes a reconciliation discrepancy.
DROP INDEX "payments_one_success_per_order";
