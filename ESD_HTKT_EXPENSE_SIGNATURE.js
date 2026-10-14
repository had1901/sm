/**
 * HTKT Signature Handler
 * Xử lý kết quả ký số cho:
 * - Chứng từ Dự chi (esdHTKTpayment, mã DC.)
 */

// khai báo function:
var writeSystemLog = lib.ESD_Utils.writeSystemLog;
var createActivity = lib.ESD_Utils.createActivity;

/**
 * Enum kết quả ký số
 * @readonly
 * @enum {string}
 */
var HTKT_SIGN_RESULT = {
    SUCCESS: "SUCCESS",
    PENDING: "PENDING",
    FAILED: "FAILED"
};

/**
 * Mapping trạng thái hiển thị ký số (HTKT)
 * @readonly
 */
var HTKT_SIGN_STATUS_LABEL = {
    WAIT: "Cho ky so",
    SUCCESS: "Ky so thanh cong",
    PENDING: "Dang thuc hien ky so",
    FAILED: "Ky so that bai"
};

// Điều kiện hiển thị action Ký số Dự chi trên State dùng chung esdHTKTpayment.
function checkCanSign(record) {
    if (!record ||
        String(record["transaction.type"] || "").trim() !== "Dự chi" ||
        !/^DC\.[A-Za-z0-9._-]+$/.test(String(record.id || "").trim())) {
        return "F";
    }

    var phase = String(record["current.phase"] || "").trim();
    var actorField = "";
    if (phase === "approval_dmms") actorField = "user.approver.dmms";
    else if (phase === "approval_kttc") actorField = "user.approver.kttc";
    else if (phase === "approval_final") actorField = "user.approver.final";
    if (!actorField) return "F";

    var currentUser = "";
    try {
        currentUser = String(vars.$lo_operator && vars.$lo_operator["contact.name"] || "").trim();
    } catch (ignoreOperator) {}
    if (!currentUser) {
        try { currentUser = String(vars["$lo.contact.name"] || "").trim(); }
        catch (ignoreContact) {}
    }

    var approver = String(record[actorField] || "").trim();
    return currentUser && approver && currentUser.toLowerCase() === approver.toLowerCase() ? "T" : "F";
}

// Process Definition ESD_HTKT_EXPENSE.sign gọi hàm này để mở đúng trang ký Dự chi.
function renderFormKySo() {
    var record = vars["$L.file"];
    if (checkCanSign(record) !== "T") return "";

    var currentUser = "";
    try {
        currentUser = String(vars.$lo_operator && vars.$lo_operator["contact.name"] || "").trim();
    } catch (ignoreOperator) {}
    if (!currentUser) {
        try { currentUser = String(vars["$lo.contact.name"] || "").trim(); }
        catch (ignoreContact) {}
    }

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        "HachToanKeToan/DuChi/ky-so",
        "?id=" + encodeURIComponent(String(record.id)) +
            "&userad=" + encodeURIComponent(currentUser),
        { user: currentUser, phieuId: String(record.id) }
    );
}

/**
 * Thực hiện xử lý ký số cho HTKT theo user và trạng thái ký.
 *
 * @function signatureExpense
 *
 * @param {string} expenseId - Mã phiếu Dự chi.
 * @param {string} userSign - ID user thuc hien ky (approver).
 * @param {"WAIT" | "SUCCESS"} type - Trang thai xu ly ky so.
 */
