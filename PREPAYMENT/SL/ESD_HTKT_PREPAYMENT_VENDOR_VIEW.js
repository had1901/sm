function renderTabInvoice(endpoint, input, extraData) {
    var currentRecord = extraData;

    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
        if (vars.$L_file) {
            var prepaymentId = vars.$L_file["prepayment.id"];
            var currentPhase = vars.$L_file["current.phase"];
            var initialRole = vars.$L_file["initial.role"];
            var userCheckerKttc = vars.$L_file["user.checker.kttc"];
            var userCheckerDmms = vars.$L_file["use.checker.dmms"];
            //
            var userApproverKttc = vars.$L_file["user.approver.kttc"];
            var userApproverDmms = vars.$L_file["user.approver.dmms"];
            var userCheckerFinal = vars.$L_file["user.checker.final"];
            var userApproverFinal = vars.$L_file["user.approver.final"];
            var createdBy = vars.$L_file["created.by"];
            
            var status = vars.$L_file["status"];

            if ((!currentPhase || !initialRole) && prepaymentId) {
                var prepFile = new SCFile("esdHTKTprepayment");
                var sqlPrep = "id=\"" + prepaymentId + "\"";
                var rcPrep = prepFile.doSelect(sqlPrep);

                if (rcPrep == RC_SUCCESS) {
                    if (!currentPhase && prepFile["current.phase"]) {
                        currentPhase = prepFile["current.phase"];
                    }
                    if (!initialRole && prepFile["initial.role"]) {
                        initialRole = prepFile["initial.role"];
                    }
                    if (!userCheckerKttc && prepFile["user.checker.kttc"]) {
                        userCheckerKttc = prepFile["user.checker.kttc"];
                    }
                    if (!userCheckerDmms && prepFile["use.checker.dmms"]) {
                        userCheckerDmms = prepFile["use.checker.dmms"];
                    }
                    //
                    if (!userApproverKttc && prepFile["user.approver.kttc"]) {
                        userApproverKttc = prepFile["user.approver.kttc"];
                    }
                    if (!userApproverDmms && prepFile["user.approver.dmms"]) {
                        userApproverDmms = prepFile["user.approver.dmms"];
                    }
                    if (!userCheckerFinal && prepFile["user.checker.final"]) {
                        userCheckerFinal = prepFile["user.checker.final"];
                    }
                    if (!userApproverFinal && prepFile["user.approver.final"]) {
                        userApproverFinal = prepFile["user.approver.final"];
                    }
                    if (!createdBy && prepFile["created.by"]) {
                        createdBy = prepFile["created.by"];
                    }
                    
                    if (!status && prepFile["status"]) {
                        status = prepFile["status"];
                    }
                }
            }

            // Gán dữ liệu vào currentRecord
            currentRecord = {
                "id": vars.$L_file["id"],
                "prepayment.id": prepaymentId,
                "contract.id": vars.$L_file["contract.id"],
                "prepayment.status": vars.$L_file["prepayment.status"],
                "vendor.number": vars.$L_file["vendor.number"],
                "vendor.id": vars.$L_file["vendor.id"],
                "currentPhase": currentPhase,
                "initialRole": initialRole,
                "userCheckerKttc": userCheckerKttc,
                "userCheckerDmms": userCheckerDmms,
                
                "userApproverKttc": userApproverKttc,
                "userApproverDmms": userApproverDmms,
                "userCheckerFinal": userCheckerFinal,
                "userApproverFinal": userApproverFinal,
                "createdBy": createdBy,
                
                "status": status,
                "currentUser": vars['$lo.contact.name']
            };
        }
    }

    if (currentRecord && typeof currentRecord === 'object' && !Array.isArray(currentRecord)) {
        currentRecord.isFromHK = String(vars["$G.HTKT_PREPAYMENT_MENU_CONTEXT"] || "").trim().toLowerCase() === "post_audit";
    }

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('TamUngMuaSam/ThongTinDeNghi/TabHoaDon', '', currentRecord);
}

//function renderTabLiabilityInfo(endpoint, input, extraData) {
//    var currentRecord = extraData;
//    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
//        if (vars.$L_file) {
//            currentRecord = {
//                "id": vars.$L_file["id"],
//                "prepayment.id": vars.$L_file["prepayment.id"],
//                "contract.id": vars.$L_file["contract.id"],
//                "prepayment.status": vars.$L_file["prepayment.status"],
//                "vendor.number": vars.$L_file["vendor.number"],
//                "vendor.id": vars.$L_file["vendor.id"]
//
//            };
//        }
//    }
//    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('TamUngMuaSam/ThongTinDeNghi/TabThongTinCongNo', '', currentRecord)
//}

