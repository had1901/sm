/**
 * HTKT Signature Handler
 * Xử lý kết quả ký số cho:
 * - esdHTKTprepayment
 * - esdHTKTpayment
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
 * Thực hiện xử lý ký số cho HTKT theo user và trạng thái ký.
 *
 * @function signaturePrepayment
 *
 * @param {string} prepaymentId - ID cua ban ghi HTKT prepayment can ky.
 * @param {string} userSign - ID user thuc hien ky (approver).
 * @param {"WAIT" | "SUCCESS"} type - Trang thai xu ly ky so.
 */
function signaturePrepayment(prepaymentId, userSign, type, object_ids) {
    var record = null;

    try {
        // SmartCA: lan gui thu 2 co objectIds[0].new (objectidext) => coi nhu SUCCESS,
        // du ESD_ACTIONS_INTEGRATIONS van truyen status = WAIT cho non-HSM.
        if (object_ids && object_ids[0] && object_ids[0].new && type !== "SUCCESS") {
            type = "SUCCESS";
        }

        record = new SCFile("esdHTKTprepayment");
        var query = `id="${prepaymentId}"`;
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
    var f = new SCFile("esdHTKTprepaymentAttachment");

    try {
        var query = `prepayment.id = "${record.id}" and doc.code = "TRINH_KY"`;
        var rc = f.doSelect(query);
        var SIGN_RESULT = "SUCCESS";

        if (rc == RC_SUCCESS) {
            // Luu transactionId tu yeu cau ky (SmartCA) de schedule van tin DSM.
            // object_ids[0].transactionId chi co o lan gui ky dau; khong ghi de khi rong.
            var transactionId = object_ids && object_ids[0]
                ? String(object_ids[0].transactionId || "").trim()
                : "";
            // tr?????ng th??m: getStatusKySo_HTKT ?????c field transaction.id (dbdict),
            // n??n ghi v??o transaction.id; gi??? transactionId c?? cho t????ng th??ch.
            // code c??:
            // if (transactionId && String(f["transactionId"] || "").trim() !== transactionId) {
            //     f["transactionId"] = transactionId;
            //     f.doUpdate();
            // }
            if (transactionId && (
                String(f["transaction.id"] || "").trim() !== transactionId ||
                String(f["transactionId"] || "").trim() !== transactionId
            )) {
                f["transaction.id"] = transactionId;
                f["transactionId"] = transactionId;
                f.doUpdate();
            }

            if (type == "WAIT") {
                // cho ky so - giu attachment o trang thai CURRENT
                // de replaceCurrentVersion con tim thay ban cu khi SUCCESS
            } else {
                // ky so thanh cong
                var signedObjectId = object_ids && object_ids[0] ? object_ids[0].new : null;
                processSignatureResult("esdHTKTprepaymentAttachment", f.id, SIGN_RESULT, signedObjectId);
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

        if (tableName === "esdHTKTprepaymentAttachment") {
            return applyPrepaymentSignatureResult(tableName, recordId, signResult, signedObjectId);
        }

        writeSystemLog("[HTKT_SIGNATURE] Unsupported table: " + tableName);
        return false;

    } catch (e) {
        writeSystemLog("[HTKT_SIGNATURE] ERROR processSignatureResult: " + e.message);
        return false;
    }
}

/**
 * Xử lý ký số cho bảng esdHTKTprepaymentAttachment
 *
 * @param {string} tableName
 * @param {string} recordId
 * @param {string} signResult
 * @returns {boolean}
 */
function applyPrepaymentSignatureResult(tableName, recordId, signResult, signedObjectId) {
    var record = null;

    try {
        record = new SCFile(tableName);
        var rc = record.doSelect(`id="${recordId}"`);

        if (rc != RC_SUCCESS) {
            writeSystemLog("[HTKT_SIGNATURE] HTKT not found: " + recordId);
            return false;
        }

        var prepaymentId = record['prepayment.id'];

        // ===== SUCCESS: thay file TRUOC (replaceCurrentVersion can attachment cu con status CURRENT) =====
        if (signResult === HTKT_SIGN_RESULT.SUCCESS) {
            var replaceRes = lib.ESD_HTKT_PREPAYMENT_DOCUMENT.replaceCurrentVersion({
                prepaymentId: prepaymentId,
                currentUser: record['uploaded.by'] || '',
                oldObjectId: record['ecm.object.id'] || '',
                newObjectId: signedObjectId || '',
                newDocId: '',
                cifNum: prepaymentId,
                accNum: prepaymentId
            });

            if (!replaceRes || replaceRes.success !== true) {
                writeSystemLog("[HTKT_SIGNATURE] replaceCurrentVersion failed: " + (replaceRes && replaceRes.message || ''));
                return false;
            }

            // Attachment cu da bi xoa; Rule 4 (updateNextStatus) se lo chuyen phase.
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
 * @param {string} prepaymentId - Ma HTKT can xu ly ky so.
 * @param {number} [repeat=86400] - Chu ky lap cua schedule (giay).
 * @param {number} [timeoutSeconds=240] - Thoi gian toi da (giay) truoc khi xoa schedule.
 *
 * @returns {Object|boolean} Ket qua createSchedule; false neu thieu prepaymentId hoac khong co attachment dang cho ky.
 *
 * @example
 * createScheduleSignatureHTKT("TU.106.26.0000001", 10, 240);
 */
function createScheduleSignatureHTKT(prepaymentId, repeat, timeoutSeconds) {
    if (!prepaymentId) return false;

    var scheduleName = "ESD HTKT SIGNATURE " + prepaymentId;

    if (!repeat) repeat = 24 * 60 * 60; // 1 ngay
    if (!timeoutSeconds) timeoutSeconds = 240; // mac dinh 4 phut

    var attachmentQuery = 'prepayment.id ="' + prepaymentId + '"';
    var attachmentIdList = lib.ESD_Utils.getDataArr("esdHTKTprepaymentAttachment", attachmentQuery, "id") || [];
    if (attachmentIdList.length == 0) return false;
    var jsCode = `

var writeSystemLog = lib.ESD_Utils.writeSystemLog;
var isDelete = true;

var SIGN_RESULT = "SUCCESS";

try {
    var attachmentIdList = ${JSON.stringify(attachmentIdList)};
    var prepaymentId = "${prepaymentId}";
    var signedObjectId = null;

    //vấn tin API
    var signStatus = null;
    if (lib.ESD_ACTIONS_INTEGRATIONS_HTKT && typeof lib.ESD_ACTIONS_INTEGRATIONS_HTKT.getStatusKySo_HTKT === "function") {
        signStatus = lib.ESD_ACTIONS_INTEGRATIONS_HTKT.getStatusKySo_HTKT(prepaymentId);
    } else {
        writeSystemLog("[SCH: ${scheduleName}] WARNING: getStatusKySo_HTKT not found, keep PENDING");
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
            var isApprovalProcessed = lib.ESD_HTKT_SIGNATURE.processSignatureResult(
                "esdHTKTprepaymentAttachment",
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
function updatePrepaymentStatus(recordId) {
    var itemPrepayment = new SCFile('esdHTKTprepayment');
    var rc = itemPrepayment.doSelect(`id = "${recordId}"`);
    if (rc == RC_SUCCESS) {
        lib.ESD_HTKT_PREPAYMENT_WF.updateNextStatus(itemPrepayment);
        itemPrepayment.doUpdate();
    }
    try { if (itemPrepayment) itemPrepayment.doClose() } catch (e) {}
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
//             // update bảng esdHTKTprepaymentAttachment
//             //            updateTable(id, object_ids);
//             status = "SUCCESS";
//         } else {
//             // update bảng esdHTKTprepaymentAttachment
//             updateTable(id, object_ids);
//         }
//         if (tableName === "esdHTKTprepayment") {
//             // cập nhật trạng thái status để đi luồng cho esdHTKTprepayment
//             var result = lib.ESD_HTKT_SIGNATURE.signaturePrepayment(id, userad.toUpperCase(), status, object_ids);
//             if (sign_tech != "HSM") {
//                 // nếu là smart CA, tạo job
//                 var data = lib.ESD_HTKT_SIGNATURE.createScheduleSignatureHTKT(id, 10);
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

//ky_so({ id: 'TU.106.26.0000002', tableName: 'esdHTKTprepayment', userad: 'huydq', objectIds: ['NEW objectID'], signTech: 'HSM' });