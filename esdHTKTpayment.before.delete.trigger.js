// =========================================================================
// 1. XÓA BẢN GHI ACTIVITY HISTORY (activityHTKTpayment)
// =========================================================================
var activityNumber = String(record["id.activity.vj"] || "").trim();

if (activityNumber) {
    var activity = null;
    try {
        activity = new SCFile("activityHTKTpayment");
        var rcAct = activity.doSelect('number="' + activityNumber + '"');

        while (rcAct === RC_SUCCESS) {
            var deleteRc = activity.doDelete();
            if (deleteRc !== RC_SUCCESS) {
                print("ERROR: Cannot delete Activity. RC = " + deleteRc);
            }
            rcAct = activity.getNext();
        }
    } catch (eAct) {
        print("ERROR: Exception when deleting activityHTKTpayment: " + eAct);
    } finally {
        try { if (activity) activity.doClose(); } catch (ignore) {}
    }
}

// =========================================================================
// 2. XÓA NHÀ CUNG CẤP THANH TOÁN (esdHTKTpaymentVendor)
// =========================================================================
var paymentId = String(record["payment.id"] || record["id"] || "").trim();

if (paymentId) {
    var pVendor = null;
    try {
        pVendor = new SCFile("esdHTKTpaymentVendor");
        var rcVendor = pVendor.doSelect('payment.id="' + paymentId + '"');

        while (rcVendor === RC_SUCCESS) {
            var delVendorRc = pVendor.doDelete();
            if (delVendorRc !== RC_SUCCESS) {
                print("ERROR: Cannot delete paymentVendor. RC = " + delVendorRc);
            }
            rcVendor = pVendor.getNext();
        }
    } catch (eVendor) {
        print("ERROR: Exception when deleting esdHTKTpaymentVendor: " + eVendor);
    } finally {
        try { if (pVendor) pVendor.doClose(); } catch (ignore) {}
    }

    // =========================================================================
    // 3. XÓA KẾT QUẢ HẠCH TOÁN THANH TOÁN (esdHTKTaccountingInformation)
    // =========================================================================
    var accInfo = null;
    try {
        accInfo = new SCFile("esdHTKTaccountingInformation");
        var rcAcc = accInfo.doSelect('prepayment.id="' + paymentId + '"');

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
    
    // =========================================================================
    // 4. XÓA TÀI LIỆU / FILE ĐÍNH KÈM (esdHTKTpaymentAttachment)
    // =========================================================================
    var pAttach = null;
    try {
        pAttach = new SCFile("esdHTKTpaymentAttachment");
        var rcAttach = pAttach.doSelect('payment.id="' + paymentId + '"');
        while (rcAttach === RC_SUCCESS) {
            var delAttachRc = pAttach.doDelete();
            if (delAttachRc !== RC_SUCCESS) {
                print("ERROR: Cannot delete paymentAttachment. RC = " + delAttachRc);
            }
            rcAttach = pAttach.getNext();
        }
    } catch (eAttach) {
        print("ERROR: Exception when deleting esdHTKTpaymentAttachment: " + eAttach);
    } finally {
        try { if (pAttach) pAttach.doClose(); } catch (ignore) {}
    }
}