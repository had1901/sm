/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_WF
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Quản lý vòng đời trạng thái (Workflow Lifecycle) của phiếu đề nghị thanh toán từ Tạo mới đến Đóng phiếu.
 * - Kiểm tra điều kiện chuyển phase, thẩm định quyền hạn người thực hiện (Reviewer, Approver).
 * - Tích hợp gọi sinh EForm, upload bản trình ký PDF và kích hoạt quy trình ký số DSM.
 * - Ghi nhận lịch sử hoạt động (Activity History / Audit Trail) của hồ sơ qua từng bước duyệt.
 * -----------------------------------------------------------------------------
 */

/* =============================================================================
 * 1. CẤU HÌNH & HẰNG SỐ (CONFIG & CONSTANTS)
 * ============================================================================= */

var createActivity = lib.ESD_Utils.createActivity;

var WF_CONFIG = {
    SERVICE_NAME: "ESD_HTKT_PAYMENT_WF",
    SERVICE_VERSION: "2.1.0"
};

var NEXT_PHASE_MAP = {
    "initial_dmms": "dmms_initiated",
    "initial_kttc": "kttc_checked",
    "check_dmms": "dmms_checked",
    "approval_dmms": "dmms_approved",
    "approval_kttc": "kttc_approved",
    "check_final": "checked",
    "approval_final": "approved"
};

var STATUS_MAP = {
    "dmms_created": "Tạo mới",
    "kttc_created": "Tạo mới",
    "dmms_initiated": "Chờ KTTC xử lý",
    "kttc_checked": "Chờ phê duyệt",
    "dmms_checked": "Chờ phê duyệt",
    "dmms_approved": "Chờ phê duyệt",
    "kttc_approved": "Chờ phê duyệt",
    "checked": "Chờ phê duyệt",
    "approved": "Đã phê duyệt",
    "cancelled": "Đã xóa",
    "request_edit": "Chờ chỉnh sửa",
    "accounted": "Đã hạch toán"
};

var HTKT_WF_PHASE = {
    INITIAL_DMMS: "initial_dmms",
    INITIAL_KTTC: "initial_kttc",
    CHECK_DMMS: "check_dmms",
    APPROVAL_DMMS: "approval_dmms",
    APPROVAL_KTTC: "approval_kttc",
    CHECK_FINAL: "check_final",
    APPROVAL_FINAL: "approval_final"
};

var HTKT_WF_DSM_STATUS = {
    REQUESTED: "01",
    SENT: "03",
    FAILED: "04",
    SIGNED: "05",
    ECM_UPLOADED: "07",
    UNKNOWN_ERROR: "99"
};


/* =============================================================================
 * 2. CÁC HÀM KIỂM TRA QUYỀN HẠN & TRẠNG THÁI (PERMISSION & ACTION CHECKS)
 * ============================================================================= */

function checkShowApproval(record) {
    var currentUser = vars.$lo_operator["contact.name"];
    if ((record["created.by"] == currentUser && record["initial.role"] == "kttc") ||
            record["user.checker.kttc"] == currentUser) {
        return "T";
    }
    return "F";
}

function checkCanSave(record) {
    var currentUser = vars.$lo_operator["contact.name"];
    if ((record["created.by"] == currentUser && record["initial.role"] == "kttc" && record["current.phase"] == "initial_kttc") ||
            (record["created.by"] == currentUser && record["initial.role"] == "dmms" && record["current.phase"] == "initial_dmms") ||
            (record["user.checker.kttc"] == currentUser && record["current.phase"] == "initial_kttc")
    ) {
        return "T";
    }
    return "F";
}

function checkCanReturn(record) {
    var fieldCheck = null;
    var currentPhase = record.current_phase || record["current.phase"];
    var currentUser = vars.$lo_operator["contact.name"];

    switch (currentPhase) {
        case "initial_kttc":
            fieldCheck = "user.checker.kttc";
            break;
        case "check_dmms":
            fieldCheck = "user.checker.dmms";
            break;
        case "approval_dmms":
            fieldCheck = "user.approver.dmms";
            break;
        case "approval_kttc":
            fieldCheck = "user.approver.kttc";
            break;
        case "check_final":
            fieldCheck = "user.checker.final";
            break;
        case "approval_final":
            fieldCheck = "user.approver.final";
            break;
        default:
            break;
    }

    if (fieldCheck && record[fieldCheck] == currentUser && record["created.by"] != currentUser) {
        return "T";
    }
    return "F";
}

function canEditInCurrenPhase(record) {
    var currentUser = vars.$lo_operator["contact.name"];
    var currentPhase = record.current_phase || record["current.phase"];

    switch (currentPhase) {
        case "initial_dmms":
            return record["created.by"] == currentUser && record["initial.role"] == "dmms";
        case "initial_kttc":
            return record["created.by"] == currentUser && record["initial.role"] == "kttc";
        case "check_dmms":
        case "approval_dmms":
        case "approval_kttc":
        case "check_final":
        case "approval_final":
            return false;
        default:
            return false;
    }
}

function canUpdateApprovalInfo(record, field) {
    var currentUser = vars.$lo_operator["contact.name"];
    var currentPhase = record.current_phase || record["current.phase"];

    switch (currentPhase) {
        case "initial_dmms":
            return field == "require.check.level1" && record["created.by"] == currentUser && record["initial.role"] == "dmms";
        case "initial_kttc":
            return field == "require.check.level2" &&
                    ((record["created.by"] == currentUser && record["initial.role"] == "kttc") ||
                            record["user.checker.kttc"] == currentUser);
        case "check_dmms":
        case "approval_dmms":
        case "approval_kttc":
        case "check_final":
        case "approval_final":
            return false;
        default:
            return null;
    }
}


/* =============================================================================
 * 3. LOGIC CHUYỂN BƯỚC WORKFLOW & GHI LỊCH SỬ (WORKFLOW TRANSITIONS)
 * ============================================================================= */

function updateNextStatus(record, previousRecord) {
    var currentPhase = record.current_phase || record["current.phase"];
    var oldPhase = currentPhase;
    var documentResult = null;

    // trưởng thêm: Process cũ gọi trực tiếp updateNextStatus; lấy phase trước chuyển từ oldrecord.
    if (!previousRecord && typeof oldrecord !== "undefined") {
        previousRecord = oldrecord;
    }
    if (previousRecord && previousRecord["current.phase"]) {
        oldPhase = String(previousRecord["current.phase"]).trim();
    }

    // trưởng thêm: Chỉ tạo bản trình ký khi rời phase initial_kttc.
//    if (oldPhase === HTKT_WF_PHASE.INITIAL_KTTC) {
//        try {
//            htktWfAssertDependencies(true);
//
//            var paymentId = htktWfPaymentId(record);
//
//            var currentDocument = htktWfDocument().getCurrentPresentation({
//                paymentId: paymentId
//            });
//
//            if (currentDocument && currentDocument.success === true) {
//                documentResult = htktWfOk({
//                    idempotent: true,
//                    document: currentDocument.data
//                }, "Bản trình ký đã được tạo trước đó.");
//            } else if (currentDocument && currentDocument.code && currentDocument.code !== "DOCUMENT_NOT_FOUND") {
////                throw new Error(currentDocument.message || "Không kiểm tra được bản trình ký hiện tại.");
//            } else {
//                documentResult = htktWfDocument().generateAndUploadPresentation({
//                    paymentId: paymentId,
//                    currentUser: htktWfCurrentUser()
//                });
//
//                if (!documentResult || documentResult.success !== true) {
//                    var documentError = documentResult && documentResult.message
//                            ? documentResult.message
//                            : "Không sinh và lưu được bản trình ký.";
//                    if (documentResult && documentResult.detail) {
//                        documentError += " " + documentResult.detail;
//                    }
//                    throw new Error(documentError);
//                }
//            }
//        } catch (docErr) {
////            throw docErr;
//        }
//    }

    if (currentPhase === "start") {
        record.status = "initialized";
    } else if (NEXT_PHASE_MAP[currentPhase]) {
        record.status = NEXT_PHASE_MAP[currentPhase];
    }

    try {
        if (currentPhase == "initial_dmms") {
            lib.ESD_HTKT_PAYMENT_VENDOR.syncVendorOglFromPayment(record);
        }
    } catch (e) {}

    createApprovalHistory(record);


    return documentResult;
}

/**
 * Ghi lịch sử chuyển phase workflow:
 * - Trình phê duyệt: initial_dmms / initial_kttc
 * - Rà soát 1: check_dmms
 * - Rà soát 2: check_final
 * - Phê duyệt: approval_dmms / approval_kttc / approval_final
 */
