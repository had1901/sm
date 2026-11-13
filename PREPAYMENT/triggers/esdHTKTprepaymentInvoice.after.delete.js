try {
    if (record && record["invoice.id"]) {
        lib.ESD_HTKT_PREPAYMENT_VENDOR.resetInvoiceRequestId(record["invoice.id"]);
    }
} catch (e) {
    try {
        // print("[TRIGGER-esdHTKTpaymentInvoice.after.delete][ERROR] " + e);
    } catch (ignore) {}
}
system.library.ESD_HTKT_PREPAYMENT_ENTRY
    .syncPrepaymentEntryBySourceChange(
        "esdHTKTprepaymentInvoice",
        record
    );