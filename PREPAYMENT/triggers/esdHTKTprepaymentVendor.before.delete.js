//lib.ESD_Utils.printMsg("trigger Deleted ");

/**
 * After-delete trigger của esdHTKTprepaymentVendor.
 *
 * Khi một NCC bị xóa khỏi đề nghị tạm ứng:
 * 1. Dọn dẹp các dữ liệu chi tiết tham chiếu đến cặp prepayment.id + vendor.id
 * 2. Cập nhật lại TỔNG SỐ TIỀN của phiếu tạm ứng (esdHTKTprepayment)
 * 3. Kích hoạt đồng bộ / sinh lại bút toán tạm ứng (esdHTKTprepaymentEntry)
 */
function handleRemoveVendorPrepaymentData(rec) {
    if (!rec) return;

    var prepaymentId = rec["prepayment.id"];
    var vendorId = rec["vendor.id"]; 

    if (!prepaymentId) {
        return;
    }

    // =========================================================================
    // 1. XÓA BẢN GHI TRONG esdHTKTprepaymentInvoice 
    // (Vì bảng này không có vendor.id nên phải join ngầm qua mã số thuế)
    // =========================================================================
    if (vendorId) {
        var taxId = "";
        var vFile = new SCFile("esdHTKTvendor", SCFILE_READONLY);
        if (vFile.doSelect('id="' + vendorId + '"') === RC_SUCCESS) {
            taxId = vFile["vendor.number"];
        }

        if (taxId) {
            var prepInvFile = new SCFile("esdHTKTprepaymentInvoice");
            var prepInvQuery = 'prepayment.id="' + prepaymentId + '"';
            
            var idsToDelete = []; 
            var invoiceIdsToFree = [];

            if (prepInvFile.doSelect(prepInvQuery) === RC_SUCCESS) {
                do {
                    var invoiceId = prepInvFile["invoice.id"];
                    var prepInvId = prepInvFile["id"]; 
                    
                    if (invoiceId) {
                        var invFile = new SCFile("esdHTKTinvoice", SCFILE_READONLY);
                        if (invFile.doSelect('id="' + invoiceId + '"') === RC_SUCCESS) {
                            var invoiceTaxId = invFile["seller.tax.code"];
                            if (invoiceTaxId === taxId) {
                                idsToDelete.push(prepInvId);
                                invoiceIdsToFree.push(invoiceId);
                            }
                        }
                        try { invFile.doClose(); } catch (e) {}
                    }
                } while (prepInvFile.getNext() === RC_SUCCESS);
            }
            
            // Xóa bảng trung gian
            for (var k = 0; k < idsToDelete.length; k++) {
                var delPrepInv = new SCFile("esdHTKTprepaymentInvoice");
                if (delPrepInv.doSelect('id="' + idsToDelete[k] + '"') == RC_SUCCESS) {
                    delPrepInv.doDelete();
                }
            }
            
            // Giải phóng hóa đơn (set request.id = null)
            for (var m = 0; m < invoiceIdsToFree.length; m++) {
                var updateInv = new SCFile("esdHTKTinvoice");
                if (updateInv.doSelect('id="' + invoiceIdsToFree[m] + '"') == RC_SUCCESS) {
                    updateInv["request.id"] = null; 
                    updateInv.doUpdate();
                }
            }
        }
    }

    // =========================================================================
    // 2. TÍNH TOÁN VÀ CẬP NHẬT LẠI TỔNG TIỀN TẠM ỨNG
    // =========================================================================
    updateTotalPrepaymentAmount(prepaymentId);

    // =========================================================================
    // 3. ĐỒNG BỘ LẠI BÚT TOÁN SAU KHI XÓA NCC
    // =========================================================================
    try {
        if (system.library.ESD_HTKT_PREPAYMENT_ENTRY && 
            typeof system.library.ESD_HTKT_PREPAYMENT_ENTRY.syncPrepaymentEntryBySourceChange === "function") {
            
            system.library.ESD_HTKT_PREPAYMENT_ENTRY.syncPrepaymentEntryBySourceChange(
                "esdHTKTprepaymentVendor",
                rec
            );
        }
    } catch (errSync) {
        try {
            if (typeof lib !== "undefined" && lib.ESD_Utils && typeof lib.ESD_Utils.printMsg === "function") {
                lib.ESD_Utils.printMsg("[PREPAYMENT-VENDOR-AFTER-DELETE][SYNC-ERROR] " + errSync);
            }
        } catch (ignore) {}
    }
}

/**
 * Tính tổng amount của các nhà cung cấp còn lại
 * và cập nhật vào esdHTKTprepayment.amount.
 */
function updateTotalPrepaymentAmount(prepaymentId) {
    if (!prepaymentId) return false;

    var totalAmount = 0;
    var vendorFile = null;
    var prepayFile = null;

    // BƯỚC 1: Tính tổng amount của các NCC còn lại
    try {
        vendorFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
        var vendorQuery = 'prepayment.id="' + prepaymentId + '"';
        var rcVendor = vendorFile.doSelect(vendorQuery);

        while (rcVendor === RC_SUCCESS) {
            var rawAmount = vendorFile["amount"];
            var amount = 0;

            if (rawAmount !== null && rawAmount !== undefined && rawAmount !== "") {
                var cleanAmount = String(rawAmount).replace(/,/g, "").trim();
                amount = parseFloat(cleanAmount);

                if (isNaN(amount)) {
                    amount = 0;
                }
            }

            totalAmount += amount;
            rcVendor = vendorFile.getNext();
        }
    } catch (ex) {
        return false;
    } finally {
        try {
            if (vendorFile) vendorFile.doClose();
        } catch (ignore) {}
    }

    // BƯỚC 2: Cập nhật tổng tiền vào phiếu tạm ứng (Set NULL nếu bằng 0)
    try {
        prepayFile = new SCFile("esdHTKTprepayment");
        var prepayQuery = 'id="' + prepaymentId + '"';
        var rcPrepay = prepayFile.doSelect(prepayQuery);

        if (rcPrepay === RC_SUCCESS) {
            if (totalAmount === 0) {
                prepayFile["amount"] = null; // Trả về null nếu không còn tiền
            } else {
                prepayFile["amount"] = totalAmount.toString();
            }
            prepayFile.doUpdate();
            return true;
        }
        return false;
    } catch (ex) {
        return false;
    } finally {
        try {
            if (prepayFile) prepayFile.doClose();
        } catch (ignore) {}
    }
}

// ================= ENTRY POINT =================
try {
    var targetRecord = (typeof oldrecord !== "undefined" && oldrecord) ? oldrecord : (typeof record !== "undefined" ? record : null);

    if (targetRecord) {
        // In log debug nếu cần
        try {
            if (typeof lib !== "undefined" && lib.ESD_Utils && typeof lib.ESD_Utils.printMsg === "function") {
                lib.ESD_Utils.printMsg("Trigger After Delete esdHTKTprepaymentVendor: " + targetRecord["prepayment.id"] + " | Vendor: " + targetRecord["vendor.id"]);
            }
        } catch (ignore) {}

        // Thực thi dọn dẹp và đồng bộ lại bút toán
        handleRemoveVendorPrepaymentData(targetRecord);
    }
} catch (e) {
    try {
        if (typeof lib !== "undefined" && lib.ESD_Utils && typeof lib.ESD_Utils.printMsg === "function") {
            lib.ESD_Utils.printMsg("[PREPAYMENT-VENDOR-AFTER-DELETE][ERROR] " + e);
        }
    } catch (ignore) {}
}