function createApprovalHistory(record) {
    try {
        var currentPhase = String(
                record.current_phase || record["current.phase"] || ""
        ).trim();

        var activityType = "";

        if (currentPhase == "initial_dmms" || currentPhase == "initial_kttc") {
            activityType = "Trình phê duyệt";
        } else if (currentPhase == "check_dmms") {
            activityType = "Rà soát 1";
        } else if (currentPhase == "check_final") {
            activityType = "Rà soát 2";
        } else if (
                currentPhase == "approval_dmms" ||
                currentPhase == "approval_kttc" ||
                currentPhase == "approval_final"
        ) {
            activityType = "Phê duyệt";
        }

        if (!activityType) {
            return;
        }

        var currentUser = String(
                vars.$lo_operator["contact.name"] || vars["$lo.contact.name"] || ""
        ).trim();

        var paymentId = String(record["id"] || record.id || "").trim();

        if (!currentUser || !paymentId) {
            return;
        }

        createActivity(
                "activityHTKTpayment",
                activityType + ' Đề nghị Thanh Toán: Mã đề nghị: "' + paymentId + '"',
                paymentId,
                activityType,
                currentUser
        );
    } catch (e) {
        /* print(
                "[ESD_HTKT_PAYMENT_WF.createApprovalHistory] Không thể ghi activity: " + e.toString()
        ); */
    }
}

function cancelRequest(record) {
    record.status = "cancelled";

    try {
        var currentUser = String(
                vars.$lo_operator["contact.name"] || vars["$lo.contact.name"] || ""
        ).trim();

        var paymentId = String(record["id"] || record.id || "").trim();

        if (currentUser && paymentId) {
            createActivity(
                    "activityHTKTpayment",
                    'Xóa Đề nghị Thanh toán: Mã đề nghị: "' + paymentId + '"',
                    paymentId,
                    "Xóa",
                    currentUser
            );
        }
    } catch (e) {
        /* print(
                "[ESD_HTKT_PAYMENT_WF.cancelRequest] Không thể ghi activity: " + e.toString()
        ); */
    }
}

function getReturnToUpdatePhase(record) {
    var initialRole = String(record && record["initial.role"] || "").trim().toLowerCase();

    if (initialRole === "dmms") return HTKT_WF_PHASE.INITIAL_DMMS;
    if (initialRole === "kttc") return HTKT_WF_PHASE.INITIAL_KTTC;
    return "";
}

function returnToUpdate(record, documentsAlreadyDeleted) {
    if (documentsAlreadyDeleted !== true) {
        var deleteResult = deleteDocumentsBeforeReturn(record);
        if (!deleteResult || deleteResult.success !== true) {
            throw new Error(
                    deleteResult && deleteResult.message
                            ? deleteResult.message
                            : "Khong xoa duoc tai lieu ECM truoc khi yeu cau chinh sua."
            );
        }
    }

    // 1. Cập nhật trạng thái phiếu
    record.status = "request_edit";

    var currentUser = String(
            vars.$lo_operator["contact.name"] || vars["$lo.contact.name"] || ""
    ).trim();
    var paymentId = String(record["id"] || record.id || "").trim();
    var returnReason = String(record["return.reason"] || "").trim();
    var createdBy = String(record["created.by"] || "").trim();
    var currentStatus = String(record.status || record["status"] || "").trim();

    // 2. Ghi Activity log
    try {
        if (currentUser && paymentId) {
            var activityDescription =
                    "Yêu cầu chỉnh sửa Đề nghị Thanh Toán" +
                    (returnReason ? '\nLý do: "' + returnReason + '"' : "");

            createActivity(
                    "activityHTKTpayment",
                    activityDescription,
                    paymentId,
                    "Yêu cầu chỉnh sửa",
                    currentUser
            );
        }
    } catch (e) {
        /* print("[ESD_HTKT_PAYMENT_WF.returnToUpdate] Không thể ghi activity: " + e.toString()); */
    }

    // 3. KIỂM TRA ĐIỀU KIỆN TRƯỚC KHI GỌI GỬI EMAIL
    try {
        if (currentStatus === "request_edit" && paymentId && createdBy && returnReason) {
            if (lib.ESD_HTKT_ACTION_WF_SEND_EMAIL && typeof lib.ESD_HTKT_ACTION_WF_SEND_EMAIL.sendEmailRequestEdit === "function") {
                lib.ESD_HTKT_ACTION_WF_SEND_EMAIL.sendEmailRequestEdit(record);
            }
        }
    } catch (eMail) {
        /* Bọc try-catch để nếu có lỗi gửi mail cũng không làm sập luồng trả lại phiếu */
    }
}

/* =============================================================================
 * 4. TẦNG VALIDATION NGHIỆP VỤ (BUSINESS VALIDATIONS)
 * ============================================================================= */

function validateDataInPhase(record, type) {
    // Nếu không phải gọi từ Workflow (Trình duyệt / Chuyển bước) -> Bỏ qua kiểm tra chuyển phase
    if (type !== "wf") {
        return null;
    }

    var errorMss = [];

    // Validate chung thông tin NCC + thanh toán
    var vendorErrors = validateVendorAndPaymentDetailsOnWorkflow(record);
    if (vendorErrors && vendorErrors.length > 0) {
        errorMss = errorMss.concat(vendorErrors);
    }

    var currentPhase = record.current_phase || record["current.phase"];

    // Tái kiểm tra hóa đơn khi Trình phiếu
    if (currentPhase === "initial_dmms" || currentPhase === "initial_kttc") {
        var paymentId = String(record["id"] || record.id || "");
        var invoiceBrErrors = validateInvoices(paymentId);
        if (invoiceBrErrors && invoiceBrErrors.length > 0) {
            errorMss = errorMss.concat(invoiceBrErrors);
        }
    }

    // Validate theo từng phase
    var phaseErrors = null;

    switch (currentPhase) {
        case "initial_dmms":
            phaseErrors = validateFromCbDmmsToCbKttc();
            break;
        case "initial_kttc":
            phaseErrors = validateFromCbKttc();
            break;
        case "check_dmms":
            phaseErrors = validateFromRsDmmsToPdDmms();
            break;
        case "approval_dmms":
            phaseErrors = validateFromPdDmmsToPdKttc();
            break;
        case "approval_kttc":
            phaseErrors = validateFromPdKttcToRsCapThamQuyen();
            break;
        case "check_final":
            phaseErrors = validateFromRsCapThamQuyenToPdCapThamQuyen();
            break;
        case "approval_final":
            phaseErrors = validateFromPdCapThamQuyenToEnd();
            break;
    }

    if (phaseErrors && phaseErrors.length > 0) {
        errorMss = errorMss.concat(phaseErrors);
    }

    return errorMss.length > 0 ? errorMss : null;
}

function validateFieldExample() {
    var dataIsValid = false;

    if (dataIsValid) {
        returnCode = 0;
    }
    returnCode = 1;
}

function validateFromCbDmmsToCbKttc() {
    var record = vars.$L_file;
    var errorMss = [];

    if (!record["user.checker.kttc"]) errorMss.push("Chưa chọn cán bộ KTTC tiếp nhận");
    if (record["require.check.level1"] && !record["user.checker.dmms"]) errorMss.push("Chưa chọn cán bộ Rà soát ĐMMS");
    if (!record["user.approver.dmms"]) errorMss.push("Chưa chọn cán bộ Phê duyệt ĐMMS");
    var description = String(record["description"] || "").trim();

    if (description === "") {
        errorMss.push("Nội dung giao dịch không được để trống.");
    } else if (description.length > 255) {
        errorMss.push("Nội dung giao dịch không được vượt quá 255 ký tự.");
    }

    return errorMss.length > 0 ? errorMss : null;
}

