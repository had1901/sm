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

    if (!htktWfExpenseId(record)) {
        return ["Bản ghi không phải phiếu Dự chi hợp lệ."];
    }
    
    var submissionPhase = record.current_phase || record["current.phase"];
    if (submissionPhase === "initial_dmms" || submissionPhase === "initial_kttc") {
        try {
            lib.ESD_HTKT_PAYMENT_LOAD_APRROVAL_COMBOBOX.syncPaymentApprovalFromDatabase(record);
        } catch (approvalError) {
            return ["Không tải lại được thông tin phê duyệt trước khi trình: " + String(approvalError.message || approvalError)];
        }
    }

    var errorMss = [];

    // Validate NCC, nội dung đề nghị và số tiền của từng món đã lưu.
    var vendorErrors = validateVendorAndPaymentDetailsOnWorkflow(record);
    if (vendorErrors && vendorErrors.length > 0) {
         errorMss = errorMss.concat(vendorErrors);
//        return vendorErrors;
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

    if (errorMss.length > 0) return errorMss;

    // Chỉ xử lý OGL khi toàn bộ dữ liệu và validation theo phase đã hợp lệ.
    return validateExpenseOglBeforeSubmission(record);
}

/** ĐMMS được trình khi lỗi OGL; KTTC phải đồng bộ đủ site trước khi trình. */
function validateExpenseOglBeforeSubmission(record) {
    var phase = record.current_phase || record["current.phase"];
    if (phase !== "initial_dmms" && phase !== "initial_kttc") return null;
    try {
        var result = phase === "initial_dmms"
                ? lib.ESD_HTKT_EXPENSE_VENDOR.syncExpenseVendorsToOglOnSubmit(record)
                : lib.ESD_HTKT_EXPENSE_VENDOR.checkExpenseVendorsOglOnSubmit(record);
        if (result && result.success === true) return null;
        var message = result && result.message || "Không xác định được kết quả đồng bộ NCC/site OGL.";
        if (phase === "initial_kttc") {
            return ["Chưa đồng bộ đầy đủ Site Nhà cung cấp. Vui lòng bấm Đồng bộ OGL trước khi trình phiếu."];
        }
        print("Đồng bộ OGL khi ĐMMS trình phiếu chưa hoàn tất: " + message);
    } catch (error) {
        if (phase === "initial_kttc") {
            return ["Không kiểm tra được Site Nhà cung cấp trước khi trình phiếu. " + String(error.message || error)];
        }
        print("Đồng bộ OGL khi ĐMMS trình phiếu chưa hoàn tất: " + String(error.message || error));
    }
    return null;
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
        errorMss.push("Ghi chú giao dịch không được để trống.");
    } else if (description.length > 255) {
        errorMss.push("Ghi chú giao dịch không được vượt quá 255 ký tự.");
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
        errorMss.push("Ghi chú giao dịch không được để trống.");
    } else if (description.length > 255) {
        errorMss.push("Ghi chú giao dịch không được vượt quá 255 ký tự.");
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

//function validateVendorAndPaymentDetailsOnWorkflow(record) {
//    var paymentId = String(record.id || "");
//    var vendor = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
//    var rc = vendor.doSelect('payment.id="' + paymentId + '"');
//
//    try {
//        vendor.doClose();
//    } catch (e) {}
//
//    return rc == RC_SUCCESS ? null : ["Vui lòng chọn ít nhất một món dự chi."];
//}

function validateVendorAndPaymentDetailsOnWorkflow(record) {
    var paymentId = String(record.id || "").trim();
    if (!paymentId) return ["Thiếu mã phiếu Dự chi để kiểm tra các món."];

    var errorMss = [];
    var vendor = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
    try {
        var escapedPaymentId = paymentId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        var rc = vendor.doSelect('payment.id="' + escapedPaymentId + '"');
        if (rc === RC_NO_MORE) return ["Vui lòng chọn ít nhất một món dự chi."];

        while (rc === RC_SUCCESS) {
            if (!String(vendor["vendor.id"] || "").trim()) {
                return ["Chưa chọn Nhà cung cấp cho món dự chi."];
            }
            
            var transactionDescription = String(vendor["transaction.des"] || "").trim();
            var descriptionError = "";
            if (!transactionDescription) {
                descriptionError = "Nội dung đề nghị của món Dự chi không được để trống.";
            } else if (transactionDescription.length > 255) {
                descriptionError = "Nội dung đề nghị của món Dự chi không được vượt quá 255 ký tự.";
            }
            if (descriptionError && errorMss.indexOf(descriptionError) < 0) errorMss.push(descriptionError);

            var amountText = vendor["amount"] == null ? "" : String(vendor["amount"]).replace(/,/g, "").trim();
            var amount = amountText ? Number(amountText) : NaN;
            var amountError = "";
            if (!isFinite(amount)) {
                amountError = "Số tiền dự chi là bắt buộc và phải là số hợp lệ.";
            } else if (amount <= 0) {
                amountError = "Số tiền dự chi phải lớn hơn 0.";
            }
            if (amountError && errorMss.indexOf(amountError) < 0) errorMss.push(amountError);
            rc = vendor.getNext();
        }
        if (rc !== RC_NO_MORE) {
            errorMss.push("Không đọc được đầy đủ các món Dự chi. Code: " + rc);
        }
    } catch (error) {
        errorMss.push("Không kiểm tra được các món Dự chi: " + String(error.message || error));
    } finally {
        try { vendor.doClose(); } catch (closeError) {}
    }

    return errorMss.length > 0 ? errorMss : null;
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
        errorMss.push("Phiếu Dự chi đang chứa hóa đơn quá hạn kiểm tra. Vui lòng kiểm tra lại các hóa đơn.");
    }

    return errorMss.length > 0 ? errorMss : null;
}


