// =========================================================================
// 1. XÓA BẢN GHI ACTIVITY HISTORY (activityHTKTpayment)
// =========================================================================
var activityNumber = String(record["id.activity.vj"] || "").trim();

if (activityNumber) {
    var activity = null;
    try {
        activity = new SCFile("activityHTKTprepayment");
        var rcAct = activity.doSelect('number="' + activityNumber + '"');

        while (rcAct === RC_SUCCESS) {
            var deleteRc = activity.doDelete();
            if (deleteRc !== RC_SUCCESS) {
                print("ERROR: Cannot delete Activity. RC = " + deleteRc);
            }
            rcAct = activity.getNext();
        }
    } catch (eAct) {
        print("ERROR: Exception when deleting activityHTKTprepayment: " + eAct);
    } finally {
        try { if (activity) activity.doClose(); } catch (ignore) {}
    }
}

// =========================================================================
// 2. XÓA NHÀ CUNG CẤP THANH TOÁN (esdHTKTprepaymentVendor)
// =========================================================================
var prepayment = String(record["prepayment.id"] || record["id"] || "").trim();

if (prepayment) {
    var pVendor = null;
    try {
        pVendor = new SCFile("esdHTKTprepaymentVendor");
        var rcVendor = pVendor.doSelect('prepayment.id="' + prepayment + '"');

        while (rcVendor === RC_SUCCESS) {
            var delVendorRc = pVendor.doDelete();
            if (delVendorRc !== RC_SUCCESS) {
                print("ERROR: Cannot delete paymentVendor. RC = " + delVendorRc);
            }
            rcVendor = pVendor.getNext();
        }
    } catch (eVendor) {
        print("ERROR: Exception when deleting esdHTKTprepaymentVendor: " + eVendor);
    } finally {
        try { if (pVendor) pVendor.doClose(); } catch (ignore) {}
    }

    // =========================================================================
    // 3. XÓA KẾT QUẢ HẠCH TOÁN THANH TOÁN (esdHTKTaccountingInformation)
    // =========================================================================
    var accInfo = null;
    try {
        accInfo = new SCFile("esdHTKTaccountingInformation");
        var rcAcc = accInfo.doSelect('prepayment.id="' + prepayment + '"');

        while (rcAcc === RC_SUCCESS) {
            var delAccRc = accInfo.doDelete();
            if (delAccRc !== RC_SUCCESS) {
                print("ERROR: Cannot delete accountingInformation. RC = " + delAccRc);
            }
            rcAcc = accInfo.getNext();
        }
    } catch (eAcc) {
        print("ERROR: Exception when deleting esdHTKTaccountingInformation: " + eAcc);
    } finally {
        try { if (accInfo) accInfo.doClose(); } catch (ignore) {}
    }
    
    var pAttach = null;
    try {
        pAttach = new SCFile("esdHTKTprepaymentAttachment");
        var rcAttach = pAttach.doSelect('prepayment.id="' + prepayment + '"');
        while (rcAttach === RC_SUCCESS) {
            var delAttachRc = pAttach.doDelete();
            if (delAttachRc !== RC_SUCCESS) {
                print("ERROR: Cannot delete prepaymentAttachment. RC = " + delAttachRc);
            }
            rcAttach = pAttach.getNext();
        }
    } catch (eAttach) {
        print("ERROR: Exception when deleting esdHTKTpaymentAttachment: " + eAttach);
    } finally {
        try { if (pAttach) pAttach.doClose(); } catch (ignore) {}
    }
}