function validateFromCbKttc() {
    var record = vars.$L_file;
    var errorMss = [];
    var paymentId = String(record["id"] || record.id || "");

    // Validate Tab hạch toán: bắt buộc (tổng nợ = tổng có)
    var accountingResult = validateRequiredEsdHTKTpaymentEntry(paymentId);
    if (accountingResult.success !== true) {
        errorMss.push(
                accountingResult.error ||
                "Thông tin hạch toán là bắt buộc và tổng ghi nợ phải bằng tổng ghi có."
        );
    }

    // Validate Tab tài liệu đính kèm (Loại khấu trừ)
    var requiredDeductionType = validateRequiredEsdHTKTpaymentInvoice(paymentId);
    if (requiredDeductionType.success !== true) {
        errorMss.push(
                requiredDeductionType.error ||
                "Hóa đơn bắt buộc chọn loại khấu trừ"
        );
    }
    //////////////////
    // Validate số tiền hoàn ứng của tất cả nhà cung cấp có khớp nhau không
    var refundMatchResult = validateAllVendorsRefundMatch(paymentId);
    if (refundMatchResult.success !== true) {
        errorMss.push(refundMatchResult.error);
    }
    //////////////////

    // Validate phương thức thanh toán của các nhà cung cấp nếu >= 2 NCC
    var paymentMethodResult = validateAllVendorsPaymentMethodMatch(paymentId);
    if (paymentMethodResult.success !== true) {
        errorMss.push(paymentMethodResult.error);
    }

    // Validate thông tin phê duyệt
    if (!record["user.approver.kttc"]) {
        errorMss.push("Chưa chọn cán bộ Phê duyệt KTTC");
    }

    if (record["require.check.level2"] && !record["user.checker.final"]) {
        errorMss.push("Chưa chọn cán bộ Rà soát KTTC");
    }

    if (!record["user.approver.final"]) {
        errorMss.push("Chưa chọn cán bộ Phê duyệt Cấp có thẩm quyền");
    }

    var description = String(record["description"] || "").trim();

    if (description === "") {
        errorMss.push("Nội dung giao dịch không được để trống.");
    } else if (description.length > 255) {
        errorMss.push("Nội dung giao dịch không được vượt quá 255 ký tự.");
    }

    // Validate riêng theo initial_role
    var initialRole = record.initial_role || record["initial.role"];
    var mss = null;

    if (initialRole === "dmms") {
        if (record["require.check.level1"]) {
            mss = validateFromCbKttcToRsDmms();
            if (mss && mss.length > 0) errorMss = errorMss.concat(mss);
        } else {
            mss = validateFromCbKttcToPdDmms();
            if (mss && mss.length > 0) errorMss = errorMss.concat(mss);
        }
    } else if (initialRole === "kttc") {
        mss = validateFromCbKttcToPdDmms();
        if (mss && mss.length > 0) errorMss = errorMss.concat(mss);
    }

    return errorMss;
}

function validateFromCbKttcToRsDmms() { return null; }
function validateFromCbKttcToPdDmms() { return null; }
function validateFromRsDmmsToPdDmms() { return null; }
function validateFromPdDmmsToPdKttc() { return null; }
function validateFromPdKttcToRsCapThamQuyen() { return null; }
function validateFromRsCapThamQuyenToPdCapThamQuyen() { return null; }
function validateFromPdCapThamQuyenToEnd() { return null; }

function validateRequiredEsdHTKTpaymentEntry(paymentId) {
    if (!paymentId) {
        return { success: false, error: "Không tìm thấy mã đề nghị thanh toán." };
    }

    var f = new SCFile("esdHTKTpaymentEntry", SCFILE_READONLY);

    try {
        var rc = f.doSelect('payment.id="' + paymentId + '"');
        var count = 0;
        var totalDebit = 0;
        var totalCredit = 0;
        var hasEmptyAccount = false;

        while (rc == RC_SUCCESS) {
            count++;

            var accountNumber = String(f["account.number"] || "").trim();
            var accountName = String(f["account.name"] || "").trim();
            if (!accountNumber || !accountName) {
                hasEmptyAccount = true;
            }

            var amount = Number(f["amount"]) || 0;
            var accountType = f["account.type"];

            if (accountType == "DEBIT") {
                totalDebit += amount;
            } else if (accountType == "ASSET") {
                totalCredit += amount;
            }

            rc = f.getNext();
        }

        if (count == 0) {
            return { success: false, error: "Thông tin hạch toán là bắt buộc." };
        }

        if (hasEmptyAccount) {
            return {
                success: false,
                error: "Thông tin hạch toán không được để trống số tài khoản hoặc tên tài khoản."
            };
        }

        if (totalDebit != totalCredit) {
            return { success: false, error: "Tổng ghi nợ phải bằng tổng ghi có." };
        }

        return { success: true };
    } catch (err) {
        return {
            success: false,
            error: "Không kiểm tra được thông tin hạch toán: " + err
        };
    } finally {
        try { f.doClose(); } catch (e) {}
    }
}

function validateRequiredEsdHTKTpaymentInvoice(paymentId) {
    if (!paymentId) {
        return {
            success: false,
            error: "Không tìm thấy ID hóa đơn/thanh toán để kiểm tra."
        };
    }

    var f = new SCFile("esdHTKTpaymentInvoice", SCFILE_READONLY);

    try {
        var querySQL = 'payment.id="' + paymentId + '"';
        var rc = f.doSelect(querySQL);

        while (rc == RC_SUCCESS) {
            var deductionType = f["deduction.type"];

            if (deductionType == null || deductionType == "") {
                return {
                    success: false,
                    error: "Hóa đơn bắt buộc chọn loại khấu trừ"
                };
            }

            rc = f.getNext();
        }
        return { success: true };

    } catch (err) {
        return {
            success: false,
            error: "Lỗi trong quá trình kiểm tra hóa đơn: " + err
        };
    } finally {
        try { f.doClose(); } catch (e) {}
    }
}

