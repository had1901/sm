/**
 * 1. HÀM MAPPER: Convert SCFile Record sang Object Payload chuẩn
 */
function mapPrepaymentToPayload(rec, extraData) {
    if (!rec) {
        print("[PREPAYMENT_LOG] mapPrepaymentToPayload: rec is null/empty.");
        return null;
    }

    print("[PREPAYMENT_LOG] mapPrepaymentToPayload: Processing record ID = " + rec["id"]);

    var payload = {
        "id": rec["id"] || "",
        "transaction.type": rec["transaction.type"] || "",
        "created.at": rec["created.at"],
        "completed.date": rec["completed.date"],
        
        "contract.id": rec["contract.id"] || "",
        "currency": rec["currency"] || "",

//        "amount": rec["amount"],
        "total.amount.paid": rec["total.amount.paid"],
        "total.refund.amount": rec["total.refund.amount"],

        "unit.lv1": rec["unit.lv1"] || "",
        "unit.lv2": rec["unit.lv2"] || "",

        "created.by": rec["created.by"] || "",
        "description": rec["description"] || "",
        "status": rec["status"] || ""
    };

    if (extraData) {
//        print("[PREPAYMENT_LOG] mapPrepaymentToPayload: Received extraData = " + JSON.stringify(extraData));
        
        if (extraData.totalVendorAmount !== undefined) {
            payload["amount"] = extraData.totalVendorAmount;
        }

        if (extraData.supplierDetails !== undefined) {
            var supplierObject = {
                "suppliers": extraData.supplierDetails
            };
            payload["supplier"] = JSON.stringify(supplierObject); 
        }

    } else {
        print("[PREPAYMENT_LOG] mapPrepaymentToPayload: No extraData provided.");
    }
    
    print("[PREPAYMENT_LOG] mapPrepaymentToPayload: Final Payload = " + JSON.stringify(payload));
    return payload;
}

/**
 * 2. HÀM TÍNH TOÁN: Query bảng esdHTKTprepaymentVendor
 */
