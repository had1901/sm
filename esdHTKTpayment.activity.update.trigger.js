/**
 * 1. HÀM MAPPER: Convert SCFile Record sang Object Payload chuẩn
 */
function mapPaymentToPayload(rec, extraData) {
    if (!rec) {
        return null;
    }

    var payload = {
        "id": rec["id"] || "",
        "transaction.type": rec["transaction.type"] || "",
        "created.at": rec["created.at"],
        "completed.date": rec["completed.date"],
        
        // Bổ sung các trường giống bên Tạm ứng
        "contract.id": rec["contract.id"] || "",
        "currency": rec["currency"] || "",
        "amount": rec["amount"],
        
        "unit.lv1": rec["unit.lv1"] || "",
        "unit.lv2": rec["unit.lv2"] || "",

        "created.by": rec["created.by"] || "",
        "description": rec["description"] || "",
        "status": rec["status"] || ""
    };

    if (extraData) {        
        payload["total.amount.paid"] = extraData.paidAmount;
        payload["approved.invoice.amount"] = extraData.approvedInvoiceAmount;
        payload["total.refund.amount"] = extraData.refundAmount;
        
        // Đã sửa lại thành gán Object trực tiếp (BỎ JSON.stringify) để giống bên Tạm ứng
        if (extraData.supplierDetails !== undefined) {
            payload["supplier"] = {
                "suppliers": extraData.supplierDetails
            };
        }
    } else {
//        print("[PAYMENT_LOG] mapPaymentToPayload: No extraData provided.");
    }
    return payload;
}

/**
 * 3. HÀM ĐIỀU PHỐI: Cập nhật Contract Payment
 */
function handlePhaseChangeUpdate(rec, oldRec) {
    if (!rec) return;
    
    var phase = rec["current.phase"] || "";
    var old = (oldRec && oldRec["current.phase"]) ? oldRec["current.phase"] : "";
    var status = rec["status"] || "";
    
    var totals = lib.ESD_HTKT_PAYMENT_VENDOR.getPaymentVendorList(rec["id"]) || {};
        
    var payload = mapPaymentToPayload(rec, {
        approvedInvoiceAmount: totals.approvedInvoiceAmount,
        paidAmount: totals.paidAmount,
        refundAmount: totals.refundAmount,
        supplierDetails: totals.supplierDetails 
    });
                
    if (phase === "end" && status === "cancelled") {
        try {
            lib.ESD_HD_Integration.deleteContractPayment(rec);
        } catch(ex) { 
//            print("[ERROR] [PAYMENT_LOG] Exception during DELETE: " + ex);
        }
        return; 
    }
    
    if (phase !== old || status === "accounted") {
        try {
            lib.ESD_HD_Integration.updateContractPayment(payload);
        } catch(ex) { 
//            print("[ERROR] [PAYMENT_LOG] Exception during UPDATE: " + ex);
        }
    } else {
//        print("[PAYMENT_LOG] handlePhaseChangeUpdate: No update/delete action triggered. Conditions not met.");
    }
}


// =========================================================================

var transactionType = record ? record["transaction.type"] : "";
var isPayment = transactionType == "Thanh toán";
var isExpense = transactionType == "Dự chi";

// 1. Chỉ Thanh toán mới cập nhật Contract Payment khi thay đổi phase.
if (isPayment) {
    handlePhaseChangeUpdate(record, oldrecord);
} else {
//    print("[PAYMENT_LOG] Step 1: Skipped handlePhaseChangeUpdate (Not a Payment).");
}

// 2. Sinh accountingInformation theo đúng SL của từng loại giao dịch.
// 3. Gọi hạch toán dùng chung cho cả Thanh toán và Dự chi.
if (
    (isPayment || isExpense) &&
    record["status"] == "approved" &&
    record["current.phase"] == "end" &&
    (!oldrecord || oldrecord["current.phase"] != "end")
) {
    var accountingResult;
    if (isPayment) {
        accountingResult = system.library.ESD_HTKT_PAYMENT_ACCOUNTING_INFORMATION.generatePaymentAccountingInformation(record["id"], false);
    } else {
        accountingResult = system.library.ESD_HTKT_EXPENSE_ACCOUNTING_INFORMATION.generatePaymentAccountingInformation(record["id"]);
    }

    system.library.ESD_HTKT_ACCOUNTING_UTILS.processAccounting(record);
} else {
//    print("[PAYMENT_LOG] Skipping Accounting Generation (Conditions not met).");
}

// 4. Chỉ Thanh toán mới đồng bộ báo cáo công nợ NCC.
if (isPayment && ((record["status"] == "approved" && (!oldrecord || oldrecord["status"] != "approved")))) {
    try {
        lib.ESD_HTKT_REPORT_VENDOR_DEBT.syncVendorDebtReportForHTKT(record["id"], "PAYMENT");
    } catch (eDebt) {
//        print("[ERROR] syncVendorDebtReportForHTKT failed for Payment ID: " + record["id"] + " | Exception: " + eDebt);
    }
} else {
//    print("[PAYMENT_LOG] Skipping Vendor Debt Report Sync.");
}