function validateVendorAndPaymentDetails(record) {
    var errorMss = [];

    function checkMaxLength(value, maxLength, fieldName) {
        if (value && value.length > maxLength) {
            errorMss.push(fieldName + " không được vượt quá " + maxLength + " ký tự.");
        }
    }

    function parseAmount(value) {
        if (value === null || value === undefined) return NaN;

        var normalizedValue = String(value).replace(/,/g, "").trim();
        if (!normalizedValue) return NaN;

        var numberValue = Number(normalizedValue);
        return isFinite(numberValue) ? numberValue : NaN;
    }

    var vendorName = vars.$supplierId;
    if (!vendorName) {
        errorMss.push("Tên Nhà cung cấp là bắt buộc.");
    } else {
        checkMaxLength(vendorName, 255, "Tên Nhà cung cấp");
    }

    var taxCode = vars.$taxCode;
    if (!taxCode) {
        errorMss.push("Thông tin Mã số thuế là bắt buộc.");
    } else {
        checkMaxLength(taxCode, 255, "Thông tin Mã số thuế");
    }

    var amountField = parseAmount(vars.$amount);
    var approvedInvoiceAmount = parseAmount(vars.$approvedInvoiceAmount);
    var refundAmount = parseAmount(vars.$refundAmount);
    var remainingAmount = parseAmount(vars.$remainingAmount);
    var payableaAmount = parseAmount(vars.$payableAmount);

    if (isNaN(amountField)) {
        errorMss.push("Số tiền đề nghị thanh toán là bắt buộc.");
    } else if (amountField < 0) {
        errorMss.push("Số tiền đề nghị thanh toán phải lớn hơn 0.");
    } else if (amountField > remainingAmount) {
        errorMss.push("Số tiền đề nghị thanh toán phải nhỏ hơn hoặc bằng Số tiền còn lại.");
    }

    if (isNaN(approvedInvoiceAmount)) {
        errorMss.push("Giá trị hóa đơn chấp nhận là bắt buộc.");
    } else if (approvedInvoiceAmount < 0) {
        errorMss.push("Giá trị hóa đơn chấp nhận phải lớn hơn 0.");
    } else if (approvedInvoiceAmount > remainingAmount) {
        errorMss.push("Giá trị hóa đơn chấp nhận phải nhỏ hơn hoặc bằng Số tiền còn lại.");
    }

    if (isNaN(refundAmount)) {
        errorMss.push("Số tiền hoàn ứng lần này là bắt buộc.");
    } else if (refundAmount < 0) {
        errorMss.push("Số tiền hoàn ứng lần này phải lớn hơn 0.");
    }

    var paymentId = String(record["payment.id"] || record.payment_id || "").trim();
    var vendorId = String(record["vendor.id"] || record.vendor_id || "").trim();
    var contractId = String(record["contract.id"] || record.contract_id || "").trim();

    if (payableaAmount > 0 && vendorId) {
        try {
            if (!paymentId) {
                throw new Error("Thiếu thông tin phiếu thanh toán.");
            }
            var totalPayableRemaining = parseAmount(
                lib.ESD_HTKT_PAYMENT_SUPPLIER_LEDGER_LIST.getTotalAccountsPayableRemainingAmount(paymentId, vendorId)
            );
            if (isNaN(totalPayableRemaining)) {
                throw new Error("Tổng số tiền phải trả còn lại không hợp lệ.");
            }
            if (payableaAmount > totalPayableRemaining) {
                errorMss.push("Số tiền cấn trừ phải trả phải nhỏ hơn Tổng số tiền phải trả còn lại (" + totalPayableRemaining + ").");
            }
        } catch (ePayable) {
            errorMss.push("Không thể kiểm tra Tổng số tiền phải trả còn lại. " + String(ePayable.message || ePayable));
        }
    }

    if (!isNaN(approvedInvoiceAmount) && approvedInvoiceAmount >= 0 && vendorId) {
        var attachedInvoiceFile = null;
        var paymentInvoiceFile = null;
        try {
            if (!paymentId || !vendorId) {
                throw new Error("Thiếu thông tin phiếu thanh toán, nhà cung cấp.");
            }

            paymentInvoiceFile = new SCFile("esdHTKTpaymentInvoice", SCFILE_READONLY);
            var paymentInvoiceQuery = 'payment.id="' + escapeSmQueryValue(paymentId) +
                '" and vendor.id="' + escapeSmQueryValue(vendorId) + '"';
            if (paymentInvoiceFile.doSelect(paymentInvoiceQuery) == RC_SUCCESS) {
                // Cùng phạm vi và cách cộng grand.total với createListInvoinVendor.
                var totalAttachedInvoiceAmount = "0";
                attachedInvoiceFile = new SCFile("esdHTKTinvoice", SCFILE_READONLY);
                var attachedInvoiceQuery = "SELECT i.id, i.grand.total " +
                    "FROM esdHTKTinvoice i JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) " +
                    'WHERE i.request.id = "' + escapeSmQueryValue(paymentId) +
                    '" AND v.id = "' + escapeSmQueryValue(vendorId) + '"';
                var rcAttachedInvoice = attachedInvoiceFile.doSelect(attachedInvoiceQuery);
                while (rcAttachedInvoice == RC_SUCCESS) {
                    var attachedInvoiceAmount = String(attachedInvoiceFile["grand.total"] || attachedInvoiceFile["grandTotal"] || "0");
                    totalAttachedInvoiceAmount = lib.ESD_HTKT_Utils.addStringsManual(totalAttachedInvoiceAmount, attachedInvoiceAmount);
                    rcAttachedInvoice = attachedInvoiceFile.getNext();
                }

                var approvedInvoiceAmountText = String(vars.$approvedInvoiceAmount).replace(/,/g, "").trim();
                if (lib.ESD_HTKT_Utils.compareMoneyStrings(approvedInvoiceAmountText, totalAttachedInvoiceAmount) > 0) {
                    errorMss.push("Giá trị hóa đơn chấp nhận phải nhỏ hơn hoặc bằng tổng giá trị hóa đơn của nhà cung cấp gắn vào phiếu (" + totalAttachedInvoiceAmount + ").");
                }
            }
        } catch (eInvoice) {
            errorMss.push("Không thể kiểm tra tổng giá trị hóa đơn gắn vào phiếu. " + String(eInvoice.message || eInvoice));
        } finally {
            try { if (attachedInvoiceFile) attachedInvoiceFile.doClose(); } catch (eCloseInvoice) {}
            try { if (paymentInvoiceFile) paymentInvoiceFile.doClose(); } catch (eClosePaymentInvoice) {}
        }
    }

    if (refundAmount > 0 && vendorId) {
        var paymentFile = null;
        try {


            if (!contractId && paymentId) {
                paymentFile = new SCFile("esdHTKTpayment", SCFILE_READONLY);
                if (paymentFile.doSelect('id="' + escapeSmQueryValue(paymentId) + '"') == RC_SUCCESS) {
                    contractId = String(paymentFile["contract.id"] || "").trim();
                }
            }

            if (!paymentId || !contractId) {
                throw new Error("Thiếu thông tin phiếu thanh toán, hợp đồng.");
            }

            var debtSummary = lib.ESD_HTKT_PAYMENT_SUPPLIER_LEDGER_LIST.getSupplierDebtSummary({
                details: JSON.stringify({ paymentId: paymentId, vendorId: vendorId, contractId: contractId })
            });
            var tongCoTheHoanUng = parseAmount(debtSummary && debtSummary.tongCoTheHoanUng);
            if (isNaN(tongCoTheHoanUng) || tongCoTheHoanUng < 0) {
                throw new Error("Tổng có thể hoàn ứng không hợp lệ.");
            }
            if (refundAmount > tongCoTheHoanUng) {
                errorMss.push("Số tiền hoàn ứng lần này phải nhỏ hơn hoặc bằng Tổng có thể hoàn ứng (" + tongCoTheHoanUng + ").");
            }
        } catch (eRefund) {
            errorMss.push("Không thể kiểm tra Tổng có thể hoàn ứng. " + String(eRefund.message || eRefund));
        } finally {
            try { if (paymentFile) paymentFile.doClose(); } catch (eClosePayment) {}
        }
    }

//    if(refundAmount == 0 && amountField == 0 && approvedInvoiceAmount == 0) {
//        errorMss.push("Vui lòng nhập số tiền.");
//    }

    if (amountField > 0) {
        var paymentMethod = record["payment.method"];
        if (!paymentMethod) {
            errorMss.push("Vui lòng chọn phương thức thanh toán.");
        } else {
            if (paymentMethod === "CHUYENKHOAN") {
                if (!record["beneficiary.account"]) {
                    errorMss.push("Số tài khoản thụ hưởng không được để trống.");
                } else {
                    var beneficiaryAccount = String(record["beneficiary.account"]).trim();
                    if (!/^\d+$/.test(beneficiaryAccount)) {
                        errorMss.push("Số tài khoản thụ hưởng chỉ được phép nhập số.");
                    } else {
                        checkMaxLength(beneficiaryAccount, 255, "Số tài khoản thụ hưởng");
                    }
                }

                if (!record["beneficiary.bank"]) {
                    errorMss.push("Ngân hàng thụ hưởng không được để trống.");
                } else {
                    var bankValue = String(record["beneficiary.bank"]).trim();
                    checkMaxLength(bankValue, 255, "Ngân hàng thụ hưởng");

                    // Lấy danh sách Value List từ biến $bankcode của hệ thống
                    var validBankCodes = vars.$bankcode;
                    var isBankValid = false;

                    if (validBankCodes != null) {
                        // Ép kiểu về mảng Javascript chuẩn (phòng trường hợp là SCArray của HPSM)
                        var bankCodeArray = (typeof validBankCodes.toArray === 'function') ? validBankCodes.toArray() : validBankCodes;

                        // Kiểm tra giá trị có nằm trong Value List không
                        for (var i = 0; i < bankCodeArray.length; i++) {
                            if (bankCodeArray[i] != null && String(bankCodeArray[i]).trim() === bankValue) {
                                isBankValid = true;
                                break;
                            }
                        }
                    }

                    if (!isBankValid) {
                        errorMss.push("Ngân hàng thụ hưởng không hợp lệ. Vui lòng chọn ngân hàng có trong danh sách.");
                    }
                }

                if (!record["beneficiary.name"]) {
                    errorMss.push("Tên chủ tài khoản thụ hưởng không được để trống.");
                } else {
                    checkMaxLength(record["beneficiary.name"], 255, "Tên chủ tài khoản thụ hưởng");
                }

                if (!record["transaction.des"]) {
                    errorMss.push("Nội dung giao dịch không được để trống.");
                } else {
                    checkMaxLength(record["transaction.des"], 255, "Nội dung giao dịch");
                }

            } else if (paymentMethod === "TIENMAT") {
                if (!record["beneficiary.name"]) {
                    errorMss.push("Họ tên người thụ hưởng tiền mặt không được để trống.");
                } else {
                    checkMaxLength(record["beneficiary.name"], 255, "Họ tên người thụ hưởng tiền mặt");
                }

                if (!record["identity.number"]) {
                    errorMss.push("Số giấy tờ tùy thân (CMND/CCCD/Hộ chiếu) không được để trống.");
                } else {
                    var identityNumber = String(record["identity.number"]).trim();
                    if (!/^\d+$/.test(identityNumber)) {
                        errorMss.push("Số giấy tờ tùy thân chỉ được phép nhập số.");
                    } else {
                        checkMaxLength(identityNumber, 255, "Số giấy tờ tùy thân");
                    }
                }

                if (!record["issued.date"]) {
                    errorMss.push("Ngày cấp giấy tờ tùy thân không được để trống.");
                } else {
                    var issuedDate = new Date(record["issued.date"]);
                    var today = new Date();

                    issuedDate.setHours(0, 0, 0, 0);
                    today.setHours(0, 0, 0, 0);

                    if (issuedDate > today) {
                        errorMss.push("Ngày cấp giấy tờ tùy thân không được vượt quá ngày hiện tại.");
                    }
                }

                if (!record["issued.place"]) {
                    errorMss.push("Nơi cấp giấy tờ tùy thân không được để trống.");
                } else {
                    checkMaxLength(record["issued.place"], 255, "Nơi cấp giấy tờ tùy thân");
                }

                if (!record["phone"]) {
                    errorMss.push("Số điện thoại người thụ hưởng không được để trống.");
                } else {
                    var phone = String(record["phone"]).trim();
                    if (!/^\d+$/.test(phone)) {
                        errorMss.push("Số điện thoại chỉ được chứa các chữ số.");
                    }
                    if (phone.length !== 10) {
                        errorMss.push("Số điện thoại phải gồm đúng 10 số.");
                    }
                    if (phone.charAt(0) !== "0") {
                        errorMss.push("Số điện thoại phải bắt đầu bằng số 0.");
                    }
                }

                if (!record["transaction.des"]) {
                    errorMss.push("Nội dung giao dịch không được để trống.");
                } else {
                    checkMaxLength(record["transaction.des"], 255, "Nội dung giao dịch");
                }
            }
        }
    }
    return errorMss;
}