function signatureExpense(expenseId, userSign, type, object_ids) {
    var record = null;

    try {
        expenseId = String(expenseId || "").trim();
        if (!/^DC\.[A-Za-z0-9._-]+$/.test(expenseId) || !userSign) return false;
        // SmartCA: lan gui thu 2 co objectIds[0].new (objectidext) => coi nhu SUCCESS,
        // du ESD_ACTIONS_INTEGRATIONS van truyen status = WAIT cho non-HSM.
        if (object_ids && object_ids[0] && object_ids[0].new && type !== "SUCCESS") {
            type = "SUCCESS";
        }

        record = new SCFile("esdHTKTpayment");
        var query = 'id="' + expenseId.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
        var rc = record.doSelect(query);

        if (rc == RC_SUCCESS) {
            return signatureConfirmReal(record, userSign, type, object_ids);
        }
        return false;
    } catch (e) {
        writeSystemLog("[HTKT_EXPENSE_SIGNATURE] signatureExpense: " + e.message);
        return false;
    } finally {
        try {
            if (record) record.doClose();
        } catch (e2) {
            // bo qua
        }
    }
}
function signatureConfirmReal(record, userad, type, object_ids) {
    var f = new SCFile("esdHTKTpaymentAttachment");

    try {
        var safeId = String(record.id).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        var query = 'payment.id="' + safeId + '" and doc.code="TRINH_KY"';
        var rc = f.doSelect(query);

        if (rc == RC_SUCCESS && (!String(f.status || "").trim() || String(f.status).trim() === "CURRENT")) {
            var requestedOldObjectId = object_ids && object_ids[0]
                ? String(object_ids[0].old || "").trim() : "";
            if (requestedOldObjectId && requestedOldObjectId !== String(f["ecm.object.id"] || "").trim()) {
                return true;
            }
            if (!String(f.status || "").trim()) {
                f.status = "CURRENT";
                if (f.doUpdate() != RC_SUCCESS) return false;
            }
            // Luu transactionId tu yeu cau ky (SmartCA) de schedule van tin DSM.
            // object_ids[0].transactionId chi co o lan gui ky dau; khong ghi de khi rong.
            var transactionId = object_ids && object_ids[0]
                ? String(object_ids[0].transactionId || "").trim()
                : "";
            if (transactionId && String(f["transaction.id"] || "").trim() !== transactionId) {
                f["transaction.id"] = transactionId;
                if (f.doUpdate() != RC_SUCCESS) return false;
            }

            if (type == "WAIT") {
                // cho ky so - giu attachment o trang thai CURRENT
                // de replaceCurrentVersion con tim thay ban cu khi SUCCESS
                return true;
            } else {
                // ky so thanh cong
                var signedObjectId = object_ids && object_ids[0] ? object_ids[0].new : null;
                if (!signedObjectId) return false;
                var attachmentId = String(f.id);
                f.doClose();
                f = null;
                return processSignatureResult("esdHTKTpaymentAttachment", attachmentId, "SUCCESS", signedObjectId);
            }
        }
        return false;
    } catch (e) {
        writeSystemLog("[HTKT_EXPENSE_SIGNATURE] signatureConfirmReal: " + e.message);
        return false;
    } finally {
        try {
            if (f) f.doClose();
        } catch (e2) {
            // bo qua
        }
    }
}
/**
 * Entry point xử lý ký số
 *
 * @param {string} tableName - tên bảng
 * @param {string} recordId - id record
 * @param {"SUCCESS" | "PENDING" | "FAILED"} signResult
 *
 * @returns {boolean}
 */
function processSignatureResult(tableName, recordId, signResult, signedObjectId) {
    try {
        if (!tableName || !recordId) {
            writeSystemLog("[HTKT_SIGNATURE] Missing input");
            return false;
        }

        if (signResult === HTKT_SIGN_RESULT.PENDING) {
            return true;
        }

        if (tableName === "esdHTKTpaymentAttachment") {
            return applyExpenseSignatureResult(tableName, recordId, signResult, signedObjectId);
        }

        writeSystemLog("[HTKT_SIGNATURE] Unsupported table: " + tableName);
        return false;

    } catch (e) {
        writeSystemLog("[HTKT_SIGNATURE] ERROR processSignatureResult: " + e.message);
        return false;
    }
}

/**
 * Xử lý ký số cho bảng esdHTKTpaymentAttachment
 *
 * @param {string} tableName
 * @param {string} recordId
 * @param {string} signResult
 * @returns {boolean}
 */
function applyExpenseSignatureResult(tableName, recordId, signResult, signedObjectId) {
    var record = null;

    try {
        record = new SCFile(tableName);
        var safeRecordId = String(recordId).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        var rc = record.doSelect('id="' + safeRecordId + '"');

        if (rc != RC_SUCCESS) {
            writeSystemLog("[HTKT_SIGNATURE] HTKT not found: " + recordId);
            return false;
        }

        var expenseId = record['payment.id'];
        if (String(expenseId || "").indexOf("DC.") !== 0 || record['doc.code'] !== "TRINH_KY") return false;

        // ===== SUCCESS: thay file TRUOC (replaceCurrentVersion can attachment cu con status CURRENT) =====
        if (signResult === HTKT_SIGN_RESULT.SUCCESS) {
            var originalUploader = record['uploaded.by'] || '';
            var oldObjectId = record['ecm.object.id'] || '';
            record.doClose();
            record = null;
            var replaceRes = lib.ESD_HTKT_EXPENSE_DOCUMENT.replaceCurrentVersion({
                expenseId: expenseId,
                currentUser: originalUploader,
                oldObjectId: oldObjectId,
                newObjectId: signedObjectId || '',
                newDocId: '',
                cifNum: expenseId,
                accNum: expenseId
            });

            if (!replaceRes || replaceRes.success !== true) {
                writeSystemLog("[HTKT_SIGNATURE] replaceCurrentVersion failed: " + (replaceRes && replaceRes.message || ''));
                return false;
            }

            // Attachment giu nguyen ID; Rule 4 (updateNextStatus) se lo chuyen phase.
            return true;
        }

        // ===== FAILED/PENDING: chi cap nhat trang thai =====
        record.status = HTKT_SIGN_STATUS_LABEL[signResult];
        if (signedObjectId) record['ecm.object.id'] = signedObjectId;
        var rcUpdate = record.doUpdate();

        if (rcUpdate != RC_SUCCESS) {
            writeSystemLog("[HTKT_SIGNATURE] Update HTKT failed: " + recordId);
            return false;
        }

        return true;

    } catch (e) {
        writeSystemLog("[HTKT_SIGNATURE] EXCEPTION HTKT: " + e.message);
        return false;

    } finally {
        if (record) {
            try { record.doClose(); } catch (e) {}
        }
    }
}