/* =============================================================================
 * 5. MỞ RỘNG TÍCH HỢP BẢN TRÌNH KÝ & KÝ SỐ DSM (EXTENSIONS VERSION 2.0.0)
 * ============================================================================= */

var HTKT_WF_PHASE = {
    INITIAL_DMMS: "initial_dmms",
    INITIAL_KTTC: "initial_kttc",
    CHECK_DMMS: "check_dmms",
    APPROVAL_DMMS: "approval_dmms",
    APPROVAL_KTTC: "approval_kttc",
    CHECK_FINAL: "check_final",
    APPROVAL_FINAL: "approval_final"
};

var HTKT_EXPENSE_NEXT_STATUS = {
    initial_dmms: "dmms_initiated",
    initial_kttc: "kttc_checked",
    check_dmms: "dmms_checked",
    approval_dmms: "dmms_approved",
    approval_kttc: "kttc_approved",
    check_final: "checked",
    approval_final: "approved"
};

function htktWfExpenseId(record) {
    if (!record || String(record["transaction.type"] || "").trim() !== "Dự chi") return "";
    var expenseId = String(record.id || "").trim();
    return /^DC\.[A-Za-z0-9._-]+$/.test(expenseId) ? expenseId : "";
}

function htktWfDocument() {
    return lib.ESD_HTKT_EXPENSE_DOCUMENT;
}

function htktWfOk(data, message) {
    return { success: true, code: "OK", message: message || "Thành công", data: data || null };
}

function htktWfFail(code, message, detail, data) {
    return {
        success: false,
        code: code || "WORKFLOW_ERROR",
        message: message || "Có lỗi xảy ra khi xử lý phiếu Dự chi.",
        detail: detail || "",
        data: data || null
    };
}

function htktWfFailException(code, message, error, data) {
    return htktWfFail(code, message, String(error && error.message || error || ""), data);
}