function validateVendorAndPaymentDetailsOnWorkflow(record) {
    var paymentId = String(record.id || "");
    var vendor = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
    var rc = vendor.doSelect('payment.id="' + paymentId + '"');

    try {
        vendor.doClose();
    } catch (e) {}

    return rc == RC_SUCCESS ? null : ["Vui lòng chọn nhà cung cấp."];
}

/**
 * BR-002-16: Kiểm tra lại trạng thái hóa đơn trước khi trình phiếu
 * @param {String} paymentId - ID của phiếu đề nghị thanh toán
 * @returns {Array|null} Trả về mảng chứa thông báo lỗi nếu có
 */
function validateInvoices(paymentId) {
    if (!paymentId) return null;

    var errorMss = [];
    var hasInvalidInvoice = false;

    var prepInvoiceFile = new SCFile('esdHTKTpaymentInvoice', SCFILE_READONLY);
    var rc = prepInvoiceFile.doSelect('payment.id="' + paymentId + '"');

    while (rc == RC_SUCCESS) {
        var invoiceId = prepInvoiceFile['invoice.id'];

        if (invoiceId) {
            var invoiceFile = new SCFile('esdHTKTinvoice');
            var invRc = invoiceFile.doSelect('id="' + invoiceId + '"');

            if (invRc == RC_SUCCESS) {
                var lastCheckDate = invoiceFile['last.check.date'];

                var timeStatus = lib.ESD_HTKT_PREPAYMENT_VENDOR.checkInvoiceStatus(lastCheckDate);

                if (timeStatus == "Quá hạn") {

                    hasInvalidInvoice = true;

                    var apiResponse = lib.ESD_HTKT_SCHEDULE_OGL.callCheckInvoiceAPI(invoiceFile);

                    if (apiResponse && apiResponse.success === true) {
                        invoiceFile['last.check.date'] = new Date();
                        invoiceFile.doUpdate();
                    }
                }
            }
            try { invoiceFile.doClose(); } catch (e) {}
        }

        rc = prepInvoiceFile.getNext();
    }

    try { prepInvoiceFile.doClose(); } catch (e) {}

    if (hasInvalidInvoice) {
        errorMss.push("Đề nghị thanh toán đang chứa hóa đơn quá hạn kiểm tra. Vui lòng kiểm tra lại các hóa đơn");
    }

    return errorMss.length > 0 ? errorMss : null;
}


/* =============================================================================
 * 5. MỞ RỘNG TÍCH HỢP BẢN TRÌNH KÝ & KÝ SỐ DSM (EXTENSIONS VERSION 2.0.0)
 * ============================================================================= */

function htktWfCommon() {
    return lib.ESD_HTKT_PAYMENT_COMMON;
}

function htktWfDocument() {
    return lib.ESD_HTKT_PAYMENT_DOCUMENT;
}

function htktWfOk(data, message) {
    return htktWfCommon().ok(data, message || "Thành công", "OK");
}

function htktWfFail(code, message, detail, data) {
    return htktWfCommon().fail(
            code || "WORKFLOW_ERROR",
            message || "Có lỗi xảy ra khi xử lý workflow.",
            detail || "",
            data
    );
}

function htktWfFailException(code, message, error, data) {
    return htktWfCommon().failFromException(
            code || "WORKFLOW_ERROR",
            message || "Có lỗi xảy ra khi xử lý workflow.",
            error,
            data
    );
}

function htktWfAssertDependencies(requireDocument) {
    if (!lib || !lib.ESD_HTKT_PAYMENT_COMMON || typeof lib.ESD_HTKT_PAYMENT_COMMON.ok !== "function") {
        throw new Error("Thiếu ESD_HTKT_PAYMENT_COMMON.");
    }

    if (requireDocument === true &&
            (!lib.ESD_HTKT_PAYMENT_DOCUMENT ||
                    typeof lib.ESD_HTKT_PAYMENT_DOCUMENT.generateAndUploadPresentation !== "function" ||
                    typeof lib.ESD_HTKT_PAYMENT_DOCUMENT.getCurrentPresentation !== "function" ||
                    typeof lib.ESD_HTKT_PAYMENT_DOCUMENT.replaceCurrentVersion !== "function" ||
                    typeof lib.ESD_HTKT_PAYMENT_DOCUMENT.invalidateCurrentCycle !== "function")
    ) {
        throw new Error("Thiếu hoặc sai contract ESD_HTKT_PAYMENT_DOCUMENT.");
    }
}

function htktWfPhase(record) { return htktWfCommon().getCurrentPhase(record); }
function htktWfInitialRole(record) { return htktWfCommon().getInitialRole(record); }
function htktWfPaymentId(record) { return htktWfCommon().getRecordId(record); }
function htktWfCurrentUser() { return htktWfCommon().getCurrentUser(); }
function htktWfRead(record, fields) { return htktWfCommon().readString(record, fields, ""); }
function htktWfSameUser(u1, u2) { return htktWfCommon().equalsIgnoreCase(u1, u2); }

function htktWfIsSubmissionPhaseValue(phase) {
    return phase === HTKT_WF_PHASE.INITIAL_DMMS || phase === HTKT_WF_PHASE.INITIAL_KTTC;
}

function htktWfIsReviewPhaseValue(phase) {
    return phase === HTKT_WF_PHASE.CHECK_DMMS || phase === HTKT_WF_PHASE.CHECK_FINAL;
}

function htktWfIsSignaturePhaseValue(phase) {
    return phase === HTKT_WF_PHASE.APPROVAL_DMMS ||
            phase === HTKT_WF_PHASE.APPROVAL_KTTC ||
            phase === HTKT_WF_PHASE.APPROVAL_FINAL;
}

function getCurrentActorField(record) {
    var phase = htktWfPhase(record);

    switch (phase) {
        case HTKT_WF_PHASE.INITIAL_DMMS:
            return "created.by";
        case HTKT_WF_PHASE.INITIAL_KTTC:
            return htktWfInitialRole(record) === "kttc" ? "created.by" : "user.checker.kttc";
        case HTKT_WF_PHASE.CHECK_DMMS:
            return "user.checker.dmms";
        case HTKT_WF_PHASE.APPROVAL_DMMS:
            return "user.approver.dmms";
        case HTKT_WF_PHASE.APPROVAL_KTTC:
            return "user.approver.kttc";
        case HTKT_WF_PHASE.CHECK_FINAL:
            return "user.checker.final";
        case HTKT_WF_PHASE.APPROVAL_FINAL:
            return "user.approver.final";
        default:
            return "";
    }
}

function getWorkflowContext(record) {
    if (!record) {
        return htktWfFail("MISSING_WORKFLOW_RECORD", "Không có bản ghi đề nghị thanh toán.");
    }

    try {
        htktWfAssertDependencies(false);
        var phase = htktWfPhase(record);
        var initialRole = htktWfInitialRole(record);
        var actorField = getCurrentActorField(record);
        var expectedActors = [];
        var actor = actorField ? htktWfRead(record, [actorField]) : "";

        if (actor) {
            expectedActors.push(actor);
        }

        if (phase === HTKT_WF_PHASE.INITIAL_KTTC && initialRole === "kttc") {
            var checkerKttc = htktWfRead(record, ["user.checker.kttc"]);
            if (checkerKttc && !htktWfSameUser(checkerKttc, actor)) {
                expectedActors.push(checkerKttc);
            }
        }

        return htktWfOk({
            paymentId: htktWfPaymentId(record),
            currentPhase: phase,
            initialRole: initialRole,
            currentStatus: htktWfRead(record, ["status"]),
            currentUser: htktWfCurrentUser(),
            actorField: actorField,
            expectedActor: actor,
            expectedActors: expectedActors,
            isSubmissionPhase: htktWfIsSubmissionPhaseValue(phase),
            isReviewPhase: htktWfIsReviewPhaseValue(phase),
            isSignaturePhase: htktWfIsSignaturePhaseValue(phase),
            isFinalApproval: phase === HTKT_WF_PHASE.APPROVAL_FINAL
        }, "Đã lấy workflow context.");
    } catch (error) {
        return htktWfFailException("WORKFLOW_CONTEXT_EXCEPTION", "Không lấy được workflow context.", error);
    }
}

function isReviewPhase(record) {
    return htktWfIsReviewPhaseValue(htktWfPhase(record));
}

function isSignaturePhase(record) {
    return htktWfIsSignaturePhaseValue(htktWfPhase(record));
}



// Kiểm tra quyền hiển thị Workflow Action Test ký.
function checkCanSign(record) {
    var actorResult = validateCurrentActor(record);

    if (!actorResult || actorResult.success !== true) {
        return "F";
    }

    if (!actorResult.data || actorResult.data.isSignaturePhase !== true) {
        return "F";
    }

    return "T";
}