/**
 * Tạo schedule tự động xử lý ký số HTKT và các bước phê duyệt liên quan.
 *
 * Chức năng:
 * - Lấy danh sách approval đang ở trạng thái "Đang thực hiện ký số" theo dxmsId
 * - Tạo schedule chạy định kỳ để:
 *   + Gọi xử lý ký số cho từng approval
 *   + Ghi log lỗi nếu có exception hoặc xử lý thất bại
 * - Nếu TẤT CẢ approval xử lý thành công → xóa schedule
 * - Nếu chưa thành công:
 *   + Kiểm tra thời gian chạy (startTime)
 *   + Nếu vượt quá timeout → xóa schedule
 *
 * @function createScheduleSignatureHTKT
 *
 * @param {string} expenseId - Ma HTKT can xu ly ky so.
 * @param {number} [repeat=86400] - Chu ky lap cua schedule (giay).
 * @param {number} [timeoutSeconds=240] - Thoi gian toi da (giay) truoc khi xoa schedule.
 *
 * @returns {Object|boolean} Ket qua createSchedule; false neu thieu expenseId hoac khong co attachment dang cho ky.
 *
 * @example
 * createScheduleSignatureHTKT("DC.106.26.0000001", 10, 240);
 */
function createScheduleSignatureHTKT(expenseId, repeat, timeoutSeconds) {
    expenseId = String(expenseId || "").trim();
    if (!/^DC\.[A-Za-z0-9._-]+$/.test(expenseId)) return false;

    var scheduleName = "ESD HTKT EXPENSE SIGNATURE " + expenseId;

    if (!repeat) repeat = 24 * 60 * 60; // 1 ngay
    if (!timeoutSeconds) timeoutSeconds = 240; // mac dinh 4 phut

    var safeExpenseId = expenseId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    var attachmentQuery = 'payment.id="' + safeExpenseId + '" and doc.code="TRINH_KY"';
    var attachmentIdList = lib.ESD_Utils.getDataArr("esdHTKTpaymentAttachment", attachmentQuery, "id") || [];
    if (attachmentIdList.length == 0) return false;
    var jsCode = `

var writeSystemLog = lib.ESD_Utils.writeSystemLog;
var isDelete = true;

var SIGN_RESULT = "SUCCESS";

try {
    var attachmentIdList = ${JSON.stringify(attachmentIdList)};
    var expenseId = ${JSON.stringify(expenseId)};
    var signedObjectId = null;

    //vấn tin API
    var signStatus = null;
    if (lib.ESD_ACTIONS_INTEGRATIONS_HTKT && typeof lib.ESD_ACTIONS_INTEGRATIONS_HTKT.getStatusKySo_Expense_HTKT === "function") {
        signStatus = lib.ESD_ACTIONS_INTEGRATIONS_HTKT.getStatusKySo_Expense_HTKT(expenseId);
    } else {
        writeSystemLog("[SCH: ${scheduleName}] WARNING: getStatusKySo_Expense_HTKT not found, keep PENDING");
    }

    var isSigned = signStatus && signStatus.objectidext;
    if (isSigned) {
        SIGN_RESULT = "SUCCESS";
        signedObjectId = signStatus.objectidext || null;
    } else {
        SIGN_RESULT = "PENDING";
        isDelete = false;
    }

    for (var j = 0; j < attachmentIdList.length; j++) {
        try {
            var attachmentId = attachmentIdList[j];
            var isApprovalProcessed = lib.ESD_HTKT_EXPENSE_SIGNATURE.processSignatureResult(
                "esdHTKTpaymentAttachment",
                attachmentId,
                SIGN_RESULT,
                signedObjectId
            );
            if (SIGN_RESULT != "SUCCESS" || isApprovalProcessed !== true) {
                isDelete = false;
            }

        } catch (e) {
            isDelete = false;
            writeSystemLog("[SCH: ${scheduleName} ][APPROVAL] Exception: " + attachmentIdList[j] + " | " + e.message);
        }
    }

} catch (e) {
    isDelete = false;
    writeSystemLog("[SCH: ${scheduleName}] Approval query error: " + e.message);
}

var sche = new SCFile("schedule");

try {
    var rc = sche.doSelect('name="${scheduleName}"');

    if (rc == RC_SUCCESS) {
        var now = new Date().getTime();

        if (isDelete) {
            sche.doDelete();
        } else {
            var startTime = sche.strings1 && sche.strings1.length
                ? parseInt(sche.strings1[0], 10)
                : NaN;

            if (isNaN(startTime)) {
                writeSystemLog("[SCH: ${scheduleName}] ERROR: startTime invalid");
                sche.doDelete();
            }

            // ===== timeout check =====
            else if (now - startTime >= ${timeoutSeconds} * 1000) {
                writeSystemLog("[SCH: ${scheduleName}] Timeout reached, delete schedule");
                sche.doDelete();
            }
        }
    }

} catch (e) {
    writeSystemLog("[SCH: ${scheduleName}] delete schedule error: " + e.message);
} finally {
    if (sche) sche.doClose();
}

`;

    return lib.ESD_SCHEDULE_Utils.createSchedule({
        scheduleName: scheduleName,
        jsCode: jsCode,
        repeat: repeat,
    });
}
