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