function renderTabLiabilityInfo(endpoint, input, extraData) {
    var currentRecord = extraData;

    // 1. Kiểm tra nếu extraData trống thì lấy từ $L_file
    var isEmptyRecord = !currentRecord || 
                        (Array.isArray(currentRecord) && currentRecord.length === 0) || 
                        (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0);

    if (isEmptyRecord && vars.$L_file) {
        currentRecord = {
            "id": vars.$L_file["id"],
            "prepayment.id": vars.$L_file["prepayment.id"],
            "contract.id": vars.$L_file["contract.id"],
            "prepayment.status": vars.$L_file["prepayment.status"],
            "vendor.number": vars.$L_file["vendor.number"],
            "vendor.id": vars.$L_file["vendor.id"]
        };
    }

    if (currentRecord && currentRecord["prepayment.id"]) {
        var prepId = currentRecord["prepayment.id"];
        var needQuery = !currentRecord["contract.id"] || 
                        !currentRecord["prepayment.status"] || 
                        !currentRecord["vendor.id"];

        if (needQuery) {
            var prepFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
            
            // LƯU Ý: Khóa chính của esdHTKTprepayment là "id"
            var sqlPrep = 'id="' + prepId + '"';
            var rcPrep = prepFile.doSelect(sqlPrep);

            if (rcPrep === RC_SUCCESS) {
                if (!currentRecord["contract.id"]) {
                    currentRecord["contract.id"] = prepFile["contract.id"] || null;
                }
                if (!currentRecord["prepayment.status"]) {
                    currentRecord["prepayment.status"] = prepFile["status"] || prepFile["prepayment.status"] || null;
                }
                if (!currentRecord["vendor.id"]) {
                    currentRecord["vendor.id"] = prepFile["vendor.id"] || null;
                }
            }
        }
    }
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('TamUngMuaSam/ThongTinDeNghi/TabThongTinCongNo', '', currentRecord);
}


/**
 * Tab "Hàng hoá dịch vụ" - giải ngân theo HHDV (Đề nghị tạm ứng).
 * HTML-Generating Script: ESD_HTKT_PREPAYMENT_VENDOR_VIEW.renderTabHHDV
 * Số tiền đề nghị tạm ứng lấy từ biến form $isAmount (esdHTKTprepaymentVendor_do_save_view),
 * fallback cột amount của esdHTKTprepaymentVendor.
 */
function renderTabHHDV(endpoint, input, extraData) {
    var currentRecord = extraData;
    if (!currentRecord || Array.isArray(currentRecord) || typeof currentRecord !== 'object') {
        currentRecord = {};
    }

    var localFile = vars.$L_file || {};
    var rowId = currentRecord["id"] || localFile["id"] || "";
    var prepaymentId = currentRecord["prepayment.id"] || currentRecord["prepaymentId"] || localFile["prepayment.id"] || "";
    var contractId = currentRecord["contract.id"] || currentRecord["contractId"] || localFile["contract.id"] || "";
    var vendorId = currentRecord["vendor.id"] || currentRecord["vendorId"] || localFile["vendor.id"] || "";
    var vendorNumber = currentRecord["vendor.number"] || currentRecord["vendorNumber"] || localFile["vendor.number"] || "";
    var status = currentRecord["status"] || localFile["prepayment.status"] || localFile["status"] || "";

    // Số tiền đề nghị tạm ứng của NCC
    var amount = vars.$isAmount;
    if (amount === undefined || amount === null || String(amount).trim() === "") {
        amount = localFile["amount"];
    }
    amount = String(amount === undefined || amount === null ? "" : amount).replace(/,/g, "").trim();

    // Thông tin phân quyền (BR-01)
    if (prepaymentId) {
        var prepFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
        if (prepFile.doSelect('id="' + prepaymentId + '"') === RC_SUCCESS) {
            if (!contractId && prepFile["contract.id"]) {
                contractId = prepFile["contract.id"];
            }
            currentRecord["currentPhase"] = prepFile["current.phase"];
            currentRecord["initialRole"] = prepFile["initial.role"];
            currentRecord["createdBy"] = prepFile["created.by"];
            currentRecord["userCheckerDmms"] = prepFile["user.checker.dmms"] || prepFile["use.checker.dmms"];
            currentRecord["userCheckerKttc"] = prepFile["user.checker.kttc"];
            currentRecord["userApproverKttc"] = prepFile["user.approver.kttc"];
            currentRecord["userApproverDmms"] = prepFile["user.approver.dmms"];
            currentRecord["userCheckerFinal"] = prepFile["user.checker.final"];
            currentRecord["userApproverFinal"] = prepFile["user.approver.final"];
            if (prepFile["status"]) {
                status = prepFile["status"];
            }
        }
        prepFile.doClose();
    }

    currentRecord["id"] = rowId;
    currentRecord["prepaymentVendorId"] = rowId;
    currentRecord["prepaymentId"] = prepaymentId;
    currentRecord["prepayment.id"] = prepaymentId;
    currentRecord["contractId"] = contractId;
    currentRecord["contract.id"] = contractId;
    currentRecord["vendorId"] = vendorId;
    currentRecord["vendor.id"] = vendorId;
    currentRecord["vendorNumber"] = vendorNumber;
    currentRecord["vendor.number"] = vendorNumber;
    currentRecord["status"] = status;
    currentRecord["isAmount"] = amount;
    currentRecord["currentUser"] = vars['$lo.contact.name'] || currentRecord["currentUser"] || "";
    currentRecord.isFromHK = String(vars["$G.HTKT_PREPAYMENT_MENU_CONTEXT"] || "").trim().toLowerCase() === "post_audit";

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
            "TamUngMuaSam/ThongTinDeNghi/TabHangHoaDichVu",
            "",
            currentRecord
    );
}
