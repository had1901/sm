/**
 * ScriptLibrary : ESD_HTKT_PREPAYMENT_WF
 * -----------------------------------------------------------------------------
 * Module        : HTKT - Đề nghị tạm ứng
 * Version       : 2.1.0
 * Environment   : OpenText Service Manager (JavaScript ES5 Engine)
 *
 * Chức năng:
 * - Quản lý Workflow & Chuyển trạng thái Phiếu đề nghị tạm ứng.
 * - Kiểm tra quyền hạn (Checker/Approver), Validate dữ liệu theo Phase.
 * - Ghi nhận Lịch sử hoạt động (Activity History).
 * - Tích hợp Quản lý Bản trình ký PDF & Ký số DSM (v2.0.0).
 *
 * Phụ thuộc:
 * - ESD_HTKT_PREPAYMENT_COMMON >= 1.0.0
 * - ESD_HTKT_PREPAYMENT_DOCUMENT >= 2.0.0 (Optional/Dynamic)
 * - ESD_Utils, ESD_HTKT_SCHEDULE_OGL
 * -----------------------------------------------------------------------------
 */

/* =============================================================================
 * 1. CẤU HÌNH & HẰNG SỐ (CONFIG & CONSTANTS)
 * ============================================================================= */

var createActivity = lib.ESD_Utils.createActivity;