function validateCurrentActor(record) {
    var contextResult = getWorkflowContext(record);
    if (contextResult.success !== true) return contextResult;

    var context = contextResult.data;
    if (!context.currentUser) {
        return htktWfFail("MISSING_CURRENT_USER", "Không xác định được người dùng hiện tại.");
    }
    if (!context.actorField) {
        return htktWfFail("WORKFLOW_PHASE_NOT_SUPPORTED", "Phase hiện tại không được hỗ trợ.", "currentPhase=" + context.currentPhase, context);
    }
    if (!context.expectedActors.length) {
        return htktWfFail("WORKFLOW_ACTOR_NOT_CONFIGURED", "Chưa cấu hình người xử lý cho bước hiện tại.", "actorField=" + context.actorField, context);
    }

    for (var i = 0; i < context.expectedActors.length; i++) {
        if (htktWfSameUser(context.currentUser, context.expectedActors[i])) {
            return htktWfOk(context, "Người dùng được phép xử lý bước này.");
        }
    }

    return htktWfFail("INVALID_CURRENT_ACTOR", "Người dùng hiện tại không được phép xử lý bước này.", "currentUser=" + context.currentUser, context);
}

function validateLatestWorkflowActor(record) {
    try {
        // Đã đổi từ PREPAYMENT sang PAYMENT tương ứng với module Thanh Toán
        if (
            !lib ||
            !lib.ESD_HTKT_PAYMENT_LOAD_APRROVAL_COMBOBOX ||
            typeof lib.ESD_HTKT_PAYMENT_LOAD_APRROVAL_COMBOBOX.syncPaymentApprovalFromDatabase !== "function"
        ) {
            return htktWfFail(
                "WORKFLOW_ACTOR_REFRESH_DEPENDENCY_MISSING",
                "Không kiểm tra được người xử lý mới nhất của hồ sơ. Vui lòng tải lại hồ sơ.",
                "Thiếu ESD_HTKT_PAYMENT_LOAD_APRROVAL_COMBOBOX.syncPaymentApprovalFromDatabase()."
            );
        }

        lib.ESD_HTKT_PAYMENT_LOAD_APRROVAL_COMBOBOX
            .syncPaymentApprovalFromDatabase(record);

        var actorResult = validateCurrentActor(record);

        if (!actorResult || actorResult.success !== true) {
            if (actorResult && actorResult.code === "INVALID_CURRENT_ACTOR") {
                return htktWfFail(
                    "PAYMENT_REASSIGNED", // Đổi từ PREPAYMENT_REASSIGNED
                    "Hồ sơ đã được tái phân công cho cán bộ khác. Vui lòng tải lại hồ sơ.",
                    actorResult.detail || "",
                    actorResult.data || null
                );
            }

            return actorResult || htktWfFail(
                "WORKFLOW_ACTOR_VALIDATION_FAILED",
                "Không kiểm tra được người xử lý hiện tại của hồ sơ. Vui lòng tải lại hồ sơ."
            );
        }

        return actorResult;
    } catch (error) {
        return htktWfFailException(
            "WORKFLOW_ACTOR_REFRESH_EXCEPTION",
            "Không kiểm tra được người xử lý mới nhất của hồ sơ. Vui lòng tải lại hồ sơ.",
            error
        );
    }
}
function htktWfValidateLegacy(record) {
    var errors;
    try {
        errors = validateDataInPhase(record, "wf");
    } catch (error) {
        return htktWfFailException("WORKFLOW_VALIDATION_EXCEPTION", "Không thực hiện được validation workflow hiện tại.", error);
    }

    if (errors && errors.length) {
        return htktWfFail("WORKFLOW_VALIDATION_FAILED", "Dữ liệu chưa đủ điều kiện chuyển bước.", errors.join("\n"), { errors: errors });
    }

    return htktWfOk({ valid: true }, "Dữ liệu workflow hợp lệ.");
}

function getWorkflowConfig() {
    try {
        htktWfAssertDependencies(false);
        return htktWfOk({
            serviceName: WF_CONFIG.SERVICE_NAME,
            serviceVersion: WF_CONFIG.SERVICE_VERSION,
            commonVersion: htktWfCommon().getVersion(),
            phases: HTKT_WF_PHASE,
            dsmFileStatuses: HTKT_WF_DSM_STATUS,
            legacyLogicPreserved: true
        }, "Đã lấy cấu hình workflow.");
    } catch (error) {
        return htktWfFailException("WORKFLOW_DEPENDENCY_ERROR", "Không khởi tạo được tích hợp workflow.", error);
    }
}

/* Trình phiếu: validate cũ -> sinh/upload PDF -> gọi nguyên updateNextStatus() */
function submitForApproval(record) {
    var phase = htktWfPhase(record);
    if (!htktWfIsSubmissionPhaseValue(phase)) {
        return htktWfFail("INVALID_SUBMISSION_PHASE", "Chỉ được sinh bản trình ký tại bước Trình phê duyệt.", "currentPhase=" + phase);
    }

    try {
        htktWfAssertDependencies(true);
    } catch (error) {
        return htktWfFailException("WORKFLOW_DEPENDENCY_ERROR", "Không khởi tạo được dịch vụ bản trình ký.", error);
    }

    var actorResult = validateCurrentActor(record);
    if (actorResult.success !== true) return actorResult;

    var validationResult = htktWfValidateLegacy(record);
    if (validationResult.success !== true) return validationResult;

    var documentResult = null;
    try {
        // updateNextStatus đọc oldrecord và tự lưu attachment khi rời initial_kttc.
        documentResult = updateNextStatus(record);
    } catch (errorUpdate) {
        return htktWfFailException(
                "WORKFLOW_STATUS_UPDATE_EXCEPTION",
                "Không tạo được bản trình ký hoặc không cập nhật được workflow.",
                errorUpdate,
                { document: documentResult ? documentResult.data : null, retrySafe: true }
        );
    }

    return htktWfOk({
        paymentId: actorResult.data.paymentId,
        submittedBy: actorResult.data.currentUser,
        previousPhase: phase,
        nextStatus: htktWfRead(record, ["status"]),
        document: documentResult ? documentResult.data : null,
        recordMustBeSaved: true
    }, phase === HTKT_WF_PHASE.INITIAL_KTTC
            ? "Sinh bản trình ký và chuyển trạng thái thành công."
            : "Chuyển trạng thái thành công.");
}

/* Rà soát chỉ xác nhận, không ký số */
function confirmReview(record) {
    var phase = htktWfPhase(record);
    if (!htktWfIsReviewPhaseValue(phase)) {
        return htktWfFail("INVALID_REVIEW_PHASE", "Phase hiện tại không phải bước rà soát.", "currentPhase=" + phase);
    }

    var actorResult = validateCurrentActor(record);
    if (actorResult.success !== true) return actorResult;

    var validationResult = htktWfValidateLegacy(record);
    if (validationResult.success !== true) return validationResult;

    try {
        updateNextStatus(record);
    } catch (error) {
        return htktWfFailException("WORKFLOW_STATUS_UPDATE_EXCEPTION", "Không cập nhật được trạng thái sau rà soát.", error);
    }

    return htktWfOk({
        paymentId: actorResult.data.paymentId,
        confirmedBy: actorResult.data.currentUser,
        previousPhase: phase,
        nextStatus: htktWfRead(record, ["status"]),
        recordMustBeSaved: true
    }, "Xác nhận rà soát thành công.");
}

/* Lấy context ký; tuyệt đối không chuyển workflow tại đây */
function prepareApprovalForSignature(record) {
    var phase = htktWfPhase(record);
    if (!htktWfIsSignaturePhaseValue(phase)) {
        return htktWfFail("SIGNATURE_NOT_REQUIRED", "Phase hiện tại không phải bước phê duyệt ký số.", "currentPhase=" + phase);
    }

    try {
        htktWfAssertDependencies(true);
    } catch (error) {
        return htktWfFailException("WORKFLOW_DEPENDENCY_ERROR", "Không khởi tạo được dịch vụ bản trình ký.", error);
    }

    var actorResult = validateCurrentActor(record);
    if (actorResult.success !== true) return actorResult;

    var validationResult = htktWfValidateLegacy(record);
    if (validationResult.success !== true) return validationResult;

    var documentResult = htktWfDocument().getCurrentPresentation({
        paymentId: actorResult.data.paymentId
    });

    if (!documentResult || documentResult.success !== true) {
        return documentResult || htktWfFail("CURRENT_PRESENTATION_NOT_FOUND", "Không tìm thấy bản trình ký hiện hành.");
    }

    var doc = documentResult.data;
    var docStatus = String(doc.status || "").trim().toUpperCase();
    var isSignableStatus = docStatus === "CURRENT" || docStatus === "CHO KY SO" || docStatus === "DANG THUC HIEN KY SO" || !docStatus;
    if (!isSignableStatus || !doc.ecmObjectId) {
        return htktWfFail("CURRENT_PRESENTATION_NOT_SIGNABLE", "Bản trình ký hiện hành không ở trạng thái cho phép ký.", "status=" + String(doc.status || ""), doc);
    }

    return htktWfOk({
        moduleCode: "HTKT_PAYMENT",
        paymentId: actorResult.data.paymentId,
        currentPhase: phase,
        currentUser: actorResult.data.currentUser,
        isFinalApproval: phase === HTKT_WF_PHASE.APPROVAL_FINAL,
        document: {
            attachmentId: doc.id,
            ecmDocId: doc.ecmDocId,
            ecmObjectId: doc.ecmObjectId,
            fileName: doc.name,
            size: doc.size,
            groupCode: doc.groupCode,
            status: doc.status,
            versionNo: doc.versionNo
        }
    }, "Đã chuẩn bị context ký số.");
}