function htktWfAssertDependencies(requireDocument) {
    if (requireDocument === true &&
            (!lib.ESD_HTKT_EXPENSE_DOCUMENT ||
                    typeof lib.ESD_HTKT_EXPENSE_DOCUMENT.generateAndUploadPresentation !== "function" ||
                    typeof lib.ESD_HTKT_EXPENSE_DOCUMENT.getCurrentPresentation !== "function" ||
                    typeof lib.ESD_HTKT_EXPENSE_DOCUMENT.markCurrentPresentationCompleted !== "function")
    ) {
        throw new Error("Thiếu hoặc sai contract ESD_HTKT_EXPENSE_DOCUMENT.");
    }
}

function htktWfPhase(record) { return String(record && record["current.phase"] || "").trim(); }
function htktWfInitialRole(record) { return String(record && record["initial.role"] || "").trim(); }
function htktWfCurrentUser() {
    var user = "";
    try { user = String(vars.$lo_operator && vars.$lo_operator["contact.name"] || "").trim(); }
    catch (ignoreOperator) {}
    if (!user) {
        try { user = String(vars["$lo.contact.name"] || "").trim(); }
        catch (ignoreContact) {}
    }
    return user;
}
function htktWfRead(record, fields) {
    if (!record) return "";
    for (var i = 0; i < fields.length; i++) {
        var value = String(record[fields[i]] || "").trim();
        if (value) return value;
    }
    return "";
}
function htktWfSameUser(u1, u2) {
    return !!u1 && !!u2 && String(u1).toLowerCase() === String(u2).toLowerCase();
}

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
    var expenseId = htktWfExpenseId(record);
    if (!expenseId) {
        return htktWfFail("MISSING_WORKFLOW_RECORD", "Không có bản ghi phiếu Dự chi hợp lệ.");
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
            expenseId: expenseId,
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

/* Sinh PDF khi rời initial_kttc, kể cả khi Process đã đổi phase trên record. */
function ensurePresentationForSubmission(record) {
    var contextResult = getWorkflowContext(record);
    if (contextResult.success !== true) return contextResult;
    var context = contextResult.data;
    if (context.currentPhase !== HTKT_WF_PHASE.INITIAL_KTTC) {
        return htktWfFail("INVALID_SUBMISSION_PHASE", "Chỉ sinh bản trình ký Dự chi tại bước Trình phê duyệt KTTC.");
    }

    var allowed = false;
    for (var i = 0; i < context.expectedActors.length; i++) {
        if (htktWfSameUser(context.currentUser, context.expectedActors[i])) {
            allowed = true;
            break;
        }
    }
    if (!allowed) {
        return htktWfFail("INVALID_CURRENT_ACTOR", "Người dùng hiện tại không được trình phiếu Dự chi này.");
    }

    var validationErrors = validateDataInPhase(record, "wf");
    if (validationErrors && validationErrors.length) {
        return htktWfFail("WORKFLOW_VALIDATION_FAILED", validationErrors.join("\n"));
    }

    try {
        htktWfAssertDependencies(true);
        var currentResult = htktWfDocument().getCurrentPresentation({ expenseId: context.expenseId });
        if (currentResult && currentResult.success === true) {
            return htktWfOk({
                idempotent: true,
                expenseId: context.expenseId,
                document: currentResult.data
            }, "Bản trình ký Dự chi đã được tạo trước đó.");
        }
        if (!currentResult || currentResult.code !== "DOCUMENT_NOT_FOUND") {
            return currentResult || htktWfFail("DOCUMENT_QUERY_FAILED", "Không kiểm tra được bản trình ký Dự chi.");
        }

        var generated = htktWfDocument().generateAndUploadPresentation({
            expenseId: context.expenseId,
            currentUser: context.currentUser
        });
        if (!generated || generated.success !== true) {
            return generated || htktWfFail("DOCUMENT_GENERATION_FAILED", "Không sinh được bản trình ký Dự chi.");
        }
        return htktWfOk({
            idempotent: false,
            expenseId: context.expenseId,
            document: generated.data.document
        }, "Đã sinh bản trình ký Dự chi.");
    } catch (error) {
        return htktWfFailException("DOCUMENT_GENERATION_FAILED", "Không sinh được bản trình ký Dự chi.", error);
    }
}

function prepareApprovalForSignature(record) {
    var contextResult = getWorkflowContext(record);
    if (contextResult.success !== true) return contextResult;
    if (!contextResult.data.isSignaturePhase) {
        return htktWfFail("INVALID_SIGNATURE_PHASE", "Phiếu Dự chi không ở bước phê duyệt ký số.");
    }
    if (!lib.ESD_HTKT_EXPENSE_SIGNATURE ||
            lib.ESD_HTKT_EXPENSE_SIGNATURE.checkCanSign(record) !== "T") {
        return htktWfFail("INVALID_CURRENT_ACTOR", "Người dùng hiện tại không được ký phiếu Dự chi này.");
    }

    var validationErrors = validateDataInPhase(record, "wf");
    if (validationErrors && validationErrors.length) {
        return htktWfFail("WORKFLOW_VALIDATION_FAILED", validationErrors.join("\n"));
    }

    try {
        htktWfAssertDependencies(true);
        var documentResult = htktWfDocument().getCurrentPresentation({ expenseId: contextResult.data.expenseId });
        // SIT recovery for tickets that reached a signing phase before the old
        // Process called the document upload step. Keep UAT unchanged.
        if (documentResult && documentResult.code === "DOCUMENT_NOT_FOUND" &&
                lib.ESD_ENV_CONFIG &&
                String(lib.ESD_ENV_CONFIG.getENV() || "").trim().toUpperCase() === "SIT") {
            var initialRole = String(record["initial.role"] || "").trim().toLowerCase();
            var submitter = initialRole === "kttc"
                ? htktWfRead(record, ["created.by", "user.checker.kttc"])
                : htktWfRead(record, ["user.checker.kttc", "created.by"]);
            var generated = htktWfDocument().generateAndUploadPresentation({
                expenseId: contextResult.data.expenseId,
                currentUser: submitter || contextResult.data.currentUser
            });
            if (!generated || generated.success !== true) {
                return generated || htktWfFail("DOCUMENT_GENERATION_FAILED", "Không sinh và lưu được bản trình ký Dự chi.");
            }
            documentResult = htktWfDocument().getCurrentPresentation({ expenseId: contextResult.data.expenseId });
        }
        if (!documentResult || documentResult.success !== true) {
            if (documentResult && documentResult.code === "DOCUMENT_NOT_FOUND") {
                return htktWfFail(
                    "DOCUMENT_NOT_FOUND",
                    "Phiếu Dự chi chưa có bản trình ký. Cần sinh và lưu PDF trước khi mở màn ký số."
                );
            }
            return documentResult || htktWfFail("DOCUMENT_NOT_FOUND", "Không tìm thấy bản trình ký Dự chi.");
        }

        var document = documentResult.data;
        var status = String(document && document.status || "").trim().toUpperCase();
        if (!document || !document.id || !document.ecmObjectId || status !== "CURRENT") {
            return htktWfFail("DOCUMENT_NOT_SIGNABLE", "Bản trình ký Dự chi chưa sẵn sàng để ký.");
        }

        vars["$L.htktSignOldAttachmentId"] = String(document.id);
        vars["$L.htktSignOldObjectId"] = String(document.ecmObjectId);

        return htktWfOk({
            expenseId: contextResult.data.expenseId,
            currentPhase: contextResult.data.currentPhase,
            document: {
                attachmentId: document.id,
                ecmObjectId: document.ecmObjectId
            }
        }, "Đã chuẩn bị bản trình ký Dự chi.");
    } catch (error) {
        return htktWfFailException("SIGNATURE_PREPARATION_FAILED", "Không chuẩn bị được bản trình ký Dự chi.", error);
    }
}

function checkSignatureSucceeded(record) {
    var expenseId = htktWfExpenseId(record);
    var oldAttachmentId = String(vars["$L.htktSignOldAttachmentId"] || "").trim();
    var oldObjectId = String(vars["$L.htktSignOldObjectId"] || "").trim();
    if (!expenseId || !oldObjectId) return "F";

    try {
        htktWfAssertDependencies(true);
        var currentResult = htktWfDocument().getCurrentPresentation({ expenseId: expenseId });
        if (!currentResult || currentResult.success !== true || !currentResult.data) return "F";
        var current = currentResult.data;
        // Dự chi replaces ECM IDs on the same attachment row. The attachment
        // ID must stay the same; the Object ID must change after signing.
        return current.id && current.ecmObjectId &&
                (!oldAttachmentId || String(current.id) === oldAttachmentId) &&
                String(current.ecmObjectId) !== oldObjectId ? "T" : "F";
    } catch (ignore) {
        return "F";
    }
}

function expenseWfWriteActivity(record, phase, expenseId, previousStatus) {
    if (String(previousStatus || "") === String(record.status || "")) return;
    var activityType = "";
    if (phase === HTKT_WF_PHASE.INITIAL_DMMS || phase === HTKT_WF_PHASE.INITIAL_KTTC) {
        activityType = "Trình phê duyệt";
    } else if (phase === HTKT_WF_PHASE.CHECK_DMMS) {
        activityType = "Rà soát 1";
    } else if (phase === HTKT_WF_PHASE.CHECK_FINAL) {
        activityType = "Rà soát 2";
    } else {
        activityType = "Phê duyệt";
    }
    try {
        var currentUser = htktWfCurrentUser();
        if (currentUser && lib.ESD_Utils && typeof lib.ESD_Utils.createActivity === "function") {
            lib.ESD_Utils.createActivity(
                "activityHTKTpayment",
                activityType + ' phiếu Dự chi: Mã phiếu: "' + expenseId + '"',
                expenseId,
                activityType,
                currentUser
            );
        }
    } catch (ignoreActivity) {}
}

function updateNextStatus(record, previousRecord) {
    var expenseId = htktWfExpenseId(record);
    var phase = htktWfPhase(record);
    // Process Definitions can advance current.phase before invoking this
    // function. Tạm ứng SIT uses oldrecord to detect the phase being left.
    if (!previousRecord && typeof oldrecord !== "undefined") previousRecord = oldrecord;
    var oldPhase = previousRecord && htktWfPhase(previousRecord) || phase;
    var nextStatus = HTKT_EXPENSE_NEXT_STATUS[phase];
    if (!expenseId || !nextStatus) {
        return htktWfFail("INVALID_WORKFLOW_PHASE", "Phiếu Dự chi không ở bước xử lý được hỗ trợ.");
    }

    if (oldPhase === HTKT_WF_PHASE.INITIAL_KTTC) {
        var presentationResult = ensurePresentationForSubmission(
            phase === HTKT_WF_PHASE.INITIAL_KTTC ? record : previousRecord
        );
        // The SM Process Definition does not necessarily inspect a returned
        // result object. Throw as in Tạm ứng SIT so a failed ECM/DB write
        // cannot silently advance the ticket to approval_kttc.
        if (!presentationResult || presentationResult.success !== true) {
            throw new Error(
                "Không sinh và lưu được bản trình ký Dự chi: " +
                (presentationResult && presentationResult.message || "Lỗi không xác định.") +
                (presentationResult && presentationResult.detail ? " " + presentationResult.detail : "")
            );
        }
        var previousSubmissionStatus = record.status;
        record.status = nextStatus;
        expenseWfWriteActivity(record, phase, expenseId, previousSubmissionStatus);
        return htktWfOk({
            expenseId: expenseId,
            nextStatus: nextStatus,
            document: presentationResult.data.document,
            recordMustBeSaved: true
        }, "Đã sinh bản trình ký và chuyển bước phiếu Dự chi.");
    }

    if (phase === HTKT_WF_PHASE.INITIAL_DMMS ||
            phase === HTKT_WF_PHASE.CHECK_DMMS ||
            phase === HTKT_WF_PHASE.CHECK_FINAL) {
        var contextResult = getWorkflowContext(record);
        if (contextResult.success !== true) return contextResult;
        var context = contextResult.data;
        var allowed = false;
        for (var i = 0; i < context.expectedActors.length; i++) {
            if (htktWfSameUser(context.currentUser, context.expectedActors[i])) {
                allowed = true;
                break;
            }
        }
        if (!allowed) {
            return htktWfFail("INVALID_CURRENT_ACTOR", "Người dùng hiện tại không được xử lý phiếu Dự chi này.");
        }
        var validationErrors = validateDataInPhase(record, "wf");
        if (validationErrors && validationErrors.length) {
            return htktWfFail("WORKFLOW_VALIDATION_FAILED", validationErrors.join("\n"));
        }
        var previousReviewStatus = record.status;
        record.status = nextStatus;
        expenseWfWriteActivity(record, phase, expenseId, previousReviewStatus);
        return htktWfOk({ expenseId: expenseId, nextStatus: nextStatus, recordMustBeSaved: true },
            "Đã chuyển bước phiếu Dự chi.");
    }
    if (!lib.ESD_HTKT_EXPENSE_SIGNATURE ||
            lib.ESD_HTKT_EXPENSE_SIGNATURE.checkCanSign(record) !== "T") {
        return htktWfFail("INVALID_CURRENT_ACTOR", "Người dùng hiện tại không được phê duyệt phiếu Dự chi này.");
    }
    if (checkSignatureSucceeded(record) !== "T") {
        return {
            success: true,
            code: "SIGNATURE_PENDING",
            message: "",
            data: {
                expenseId: expenseId,
                pending: true,
                recordMustBeSaved: false
            }
        };
    }

    if (phase === HTKT_WF_PHASE.APPROVAL_FINAL) {
        try {
            htktWfAssertDependencies(true);
            var completeResult = htktWfDocument().markCurrentPresentationCompleted({ expenseId: expenseId });
            if (!completeResult || completeResult.success !== true) {
                return completeResult || htktWfFail("DOCUMENT_COMPLETE_FAILED", "Không hoàn tất được bản trình ký Dự chi.");
            }
        } catch (error) {
            return htktWfFailException("DOCUMENT_COMPLETE_FAILED", "Không hoàn tất được bản trình ký Dự chi.", error);
        }
    }

    var previousApprovalStatus = record.status;
    record.status = nextStatus;
    expenseWfWriteActivity(record, phase, expenseId, previousApprovalStatus);

    return htktWfOk({ expenseId: expenseId, nextStatus: nextStatus, recordMustBeSaved: true },
        "Đã cập nhật trạng thái phiếu Dự chi.");
}

function submitForApproval(record, previousRecord) {
    var phase = htktWfPhase(record);
    if (!previousRecord && typeof oldrecord !== "undefined") previousRecord = oldrecord;
    var oldPhase = previousRecord && htktWfPhase(previousRecord) || phase;
    if (oldPhase !== HTKT_WF_PHASE.INITIAL_DMMS && oldPhase !== HTKT_WF_PHASE.INITIAL_KTTC) {
        return htktWfFail("INVALID_SUBMISSION_PHASE", "Phiếu Dự chi không ở bước Trình phê duyệt.");
    }
    return updateNextStatus(record, previousRecord);
}

function confirmReview(record) {
    var phase = htktWfPhase(record);
    if (phase !== HTKT_WF_PHASE.CHECK_DMMS && phase !== HTKT_WF_PHASE.CHECK_FINAL) {
        return htktWfFail("INVALID_REVIEW_PHASE", "Phiếu Dự chi không ở bước rà soát.");
    }
    return updateNextStatus(record);
}


// Kiểm tra quyền hiển thị Workflow Action Test ký.
