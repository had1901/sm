/**
 * Workflow validations cho Đề nghị Dự chi.
 *
 * Các hàm chính:
 * - validateDataInPhase: điều phối validation theo phase khi workflow chuyển bước.
 * - validateFromCbDmmsToCbKttc: kiểm tra dữ liệu tại bước cán bộ ĐMMS.
 * - validateFromCbKttc: kiểm tra hạch toán, hóa đơn và thông tin phê duyệt tại bước KTTC.
 *
 * Dự chi không kiểm tra phương thức thanh toán, không đối chiếu số tiền hoàn ứng
 * và không đối chiếu phương thức thanh toán giữa các nhà cung cấp.
 */
/* =============================================================================
 * 4. TẦNG VALIDATION NGHIỆP VỤ (BUSINESS VALIDATIONS)
 * ============================================================================= */

function validateDataInPhase(record, type) {
    // Nếu không phải gọi từ Workflow (Trình duyệt / Chuyển bước) -> Bỏ qua kiểm tra chuyển phase
    if (type !== "wf") {
        return null;
    }

    var errorMss = [];

    // Validate đã chọn nhà cung cấp cho phiếu Dự chi
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
        return { success: false, error: "Không tìm thấy mã đề nghị Dự chi." };
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
 * @param {String} paymentId - ID của phiếu đề nghị Dự chi
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