/*
 * Dùng trong Condition của RuleSet sau khi popup ký đóng.
 * Chỉ trả T khi attachment hiện hành đã được thay bằng bản sau ký.
 */
function checkSignatureSucceeded(record) {
    try {
        htktWfAssertDependencies(true);

        var oldAttachmentId = String(vars["$L.htktSignOldAttachmentId"] || "").trim();
        var oldObjectId = String(vars["$L.htktSignOldObjectId"] || "").trim();
        if (!record || !oldAttachmentId || !oldObjectId) return "F";

        var currentResult = htktWfDocument().getCurrentPresentation({
            paymentId: htktWfPaymentId(record)
        });
        if (!currentResult || currentResult.success !== true || !currentResult.data) return "F";

        var currentAttachmentId = String(currentResult.data.id || "").trim();
        var currentObjectId = String(currentResult.data.ecmObjectId || "").trim();

        return currentAttachmentId &&
        currentObjectId &&
        currentAttachmentId !== oldAttachmentId &&
        currentObjectId !== oldObjectId
                ? "T"
                : "F";
    } catch (ignore) {
        return "F";
    }
}

function htktWfDsmStatus(value) {
    var status = htktWfCommon().trim(value);
    return status.length === 1 ? "0" + status : status;
}

function htktWfExtractSignResult(result) {
    var root = result || {};
    var payload = root.data || root;
    var signed = null;

    if (htktWfCommon().isArray(payload.signed)) {
        signed = payload.signed.length ? payload.signed[0] : null;
    } else if (payload.data && htktWfCommon().isArray(payload.data.signed)) {
        signed = payload.data.signed.length ? payload.data.signed[0] : null;
    } else if (htktWfCommon().isArray(root.signed)) {
        signed = root.signed.length ? root.signed[0] : null;
    }

    signed = signed || payload || root;

    return {
        requestId: htktWfRead(root, ["requestId", "request_id"]),
        transactionId: htktWfRead(root, ["transaction_id", "transactionId"]) || htktWfRead(signed, ["tranidresult", "transaction_id"]),
        status: htktWfDsmStatus(htktWfRead(signed, ["status", "signStatus"])),
        oldObjectId: htktWfRead(signed, ["objectid", "oldObjectId"]) || htktWfRead(root, ["objectid", "oldObjectId"]),
        newObjectId: htktWfRead(signed, ["objectidext", "newObjectId"]) || htktWfRead(root, ["objectidext", "newObjectId", "data_to_be_signed"]),
        newDocId: htktWfRead(signed, ["docidext", "newDocId"]) || htktWfRead(root, ["docidext", "newDocId"]),
        signerUser: htktWfRead(signed, ["userad", "signerUser"]) || htktWfRead(root, ["userad", "signerUser"])
    };
}

/* Chỉ chuyển workflow khi DSM status=07 và có Object ID sau ký */
function completeApprovalAfterSignature(record, signResult) {
    var phase = htktWfPhase(record);
    if (!htktWfIsSignaturePhaseValue(phase)) {
        return htktWfFail("INVALID_SIGNATURE_PHASE", "Phase hiện tại không phải bước phê duyệt ký số.", "currentPhase=" + phase);
    }

    try {
        htktWfAssertDependencies(true);
    } catch (error) {
        return htktWfFailException("WORKFLOW_DEPENDENCY_ERROR", "Không khởi tạo được dịch vụ bản trình ký.", error);
    }

    var actorResult = validateCurrentActor(record);
    if (actorResult.success !== true) return actorResult;

    var sign = htktWfExtractSignResult(signResult);

    if (sign.signerUser && !htktWfSameUser(sign.signerUser, actorResult.data.currentUser)) {
        return htktWfFail("SIGNER_USER_MISMATCH", "Người ký DSM không khớp người xử lý hiện tại.", "signerUser=" + sign.signerUser, sign);
    }

    if (sign.status !== HTKT_WF_DSM_STATUS.ECM_UPLOADED) {
        return htktWfFail("SIGN_FILE_NOT_COMPLETED", "File ký số chưa hoàn tất trên ECM.", "DSM status=" + sign.status, {
            requestId: sign.requestId,
            transactionId: sign.transactionId,
            status: sign.status,
            pending: sign.status === HTKT_WF_DSM_STATUS.REQUESTED || sign.status === HTKT_WF_DSM_STATUS.SENT || sign.status === HTKT_WF_DSM_STATUS.SIGNED,
            failed: sign.status === HTKT_WF_DSM_STATUS.FAILED || sign.status === HTKT_WF_DSM_STATUS.UNKNOWN_ERROR
        });
    }

    if (!sign.oldObjectId || !sign.newObjectId) {
        return htktWfFail("SIGN_OBJECT_ID_INVALID", "Thiếu Object ID trước ký hoặc sau ký.", "status=07 yêu cầu objectid và objectidext.", sign);
    }

    var currentResult = htktWfDocument().getCurrentPresentation({
        paymentId: actorResult.data.paymentId
    });

    if (!currentResult || currentResult.success !== true) {
        return currentResult || htktWfFail("CURRENT_PRESENTATION_NOT_FOUND", "Không tìm thấy bản trình ký hiện hành.");
    }

    var currentDoc = currentResult.data;
    var nextStatus = NEXT_PHASE_MAP[phase] || "";

    if (currentDoc.ecmObjectId === sign.newObjectId && nextStatus && htktWfRead(record, ["status"]) === nextStatus) {
        return htktWfOk({
            idempotent: true,
            paymentId: actorResult.data.paymentId,
            nextStatus: nextStatus,
            currentDocument: currentDoc,
            recordMustBeSaved: false
        }, "Kết quả ký và workflow đã được hoàn tất trước đó.");
    }

    var replaceResult = htktWfDocument().replaceCurrentVersion({
        paymentId: actorResult.data.paymentId,
        currentUser: actorResult.data.currentUser,
        oldObjectId: sign.oldObjectId,
        newObjectId: sign.newObjectId,
        newDocId: sign.newDocId,
        fileName: currentDoc.name
    });

    if (!replaceResult || replaceResult.success !== true) {
        return htktWfFail(
                "SIGNED_PRESENTATION_UPDATE_FAILED",
                (replaceResult && replaceResult.message) ? replaceResult.message : "Không cập nhật được PDF sau ký.",
                (replaceResult && replaceResult.detail) ? replaceResult.detail : "",
                replaceResult ? replaceResult.data : null
        );
    }

    var completeResult = null;
    if (phase === HTKT_WF_PHASE.APPROVAL_FINAL) {
        completeResult = htktWfDocument().markCurrentPresentationCompleted({
            paymentId: actorResult.data.paymentId
        });

        if (!completeResult || completeResult.success !== true) {
            return htktWfFail(
                    "PRESENTATION_COMPLETE_FAILED",
                    (completeResult && completeResult.message) ? completeResult.message : "Không đánh dấu được bản trình ký hoàn tất.",
                    (completeResult && completeResult.detail) ? completeResult.detail : "",
                    completeResult ? completeResult.data : null
            );
        }
    }

    try {
        updateNextStatus(record);
    } catch (errorUpdate) {
        return htktWfFailException(
                "WORKFLOW_STATUS_UPDATE_EXCEPTION",
                "Đã cập nhật PDF sau ký nhưng không cập nhật được workflow.",
                errorUpdate,
                { replaceResult: replaceResult.data, retrySafe: true }
        );
    }

    return htktWfOk({
        idempotent: replaceResult.data && replaceResult.data.idempotent === true,
        paymentId: actorResult.data.paymentId,
        approvedBy: actorResult.data.currentUser,
        previousPhase: phase,
        nextStatus: htktWfRead(record, ["status"]),
        dsm: sign,
        versionResult: replaceResult.data,
        completionResult: completeResult ? completeResult.data : null,
        recordMustBeSaved: true
    }, phase === HTKT_WF_PHASE.APPROVAL_FINAL ? "Ký số và phê duyệt cuối thành công." : "Ký số và chuyển bước phê duyệt thành công.");
}