var WF_CONFIG = {
    SERVICE_NAME: "ESD_HTKT_PREPAYMENT_WF",
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
    if (oldPhase === HTKT_WF_PHASE.INITIAL_KTTC) {
        htktWfAssertDependencies(true);

        var prepaymentId = htktWfPrepaymentId(record);
        var currentDocument = htktWfDocument().getCurrentPresentation({
            prepaymentId: prepaymentId
        });

        if (currentDocument && currentDocument.success === true) {
            documentResult = htktWfOk({
                idempotent: true,
                document: currentDocument.data
            }, "Bản trình ký đã được tạo trước đó.");
        } else if (currentDocument && currentDocument.code && currentDocument.code !== "DOCUMENT_NOT_FOUND") {
            throw new Error(currentDocument.message || "Không kiểm tra được bản trình ký hiện tại.");
        } else {
            documentResult = htktWfDocument().generateAndUploadPresentation({
                prepaymentId: prepaymentId,
                currentUser: htktWfCurrentUser()
            });

            if (!documentResult || documentResult.success !== true) {
                var documentError = documentResult && documentResult.message
                        ? documentResult.message
                        : "Không sinh và lưu được bản trình ký.";
                if (documentResult && documentResult.detail) {
                    documentError += " " + documentResult.detail;
                }
                throw new Error(documentError);
            }
        }
    }

    if (currentPhase === "start") {
        record.status = "initialized";
    } else if (NEXT_PHASE_MAP[currentPhase]) {
        record.status = NEXT_PHASE_MAP[currentPhase];
    }

    if (currentPhase === "approval_final") {
//        record["completed.date"] = system.functions.tod();

        var contractId = record["contract.id"];
        if (contractId) {
            var docInfoFile = new SCFile("esdHDcontractDocInfo", SCFILE_READONLY);
            var docQuery = 'contract.id="' + contractId + '" and doc.type="BAOLANHTU" and status="Co hieu luc"';

            if (docInfoFile.doSelect(docQuery) == RC_SUCCESS) {
                // Gán trực tiếp vào record -> Workflow sẽ tự động lưu xuống DB cùng phiếu này
                record["guarantee.no"] = docInfoFile["doc.no"];
                record["issuing.bank"] = docInfoFile["issuing.bank"];
                record["guarantee.amount"] = Number(docInfoFile["guarantee.amount"]) || 0;
                record["guarantee.expiry.date"] = docInfoFile["expire.date"];
            }
            try { docInfoFile.doClose(); } catch (e) {}
        }
    }

    try {
        if (currentPhase == "initial_dmms") {
            lib.ESD_HTKT_PREPAYMENT_VENDOR.syncVendorOglFromPrepayment(record);
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

        var prepaymentId = String(record["id"] || record.id || "").trim();

        if (!currentUser || !prepaymentId) {
            return;
        }

        createActivity(
                "activityHTKTprepayment",
                activityType + ' Đề nghị Tạm ứng: Mã đề nghị: "' + prepaymentId + '"',
                prepaymentId,
                activityType,
                currentUser
        );
    } catch (e) {
        print(
                "[ESD_HTKT_PREPAYMENT_WF.createApprovalHistory] Không thể ghi activity: " + e.toString()
        );
    }
}

function cancelRequest(record) {
    // Bo sung duy nhat cho nut Xoa lon tren Workflow SM: go lien ket hoa don.
    var cancelPrepaymentId = String(record["id"] || record.id || "").trim();
    if (!cancelPrepaymentId) {
        throw new Error("Khong tim thay ma de nghi tam ung de xoa.");
    }
    var unlinkResult = lib.ESD_HTKT_PREPAYMENT_INVOICE.unlinkAllInvoicesOnPrepaymentCancel(cancelPrepaymentId);
    if (!unlinkResult || unlinkResult.success !== true) {
        throw new Error("Khong the xoa de nghi tam ung vi go lien ket hoa don that bai: " +
                (unlinkResult && unlinkResult.message ? unlinkResult.message : "Khong ro nguyen nhan."));
    }

    record.status = "cancelled";

    try {
        var currentUser = String(
                vars.$lo_operator["contact.name"] || vars["$lo.contact.name"] || ""
        ).trim();

        var prepaymentId = String(record["id"] || record.id || "").trim();

        if (currentUser && prepaymentId) {
            createActivity(
                    "activityHTKTprepayment",
                    "Xóa Đề nghị Tạm ứng",
                    prepaymentId,
                    "Xóa",
                    currentUser
            );
        }
    } catch (e) {
        print(
                "[ESD_HTKT_PREPAYMENT_WF.cancelRequest] Không thể ghi activity: " + e.toString()
        );
    }
}

function getReturnToUpdatePhase(record) {
    var initialRole = String(record && record["initial.role"] || "").trim().toLowerCase();

    if (initialRole === "dmms") return HTKT_WF_PHASE.INITIAL_DMMS;
    if (initialRole === "kttc") return HTKT_WF_PHASE.INITIAL_KTTC;
    return "";
}

function returnToUpdate(record, documentsAlreadyDeleted) {
    var returnPhase = getReturnToUpdatePhase(record);
    if (!returnPhase) {
        throw new Error("Không xác định được initial.role để trả phiếu về chỉnh sửa.");
    }

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
    record["current.phase"] = returnPhase;
    record.status = "request_edit";

    var currentUser = String(
            (vars.$lo_operator ? (vars.$lo_operator["contact.name"] || vars.$lo_operator["name"]) : "") ||
            vars["$lo.contact.name"] ||
            ""
    ).trim();

    var prepaymentId = String(record["id"] || record.id || "").trim();
    var returnReason = String(record["return.reason"] || record.return_reason || vars["$return.reason"] || "").trim();
    var createdBy = String(record["created.by"] || record.created_by || "").trim();
    var currentStatus = String(record.status || record["status"] || "").trim();

    // 2. Ghi Activity log
    try {
        if (currentUser && prepaymentId) {
            var activityDescription =
                    "Yêu cầu chỉnh sửa Đề nghị Tạm ứng" +
                    (returnReason ? '\nLý do: "' + returnReason + '"' : "");

            createActivity(
                    "activityHTKTprepayment",
                    activityDescription,
                    prepaymentId,
                    "Yêu cầu chỉnh sửa",
                    currentUser
            );
        }
    } catch (e) {
        print(
                "[ESD_HTKT_PREPAYMENT_WF.returnToUpdate] Không thể ghi activity: " + e.toString()
        );
    }

    // 3. GỌI GỬI EMAIL YÊU CẦU CHỈNH SỬA (S6_MAIL_01_02)
    try {
        if (prepaymentId && createdBy) {
            if (lib.ESD_HTKT_ACTION_WF_SEND_EMAIL && typeof lib.ESD_HTKT_ACTION_WF_SEND_EMAIL.sendEmailRequestEdit === "function") {
                lib.ESD_HTKT_ACTION_WF_SEND_EMAIL.sendEmailRequestEdit(record);
            }
        }
    } catch (eMail) {
    }
}


/* =============================================================================
 * 4. TẦNG VALIDATION NGHIỆP VỤ (BUSINESS VALIDATIONS)
 * ============================================================================= */

function validateDataInPhase(record) {
    var errorMss = [];

    // Validate chung thông tin NCC + thanh toán
    var vendorErrors = validateVendorAndPaymentDetailsOnWorkflow(record);
    if (vendorErrors && vendorErrors.length > 0) {
        errorMss = errorMss.concat(vendorErrors);
    }

    var currentPhase = record.current_phase || record["current.phase"];

    // Tái kiểm tra hóa đơn khi Trình phiếu
    if (currentPhase === "initial_dmms" || currentPhase === "initial_kttc") {
        var prepaymentId = String(record["id"] || record.id || "");
        var invoiceBrErrors = validateInvoices(prepaymentId);
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
            phaseErrors = validateFromPdCapThamQuyenToEnd(record);
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
    var prepaymentId = String(record["id"] || record.id || "");

    // Validate Tab hạch toán: bắt buộc (tổng nợ = tổng có)
    var accountingResult = validateRequiredEsdHTKTprepaymentEntry(prepaymentId);
    if (accountingResult.success !== true) {
        errorMss.push(
                accountingResult.error ||
                "Thông tin hạch toán là bắt buộc và tổng ghi nợ phải bằng tổng ghi có."
        );
    }

    // Validate Tab tài liệu đính kèm (Loại khấu trừ)
    var requiredDeductionType = validateRequiredEsdHTKTprepaymentInvoice(prepaymentId);
    if (requiredDeductionType.success !== true) {
        errorMss.push(
                requiredDeductionType.error ||
                "Hóa đơn bắt buộc chọn loại khấu trừ"
        );
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
//function validateFromPdCapThamQuyenToEnd() { return null; }
// THÊM THAM SỐ record VÀO ĐÂY
function validateFromPdCapThamQuyenToEnd(record) {
    var errorMss = [];

    try {
        var contractId = record["contract.id"];
        var currentRecordId = record["id"];
        var guaranteeAmountStr = null;

        // 1. Lấy giá trị bảo lãnh từ Database (bảng esdHDcontractDocInfo)
        if (contractId) {
            var docInfoFile = new SCFile("esdHDcontractDocInfo", SCFILE_READONLY);
            var docQuery = 'contract.id="' + contractId + '" and doc.type="BAOLANHTU" and status="Co hieu luc"';

            if (docInfoFile.doSelect(docQuery) == RC_SUCCESS) {
                guaranteeAmountStr = docInfoFile["guarantee.amount"];
            }
            try { docInfoFile.doClose(); } catch(e) {}
        }

        // Làm sạch chuỗi bảo lãnh để kiểm tra xem có hợp lệ và > 0 không
        var cleanGuaranteeStr = String(guaranteeAmountStr || "").replace(/,/g, '').trim();

        // Chỉ tiếp tục check nếu lấy được giá trị bảo lãnh hợp lệ từ DB và lớn hơn 0
        if (cleanGuaranteeStr !== "" && cleanGuaranteeStr !== "null" && lib.ESD_HTKT_Utils.compareMoneyStrings(cleanGuaranteeStr, "0") === 1) {

            // 2. Lấy số tiền đề nghị tạm ứng của phiếu hiện tại
            var currentAmountStr = String(record["amount"] || "0").trim();
            var totalAccountedAmountStr = "0";

            // 3. Truy vấn các phiếu Tạm ứng ĐÃ HẠCH TOÁN của cùng Hợp đồng này
            if (contractId) {
                var prepFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
                var query = 'contract.id="' + contractId + '" and (status="approved" or status="accounted")';
                var rc = prepFile.doSelect(query);

                while (rc == RC_SUCCESS) {
                    if (prepFile["id"] !== currentRecordId) {
                        var accountedAmtStr = String(prepFile["amount"] || "0").trim();
                        totalAccountedAmountStr = lib.ESD_HTKT_Utils.addStringsManual(totalAccountedAmountStr, accountedAmtStr);
                    }
                    rc = prepFile.getNext();
                }
                try { prepFile.doClose(); } catch(e) {}
            }

            // 4. Cộng tổng số tiền và so sánh bằng thư viện chuẩn của hệ thống
            var totalAmountStr = lib.ESD_HTKT_Utils.addStringsManual(totalAccountedAmountStr, currentAmountStr);
            var finalGuaranteeStr = String(guaranteeAmountStr).trim();

            if (lib.ESD_HTKT_Utils.compareMoneyStrings(totalAmountStr, finalGuaranteeStr) === 1) {
                errorMss.push(
                        "Tổng số tiền tạm ứng hiện tại vượt quá Giá trị bảo lãnh."
                );
            }
        }
    } catch (e) {
        print("[ESD_HTKT_PREPAYMENT_WF] Lỗi validate approval_final: " + e.toString());
    }

    return errorMss.length > 0 ? errorMss : null;
}
function validateRequiredEsdHTKTprepaymentEntry(prepaymentId) {
    if (!prepaymentId) {
        return { success: false, error: "Không tìm thấy mã đề nghị tạm ứng." };
    }

    var f = new SCFile("esdHTKTprepaymentEntry", SCFILE_READONLY);

    try {
        var rc = f.doSelect('prepayment.id="' + prepaymentId + '"');
        var count = 0;
        var totalDebit = 0;
        var totalCredit = 0;

        while (rc == RC_SUCCESS) {
            count++;

            var amount = Number(f["amount"]) || 0;
            var accountType = f["account.type"];

            if (accountType == "n\u1ee3") {
                totalDebit += amount;
            } else if (accountType == "t\u00e0i s\u1ea3n") {
                totalCredit += amount;
            }

            rc = f.getNext();
        }

        if (count == 0) {
            return { success: false, error: "Thông tin hạch toán là bắt buộc." };
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

function validateRequiredEsdHTKTprepaymentInvoice(prepaymentId) {
    if (!prepaymentId) {
        return {
            success: false,
            error: "Không tìm thấy ID hóa đơn/tạm ứng để kiểm tra."
        };
    }

    var f = new SCFile("esdHTKTprepaymentInvoice", SCFILE_READONLY);

    try {
        var querySQL = 'prepayment.id="' + prepaymentId + '"';
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

    var amountField = vars.$isAmount;
    var currency = vars.$currency;

    if (
            amountField === undefined ||
            amountField === null ||
            String(amountField).trim() === ""
    ) {
        errorMss.push("Số tiền đề nghị tạm ứng là bắt buộc.");

    } else if (
            lib.ESD_HTKT_Utils.compareMoneyStrings(
                    String(amountField),
                    "0"
            ) <= 0
    ) {
        errorMss.push("Số tiền đề nghị tạm ứng phải lớn hơn 0.");

    } else {

        // 1. Kiểm tra số tiền tạm ứng <= số tiền còn lại
        var remainingAmount = String(vars.$remainingAmt || "0");
        if (vars.$remainingAmt &&
                lib.ESD_HTKT_Utils.compareMoneyStrings(
                        String(amountField),
                        remainingAmount
                ) === 1
        ) {
            errorMss.push(
                    "Số tiền đề nghị tạm ứng phải nhỏ hơn hoặc bằng Số tiền còn lại."
            );
        }

        // =================================================================================
        // 2. Kiểm tra tổng tiền tạm ứng và các phiếu đã hạch toán <= giá trị bảo lãnh
        // =================================================================================
        var currentRecordId = record["id"];
        var prepaymentId = record["prepayment.id"] || record["prepayment_id"];
        var contractId = record["contract.id"];

        if (!contractId && prepaymentId) {
            var parentPrep = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
            if (parentPrep.doSelect('id="' + prepaymentId + '"') == RC_SUCCESS) {
                contractId = parentPrep["contract.id"];
            }
            try { parentPrep.doClose(); } catch(e) {}
        }

        if (contractId) {
            var guaranteeAmountStr = null;

            // 2.1 Lấy giá trị bảo lãnh trực tiếp từ DB
            var docInfoFile = new SCFile("esdHDcontractDocInfo", SCFILE_READONLY);
            var docQuery = 'contract.id="' + contractId + '" and doc.type="BAOLANHTU" and status="Co hieu luc"';

            if (docInfoFile.doSelect(docQuery) == RC_SUCCESS) {
                guaranteeAmountStr = docInfoFile["guarantee.amount"];
            }
            try { docInfoFile.doClose(); } catch(e) {}

            // Làm sạch chuỗi bảo lãnh để kiểm tra có giá trị hợp lệ (> 0) hay không
            var cleanGuaranteeStr = String(guaranteeAmountStr || "").replace(/,/g, '').trim();

            // Chỉ validate khi có giá trị bảo lãnh thực tế lớn hơn 0
            if (cleanGuaranteeStr !== "" && cleanGuaranteeStr !== "null" && Number(cleanGuaranteeStr) > 0) {

                var currentAmountStr = String(amountField).trim() || "0";
                var totalAccountedAmountStr = "0";

                // 2.2 Truy vấn các phiếu Tạm ứng ĐÃ HẠCH TOÁN (của hợp đồng này)
                var prepFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
                var query = 'contract.id="' + contractId + '" and (status="approved" or status="accounted")';

                var rc = prepFile.doSelect(query);

                while (rc == RC_SUCCESS) {
                    // Loại trừ phiếu hiện tại bằng ID phiếu cha
                    if (prepFile["id"] !== prepaymentId) {
                        var accountedAmtStr = String(prepFile["amount"]).trim() || "0";
                        totalAccountedAmountStr = lib.ESD_HTKT_Utils.addStringsManual(totalAccountedAmountStr, accountedAmtStr);
                    }
                    rc = prepFile.getNext();
                }
                try { prepFile.doClose(); } catch(e) {}

                // 2.3 Cộng tổng số tiền (Phiếu hiện tại + Các phiếu cũ)
                var totalAmountStr = lib.ESD_HTKT_Utils.addStringsManual(totalAccountedAmountStr, currentAmountStr);
                var finalGuaranteeStr = String(guaranteeAmountStr).trim();

                // 2.4 So sánh
                if (lib.ESD_HTKT_Utils.compareMoneyStrings(totalAmountStr, finalGuaranteeStr) === 1) {
                    errorMss.push(
                            "Tổng số tiền tạm ứng hiện tại vượt quá Giá trị bảo lãnh."
                    );
                }
            }
        }
        // =================================================================================

        // 3. VND không được có số thập phân
        if (
                currency === "VND" &&
                String(amountField).indexOf(".") !== -1
        ) {
            var normalizedAmount = lib.ESD_HTKT_Utils.normalizeMoneyString(
                    String(amountField)
            );

            var amountParts = normalizedAmount.split(".");

            if (
                    amountParts.length > 1 &&
                    amountParts[1].replace(/0/g, "") !== ""
            ) {
                errorMss.push(
                        "Số tiền đề nghị tạm ứng không được nhập số thập phân đối với loại tiền VND."
                );
            }
        }
    }

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

//                // Lấy danh sách Value List từ biến $bankcode của hệ thống
//                var validBankCodes = vars.$bankcode;
//                var isBankValid = false;
//
//                if (validBankCodes != null) {
//                    // Ép kiểu về mảng Javascript chuẩn (phòng trường hợp là SCArray của HPSM)
//                    var bankCodeArray = (typeof validBankCodes.toArray === 'function') ? validBankCodes.toArray() : validBankCodes;
//                    
//                    // Kiểm tra giá trị có nằm trong Value List không
//                    for (var i = 0; i < bankCodeArray.length; i++) {
//                        if (bankCodeArray[i] != null && String(bankCodeArray[i]).trim() === bankValue) {
//                            isBankValid = true;
//                            break;
//                        }
//                    }
//                }
//
//                if (!isBankValid) {
//                    errorMss.push("Ngân hàng thụ hưởng không hợp lệ. Vui lòng chọn ngân hàng có trong danh sách.");
//                }
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

            // --- BẮT ĐẦU: Logic validate số điện thoại mới ---
            if (!record["phone"]) {
                errorMss.push("Số điện thoại người thụ hưởng không được để trống.");
            } else {
                var phone = String(record["phone"]).trim();

                // Điều kiện tiên quyết: Bắt đầu bằng số 0
                if (phone.charAt(0) !== "0") {
                    errorMss.push("Số điện thoại phải bắt đầu bằng số 0.");
                } else {
                    // Cờ kiểm tra regex
                    var isValidMobile = /^0[35789][0-9]{8}$/.test(phone);
                    var isValidLandline = /^02[0-9]{9}$/.test(phone);

                    // Nếu không khớp cả 2 trường hợp -> Sai định dạng
                    if (!isValidMobile && !isValidLandline) {
                        errorMss.push("Số điện thoại sai định dạng.");
                    }
                }
            }
            // --- KẾT THÚC: Logic validate số điện thoại mới ---

            if (!record["transaction.des"]) {
                errorMss.push("Nội dung giao dịch không được để trống.");
            } else {
                checkMaxLength(record["transaction.des"], 255, "Nội dung giao dịch");
            }
        }
    }

    return errorMss;
}

function validateVendorAndPaymentDetailsOnWorkflow(record) {
    var prepaymentId = String(record.id || "");
    var vendor = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
    var prepayment = new SCFile("esdHTKTprepayment", SCFILE_READONLY);

    var rc = vendor.doSelect('prepayment.id="' + prepaymentId + '"');
    var errors = []; // Khai báo mảng chứa danh sách lỗi

    try {
        // 1. Kiểm tra đã chọn nhà cung cấp chưa
        if (rc != RC_SUCCESS) {
            return ["Vui lòng chọn nhà cung cấp."];
        }

        // Lấy thông tin phiếu tạm ứng (để lấy contractId phục vụ check bảo lãnh)
        var rcPrepayment = prepayment.doSelect('id="' + prepaymentId + '"');
        var contractId = "";
        if (rcPrepayment == RC_SUCCESS) {
            contractId = String(prepayment["contract.id"] || "");
        }

        var currentTotalAmount = "0"; // Biến cộng dồn tổng tiền phiếu hiện tại

        // Dùng vòng lặp while để validate TẤT CẢ nhà cung cấp có trong phiếu
        while (rc == RC_SUCCESS) {

            // 2. Kiểm tra bắt buộc nhập số tiền tạm ứng
            var rawAmount = vendor["amount"];
            var strAmount = String(rawAmount || "0").trim();

            if (
                    rawAmount === null ||
                    rawAmount === undefined ||
                    strAmount === "" ||
                    lib.ESD_HTKT_Utils.compareMoneyStrings(strAmount, "0") <= 0
            ) {
                errors.push("Vui lòng nhập số tiền tạm ứng lớn hơn 0.");
            }

            // CỘNG DỒN tổng tiền phiếu hiện tại
            currentTotalAmount = lib.ESD_HTKT_Utils.addStringsManual(currentTotalAmount, strAmount);

            // 3. Lấy số tiền theo NCC và số tiền tạm ứng
            var contractAmount = String(vendor["contract.amount"] || "0");
            var prepaymentAmount = strAmount;

            // Kiểm tra số tiền tạm ứng <= số tiền còn lại
//            if (lib.ESD_HTKT_Utils.compareMoneyStrings(prepaymentAmount, contractAmount) === 1) {
//                errors.push("Số tiền đề nghị tạm ứng phải nhỏ hơn hoặc bằng Số tiền còn lại.");
//            }

            // Đã lược bỏ Bước 4 (check bảo lãnh lẻ từng vendor) ở đây

            // =========================================================================
            // 5. VALIDATE THÔNG TIN PHƯƠNG THỨC THANH TOÁN
            // =========================================================================
            var paymentMethod = vendor["payment.method"];

            if (!paymentMethod || String(paymentMethod).trim() === "") {
                errors.push("Vui lòng chọn Phương thức thanh toán.");
            }
            else if (paymentMethod === "CHUYENKHOAN") {
                // Kiểm tra các trường khi thanh toán Chuyển khoản
                if (!vendor["beneficiary.account"] || String(vendor["beneficiary.account"]).trim() === "") {
                    errors.push("Vui lòng nhập 'Số tài khoản thụ hưởng'");
                }
                if (!vendor["beneficiary.bank"] || String(vendor["beneficiary.bank"]).trim() === "") {
                    errors.push("Vui lòng chọn 'Ngân hàng thụ hưởng'.");
                }
                if (!vendor["beneficiary.name"] || String(vendor["beneficiary.name"]).trim() === "") {
                    errors.push("Vui lòng nhập 'Tên tài khoản thụ hưởng'.");
                }
            }
            else if (paymentMethod === "TIENMAT") {
                // Kiểm tra các trường khi thanh toán Tiền mặt
                if (!vendor["beneficiary.name"] || String(vendor["beneficiary.name"]).trim() === "") {
                    errors.push("Vui lòng nhập 'Họ tên người thụ hưởng'.");
                }
                if (!vendor["identity.number"] || String(vendor["identity.number"]).trim() === "") {
                    errors.push("Vui lòng nhập 'Số giấy tờ tùy thân'.");
                }
                if (!vendor["issued.date"]) {
                    errors.push("Vui lòng nhập 'Ngày cấp' giấy tờ tùy thân.");
                }
                if (!vendor["issued.place"] || String(vendor["issued.place"]).trim() === "") {
                    errors.push("Vui lòng nhập 'Nơi cấp' giấy tờ tùy thân.");
                }
            }
            // =========================================================================

            rc = vendor.getNext();
        }

        // =========================================================================
        // 6. KIỂM TRA TỔNG TIỀN TẠM ỨNG (PHIẾU HIỆN TẠI + ĐÃ DUYỆT/HẠCH TOÁN) <= BẢO LÃNH
        // =========================================================================
        if (contractId) {
            var guaranteeAmountStr = null;
            var docInfoFile = new SCFile("esdHDcontractDocInfo", SCFILE_READONLY);
            // Dùng BAOLANHBH chuẩn giống hệt các function khác
            var docQuery = 'contract.id="' + contractId + '" and doc.type="BAOLANHTU" and status="Co hieu luc"';

            if (docInfoFile.doSelect(docQuery) == RC_SUCCESS) {
                guaranteeAmountStr = docInfoFile["guarantee.amount"];
            }
            try { docInfoFile.doClose(); } catch(e) {}

            var cleanGuaranteeStr = String(guaranteeAmountStr || "").replace(/,/g, '').trim();

            if (cleanGuaranteeStr !== "" && cleanGuaranteeStr !== "null" && lib.ESD_HTKT_Utils.compareMoneyStrings(cleanGuaranteeStr, "0") === 1) {

                var totalAccountedAmountStr = "0";
                var prepFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
                var query = 'contract.id="' + contractId + '" and (status="approved" or status="accounted")';
                var rcPrep = prepFile.doSelect(query);

                while (rcPrep == RC_SUCCESS) {
                    // Loại trừ phiếu hiện tại đang validate
                    if (prepFile["id"] !== prepaymentId) {
                        var accountedAmtStr = String(prepFile["amount"] || "0").trim();
                        totalAccountedAmountStr = lib.ESD_HTKT_Utils.addStringsManual(totalAccountedAmountStr, accountedAmtStr);
                    }
                    rcPrep = prepFile.getNext();
                }
                try { prepFile.doClose(); } catch(e) {}

                // TỔNG = Tổng các phiếu cũ + Tổng tiền phiếu hiện tại
                var totalAmountStr = lib.ESD_HTKT_Utils.addStringsManual(totalAccountedAmountStr, currentTotalAmount);
                var finalGuaranteeStr = String(guaranteeAmountStr).trim();

                // So sánh tổng cuối cùng với Hạn mức bảo lãnh
                if (lib.ESD_HTKT_Utils.compareMoneyStrings(totalAmountStr, finalGuaranteeStr) === 1) {
                    errors.push("Tổng số tiền tạm ứng hiện tại và các khoản đã duyệt/hạch toán vượt quá Giá trị bảo lãnh.");
                }
            }
        }
        // =========================================================================

        // Lọc các thông báo lỗi trùng lặp (nếu nhiều NCC mắc cùng 1 lỗi)
        if (errors.length > 0) {
            var uniqueErrors = [];
            for (var i = 0; i < errors.length; i++) {
                if (uniqueErrors.indexOf(errors[i]) === -1) {
                    uniqueErrors.push(errors[i]);
                }
            }
            return uniqueErrors;
        }

        return null;

    } finally {
        try {
            vendor.doClose();
        } catch (e) {}

        try {
            prepayment.doClose();
        } catch (e) {}
    }
}
//function validatePrepaymentVendors(record) {
//    var prepaymentId = String(record.prepayment_id || "");
//    var vendor = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
//    var rc = vendor.doSelect('prepayment.id="' + prepaymentId + '"');
//
//    try {
//        // 1. Kiểm tra đã chọn nhà cung cấp chưa
//        if (rc != RC_SUCCESS) {
//            return ["Vui lòng chọn nhà cung cấp."];
//        }
//
//        // Kiểm tra bắt buộc nhập số tiền tạm ứng
//        var rawAmount = vendor["amount"];
//        if (rawAmount === null || rawAmount === undefined || String(rawAmount).trim() === "" || lib.ESD_HTKT_Utils.compareMoneyStrings(String(rawAmount), "0") <= 0) {
//            return ["Vui lòng nhập hoặc lưu số tiền tạm ứng."];
//        }
//        return null;
//
//    } finally {
//        try {
//            vendor.doClose();
//        } catch (e) {}
//    }
//}
function validatePrepaymentVendors(record) {
    var prepaymentId = String(record.prepayment_id || record.id || "");
    var vendor = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
    var rc = vendor.doSelect('prepayment.id="' + prepaymentId + '"');

    // Mảng chứa các lỗi để gom lại thông báo 1 lần
    var errorMessages = [];

    try {
        // 1. Kiểm tra đã chọn nhà cung cấp chưa
        if (rc != RC_SUCCESS) {
            return ["Vui lòng chọn nhà cung cấp."];
        }

        // Duyệt qua tất cả các nhà cung cấp thuộc phiếu tạm ứng này
        while (rc == RC_SUCCESS) {

            // 2. Kiểm tra bắt buộc nhập số tiền tạm ứng
            var rawAmount = vendor["amount"];
            if (rawAmount === null || rawAmount === undefined || String(rawAmount).trim() === "" || lib.ESD_HTKT_Utils.compareMoneyStrings(String(rawAmount), "0") <= 0) {
                errorMessages.push("Vui lòng nhập hoặc lưu số tiền tạm ứng hợp lệ.");
            }

            // 3. Lấy Phương thức thanh toán
            var paymentMethod = vendor["payment.method"];

            if (!paymentMethod || String(paymentMethod).trim() === "") {
                errorMessages.push("Vui lòng chọn Phương thức thanh toán.");
            }
            else if (paymentMethod === "CHUYENKHOAN") {
                // =========================================================
                // VALIDATE CHO CHUYỂN KHOẢN
                // =========================================================
                if (!vendor["beneficiary.account"] || String(vendor["beneficiary.account"]).trim() === "") {
                    errorMessages.push("Vui lòng nhập 'Số tài khoản thụ hưởng'.");
                }
                if (!vendor["beneficiary.bank"] || String(vendor["beneficiary.bank"]).trim() === "") {
                    errorMessages.push("Vui lòng chọn 'Ngân hàng thụ hưởng'.");
                }
                if (!vendor["beneficiary.name"] || String(vendor["beneficiary.name"]).trim() === "") {
                    errorMessages.push("Vui lòng nhập 'Tên tài khoản thụ hưởng'.");
                }
            }
            else if (paymentMethod === "TIENMAT") {
                // =========================================================
                // VALIDATE CHO TIỀN MẶT
                // =========================================================
                if (!vendor["beneficiary.name"] || String(vendor["beneficiary.name"]).trim() === "") {
                    errorMessages.push("Vui lòng nhập 'Họ tên người thụ hưởng'.");
                }
                if (!vendor["identity.number"] || String(vendor["identity.number"]).trim() === "") {
                    errorMessages.push("Vui lòng nhập 'Số giấy tờ tùy thân'.");
                }
                if (!vendor["issued.date"]) {
                    errorMessages.push("Vui lòng nhập 'Ngày cấp' giấy tờ tùy thân.");
                }
                if (!vendor["issued.place"] || String(vendor["issued.place"]).trim() === "") {
                    errorMessages.push("Vui lòng nhập 'Nơi cấp' giấy tờ tùy thân.");
                }
            }

            rc = vendor.getNext();
        }

        // Trả về danh sách lỗi nếu có (lọc các câu lỗi trùng lặp)
        if (errorMessages.length > 0) {
            var uniqueErrors = errorMessages.filter(function(item, pos) {
                return errorMessages.indexOf(item) == pos;
            });
            return uniqueErrors;
        }

        // Nếu không có lỗi nào, trả về null (Hợp lệ)
        return null;

    } finally {
        try {
            vendor.doClose();
        } catch (e) {}
    }
}
/**
 * BR-002-16: Kiểm tra lại trạng thái hóa đơn trước khi trình phiếu
 * @param {String} prepaymentId - ID của phiếu đề nghị tạm ứng
 * @returns {Array|null} Trả về mảng chứa thông báo lỗi nếu có
 */
function validateInvoices(prepaymentId) {
    if (!prepaymentId) return null;

    var errorMss = [];
    var hasInvalidInvoice = false;

    var prepInvoiceFile = new SCFile('esdHTKTprepaymentInvoice', SCFILE_READONLY);
    var rc = prepInvoiceFile.doSelect('prepayment.id="' + prepaymentId + '"');

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
        errorMss.push("Đề nghị Tạm ứng đang chứa hóa đơn quá hạn kiểm tra. Vui lòng kiểm tra lại các hóa đơn");
    }

    return errorMss.length > 0 ? errorMss : null;
}


/* =============================================================================
 * 5. MỞ RỘNG TÍCH HỢP BẢN TRÌNH KÝ & KÝ SỐ DSM (EXTENSIONS VERSION 2.0.0)
 * ============================================================================= */

function htktWfCommon() {
    return lib.ESD_HTKT_PREPAYMENT_COMMON;
}

function htktWfDocument() {
    return lib.ESD_HTKT_PREPAYMENT_DOCUMENT;
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
    if (!lib || !lib.ESD_HTKT_PREPAYMENT_COMMON || typeof lib.ESD_HTKT_PREPAYMENT_COMMON.ok !== "function") {
        throw new Error("Thiếu ESD_HTKT_PREPAYMENT_COMMON.");
    }

    if (requireDocument === true &&
            (!lib.ESD_HTKT_PREPAYMENT_DOCUMENT ||
                    typeof lib.ESD_HTKT_PREPAYMENT_DOCUMENT.generateAndUploadPresentation !== "function" ||
                    typeof lib.ESD_HTKT_PREPAYMENT_DOCUMENT.getCurrentPresentation !== "function" ||
                    typeof lib.ESD_HTKT_PREPAYMENT_DOCUMENT.replaceCurrentVersion !== "function" ||
                    typeof lib.ESD_HTKT_PREPAYMENT_DOCUMENT.invalidateCurrentCycle !== "function")
    ) {
        throw new Error("Thiếu hoặc sai contract ESD_HTKT_PREPAYMENT_DOCUMENT.");
    }
}

function htktWfPhase(record) { return htktWfCommon().getCurrentPhase(record); }
function htktWfInitialRole(record) { return htktWfCommon().getInitialRole(record); }
function htktWfPrepaymentId(record) { return htktWfCommon().getRecordId(record); }
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
        return htktWfFail("MISSING_WORKFLOW_RECORD", "Không có bản ghi đề nghị tạm ứng.");
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
            prepaymentId: htktWfPrepaymentId(record),
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

/**
 * Tải lại thông tin phân công mới nhất từ DB trước khi kiểm tra actor workflow.
 *
 * Mục đích:
 * - NextJS có thể vừa tái phân công user xử lý và lưu trực tiếp xuống DB.
 * - Record đang mở trên SM có thể vẫn giữ actor cũ.
 * - Rule Set của các nút chuyển phase gọi hàm này trước validateDataInPhase/updateNextStatus.
 *
 * Lưu ý:
 * - Không thay đổi phase/status.
 * - Không thay đổi quyền workflow hiện hữu.
 * - Chỉ đồng bộ lại thông tin approval và dùng validateCurrentActor() hiện có.
 */
function validateLatestWorkflowActor(record) {
    try {
        if (
                !lib ||
                !lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX ||
                typeof lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX.syncPrepaymentApprovalFromDatabase !== "function"
        ) {
            return htktWfFail(
                    "WORKFLOW_ACTOR_REFRESH_DEPENDENCY_MISSING",
                    "Không kiểm tra được người xử lý mới nhất của hồ sơ. Vui lòng tải lại hồ sơ.",
                    "Thiếu ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX.syncPrepaymentApprovalFromDatabase()."
            );
        }

        lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX
                .syncPrepaymentApprovalFromDatabase(record);

        var actorResult = validateCurrentActor(record);

        if (!actorResult || actorResult.success !== true) {
            if (actorResult && actorResult.code === "INVALID_CURRENT_ACTOR") {
                return htktWfFail(
                        "PREPAYMENT_REASSIGNED",
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

// trưởng thêm: Kiểm tra quyền hiển thị Workflow Action Test ký.
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

function htktWfValidateLegacy(record) {
    var errors;
    try {
        errors = validateDataInPhase(record);
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
        // trưởng thêm: updateNextStatus đọc oldrecord và tự lưu attachment khi rời initial_kttc.
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
        prepaymentId: actorResult.data.prepaymentId,
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
        prepaymentId: actorResult.data.prepaymentId,
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
        prepaymentId: actorResult.data.prepaymentId
    });

    if (!documentResult || documentResult.success !== true) {
        return documentResult || htktWfFail("CURRENT_PRESENTATION_NOT_FOUND", "Không tìm thấy bản trình ký hiện hành.");
    }

    var doc = documentResult.data;
    if (doc.status !== "CURRENT" || !doc.ecmObjectId) {
        return htktWfFail("CURRENT_PRESENTATION_NOT_SIGNABLE", "Bản trình ký hiện hành không ở trạng thái cho phép ký.", "status=" + String(doc.status || ""), doc);
    }

    return htktWfOk({
        moduleCode: "HTKT_PREPAYMENT",
        prepaymentId: actorResult.data.prepaymentId,
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
 * trưởng thêm: Dùng trong Condition của RuleSet sau khi popup ký đóng.
 * Chỉ trả T khi attachment hiện hành đã được thay bằng bản sau ký.
 */
function checkSignatureSucceeded(record) {
    try {
        htktWfAssertDependencies(true);

        var oldAttachmentId = String(vars["$L.htktSignOldAttachmentId"] || "").trim();
        var oldObjectId = String(vars["$L.htktSignOldObjectId"] || "").trim();
        if (!record || !oldAttachmentId || !oldObjectId) return "F";

        var currentResult = htktWfDocument().getCurrentPresentation({
            prepaymentId: htktWfPrepaymentId(record)
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
        prepaymentId: actorResult.data.prepaymentId
    });

    if (!currentResult || currentResult.success !== true) {
        return currentResult || htktWfFail("CURRENT_PRESENTATION_NOT_FOUND", "Không tìm thấy bản trình ký hiện hành.");
    }

    var currentDoc = currentResult.data;
    var nextStatus = NEXT_PHASE_MAP[phase] || "";

    if (currentDoc.ecmObjectId === sign.newObjectId && nextStatus && htktWfRead(record, ["status"]) === nextStatus) {
        return htktWfOk({
            idempotent: true,
            prepaymentId: actorResult.data.prepaymentId,
            nextStatus: nextStatus,
            currentDocument: currentDoc,
            recordMustBeSaved: false
        }, "Kết quả ký và workflow đã được hoàn tất trước đó.");
    }

    var replaceResult = htktWfDocument().replaceCurrentVersion({
        prepaymentId: actorResult.data.prepaymentId,
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
            prepaymentId: actorResult.data.prepaymentId
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
        prepaymentId: actorResult.data.prepaymentId,
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
            prepaymentId: htktWfPrepaymentId(record),
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
        prepaymentId: htktWfPrepaymentId(record),
        requestedBy: htktWfCurrentUser(),
        previousPhase: phase,
        nextStatus: htktWfRead(record, ["status"]),
        documentDeletion: deleteResult.data,
        recordMustBeSaved: true
    }, "Yêu cầu chỉnh sửa, xóa tài liệu và chuyển hồ sơ về cập nhật thành công.");
}