function calculateTotalVendorAmount(prepaymentId) {
    var result = {
        totalAmount: "0",
        supplierDetails: [] 
    };

    if (!prepaymentId) {
        print("[PREPAYMENT_LOG] calculateTotalVendorAmount: Missing prepaymentId.");
        return result;
    }

    print("[PREPAYMENT_LOG] calculateTotalVendorAmount: Starting calculation for Prepayment ID = " + prepaymentId);

    var safeId = String(prepaymentId).replace(/"/g, '\\"');
    var sql = 'prepayment.id="' + safeId + '"';

    var invoice = new SCFile("esdHTKTprepaymentInvoice", SCFILE_READONLY);
    invoice.setFields(["prepayment.id"]);
    var selectResult = invoice.doSelect(sql);

    var prepVendor = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
    prepVendor.setFields(["amount", "vendor.id"]);
    
    var selectResultVendor = prepVendor.doSelect(sql);

    if (selectResultVendor === RC_SUCCESS) {
        var masterVendor = new SCFile("esdHTKTvendor", SCFILE_READONLY);
        masterVendor.setFields(["id", "supplier.id"]);

        var totalSum = "0";
        var arrDetails = []; 

        do {
            var vId = prepVendor["vendor.id"];

            if (vId) {
                var safeVendorId = String(vId).replace(/"/g, '\\"');
                var vendorSql = 'id="' + safeVendorId + '"';

                if (masterVendor.doSelect(vendorSql) === RC_SUCCESS) {
                    var supId = masterVendor["supplier.id"] || "";
                    var amtString = prepVendor["amount"] ? String(prepVendor["amount"]).trim() : "0";
                    
                    var amtNumber = Number(amtString) || 0;

                    if (supId) {
                        arrDetails.push({
                            "supplier": supId,
                            "amount": amtNumber
                        });
                        print("[PREPAYMENT_LOG] calculateTotalVendorAmount: Found Supplier = " + supId + ", Amount = " + amtNumber);
                    }
                    
                    totalSum = lib.ESD_HTKT_Utils.addStringsManual(totalSum, amtString);
                }
            }
        } while (prepVendor.getNext() === RC_SUCCESS);

        result.supplierDetails = arrDetails;
        result.totalAmount = totalSum;
    } else {
        print("[PREPAYMENT_LOG] calculateTotalVendorAmount: No vendors found in esdHTKTprepaymentVendor for this ID.");
    }

    print("[PREPAYMENT_LOG] calculateTotalVendorAmount: Final Result = " + JSON.stringify(result));
    return result; 
}

/**
 * 3. HÀM ĐIỀU PHỐI: Cập nhật Contract Payment
 */

function handlePhaseChangeUpdate(rec, oldRec) {
    if (!rec) return;

    var phase = rec["current.phase"] || "";
    var old = (oldRec && oldRec["current.phase"]) ? oldRec["current.phase"] : "";
    var status = rec["status"] || "";
    var currentStatus = rec["current.status"] || "";

//    print("[PREPAYMENT_LOG] handlePhaseChangeUpdate: Checking Phase/Status. Phase = '" + phase + "', OldPhase = '" + old + "', Status = '" + status + "'");

    var vendorData = calculateTotalVendorAmount(rec["id"]) || { totalAmount: "0", supplierDetails: [] };
    
    var payload = mapPrepaymentToPayload(rec, {
        totalVendorAmount: vendorData.totalAmount,
        supplierDetails: vendorData.supplierDetails
    });
    
    // Kịch bản Phase = "end"
    if (phase === "end" && status === "cancelled") {
        print("[PREPAYMENT_LOG] handlePhaseChangeUpdate: Condition met for DELETE Contract Payment.");
        try {
            lib.ESD_HD_Integration.deleteContractPayment(rec);
            print("[PREPAYMENT_LOG] handlePhaseChangeUpdate: DELETE success.");
        } catch (ex) { 
            print("[PREPAYMENT_LOG] handlePhaseChangeUpdate: Exception during DELETE: " + ex);
        }
        return;
    }

    // Kịch bản Update
    if (phase !== old || status === "accounted") {
        print("[PREPAYMENT_LOG] handlePhaseChangeUpdate: Condition met for UPDATE Contract Payment.");
        try {
            lib.ESD_HD_Integration.updateContractPayment(payload);
//            print("[PREPAYMENT_LOG] handlePhaseChangeUpdate: UPDATE success.");
        } catch (ex) { 
//            print("[PREPAYMENT_LOG] handlePhaseChangeUpdate: Exception during UPDATE: " + ex);
        }
    } else {
//        print("[PREPAYMENT_LOG] handlePhaseChangeUpdate: No update/delete action triggered. Conditions not met.");
    }
}

// =========================================================================

//print("[PREPAYMENT_LOG] === SCRIPT START - Record ID: " + record["id"] + " ===");

// 1. Cập nhật Contract Payment khi có sự thay đổi Phase
handlePhaseChangeUpdate(record, oldrecord);

// 2. Đồng bộ Prepayment Entry
//print("[PREPAYMENT_LOG] Syncing Prepayment Entry...");
system.library.ESD_HTKT_PREPAYMENT_ENTRY.syncPrepaymentEntryBySourceChange("esdHTKTprepayment", record);

// 3. Sinh accountingInformation
if (record["status"] != "cancelled" && record["current.phase"] == "end" && oldrecord["current.phase"] != "end") {
//    print("[PREPAYMENT_LOG] Accounting condition met. Generating Accounting Information...");
    var accountingResult = system.library.ESD_HTKT_ACCOUNTING_INFORMATION.generateAccountingInformationByPrepaymentId(record["id"]);
//    print("[PREPAYMENT_LOG] Accounting Result: " + JSON.stringify(accountingResult));
    
    // 4. Gọi hạch toán 
//    print("[PREPAYMENT_LOG] Calling processAccounting...");
    system.library.ESD_HTKT_ACCOUNTING_UTILS.processAccounting(record);
} else {
//    print("[PREPAYMENT_LOG] Skipping Accounting Generation (Conditions not met).");
}

// 5. Đồng bộ báo cáo công nợ NCC
if (record["status"] == "approved" &&
    (!oldrecord || oldrecord["status"] != "approved")) {
//    print("[PREPAYMENT_LOG] Triggering Vendor Debt Report Sync...");
    try {
        lib.ESD_HTKT_REPORT_VENDOR_DEBT.syncVendorDebtReportForHTKT(record["id"], "PREPAYMENT");
//        print("[PREPAYMENT_LOG] syncVendorDebtReportForHTKT executed successfully.");
    } catch (eDebt) {
//        print("[ERROR] syncVendorDebtReportForHTKT failed for Prepayment ID: " + record["id"] + " | Exception: " + eDebt);
    }
} else {
//    print("[PREPAYMENT_LOG] Skipping Vendor Debt Report Sync (Status is not newly accounted).");
}

// 6. Đồng bộ số liệu Dashboard Quản trị Tài chính
try {
    print("[PREPAYMENT_LOG] run Dashboard");
    lib.ESD_HTKT_DASHBOARD_SET_DATA.setDataDashboard(record, oldrecord, "esdHTKTprepayment");
} catch (eDashboard) {
//    print("[ERROR] Dashboard sync failed for Prepayment ID: " + record["id"] + " | Exception: " + eDashboard);
}
//
//print("[PREPAYMENT_LOG] === SCRIPT END ===");
//print("=========================================================================");