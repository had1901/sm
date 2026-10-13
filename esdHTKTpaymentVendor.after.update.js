// Trigger: esdHTKTpaymentVendor.after.update
// Table: esdHTKTpaymentVendor | Type: 4 - After Update
var paymentId = String(record["payment.id"] || "").trim();

if (paymentId.substring(0, 2).toUpperCase() === "DC") {
    lib.ESD_HTKT_EXPENSE_VENDOR.syncExpenseTotalAmount(paymentId);
    lib.ESD_HTKT_EXPENSE_ENTRY.handleUpdatePaymentVendorAndAccountingSync(record);
} else if (paymentId.substring(0, 2).toUpperCase() === "TT") {
    lib.ESD_HTKT_PAYMENT_ENTRY.handleUpdatePaymentVendorAndAccountingSync(record);
}
