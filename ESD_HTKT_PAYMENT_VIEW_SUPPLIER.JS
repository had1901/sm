/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_VIEW_SUPPLIER
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Tra cứu chi tiết thông tin nhà cung cấp, chi nhánh và thông tin tài khoản ngân hàng liên kết.
 * - Tổng hợp lịch sử giao dịch, hóa đơn và các phiếu đề nghị thanh toán liên quan đến nhà cung cấp.
 * -----------------------------------------------------------------------------
 */


function renderTabInvoice(endpoint, input, extraData) {
    var currentRecord = extraData;

    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
        if (vars.$L_file) {
            var paymentId = vars.$L_file["payment.id"];
            var currentPhase = vars.$L_file["current.phase"];
            var initialRole = vars.$L_file["initial.role"];
            var userCheckerKttc = vars.$L_file["user.checker.kttc"];
            var userCheckerDmms = vars.$L_file["use.checker.dmms"];
            //
            var userApproverKttc = vars.$L_file["user.approver.kttc"];
            var userApproverDmms = vars.$L_file["user.approver.dmms"];
            var userCheckerFinal = vars.$L_file["user.checker.final"];
            var userApproverFinal = vars.$L_file["user.approver.final"];
            var userApproverKttc = vars.$L_file["user.approver.kttc"];
            var createdBy = vars.$L_file["created.by"];

            var status = vars.$L_file["status"];

            if ((!currentPhase || !initialRole) && paymentId) {
                var prepFile = new SCFile("esdHTKTpayment");
                var sqlPrep = "id=\"" + paymentId + "\"";
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
                "payment.id": paymentId,
                "contract.id": vars.$L_file["contract.id"],
                "payment.status": vars.$L_file["payment.status"],
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

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/TabThongTinDeNghi/TabHoaDon', '', currentRecord);
}

//Dung cho tab thong tin cong no
function renderTabLiabilityInfo(endpoint, input, extraData) {
    var currentRecord = extraData;

    // 1. Kiểm tra và khởi tạo object nếu extraData trống
    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
        if (vars.$L_file) {
            currentRecord = {
                "id": vars.$L_file["id"],
                "payment.id": vars.$L_file["payment.id"],
                "contract.id": vars.$L_file["contract.id"],
                "payment.status": vars.$L_file["payment.status"],
                "vendor.number": vars.$L_file["vendor.number"],
                "vendor.id": vars.$L_file["vendor.id"]
            };
        } else {
            currentRecord = {};
        }
    }

    // 2. Bổ sung dữ liệu phân quyền nếu payload của riêng tab Công nợ chưa có đủ.
    // Không dùng contract.id làm điều kiện vì hợp đồng có thể đã có nhưng quyền vẫn thiếu.
    var localFile = vars.$L_file || {};
    var paymentId = currentRecord["payment.id"] || currentRecord["paymentId"] || localFile["payment.id"];
    var missingPermission = !currentRecord["currentPhase"] ||
        !currentRecord["initialRole"] ||
        !currentRecord["currentUser"] ||
        !currentRecord["createdBy"] ||
        !currentRecord["status"];

    if (paymentId && missingPermission) {
        var paymentRec = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        var sql = "id=\"" + paymentId + "\"";

        if (paymentRec.doSelect(sql) === RC_SUCCESS) {
            currentRecord["paymentId"] = paymentId;
            currentRecord["contractId"] = currentRecord["contract.id"] || paymentRec["contract.id"];
            currentRecord["vendorId"] = currentRecord["vendor.id"] || localFile["vendor.id"];
            currentRecord["currentPhase"] = paymentRec["current.phase"];
            currentRecord["initialRole"] = paymentRec["initial.role"];
            currentRecord["createdBy"] = paymentRec["created.by"];
            currentRecord["userCheckerDmms"] = paymentRec["user.checker.dmms"];
            currentRecord["userCheckerKttc"] = paymentRec["user.checker.kttc"];
            currentRecord["userApproverKttc"] = paymentRec["user.approver.kttc"];
            currentRecord["userApproverDmms"] = paymentRec["user.approver.dmms"];
            currentRecord["userCheckerFinal"] = paymentRec["user.checker.final"];
            currentRecord["userApproverFinal"] = paymentRec["user.approver.final"];
            currentRecord["currentUser"] = vars['$lo.contact.name'];
            currentRecord["status"] = paymentRec["status"];
        }
        paymentRec.doClose();
    }
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS("HachToanKeToan/ThanhToan/TabThongTinDeNghi/TabThongTinCongNo", '', currentRecord);
}



//function getTabCostDivision(endpoint, input, extraData) {
//    var currentRecord = extraData;
//
//    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
//        if (vars.$L_file) {
//            var paymentId = vars.$L_file["payment.id"];
//            var currentPhase = vars.$L_file["current.phase"];
//            var initialRole = vars.$L_file["initial.role"];
//
//            if ((!currentPhase || !initialRole) && paymentId) {
//                var prepFile = new SCFile("esdHTKTpayment");
//                var sqlPrep = "id=\"" + paymentId + "\"";
//                var rcPrep = prepFile.doSelect(sqlPrep);
//
//                if (rcPrep == RC_SUCCESS) {
//                    if (!currentPhase && prepFile["current.phase"]) {
//                        currentPhase = prepFile["current.phase"];
//                    }
//                    if (!initialRole && prepFile["initial.role"]) {
//                        initialRole = prepFile["initial.role"];
//                    }
//                }
//            }
//
//            // Gán dữ liệu vào currentRecord
//            currentRecord = {
//                "id": vars.$L_file["id"],
//                "payment.id": paymentId,
//                "contract.id": vars.$L_file["contract.id"],
//                "payment.status": vars.$L_file["payment.status"],
//                "vendor.number": vars.$L_file["vendor.number"],
//                "vendor.id": vars.$L_file["vendor.id"],
//                "currentPhase": currentPhase,
//                "initialRole": initialRole
//            };
//        }
//    }
//
//    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
//        "HachToanKeToan/ThanhToan/TabThongTinDeNghi/TabPhanChiaChiPhi",
//        "",
//        currentRecord
//    );
//}
function getTabCostDivision(endpoint, input, extraData) {
    var currentRecord = extraData;

    // Kiểm tra nếu extraData trống thì tìm dữ liệu từ vars.$L_file hoặc $G_
    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
        if (vars.$L_file) {
            currentRecord = {
                paymentId: vars.$L_file["payment.id"] || vars.$G_payment_id,
                contractId: vars.$L_file["contract.id"] || vars.$G_contract_id,
                vendorId: vars.$L_file["vendor.id"] || vars.$L_file["vendor.number"] || vars.$G_vendor_id,
                id: vars.$L_file["id"],
                paymentStatus: vars.$L_file["payment.status"],
                vendorNumber: vars.$L_file["vendor.number"],
            };
        } else {
            // Fallback về biến toàn cục $G_ nếu không có $L_file
            currentRecord = {
                paymentId: vars.$G_payment_id,
                contractId: vars.$G_contract_id,
                vendorId: vars.$G_vendor_id,
            };
        }
    }

    var paymentId = currentRecord["payment.id"] || vars.$L_file["payment.id"];
    if (paymentId && !currentRecord["contract.id"]) {
        var paymentRec = new SCFile("esdHTKTpayment");
        var sql = "id=\"" + paymentId + "\"";

        if (paymentRec.doSelect(sql) === RC_SUCCESS) {
            currentRecord = {
                "id": vars.$L_file["id"],
                "paymentId": paymentId,
                "contractId": paymentRec["contract.id"],
                "vendorId": vars.$L_file["vendor.id"],
                "currentPhase": paymentRec["current.phase"],
                "initialRole": paymentRec["initial.role"],
                "createdBy": paymentRec["created.by"],
                "userCheckerDmms": paymentRec["user.checker.dmms"],
                "userCheckerKttc": paymentRec["user.checker.kttc"],
                "userApproverKttc": paymentRec["user.approver.kttc"],
                "userApproverDmms": paymentRec["user.approver.dmms"],
                "userCheckerFinal": paymentRec["user.checker.final"],
                "userApproverFinal": paymentRec["user.approver.final"],
                "currentUser": vars['$lo.contact.name'],
                "status": paymentRec["status"]
            };
        }
    }


    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
            "HachToanKeToan/ThanhToan/TabThongTinDeNghi/TabPhanChiaChiPhi",
            "",
            currentRecord
    );
}
