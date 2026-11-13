/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_SIGNATURE
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Tiếp nhận kết quả ký số điện tử từ hệ thống DSM cho phiếu đề nghị thanh toán.
 * - Cập nhật chữ ký số, thông tin chứng thư và thời gian ký vào bản ghi tài liệu trình ký.
 * - Điều phối chuyển bước workflow tương ứng sau khi người duyệt hoàn tất ký số.
 * -----------------------------------------------------------------------------
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

/**
 * Thực hiện xử lý ký số cho HTKT Payment theo user và trạng thái ký.
 *
 * @function signaturePayment
 *
 * @param {string} paymentId - ID cua ban ghi HTKT payment can ky.
 * @param {string} userSign - ID user thuc hien ky (approver).
 * @param {"WAIT" | "SUCCESS"} type - Trang thai xu ly ky so.
 * @param {Array} [object_ids] - Danh sach object id (cu/moi/transactionId).
 */
function signaturePayment(paymentId, userSign, type, object_ids) {
    var record = null;

    try {
        // SmartCA: lan gui thu 2 co objectIds[0].new (objectidext) => coi nhu SUCCESS,
        // du ESD_ACTIONS_INTEGRATIONS_HTKT van truyen status = WAIT cho non-HSM.
        if (object_ids && object_ids[0] && object_ids[0].new && type !== "SUCCESS") {
            type = "SUCCESS";
        }

        record = new SCFile("esdHTKTpayment");
        var query = `id="${paymentId}"`;
        var rc = record.doSelect(query);

        if (rc == RC_SUCCESS) {
            signatureConfirmReal(record, userSign, type, object_ids);
        }
    } catch (e) {
        // bo qua
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
        var query = `payment.id = "${record.id}" and doc.code = "TRINH_KY"`;
        var rc = f.doSelect(query);
        var SIGN_RESULT = "SUCCESS";

        if (rc == RC_SUCCESS) {
            // Luu transactionId tu yeu cau ky (SmartCA) de schedule van tin DSM.
            // object_ids[0].transactionId chi co o lan gui ky dau; khong ghi de khi rong.
            var transactionId = object_ids && object_ids[0]
                    ? String(object_ids[0].transactionId || "").trim()
                    : "";

            if (transactionId && (
                    String(f["transaction.id"] || "").trim() !== transactionId
            )) {
                f["transaction.id"] = transactionId;
                f.doUpdate();
            }

            if (type == "WAIT") {
                // cho ky so - giu attachment o trang thai CURRENT
                // de replaceCurrentVersion con tim thay ban cu khi SUCCESS
            } else {
                // ky so thanh cong
                var signedObjectId = object_ids && object_ids[0] ? object_ids[0].new : null;
                processSignatureResult("esdHTKTpaymentAttachment", f.id, SIGN_RESULT, signedObjectId);
            }
        }
    } catch (e) {
        // bo qua
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
 * @param {string} [signedObjectId]
 *
 * @returns {boolean}
 */
function processSignatureResult(tableName, recordId, signResult, signedObjectId) {
    try {
        if (!tableName || !recordId) {
            writeSystemLog("[HTKT_PAYMENT_SIGNATURE] Missing input");
            return false;
        }

        if (signResult === HTKT_SIGN_RESULT.PENDING) {
            return true;
        }

        if (tableName === "esdHTKTpaymentAttachment") {
            return applyPaymentSignatureResult(tableName, recordId, signResult, signedObjectId);
        }

        writeSystemLog("[HTKT_PAYMENT_SIGNATURE] Unsupported table: " + tableName);
        return false;

    } catch (e) {
        writeSystemLog("[HTKT_PAYMENT_SIGNATURE] ERROR processSignatureResult: " + e.message);
        return false;
    }
}

/**
 * Xử lý ký số cho bảng esdHTKTpaymentAttachment
 *
 * @param {string} tableName
 * @param {string} recordId
 * @param {string} signResult
 * @param {string} [signedObjectId]
 * @returns {boolean}
 */
function applyPaymentSignatureResult(tableName, recordId, signResult, signedObjectId) {
    var record = null;

    try {
        record = new SCFile(tableName);
        var rc = record.doSelect(`id="${recordId}"`);

        if (rc != RC_SUCCESS) {
            writeSystemLog("[HTKT_PAYMENT_SIGNATURE] HTKT Payment not found: " + recordId);
            return false;
        }

        var paymentId = record['payment.id'];

        // ===== SUCCESS: thay file TRUOC (replaceCurrentVersion can attachment cu con status CURRENT) =====
        if (signResult === HTKT_SIGN_RESULT.SUCCESS) {
            var replaceRes = lib.ESD_HTKT_PAYMENT_DOCUMENT.replaceCurrentVersion({
                paymentId: paymentId,
                currentUser: record['uploaded.by'] || '',
                oldObjectId: record['ecm.object.id'] || '',
                newObjectId: signedObjectId || '',
                newDocId: '',
                cifNum: paymentId,
                accNum: paymentId
            });

            if (!replaceRes || replaceRes.success !== true) {
                writeSystemLog("[HTKT_PAYMENT_SIGNATURE] replaceCurrentVersion failed: " + (replaceRes && replaceRes.message || ''));
                return false;
            }

            // Attachment cu da bi xoa; Rule (updateNextStatus) se lo chuyen phase.
            return true;
        }

        // ===== FAILED/PENDING: chi cap nhat trang thai =====
        record.status = HTKT_SIGN_STATUS_LABEL[signResult];
        if (signedObjectId) record['ecm.object.id'] = signedObjectId;
        var rcUpdate = record.doUpdate();

        if (rcUpdate != RC_SUCCESS) {
            writeSystemLog("[HTKT_PAYMENT_SIGNATURE] Update HTKT Payment failed: " + recordId);
            return false;
        }

        return true;

    } catch (e) {
        writeSystemLog("[HTKT_PAYMENT_SIGNATURE] EXCEPTION HTKT Payment: " + e.message);
        return false;

    } finally {
        if (record) {
            try { record.doClose(); } catch (e) {}
        }
    }
}

/**
 * Tạo schedule tự động xử lý ký số HTKT Payment và các bước phê duyệt liên quan.
 *
 * Chức năng:
 * - Lấy danh sách attachment đang ở trạng thái chờ ký theo paymentId
 * - Tạo schedule chạy định kỳ để:
 *   + Gọi xử lý ký số cho từng attachment
 *   + Ghi log lỗi nếu có exception hoặc xử lý thất bại
 * - Nếu TẤT CẢ attachment xử lý thành công → xóa schedule
 * - Nếu chưa thành công:
 *   + Kiểm tra thời gian chạy (startTime)
 *   + Nếu vượt quá timeout → xóa schedule
 *
 * @function createScheduleSignatureHTKT
 *
 * @param {string} paymentId - Ma HTKT Payment can xu ly ky so.
 * @param {number} [repeat=86400] - Chu ky lap cua schedule (giay).
 * @param {number} [timeoutSeconds=240] - Thoi gian toi da (giay) truoc khi xoa schedule.
 *
 * @returns {Object|boolean} Ket qua createSchedule; false neu thieu paymentId hoac khong co attachment dang cho ky.
 *
 * @example
 * createScheduleSignatureHTKT("TT.106.26.0000001", 10, 240);
 */
function createScheduleSignatureHTKT(paymentId, repeat, timeoutSeconds) {
    if (!paymentId) return false;

    var scheduleName = "ESD HTKT PAYMENT SIGNATURE " + paymentId;

    if (!repeat) repeat = 24 * 60 * 60; // 1 ngay
    if (!timeoutSeconds) timeoutSeconds = 240; // mac dinh 4 phut

    var attachmentQuery = 'payment.id ="' + paymentId + '"';
    var attachmentIdList = lib.ESD_Utils.getDataArr("esdHTKTpaymentAttachment", attachmentQuery, "id") || [];
    if (attachmentIdList.length == 0) return false;
    var jsCode = `

var writeSystemLog = lib.ESD_Utils.writeSystemLog;
var isDelete = true;

var SIGN_RESULT = "SUCCESS";

try {
    var attachmentIdList = ${JSON.stringify(attachmentIdList)};
    var paymentId = "${paymentId}";
    var signedObjectId = null;

    //vấn tin API
    var signStatus = null;
    if (lib.ESD_ACTIONS_INTEGRATIONS_HTKT && typeof lib.ESD_ACTIONS_INTEGRATIONS_HTKT.getStatusKySo_Payment_HTKT === "function") {
        signStatus = lib.ESD_ACTIONS_INTEGRATIONS_HTKT.getStatusKySo_Payment_HTKT(paymentId);
    } else {
        writeSystemLog("[SCH: ${scheduleName}] WARNING: getStatusKySo_Payment_HTKT not found, keep PENDING");
    }

    var isSigned = signStatus && (
        signStatus.status === "SUCCESS" ||
        signStatus.status === "07" || // ECM_UPLOADED: file ket qua da upload ECM
        signStatus.objectidext // co id file moi -> dung van tin
    );
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
            var isApprovalProcessed = lib.ESD_HTKT_PAYMENT_SIGNATURE.processSignatureResult(
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

function updatePaymentStatus(recordId) {
    var itemPayment = new SCFile('esdHTKTpayment');
    var rc = itemPayment.doSelect(`id = "${recordId}"`);
    if (rc == RC_SUCCESS) {
        if (lib.ESD_HTKT_PAYMENT_WF && typeof lib.ESD_HTKT_PAYMENT_WF.updateNextStatus === "function") {
            lib.ESD_HTKT_PAYMENT_WF.updateNextStatus(itemPayment);
        } else if (lib.PAYMENT_WF && typeof lib.PAYMENT_WF.updateNextStatus === "function") {
            lib.PAYMENT_WF.updateNextStatus(itemPayment);
        }
        itemPayment.doUpdate();
    }
    try { if (itemPayment) itemPayment.doClose() } catch (e) {}
}

// function ky_so(file) {
//     try {
//         var tableName = file.tableName;
//         var id = file.id;
//         var userad = file.userad;
//         var object_ids = file.objectIds;
//         var sign_tech = file.signTech;
//         var status = "WAIT";
//         // ===== HSM: ký xong =====
//         if (sign_tech == "HSM") {
//             // update bảng esdHTKTpaymentAttachment
//             //            updateTable(id, object_ids);
//             status = "SUCCESS";
//         } else {
//             // update bảng esdHTKTpaymentAttachment
//             updateTable(id, object_ids);
//         }
//         if (tableName === "esdHTKTpayment") {
//             // cập nhật trạng thái status để đi luồng cho esdHTKTpayment
//             var result = lib.ESD_HTKT_PAYMENT_SIGNATURE.signaturePayment(id, userad.toUpperCase(), status, object_ids);
//             if (sign_tech != "HSM") {
//                 // nếu là smart CA, tạo job
//                 var data = lib.ESD_HTKT_PAYMENT_SIGNATURE.createScheduleSignatureHTKT(id, 10);
//             }
//         }
//         return {
//             statusCode: "00",
//             file
//         };
//     } catch (e) {
//         return { statusCode: "99", statusDesc: "ky_so error: " + e, success: false };
//     }
// }

//ky_so({ id: 'TT.106.26.0000002', tableName: 'esdHTKTpayment', userad: 'huydq', objectIds: ['NEW objectID'], signTech: 'HSM' });