function deleteDocumentsBeforeReturn(record) {
    try {
        htktWfAssertDependencies(true);
        return htktWfDocument().invalidateCurrentCycle({
            paymentId: htktWfPaymentId(record),
            currentUser: htktWfCurrentUser(),
            reason: htktWfRead(record, ["return.reason"])
        });
    } catch (error) {
        return htktWfFailException(
                "PRESENTATION_HARD_DELETE_EXCEPTION",
                "Không xóa được tài liệu của vòng trình ký trên hệ thống lưu trữ.",
                error
        );
    }
}

/* Giữ API cũ để không làm hỏng Ruleset/đoạn gọi đã tồn tại. */
function invalidateDocumentsBeforeReturn(record) {
    return deleteDocumentsBeforeReturn(record);
}

/* Xóa cứng ECM trước, sau đó mới gọi nguyên returnToUpdate() cũ. */
function requestCorrection(record) {
    var phase = htktWfPhase(record);

    try {
        if (checkCanReturn(record) !== "T") {
            return htktWfFail(
                    "RETURN_NOT_ALLOWED",
                    "Người dùng hiện tại không được phép yêu cầu chỉnh sửa.",
                    "currentPhase=" + phase
            );
        }
    } catch (errorPermission) {
        return htktWfFailException(
                "RETURN_PERMISSION_CHECK_EXCEPTION",
                "Không kiểm tra được quyền yêu cầu chỉnh sửa.",
                errorPermission
        );
    }

    if (!getReturnToUpdatePhase(record)) {
        return htktWfFail(
                "INVALID_INITIAL_ROLE",
                "Không xác định được initial.role để trả phiếu về chỉnh sửa."
        );
    }

    var deleteResult = deleteDocumentsBeforeReturn(record);
    if (!deleteResult || deleteResult.success !== true) {
        return htktWfFail(
                "PRESENTATION_HARD_DELETE_FAILED",
                (deleteResult && deleteResult.message) ? deleteResult.message : "Không xóa được tài liệu của vòng trình ký trên hệ thống lưu trữ.",
                (deleteResult && deleteResult.detail) ? deleteResult.detail : "",
                deleteResult ? deleteResult.data : null
        );
    }

    try {
        returnToUpdate(record, true);
    } catch (errorReturn) {
        return htktWfFailException(
                "RETURN_TO_UPDATE_EXCEPTION",
                "Đã xóa tài liệu trên hệ thống lưu trữ nhưng không cập nhật được workflow.",
                errorReturn,
                { documentDeletion: deleteResult.data, retrySafe: true }
        );
    }

    return htktWfOk({
        paymentId: htktWfPaymentId(record),
        requestedBy: htktWfCurrentUser(),
        previousPhase: phase,
        nextStatus: htktWfRead(record, ["status"]),
        documentDeletion: deleteResult.data,
        recordMustBeSaved: true
    }, "Yêu cầu chỉnh sửa, xóa tài liệu và chuyển hồ sơ về cập nhật thành công.");
}




///START:SSAX01/////////////////////////////////////////////////////////////
// --- CÁC HÀM HỖ TRỢ KIỂM TRA TẠM ỨNG TRÊN PHIẾU BỔ SUNG ---

function checkRefundAmountMatch(paymentId, vendorId) {
    if (!paymentId || !vendorId) {
        return {
            headerRefundAmount: 0,
            totalListRefundAmount: 0,
            isMatch: false
        };
    }

    var headerRefundAmount = 0;
    var paymentVendorFile = null;
    try {
        paymentVendorFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
        var queryPv = 'payment.id = "' + escapeSmQueryValue(paymentId) + '" AND vendor.id = "' + escapeSmQueryValue(vendorId) + '"';
        var rcPv = paymentVendorFile.doSelect(queryPv);
        if (rcPv == RC_SUCCESS) {
            headerRefundAmount = Number(paymentVendorFile["refund.amount"] || 0);
        }
    } catch (e) {
        // print("[DEBUG checkRefundAmountMatch] Error querying paymentVendor: " + e);
    } finally {
        if (paymentVendorFile) {
            try { paymentVendorFile.doClose(); } catch (e) {}
        }
    }

    var totalListRefundAmount = 0;
    var entryFile = null;
    try {
        entryFile = new SCFile("esdHTKTpaymentEntry", SCFILE_READONLY);
        var queryEntry = 'payment.id = "' + escapeSmQueryValue(paymentId) + '" AND vendor.id = "' + escapeSmQueryValue(vendorId) + '" AND entry.type = "PREPAYMENT"';
        var rcEntry = entryFile.doSelect(queryEntry);
        while (rcEntry == RC_SUCCESS) {
            totalListRefundAmount += Number(entryFile["amount"] || 0);
            rcEntry = entryFile.getNext();
        }
    } catch (e2) {
        // print("[DEBUG checkRefundAmountMatch] Error querying paymentEntry: " + e2);
    } finally {
        if (entryFile) {
            try { entryFile.doClose(); } catch (e) {}
        }
    }

    var intHeader = Math.round(headerRefundAmount * 100000);
    var intTotalList = Math.round(totalListRefundAmount * 100000);
    var isMatch = (intHeader === intTotalList);

    return {
        headerRefundAmount: headerRefundAmount,
        totalListRefundAmount: totalListRefundAmount,
        isMatch: isMatch
    };
}

// Thêm hàm kiểm tra tất cả nhà cung cấp sử dụng JOIN để lấy vendor.number đưa vào thông báo lỗi
function validateAllVendorsRefundMatch(paymentId) {
    if (!paymentId) {
        return { success: false, error: "Không tìm thấy mã đề nghị thanh toán." };
    }

    var pvFile = null;
    try {
        pvFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);

        var select = "SELECT pv.vendor.id, v.vendor.number";
        var mapping = " FROM esdHTKTpaymentVendor pv JOIN esdHTKTvendor v ON (pv.vendor.id = v.id)";
        var control = ' WHERE pv.payment.id = "' + escapeSmQueryValue(paymentId) + '"';

        var rc = pvFile.doSelect(select + mapping + control);

        while (rc == RC_SUCCESS) {
            var vendorId = String(pvFile["vendor.id"] || "").trim();
            // Lấy vendor.number từ bảng esdHTKTvendor đã join
            var vendorNumber = String(pvFile["v.vendor.number"] || vendorId).trim();

            if (vendorId) {
                var checkResult = checkRefundAmountMatch(paymentId, vendorId);
                if (!checkResult.isMatch) {
                    return {
                        success: false,
                        error: "Số tiền hoàn ứng lần này của nhà cung cấp " + vendorNumber + " không khớp với tổng số tiền hoàn ứng lần này trong danh sách công nợ (Trên phiếu: " + checkResult.headerRefundAmount + ", Tổng trên danh sách: " + checkResult.totalListRefundAmount + ")."
                    };
                }
            }
            rc = pvFile.getNext();
        }
        return { success: true };
    } catch (e) {
        return {
            success: false,
            error: "Lỗi kiểm tra số tiền hoàn ứng của nhà cung cấp: " + e
        };
    } finally {
        if (pvFile) {
            try { pvFile.doClose(); } catch (e) {}
        }
    }
}

function escapeSmQueryValue(value) {
    return String(value || "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
}

// Kiểm tra phương thức thanh toán của các NCC (>=2 NCC thì phải đồng nhất: chỉ TIENMAT hoặc chỉ CHUYENKHOAN)
function validateAllVendorsPaymentMethodMatch(paymentId) {
    if (!paymentId) {
        return { success: false, error: "Không tìm thấy mã đề nghị thanh toán." };
    }

    var pvFile = null;
    try {
        pvFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
        var query = 'payment.id="' + escapeSmQueryValue(paymentId) + '"';
        var rc = pvFile.doSelect(query);

        var count = 0;
        var hasCash = false;
        var hasTransfer = false;
        var hasOther = false;

        while (rc == RC_SUCCESS) {
            count++;
            var method = String(pvFile["payment.method"] || "").trim().toUpperCase();

            if (method === "TIENMAT") {
                hasCash = true;
            } else if (method === "CHUYENKHOAN") {
                hasTransfer = true;
            } else {
                hasOther = true;
            }

            rc = pvFile.getNext();
        }

        if (count >= 2) {
            if (hasOther || (hasCash && hasTransfer) || (!hasCash && !hasTransfer)) {
                return {
                    success: false,
                    error: "Phương thức toán của các nhà cung cấp đang không đồng nhất."
                };
            }
        }

        return { success: true };
    } catch (e) {
        return {
            success: false,
            error: "Lỗi kiểm tra phương thức thanh toán của nhà cung cấp: " + e
        };
    } finally {
        if (pvFile) {
            try { pvFile.doClose(); } catch (e) {}
        }
    }
}

