var logger = getLog('ESD_HTKT_ACCOUNTING_ERROR_HANDLING');

var ACCOUNTING_STATUS = {
    CREATED: "CREATED",
    ERROR: "ERROR",
    IN_QUEUE: "IN_QUEUE",
    COMPLETED: "COMPLETED"
}


/**
 * ========================================================================================================================
 * ============================= Vui lòng không sửa code dưới này (had) ===================================================
 * ========================================================================================================================
 */
 
 //Thêm lịch sử thực hiện (Vui long ko xoa code)
function createActivity(tableName, description, number, type, user) {
    print('tableName', tableName)
}

function escapeQueryValue(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Sao chép giá trị Date/Time của SCFile thành primitive trước khi getNext().
 * Tránh nhiều DTO cùng giữ tham chiếu tới buffer bản ghi hiện tại của SCFile.
 */
function serializeAccountingDateTime(value) {
    if (!value) return null;

    try {
        if (typeof value.toISOString === "function") {
            return value.toISOString();
        }
    } catch (eDate) {}

    return String(value);
}

/**
 * Render Table danh sách phiếu có lỗi hạch toán
 */
function renderAccountingErrorList() {
    const payload = getUserAndPermissionInfor()
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/DanhSachLoiHachToan', '', payload);
}


/**
 * Render Tab danh sách kết quả giao dich hạch toán
 */
function renderTabKetQuaHachToan() {
    const payload = {
        paymentId: vars['$G.payment.id'],
        user: getUserAndPermissionInfor()
    }
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/DanhSachLoiHachToan/KetQuaHachToan', '', payload);
}


/**
 * ============================================================================
 * FULL SYNC ACCOUNTING ERROR HANDLING
 *
 * Không nhận payload từ NextJS.
 *
 * Mục đích:
 * - Quét toàn bộ esdHTKTaccountingInformation
 * - Group theo prepayment.id
 * - Đếm total.trans / total.error.trans
 * - Lấy thông tin bổ sung từ Payment / Prepayment
 * - Lấy payment.method từ Vendor
 * - Backfill các field còn thiếu trong accountingErrorHandling
 * - Update record đã tồn tại
 * - Insert nếu chưa tồn tại và có ERROR
 *
 * LƯU Ý:
 * - Không gọi checkCompleteAccounting().
 * - Không phụ thuộc unit của user.
 * - unit.lv1/lv2 bảng đích đang FLOAT nên convert Number().
 * ============================================================================
 */
function syncAllAccountingErrorHandling() {
    var accountingRec = null;
    var targetRec = null;
    var requestMap = {};

    var totalUpdated = 0;
    var totalInserted = 0;
    var totalSkipped = 0;

    try {
        // ================================================================
        // BƯỚC 1: QUÉT TOÀN BỘ ACCOUNTING INFORMATION
        // ================================================================
        accountingRec = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
        var accountingRc = accountingRec.doSelect("true");

        while (accountingRc === RC_SUCCESS) {
            var prepaymentId = String(
                    accountingRec['prepayment.id'] ||
                    accountingRec['prepayment_id'] ||
                    ""
            ).trim();

            if (prepaymentId) {
                if (!requestMap[prepaymentId]) {
                    var upperId = prepaymentId.toUpperCase();
                    var requestType = "";

                    if (upperId.indexOf("TT") === 0) {
                        requestType = "THANH_TOAN";
                    } else if (upperId.indexOf("TU") === 0) {
                        requestType = "TAM_UNG";
                    }

                    requestMap[prepaymentId] = {
                        requestId: prepaymentId,
                        requestType: requestType,
                        contractId: "",
                        totalTrans: 0,
                        totalErrorTrans: 0,
                        totalHandlingTrans: 0,
                        totalCompletedTrans: 0,
                        errorChannel: "",
                        updatedAt: null
                    };
                }

                var summary = requestMap[prepaymentId];
                summary.totalTrans++;

                var accStatus = String(accountingRec['status'] || "").toUpperCase();
                var accType = String(accountingRec['type'] || "").toUpperCase();

                if (!summary.contractId) {
                    summary.contractId = String(
                            accountingRec['contract.id'] ||
                            accountingRec['contract_id'] ||
                            ""
                    ).trim();
                }

                if (accStatus === "ERROR") {
                    summary.totalErrorTrans++;
                    if (!summary.errorChannel) {
                        summary.errorChannel = accType;
                    }
                }

                if (
                        accStatus === "CREATED" ||
                        accStatus === "IN_QUEUE" ||
                        accStatus === "NEW"
                ) {
                    summary.totalHandlingTrans++;
                }

                if (accStatus === "COMPLETED") {
                    summary.totalCompletedTrans++;
                }

                // Chỉ lấy đúng thời gian cập nhật của bản ghi hiện tại.
                // Không fallback sang checked.time để tránh dùng nhầm thời gian
                // xử lý của AP/CORE cho trường updated.at của phiếu tổng hợp.
                var currentUpdateAt = accountingRec['updated.at'] || null;

                if (currentUpdateAt) {
                    summary.updatedAt = currentUpdateAt;
                }
            }

            accountingRc = accountingRec.getNext();
        }

        // ================================================================
        // BƯỚC 2: XỬ LÝ TỪNG REQUEST
        // ================================================================
        for (var requestId in requestMap) {
            if (!requestMap.hasOwnProperty(requestId)) continue;

            var item = requestMap[requestId];
            var upperRequestId = String(requestId).toUpperCase();
            var tableName = "";

            if (upperRequestId.indexOf("TT") === 0) {
                tableName = "esdHTKTpayment";
            } else if (upperRequestId.indexOf("TU") === 0) {
                tableName = "esdHTKTprepayment";
            } else {
                totalSkipped++;
                continue;
            }

            // ============================================================
            // BƯỚC 3: LẤY THÔNG TIN PAYMENT / PREPAYMENT
            // ============================================================
            var requestTypeLabel = "";
            var contractCode = "";
            var amount = 0;
            var unitLv1 = "";
            var unitLv2 = "";
            var parentStatus = "";
            var detailRec = null;
            var paymentCreatedAt = null;
            var department = "";
            
            try {
                detailRec = new SCFile(tableName, SCFILE_READONLY);

                if (
                        detailRec.doSelect(
                                'id="' + escapeQueryValue(requestId) + '"'
                        ) !== RC_SUCCESS
                ) {
                    totalSkipped++;
                    continue;
                }

                parentStatus = String(detailRec['status'] || "").toLowerCase();

                // Chỉ xử lý APPROVED / ACCOUNTED
                if (parentStatus !== "approved" && parentStatus !== "accounted") {
                    totalSkipped++;
                    continue;
                }
                
                paymentCreatedAt =
                        detailRec['created.at'] ||
                        detailRec['created_at'] ||
                        null;
                        
                department = String(detailRec['department'] ||"").trim();

                requestTypeLabel = String(
                        detailRec['transaction.type'] ||
                        detailRec['transaction_type'] ||
                        ""
                );

                contractCode = String(
                        detailRec['contract.code'] ||
                        detailRec['contract_code'] ||
                        detailRec['contract.id'] ||
                        detailRec['contract_id'] ||
                        item.contractId ||
                        ""
                );

                // Amount
                if (upperRequestId.indexOf("TT") === 0) {
                    amount = Number(
                            detailRec['total.amount.paid'] ||
                            detailRec['total_amount_paid'] ||
                            detailRec['amount'] ||
                            0
                    );
                } else {
                    amount = Number(detailRec['amount'] || 0);
                }

                // Unit - giữ nguyên STRING để không mất số 0 đầu
                unitLv1 = String(
                        detailRec['unit.lv1'] ||
                        detailRec['unit_lv1'] ||
                        ""
                ).trim();

                unitLv2 = String(
                        detailRec['unit.lv2'] ||
                        detailRec['unit_lv2'] ||
                        ""
                ).trim();

            } finally {
                try {
                    if (detailRec) detailRec.doClose();
                } catch (eDetailClose) {}
            }

            // ============================================================
            // BƯỚC 4: LẤY PAYMENT METHOD TỪ VENDOR
            // ============================================================
            var paymentMethod = "";
            var vendorTableName = "";
            var vendorQueryField = "";

            if (upperRequestId.indexOf("TT") === 0) {
                vendorTableName = "esdHTKTpaymentVendor";
                vendorQueryField = "payment.id";
            } else {
                vendorTableName = "esdHTKTprepaymentVendor";
                vendorQueryField = "prepayment.id";
            }

            var vendorRec = null;

            try {
                vendorRec = new SCFile(vendorTableName, SCFILE_READONLY);
                var vendorQuery =
                        vendorQueryField + '="' + escapeQueryValue(requestId) + '"';

                if (vendorRec.doSelect(vendorQuery) === RC_SUCCESS) {
                    var hasTransfer = false;
                    var hasCash = false;

                    do {
                        var rawMethod = String(
                                vendorRec['payment.method'] || ""
                        ).toUpperCase().replace(/[^A-Z]/g, "");

                        if (
                                rawMethod.indexOf("CHUYENKHOAN") !== -1 ||
                                rawMethod.indexOf("CK") !== -1
                        ) {
                            hasTransfer = true;
                        } else if (
                                rawMethod.indexOf("TIENMAT") !== -1 ||
                                rawMethod.indexOf("TM") !== -1
                        ) {
                            hasCash = true;
                        }
                    } while (vendorRec.getNext() === RC_SUCCESS);

                    if (hasTransfer && hasCash) {
                        paymentMethod = "HON_HOP";
                    } else if (hasTransfer) {
                        paymentMethod = "CHUYENKHOAN";
                    } else if (hasCash) {
                        paymentMethod = "TIENMAT";
                    }
                }

            } finally {
                try {
                    if (vendorRec) vendorRec.doClose();
                } catch (eVendorClose) {}
            }

            // ============================================================
            // BƯỚC 5: TÍNH STATUS
            // ============================================================
//            var finalStatus = item.totalErrorTrans > 0 ? "ERROR" : "ACCOUNTED";
            
            var finalStatus =
                item.totalTrans > 0 &&
                item.totalCompletedTrans === item.totalTrans
                    ? "ACCOUNTED"
                    : "ERROR";

            // ============================================================
            // BƯỚC 6: UPDATE / INSERT ERROR HANDLING
            // ============================================================
            targetRec = new SCFile("esdHTKTaccountingErrorHandling");
            var targetQuery =
                    'request.id="' + escapeQueryValue(requestId) + '"';

            if (targetRec.doSelect(targetQuery) === RC_SUCCESS) {
                // UPDATE
                targetRec['request.type'] = item.requestType;
                targetRec['contract.id'] = item.contractId;
                targetRec['status'] = finalStatus;
                targetRec['total.trans'] = item.totalTrans;
                targetRec['total.error.trans'] = item.totalErrorTrans;

                targetRec['request.type.label'] = requestTypeLabel;
                targetRec['contract.code'] = contractCode;
                targetRec['amount'] = amount;
                targetRec['payment.method'] = paymentMethod;
                targetRec['error.channel'] = item.errorChannel;
                targetRec['updated.at'] = item.updatedAt;
                targetRec['payment.created.at'] = paymentCreatedAt;
                targetRec['department'] = department;
                targetRec['request.unit.lv1'] = unitLv1;
                targetRec['request.unit.lv2'] = unitLv2;
                var updateRc = targetRec.doUpdate();

                if (updateRc === RC_SUCCESS) totalUpdated++;

            } else {
                // INSERT chỉ khi có ERROR
                if (item.totalErrorTrans <= 0) {
                    try {
                        targetRec.doClose();
                    } catch (eSkipClose) {}

                    targetRec = null;
                    continue;
                }

                var rc = 0;
                var newId = new SCDatum();

                rc = system.functions.rtecall(
                        "getnumber",
                        rc,
                        newId,
                        "esdHTKTaccountingErrorHandling"
                );

                var generatedId = newId ? String(newId.getText() || "") : "";

                if (!generatedId) {
                    totalSkipped++;

                    try {
                        targetRec.doClose();
                    } catch (eIdClose) {}

                    targetRec = null;
                    continue;
                }

                targetRec['id'] = generatedId;
                targetRec['request.id'] = requestId;
                targetRec['request.type'] = item.requestType;
                targetRec['contract.id'] = item.contractId;
                targetRec['status'] = finalStatus;
                targetRec['total.trans'] = item.totalTrans;
                targetRec['total.error.trans'] = item.totalErrorTrans;
                targetRec['request.type.label'] = requestTypeLabel;
                targetRec['contract.code'] = contractCode;
                targetRec['amount'] = amount;
                targetRec['payment.method'] = paymentMethod;
                targetRec['error.channel'] = item.errorChannel;
                targetRec['updated.at'] = item.updatedAt;
                targetRec['payment.created.at'] = paymentCreatedAt;
                targetRec['department'] = department;
                targetRec['request.unit.lv1'] = unitLv1;
                targetRec['request.unit.lv2'] = unitLv2;
                var insertRc = targetRec.doInsert();

                if (insertRc === RC_SUCCESS) totalInserted++;
            }

            try {
                if (targetRec) targetRec.doClose();
            } catch (eTargetClose) {}

            targetRec = null;
        }

//        print(
//                "[FULL SYNC ACCOUNTING ERROR HANDLING]" +
//                " updated=" + totalUpdated +
//                ", inserted=" + totalInserted +
//                ", skipped=" + totalSkipped
//        );

        return {
            success: true,
            totalRequests: Object.keys(requestMap).length,
            updated: totalUpdated,
            inserted: totalInserted,
            skipped: totalSkipped
        };

    } catch (e) {
//        print("[FULL SYNC ACCOUNTING ERROR HANDLING ERROR] " + e);

        return {
            success: false,
            message: String(e)
        };

    } finally {
        try {
            if (accountingRec) accountingRec.doClose();
        } catch (e1) {}

        try {
            if (targetRec) targetRec.doClose();
        } catch (e2) {}
    }
}

// syncAllAccountingErrorHandling();




/**
 * Hàm JOIN lấy thêm Số tiền, Phương thức thanh toán, Contract
 * và Đơn vị (unit.lv1, unit.lv2) từ Payment/Prepayment
 */
function getPaymentDetailInfo(requestId, subType) {
    var result = {
        amount: 0,
        paymentMethod: "",
        contractId: "",
        createdAt: null,
        unitLv1: "",
        unitLv2: ""
    };

    if (!requestId) return result;

    var type = String(subType || "").toUpperCase();
    var isTamUng = (type === "TAM_UNG" || requestId.indexOf("TU") === 0);
    var isThanhToan = (type === "THANH_TOAN" || requestId.indexOf("TT") === 0);

    // 1. LẤY THÔNG TIN PHIẾU TẠM ỨNG
    if (isTamUng) {
        var prepayRec = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
        try {
            if (prepayRec.doSelect('id="' + requestId + '"') === RC_SUCCESS) {
                result['amount'] = prepayRec['amount'] || 0;
                result['contractId'] = prepayRec['contract_id'] || "";
                result['createdAt'] = prepayRec['created_at'] || null;
                // Lấy đơn vị từ bảng Prepayment
                result['unitLv1'] = prepayRec['unit.lv1'] || prepayRec['unit_lv1'] || "";
                result['unitLv2'] = prepayRec['unit.lv2'] || prepayRec['unit_lv2'] || "";
            }
        } finally {
            if (prepayRec) prepayRec.doClose();
        }

        // 2. LẤY THÔNG TIN PHIẾU THANH TOÁN
    } else if (isThanhToan) {
        var payRec = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        try {
            if (payRec.doSelect('id="' + requestId + '"') === RC_SUCCESS) {
                result['amount'] = payRec['total_amount_paid'] || 0;
                result['contractId'] = payRec['contract_id'] || "";
                result['createdAt'] = payRec['created_at'] || null;
                // Lấy đơn vị từ bảng Payment
                result['unitLv1'] = payRec['unit.lv1'] || payRec['unit_lv1'] || "";
                result['unitLv2'] = payRec['unit.lv2'] || payRec['unit_lv2'] || "";
            }
        } finally {
            if (payRec) payRec.doClose();
        }
    }

    // 3. LẤY PHƯƠNG THỨC THANH TOÁN TỪ BẢNG VENDOR
    var vendorTableName = isTamUng ? "esdHTKTprepaymentVendor" : (isThanhToan ? "esdHTKTpaymentVendor" : "");
    var vendorQueryField = isTamUng ? 'prepayment.id' : 'payment.id';

    if (vendorTableName) {
        var vendorRec = new SCFile(vendorTableName, SCFILE_READONLY);
        try {
            var vendorQuery = vendorQueryField + '="' + requestId + '"';
            if (vendorRec.doSelect(vendorQuery) === RC_SUCCESS) {
                var hasTransfer = false;
                var hasCash = false;

                do {
                    var rawMethod = String(vendorRec['payment.method'] || "").toUpperCase().replace(/[^A-Z]/g, '');

                    if (rawMethod.indexOf("CHUYENKHOAN") !== -1 || rawMethod.indexOf("CK") !== -1) {
                        hasTransfer = true;
                    } else if (rawMethod.indexOf("TIENMAT") !== -1 || rawMethod.indexOf("TM") !== -1) {
                        hasCash = true;
                    }
                } while (vendorRec.getNext() === RC_SUCCESS);

                if (hasTransfer && hasCash) {
                    result['paymentMethod'] = "Hỗn hợp";
                } else if (hasTransfer) {
                    result['paymentMethod'] = "Chuyển khoản";
                } else if (hasCash) {
                    result['paymentMethod'] = "Tiền mặt";
                }
            }
        } finally {
            if (vendorRec) vendorRec.doClose();
        }
    }
    return result;
}

//getPaymentDetailInfo('TU.106.26.0000001', 'TAM_UNG');


/**
 * Lấy checked_time mới nhất và type (kênh lỗi) của giao dịch có status ERROR.
 */
function getLatestAccountingCheckedTime(requestId) {
    if (!requestId) return {};

    var accountingRec = null;
    var latestTimestamp = 0;
    var latestErrorTimestamp = 0; // Quản lý timestamp của giao dịch lỗi
    var result = {
        latestCheckedTime: "",
        errorChannel: ""
    };

    try {
        accountingRec = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);

        var query = 'prepayment.id="' + escapeQueryValue(requestId) + '"';
        var rc = accountingRec.doSelect(query);

        while (rc === RC_SUCCESS) {
            var checkedTime = accountingRec['checked_time'] || accountingRec['checked.time'];
            var type = accountingRec['type'];
            var status = String(accountingRec['status'] || '').toUpperCase();

            var timestamp = 0;
            if (checkedTime) {
                timestamp = new Date(String(checkedTime)).getTime();
                if (isNaN(timestamp)) timestamp = 0;
            }

            // 1. Cập nhật Checked Time mới nhất (cho toàn bộ giao dịch)
            if (timestamp > latestTimestamp) {
                latestTimestamp = timestamp;
                result.latestCheckedTime = checkedTime;
            }

            // 2. CHỈ LẤY errorChannel TỪ BẢN GHI CÓ STATUS LỖI (ERROR)
            // Lấy channel của giao dịch lỗi có checkedTime mới nhất
            if (status === "ERROR" && type) {
                if (timestamp >= latestErrorTimestamp) {
                    latestErrorTimestamp = timestamp;
                    result.errorChannel = type;
                }
            }

            rc = accountingRec.getNext();
        }
    } catch (e) {
        logger.info('getLatestAccountingCheckedTime: ' + e);
    } finally {
        try {
            if (accountingRec) accountingRec.doClose();
        } catch (e1) {}
    }

//    print('result = ', JSON.stringify(result));
    return result;
}

// Đọc kết quả của chính requestId vừa thử lại; không dùng response của lần cũ.
function getAccountingRetryFailureMessage(requestId) {
    var fallback = "Gửi lại giao dịch sang hệ thống tích hợp thất bại";
    var retryRec = null;

    try {
        retryRec = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
        if (retryRec.doSelect('request.id="' + escapeQueryValue(requestId) + '"') !== RC_SUCCESS) {
            return fallback + ": không tìm thấy bản ghi theo requestId mới";
        }

        var status = String(retryRec["status"] || "").trim().toUpperCase();
        if (status === ACCOUNTING_STATUS.CREATED) {
            return fallback + ": chưa nhận được hoặc chưa lưu được phản hồi của lần thử lại";
        }

        var responseText = String(retryRec["response"] || "").trim();
        if (responseText) {
            try {
                var response = JSON.parse(responseText);
                var responseMessage = String(
                    (response && response.message) ||
                    (response && response.status && response.status.detail) ||
                    ""
                ).trim();
                if (responseMessage) return responseMessage;
            } catch (eResponse) {}
        }

        var recordMessage = String(retryRec["message"] || "").trim();
        return recordMessage || fallback;
    } catch (eRead) {
        return fallback + ": không đọc được kết quả của lần thử lại";
    } finally {
        try {
            if (retryRec) retryRec.doClose();
        } catch (eClose) {}
    }
}

//getLatestAccountingCheckedTime("TT.100.26.0000090");

/**
 * Retry gửi hạch toán lỗi
 */
function retryAccountingErrorsResult(input) {
    var data = {};

    // Bước 1: Parse dữ liệu FE gửi lên
    try {
        data = JSON.parse(input.queryString);
    } catch (e) {
        return {
            success: false,
            message: "Dữ liệu đầu vào không hợp lệ: " + String(e),
            retried: 0,
            failed: 1,
            blocked: 0,
            errors: [{ message: String(e) }]
        };
    }

    // Bước 2: Chuẩn hóa danh sách giao dịch
    var rows = data.rows || (Array.isArray(data) ? data : [data]);
    if (!rows || rows.length === 0) {
        return {
            success: false,
            message: "Danh sách giao dịch thử lại trống",
            retried: 0,
            failed: 1,
            blocked: 0,
            errors: [{ message: "Danh sách giao dịch thử lại trống" }]
        };
    }

    var result = {
        success: true,
        retried: 0,
        failed: 0,
        blocked: 0,
        errors: []
    };
    var processedRequestIds = {};

    // Bước 3: Xử lý lần lượt từng giao dịch được chọn
    for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        var targetRequestId = String(
            row.requestId || row["request.id"] || ""
        ).trim();

        // Bước 4: Kiểm tra requestId và loại bản ghi trùng
        if (!targetRequestId) {
            result.failed++;
            result.errors.push({
                index: i,
                message: "Thiếu requestId"
            });
            continue;
        }

        if (processedRequestIds[targetRequestId]) continue;
        processedRequestIds[targetRequestId] = true;

        // [CHANGED] Khai báo ngoài try để finally có thể đóng SCFile
        var accountingInfo = null;

        try {
            // Bước 5: Query bản ghi giao dịch thật trong DB
            accountingInfo = new SCFile("esdHTKTaccountingInformation");
            var query = 'request.id="' + escapeQueryValue(targetRequestId) + '"';

            if (accountingInfo.doSelect(query) !== RC_SUCCESS) {
                result.failed++;
                result.errors.push({
                    requestId: targetRequestId,
                    message: "Không tìm thấy giao dịch hạch toán"
                });
                continue;
            }

            // Bước 6: Chỉ cho thử lại giao dịch đang ở trạng thái lỗi
            var currentStatus = String(accountingInfo["status"] || "").trim().toUpperCase();
            if (currentStatus !== ACCOUNTING_STATUS.ERROR) {
                result.blocked++;
                result.errors.push({
                    requestId: targetRequestId,
                    message: "Giao dịch không còn ở trạng thái lỗi, không được phép thử lại"
                });
                continue;
            }

            var accountingType = String(accountingInfo["type"] || "").trim().toUpperCase();
            var previousData = String(accountingInfo["data"] || "");
            var previousResponse = String(accountingInfo["response"] || "");
            var retryPrepaymentId = String(
                accountingInfo["prepayment.id"] || row.prepaymentId || ""
            ).trim();

            // Bước 8: Chỉ cho phép các loại giao dịch có hàm tích hợp thật.
            if (
                accountingType !== "AP" &&
                accountingType !== "GL" &&
                accountingType !== "CORE"
            ) {
                result.failed++;
                result.errors.push({
                    requestId: targetRequestId,
                    message: "Loại giao dịch không hỗ trợ thử lại: " + accountingType
                });
                continue;
            }

            // AP/GL dùng requestId mới; CORE giữ requestId và data hiện có.
            var currentPayloadText = previousData.trim();
            var currentPayload = null;

            try {
                currentPayload = JSON.parse(currentPayloadText);
            } catch (ePayload) {
                result.failed++;
                result.errors.push({
                    requestId: targetRequestId,
                    message: "Field data của giao dịch không phải JSON hợp lệ: " + String(ePayload)
                });
                continue;
            }

            if (!currentPayload || typeof currentPayload !== "object" || Array.isArray(currentPayload)) {
                result.failed++;
                result.errors.push({
                    requestId: targetRequestId,
                    message: "Field data của giao dịch không phải JSON object hợp lệ"
                });
                continue;
            }

            var newRequestId = accountingType === "CORE"
                ? targetRequestId
                : String(lib.UUID.generateUUID() || "").trim().toLowerCase();

            if (!newRequestId) {
                result.failed++;
                result.errors.push({
                    requestId: targetRequestId,
                    message: "Không thể sinh requestId mới bằng UUID"
                });
                continue;
            }

            if (accountingType !== "CORE") {
                currentPayload.requestId = newRequestId;
            }

            var retryAccountingInfo = {
                "request.id": newRequestId,
                "prepayment.id": retryPrepaymentId,
                type: accountingType,
                "sub.type": accountingInfo["sub.type"],
                data: accountingType === "CORE" ? previousData : JSON.stringify(currentPayload)
            };

            // Luu snapshot cu va lien ket voi ban ghi xu ly loi truoc khi retry.
            var retryHistoryResult = createAccountingRetryHistory(
                retryPrepaymentId,
                targetRequestId,
                previousData,
                previousResponse,
                accountingInfo["type"]
            );

            if (!retryHistoryResult.success) {
                result.failed++;
                result.errors.push({
                    requestId: targetRequestId,
                    type: accountingType,
                    message: "Không lưu được lịch sử dữ liệu trước khi thử lại: " +
                        retryHistoryResult.message
                });
                continue;
            }

            // Bước 10: Lưu bản ghi trước khi gọi API để callApi* query lại đúng request.id.
            accountingInfo["request.id"] = newRequestId;
            accountingInfo["data"] = retryAccountingInfo.data;
            accountingInfo["response"] = "";
            accountingInfo["message"] = "";
            accountingInfo["status"] = ACCOUNTING_STATUS.CREATED;
            accountingInfo["transaction.id"] = "";
            accountingInfo["host.res.num"] = "";
            accountingInfo["ref.id"] = "";
            accountingInfo["ap.code"] = "";
            accountingInfo["batch.name"] = "";
            accountingInfo["payment.number"] = "";
            var retryCheckedTime = system.functions.tod();
            accountingInfo["checked.time"] = retryCheckedTime;
            accountingInfo["updated.at"] = retryCheckedTime;

            var updateRc = accountingInfo.doUpdate();

            if (updateRc !== RC_SUCCESS) {
                result.failed++;
                result.errors.push({
                    requestId: targetRequestId,
                    type: accountingType,
                    message: "Không lưu được bản ghi trước khi thử lại"
                });
                continue;
            }

            // Đóng SCFile hiện tại để tránh giữ record trong lúc callApi*
            // mở một SCFile khác và cập nhật cùng bản ghi.
            try {
                accountingInfo.doClose();
            } catch (eCloseBeforeRetry) {}
            accountingInfo = null;

            // Bước 11: Gọi luồng tích hợp thật. Phần mock đã được vô hiệu hóa.
            // var retrySuccess = mockCode === "0";
            // accountingInfo["response"] = JSON.stringify(mockResponse);
            var retrySuccess = false;

            if (accountingType === "AP") {
                retrySuccess = lib.ESD_HTKT_ACCOUNTING_UTILS.callApiAp(
                    retryAccountingInfo
                );
            } else if (accountingType === "GL") {
                retrySuccess = lib.ESD_HTKT_ACCOUNTING_UTILS.callApiGl(
                    retryAccountingInfo
                );
            } else if (accountingType === "CORE") {
                retrySuccess = lib.ESD_HTKT_ACCOUNTING_UTILS.callApiCore(
                    retryAccountingInfo
                );
            }

            // Bước 13: Ghi lịch sử thử lại tại màn hình xử lý lỗi và phiếu gốc.
            var retryUser = String(
                row.user || vars['$lo.contact.name'] || system.user.name || ""
            ).trim();
            var retryActivityLines = [
                "Thử lại giao dịch " + accountingType,
                "Kết quả gửi lại: " +
                    (retrySuccess
                        ? "Đã gửi sang hệ thống tích hợp"
                        : "Gửi sang hệ thống tích hợp thất bại")
            ];
            var retryActivityDescription = retryActivityLines.join("\n");

            try {
                if (
                    retryPrepaymentId &&
                    lib.ESD_Utils &&
                    lib.ESD_Utils.createActivity
                ) {
                    lib.ESD_Utils.createActivity(
                        "activityHTKTaccountingErrorHandling",
                        retryActivityDescription,
                        retryPrepaymentId,
                        "Thử lại",
                        retryUser
                    );

                    var retryRequestPrefix = retryPrepaymentId
                        .toUpperCase()
                        .slice(0, 2);
                    var retryParentActivityTable = "";

                    if (retryRequestPrefix === "TU") {
                        retryParentActivityTable = "activityHTKTprepayment";
                    } else if (retryRequestPrefix === "TT") {
                        retryParentActivityTable = "activityHTKTpayment";
                    }

                    if (retryParentActivityTable) {
                        lib.ESD_Utils.createActivity(
                            retryParentActivityTable,
                            retryActivityDescription,
                            retryPrepaymentId,
                            "Thử lại",
                            retryUser
                        );
                    }
                }
            } catch (eRetryActivity) {
//                print(
//                    "[retryAccountingErrorsResult] Không ghi được lịch sử thử lại: " +
//                    String(eRetryActivity)
//                );
            }

            // Bước 14: Tổng hợp kết quả
            if (retrySuccess) {
                result.retried++;
            } else {
                result.failed++;
                result.errors.push({
                    requestId: newRequestId,
                    type: accountingType,
                    message: getAccountingRetryFailureMessage(newRequestId)
                });
            }

        // [CHANGED] Bổ sung catch cho try xử lý từng giao dịch
        } catch (e) {
            print(
                "[ERROR retryAccountingErrorsResult] requestId=" +
                targetRequestId +
                ", error=" +
                String(e)
            );

            result.failed++;
            result.errors.push({
                requestId: targetRequestId,
                message: String(e.message || e)
            });

        // [CHANGED] Luôn đóng SCFile kể cả khi continue hoặc phát sinh exception
        } finally {
            try {
                if (accountingInfo) {
                    accountingInfo.doClose();
                }
            } catch (eClose) {}
        }
    }

    // Trả kết quả cuối cùng
    result.success = result.failed === 0 && result.blocked === 0;
    if (!result.success && result.errors.length > 0) {
        result.message = result.errors[0].message;
    }

    return result;
}

/**
 * Lưu một snapshot accounting information trước mỗi lần thử lại.
 * handling.id tham chiếu tới id của esdHTKTaccountingErrorHandling.
 */
function createAccountingRetryHistory(paymentId, requestId, data, response, type) {
    var result = {
        success: false,
        retryCount: 0,
        created: false,
        message: ""
    };

    var normalizedPaymentId = String(paymentId || "").trim();
    var previousRequestId = String(requestId || "").trim();
    var previousData = String(data || "");
    var previousResponse = String(response || "");
    var previousType = String(type || "");

    if (!normalizedPaymentId) {
        result.message = "Thiếu payment.id";
        return result;
    }

    if (!previousData) {
        result.message = "Thiếu data cũ để lưu lịch sử thử lại";
        return result;
    }

    var retryItem = null;
    var countItem = null;
    var handlingRec = null;

    try {
        handlingRec = new SCFile(
            "esdHTKTaccountingErrorHandling",
            SCFILE_READONLY
        );
        var handlingRc = handlingRec.doSelect(
            'request.id="' + escapeQueryValue(normalizedPaymentId) + '"'
        );

        if (handlingRc !== RC_SUCCESS) {
            result.message = "Không tìm thấy bản ghi xử lý lỗi hạch toán";
            return result;
        }

        var handlingId = String(handlingRec["id"] || "").trim();
        if (!handlingId) {
            result.message = "Bản ghi xử lý lỗi hạch toán chưa có id";
            return result;
        }

        var retryCount = 1;
        countItem = new SCFile(
            "esdHTKTaccountingErrorHandlingItem",
            SCFILE_READONLY
        );
        var countRc = countItem.doSelect(
            'payment.id="' + escapeQueryValue(normalizedPaymentId) + '"'
        );

        while (countRc === RC_SUCCESS) {
            retryCount++;
            countRc = countItem.getNext();
        }

        try {
            countItem.doClose();
        } catch (eCountClose) {}
        countItem = null;

        var rc = 0;
        var newId = new SCDatum();
        rc = system.functions.rtecall(
            "getnumber",
            rc,
            newId,
            "esdHTKTaccountingErrorHandlingItem"
        );

        var generatedId = newId
            ? String(newId.getText() || "").trim()
            : "";

        if (!generatedId) {
            result.message = "Không sinh được ID cho lịch sử thử lại";
            return result;
        }

        retryItem = new SCFile("esdHTKTaccountingErrorHandlingItem");
        retryItem["id"] = generatedId;
        retryItem["payment.id"] = normalizedPaymentId;
        retryItem["request.id"] = previousRequestId;
        retryItem["response"] = previousResponse;
        retryItem["retry.count"] = retryCount;
        retryItem["data"] = previousData;
        retryItem["type"] = previousType;
        retryItem["handling.id"] = handlingId;

        if (retryItem.doInsert() === RC_SUCCESS) {
            result.success = true;
            result.created = true;
            result.retryCount = retryCount;
        } else {
            result.message = "Tạo lịch sử thử lại thất bại";
        }

    } catch (e) {
        result.message = String(e.message || e);

//        print(
//            "[ERROR createAccountingRetryHistory]" +
//            " paymentId=" +
//            normalizedPaymentId +
//            ", data=" +
//            previousData +
//            ", error=" +
//            String(e)
//        );
    } finally {
        try {
            if (retryItem) {
                retryItem.doClose();
            }
        } catch (eClose) {}

        try {
            if (countItem) {
                countItem.doClose();
            }
        } catch (eCountCloseFinally) {}

        try {
            if (handlingRec) {
                handlingRec.doClose();
            }
        } catch (eHandlingClose) {}
    }

    return result;
}


/**
 * Hàm helper lấy chuỗi ngày tháng năm DDMMYYYY hiện tại
 */
function getFormattedDateStr() {
    var d = new Date();
    var day = ("0" + d.getDate()).slice(-2);
    var month = ("0" + (d.getMonth() + 1)).slice(-2);
    var year = d.getFullYear();
    return day + month + year; // Ví dụ: 15092026
}


/**
 * Lưu khai báo kết quả hạch toán
 */
function saveAccountingErrorsResult(input) {
    var data = {};
    try {
        data = JSON.parse(input.queryString);
    } catch (e) {
        return { success: false, message: "Dữ liệu đầu vào không hợp lệ: " + String(e), updated: 0, failed: 1, errors: [{ message: String(e) }] };
    }
    var rows = data.rows || (Array.isArray(data) ? data : [data]);
    if (!rows || rows.length === 0) {
        return { success: false, message: "Danh sách giao dịch khai báo trống", updated: 0, failed: 1, errors: [{ message: "Danh sách giao dịch trống" }] };
    }
    var userContact = (rows[0] && rows[0].user) ? rows[0].user : (vars['$lo.contact.name'] || system.user.name);

    // Nếu Client gửi kèm clientTime thì ưu tiên dùng, nếu không mới lấy tod() của Server
    var currentTime = (rows[0] && rows[0].clientTime) ? new Date(rows[0].clientTime) : system.functions.tod();
    var currentOpName = system.functions.operator();

    var result = {
        success: true,
        updated: 0,
        failed: 0,
        errors: []
    };

    var processedRequestIds = {};

    for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        var targetRequestId = String(row.requestId || row.id || "").trim();

        // VALIDATION BẮT BUỘC: Kiểm tra requestId từ Client gửi lên
        if (!targetRequestId) {
            result.failed++;
            result.errors.push({
                index: i,
                message: "Thiếu requestId"
            });
            continue;
        }

        if (processedRequestIds[targetRequestId]) {
            // Bỏ qua bản ghi trùng lặp requestId đã được xử lý
            continue;
        }
        processedRequestIds[targetRequestId] = true;

        try {
            var rec = new SCFile("esdHTKTaccountingInformation");
            var query = 'request.id="' + escapeQueryValue(targetRequestId) + '"';

            if (rec.doSelect(query) === RC_SUCCESS) {
                var currentStatus = String(rec["status"] || "").toUpperCase();

                // VALIDATION: Chặn khai báo lại nếu bản ghi đã hoàn thành hoặc không ở trạng thái lỗi
                if (currentStatus === ACCOUNTING_STATUS.COMPLETED || currentStatus !== ACCOUNTING_STATUS.ERROR) {
                    result.failed++;
                    result.errors.push({
                        requestId: targetRequestId,
                        message: "Giao dịch " + targetRequestId + " đã được xử lý khai báo kết quả trước đó."
                    });
                    continue;
                }

                // PHÂN LUỒNG CẬP NHẬT FIELD RESPONSE JSON
                var responseObj = {};
                var rawResponse = String(rec["response"] || "").trim();

                // Parse JSON response hiện tại (nếu có)
                if (rawResponse) {
                    try {
                        responseObj = JSON.parse(rawResponse);
                    } catch (eParse) {
                        responseObj = {};
                    }
                }

                // Lấy Transaction ID từ payload hoặc DB hoặc response/data
                var transId = String(row.transactionId || row._transactionId || rec["transaction.id"] || rec["transaction_id"] || "").trim();
                if (!transId && responseObj) {
                    transId = String(responseObj.hostRefNum || responseObj.trnRefNum || responseObj.transactionId || (responseObj.data && (responseObj.data.hostRefNum || responseObj.data.trnRefNum || responseObj.data.transactionId)) || "").trim();
                }
                if (!transId && rec["data"]) {
                    try {
                        var dObj = typeof rec["data"] === "string" ? JSON.parse(rec["data"]) : rec["data"];
                        transId = String(dObj.trnRefNum || dObj.transactionId || (dObj.data && (dObj.data.trnRefNum || dObj.data.transactionId || dObj.data.trnRef)) || "").trim();
                    } catch (eD) {}
                }

                // Lấy nội dung lỗi trước khi gán rỗng (từ rec["message"], payload FE hoặc response JSON của hệ thống tích hợp)
                var currentErrorMessage = String(rec["message"] || row.message || row.errorMessage || "").trim();
                if (!currentErrorMessage && responseObj) {
                    currentErrorMessage = String(responseObj.message || responseObj.errorMessage || responseObj.error || responseObj.description || responseObj.detail || responseObj.errorDesc || responseObj.respDesc || "").trim();
                }
                var errorSuffix = currentErrorMessage ? ("Nội dung lỗi: " + currentErrorMessage) : "";

                // Gán dữ liệu cơ bản vào object record
                rec["batch.name"] = row.batchName || "";
                rec["ap.code"] = row.invoiceNumber || "";
                rec["payment.number"] = row.paymentNumber || "";
                rec["transaction.id"] = transId;
                rec["checked.time"] = currentTime;
                rec["updated.by"] = userContact;
                rec["updated.at"] = currentTime;
                rec["status"] = ACCOUNTING_STATUS.COMPLETED;
//                rec["message"] = "";

                // Lấy thông tin cơ bản
                var dateCode = getFormattedDateStr(); // DDMMYYYY
                var noteText = (row.note && row.note.trim()) ? row.note.trim() : "";
                var noteSuffix = noteText ? ("Ghi chú: " + noteText) : "";
                var recordType = String(rec["type"] || row.type || "").toUpperCase();
                var subType = String(rec["sub.type"] || rec["subType"] || row.subType || "").toUpperCase();
                var prepaymentId = String(rec["prepayment.id"] || row.prepaymentId || "").trim().toUpperCase();

                if (recordType === "CORE") {
                    // LUỒNG 1: CHỈ DÀNH CHO CORE -> Lưu hostRefNum
//                    if (transId) {
//                        responseObj.hostRefNum = transId;
//                        rec["host.res.num"] = transId;
//                    }
                    if (transId) {
                        var hasResponseData =
                                responseObj.data &&
                                typeof responseObj.data === "object" &&
                                !Array.isArray(responseObj.data);
                    
                        if (hasResponseData) {
                            // Response có data thì lưu vào data.hostRefNum
                            responseObj.data.hostRefNum = transId;
                    
                            // Nếu response vốn có hostRefNum ngoài root thì đồng bộ để tránh lệch dữ liệu
                            if (responseObj.hostRefNum !== undefined) {
                                responseObj.hostRefNum = transId;
                            }
                        } else {
                            // Response không có data thì lưu ngoài root
                            responseObj.hostRefNum = transId;
                        }
                    
                        rec["host.res.num"] = transId;
                    }
                    
                } else {
                    // LUỒNG 2: DÀNH CHO KHÁC CORE (AP, GL, OGL...) -> Lưu data.paymentNumber
                    if (!responseObj.data || typeof responseObj.data !== "object") {
                        responseObj.data = {};
                    }

                    var valPaymentNum = (row.paymentNumber !== undefined && row.paymentNumber !== null)
                            ? row.paymentNumber
                            : rec["payment.number"];

                    if (valPaymentNum !== undefined && valPaymentNum !== null && valPaymentNum !== "") {
                        responseObj.data.paymentNumber = !isNaN(Number(valPaymentNum)) ? Number(valPaymentNum) : valPaymentNum;
                    }
                }

                // Chuỗi hóa lại để ghi đè xuống DB
                rec["response"] = JSON.stringify(responseObj);

                // Lấy 5 ký tự cuối của Ap Code
                var apCodeFull = String(rec["ap.code"] || row.invoiceNumber || "").trim();
                var apSuffix = "";
                if (apCodeFull.length >= 5) {
                    apSuffix = apCodeFull.slice(-5);
                }

                // Phân loại requestPrefix
                var requestPrefix = prepaymentId.slice(0, 2);
                var headerTitle = "";

                if (recordType === "CORE") {
                    headerTitle = "Khai báo kết quả giao dịch chuyển tiền";

                } else if (recordType === "AP") {
                    var apTypeStr = "Standard";
                    if (requestPrefix === "TT") {
                        apTypeStr = "Standard";
                    } else if (requestPrefix === "TU") {
                        if (subType === "THUE" || subType === "TAX") {
                            apTypeStr = "Standard";
                        } else {
                            apTypeStr = "Prepayment";
                        }
                    }
                    var apCodeFormatted = "QLTS_" + dateCode + (apSuffix ? ("_" + apSuffix) : "");
                    headerTitle = "Khai báo kết quả bút toán AP - " + apTypeStr + " " + apCodeFormatted;

                } else if (recordType === "GL") {
                    headerTitle = "Khai báo kết quả bút toán GL QLTS_" + dateCode;

                } else {
                    headerTitle = "Khai báo kết quả giao dịch hạch toán OGL QLTS_" + dateCode;
                }

                var logLines = [];
                
                // Tiêu đề
                logLines.push(headerTitle);
                
                // Nội dung lỗi
                if (currentErrorMessage) {
                    logLines.push("Nội dung lỗi: " + currentErrorMessage);
                }
                
                // Mã giao dịch
                if (transId) {
                    logLines.push("Mã giao dịch: " + transId);
                }
                
                // Ghi chú
                if (noteText) {
                    logLines.push("Ghi chú: " + noteText);
                }
                
                var descriptionLog = logLines.join("\n");

                var userLog = userContact;
                var ticketNumber = rec["prepayment.id"] || rec["request.id"] || row.requestId;

                // Ghi Log Activity
                try {
                    if (lib.ESD_Utils && lib.ESD_Utils.createActivity) {
                        // 1. Ghi lịch sử tại màn hình Accounting Error Handling
                        lib.ESD_Utils.createActivity(
                                "activityHTKTaccountingErrorHandling",
                                descriptionLog,
                                ticketNumber,
                                "Khai báo kết quả",
                                userLog
                        );
                        
                        // 2. Ghi thêm lịch sử vào phiếu gốc Payment / Prepayment
                        var parentActivityTable = "";
                        if (requestPrefix === "TU") {
                            parentActivityTable = "activityHTKTprepayment";
                        } else if (requestPrefix === "TT") {
                            parentActivityTable = "activityHTKTpayment";
                        }
                
                        if (parentActivityTable && prepaymentId) {
                            lib.ESD_Utils.createActivity(
                                parentActivityTable,
                                descriptionLog,
                                prepaymentId,
                                "Khai báo kết quả",
                                userLog
                            );
                        }
                    }
                } catch (eActivity) {
//                    print("[ERROR Log] Bỏ qua lỗi log, tiếp tục update: " + eActivity);
                }

                // Cập nhật bản ghi xuống DB
                var rc = rec.doUpdate();

                if (rc === RC_SUCCESS) {
                    result.updated++;
                } else {
                    result.failed++;
                    result.errors.push({
                        requestId: row.requestId,
                        message: "Update bản ghi thất bại"
                    });
                }
            } else {
                result.failed++;
                result.errors.push({
                    requestId: row.requestId,
                    message: "Không tìm thấy bản ghi"
                });
            }

//            print('rec === ', rec);
        } catch (e) {
            result.failed++;
            result.errors.push({
                requestId: row.requestId,
                message: String(e.message || e)
            });
        }
    }

    result.success = result.failed === 0;
    return result;
}





/**
 * Danh sách phiếu có lỗi hạch toán (Phân miền theo Unit của User)
 */
//function getPaymentRequestErrors(input) {
//    var payload = {};
//    try {
//        payload = JSON.parse(input.queryString);
//    } catch (e) {
//        print('Lỗi parse queryString: ' + e);
//    }
//
//    // Lấy thông tin đơn vị của User đăng nhập
//    var userUnitLv1 = payload.unitLv1 || (payload.unit ? payload.unit.lv1 : "");
//    var userUnitLv2 = payload.unitLv2 || (payload.unit ? payload.unit.lv2 : "");
//
//    // Đồng bộ trước để danh sách trả về phản ánh dữ liệu mới nhất ngay trong lần gọi hiện tại.
//     syncAccountingErrorHandling(payload);
//
//    var errorRec = new SCFile("esdHTKTaccountingErrorHandling", SCFILE_READONLY);
//    var errorQuery = "true";
//    var listData = [];
//
//    try {
//        if (errorRec.doSelect(errorQuery) === RC_SUCCESS) {
//            do {
//                var requestId = errorRec['request_id'] || "";
//                var requestType = errorRec['request_type'] || "";
//                if (!requestId) continue;
//
//                // 1. Lấy thông tin chi tiết phiếu (bao gồm cả unitLv1 và unitLv2)
//                var extraInforError = getPaymentDetailInfo(requestId, requestType);
//
//                // 2. LỌC PHÂN MIỀN DỮ LIỆU: KHỚP unitLv1 HOẶC unitLv2
//                var isMatchLv1 = userUnitLv1 && extraInforError.unitLv1 === userUnitLv1;
//                var isMatchLv2 = userUnitLv2 && extraInforError.unitLv2 === userUnitLv2;
//                
//                // Nếu User CÓ thông tin đơn vị, nhưng KHÔNG KHỚP cả Lv1 lẫn Lv2 thì mới bỏ qua
//                if ((userUnitLv1 || userUnitLv2) && !isMatchLv1 && !isMatchLv2) {
//                    continue;
//                }
//
//                // 3. Lấy thông tin checked.time mới nhất
//                var result = getLatestAccountingCheckedTime(requestId);
//
//                listData.push({
//                    id: errorRec['id'],
//                    totalTrans: errorRec['total_trans'] || 0,
//                    totalErrorTrans: errorRec['total_error_trans'] || 0,
//                    requestId: requestId,
//                    prepaymentId: requestId,
//                    requestType: requestType,
//                    contractId: errorRec['contract_id'] || extraInforError['contractId'],
//                    status: errorRec['status'] || "",
//                    amount: errorRec['amount'] || extraInforError['amount'],
//                    paymentMethod: extraInforError['paymentMethod'],
//                    type: result.errorChannel || "",
//                    checkedTime: result.latestCheckedTime || "",
//                    createdAt: extraInforError['createdAt'],
//                    updateAt: errorRec['updateAt'] || errorRec['update.at'],
//                    contractCode: errorRec['contractCode'] || errorRec['contract.code'],
//                    errorChannel: errorRec['errorChannel'] || errorRec['error.channel'],
////                    requestTypeLabel: errorRec['requestTypeLabel'] || errorRec['request.type.label'],
//                    unitLv1: errorRec['unitLv1'] || errorRec['unit.lv1'],
//                    unitLv2: errorRec['unitLv2'] || errorRec['unit.lv2']
//                });
//            } while (errorRec.getNext() === RC_SUCCESS);
//        }
//    } finally {
//        if (errorRec) errorRec.doClose();
//    }
//    return rteJSONStringify(listData);
//}





/**
 * Danh sách Activity Log theo requestId
 */
function getActivitiesByRequestId(requestId) {
    var activities = [];
    if (!requestId) return activities;

    var actRec = new SCFile("activityHTKTaccountingErrorHandling", SCFILE_READONLY);
    // Sắp xếp giảm dần theo thời gian để lấy log mới nhất lên đầu
    actRec.setOrderBy(["datestamp"], [SCFILE_DSC]);
    var actQuery = 'number="' + escapeQueryValue(requestId) + '"';

    if (actRec.doSelect(actQuery) === RC_SUCCESS) {
        do {
            activities.push({
                thenumber: actRec['thenumber'] || "",
                number: actRec['number'] || "",
                type: actRec['type'] || "",
                datestamp: actRec['datestamp'] || null,
                operator: actRec['operator'] || "",
                description: actRec['description'] || "",
                sysmoduser: actRec['sysmoduser'] || ""
            });
        } while (actRec.getNext() === RC_SUCCESS);
    }
    return activities;
}


/**
 * Danh sách lỗi giao dịch hạch toán
 */
function getAccountingErrors(input) {
    var paymentId = JSON.parse(input.queryString).paymentId;
    var requestId = paymentId.trim();

    var errorRec = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
    var errorQuery = 'prepayment.id="' + escapeQueryValue(requestId) + '"';
    var listData = [];

    // 1. QUERY TOÀN BỘ ACTIVITY THEO MÃ PHIẾU TỔNG (TU.106.26.0000072)
    var activitiesList = [];
    if (requestId) {
        var actRec = new SCFile("activityHTKTaccountingErrorHandling", SCFILE_READONLY);
        actRec.setOrderBy(["datestamp"], [SCFILE_DSC]);

        var actQuery = 'number="' + escapeQueryValue(requestId) + '"';

        if (actRec.doSelect(actQuery) === RC_SUCCESS) {
            do {
                activitiesList.push({
                    thenumber: actRec['thenumber'] || "",
                    number: actRec['number'] || "",
                    type: actRec['type'] || "",
                    datestamp: actRec['datestamp'] || null,
                    operator: actRec['operator'] || "",
                    description: actRec['description'] || "",
                    sysmoduser: actRec['sysmoduser'] || ""
                });
            } while (actRec.getNext() === RC_SUCCESS);
        }
    }

    // 2. QUERY BẢNG CHÍNH VÀ GÁN DỮ LIỆU
    try {
        var rc = errorRec.doSelect(errorQuery);

        while (rc === RC_SUCCESS) {
            var parseData = {};
            var parseResponse = {};
            var rawData = errorRec['data'];
            var rawResponse = errorRec['response'];

            if (rawData) {
                try {
                    parseData = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
                } catch (eData) {
                    parseData = { raw: String(rawData), parseError: String(eData) };
                }
            }

            if (rawResponse) {
                try {
                    parseResponse = typeof rawResponse === "string" ? JSON.parse(rawResponse) : rawResponse;
                } catch (eResponse) {
                    parseResponse = { raw: String(rawResponse), parseError: String(eResponse) };
                }
            }

            var currentReqId = errorRec['request.id'] || "";
            var currentPrepaymentId = errorRec['prepayment.id'] || "";
            var currentStatus = String(errorRec['status'] || "")
                    .trim()
                    .toUpperCase();
            var currentCheckedTime = serializeAccountingDateTime(
                    errorRec['checked.time']
            );
            var currentUpdatedAt = serializeAccountingDateTime(
                    errorRec['updated.at']
            );
            var entryDescription = getEntryDescription(currentReqId, currentPrepaymentId)

            listData.push({
                id: errorRec['id'] || "",
                requestId: errorRec['request.id'] || "",
                prepaymentId: errorRec['prepayment.id'] || "",
                vendorId: errorRec['vendor.id'] || "",
                contractId: errorRec['contract.id'] || "",
                status: currentStatus,
                type: errorRec['type'] || "",
                subType: errorRec['sub.type'] || "",
                message: currentStatus === ACCOUNTING_STATUS.ERROR
                        ? errorRec['message'] || ""
                        : "",
                apCode: errorRec['ap.code'] || "",
                batchName: errorRec['batch.name'] || "",
                paymentNumber: errorRec['payment.number'] || "",
                transactionId: errorRec['transaction.id'] || "",
                hostResNum: errorRec['host.res.num'] || "",
                amount: errorRec['amount'] || 0,
                checkedTime: currentCheckedTime,
                updatedBy: errorRec['updated.by'] || errorRec['updated_by'] || errorRec['sysmoduser'] || (activitiesList && activitiesList.length > 0 ? activitiesList[0].operator : "") || null,
                updatedAt: currentUpdatedAt,
                data: parseData,
                response: parseResponse,
                description: entryDescription,
                activities: activitiesList,

            });

            rc = errorRec.getNext();
        }
    } catch (e) {
        logger.info("getAccountingErrors ERROR prepaymentId=" + requestId + ", error=" + String(e));
    } finally {
        try {
            if (errorRec) errorRec.doClose();
        } catch (eClose) {}
    }

    return listData;
}


/**
 * Hàm hỗ trợ lấy Description từ bảng Entry tương ứng dựa theo Mã phiếu (PrepaymentId/PaymentId)
 */
function getEntryDescription(reqId, prepaymentId) {
    if (!reqId) return "";

    reqId = String(reqId).trim();
    var pId = String(prepaymentId || "").trim();
    var tableName = "";

    // 1. Phân loại bảng Entry dựa vào Tiền tố của Prepayment/Payment ID (TT. hoặc TU.)
    if (pId.indexOf("TU.") === 0) {
        tableName = "esdHTKTprepaymentEntry";
    } else if (pId.indexOf("TT.") === 0) {
        tableName = "esdHTKTpaymentEntry";
    } else {
        // Dự phòng nếu không có pId thì thử kiểm tra theo reqId
        tableName = (reqId.indexOf("TU.") === 0) ? "esdHTKTprepaymentEntry" : "esdHTKTpaymentEntry";
    }

    // 2. Query bảng Entry theo accounting.request.id
    var entryRec = new SCFile(tableName, SCFILE_READONLY);
    var description = "";

    try {
        var query = 'accounting.request.id="' + escapeQueryValue(reqId) + '"';

        if (entryRec.doSelect(query) === RC_SUCCESS) {
            description = entryRec["description"] || "";
        }
    } catch (e) {
//        print("[ERROR getEntryDescription] " + e);
    } finally {
        if (entryRec) entryRec.doClose();
    }
    return description;
}


/**
 * ============================================================================
 * HÀM XỬ LÝ CHÍNH (TRIGGER MAIN)
 * Hàm này sẽ được gọi từ SM Trigger mỗi khi có Insert/Update/Delete vào esdHTKTaccountingInformation
 * ============================================================================
 */
function onAccountingInfoSavedTrigger(oldRec, newRec, eventType) {
    // ------------------------------------------------------------------------
    // BƯỚC 1: LẤY VÀ KIỂM TRA MÃ ĐỀ NGHỊ (prepayment.id / prepayment_id)
    // ------------------------------------------------------------------------
    var prepaymentId = "";
    if (eventType === "DELETE") {
        if (!oldRec) return;
        prepaymentId = oldRec['prepayment.id'] || oldRec['prepayment_id'];
    } else {
        if (!newRec) return;
        prepaymentId = newRec['prepayment.id'] || newRec['prepayment_id'];
    }

    if (!prepaymentId) return;

    // ------------------------------------------------------------------------
    // BƯỚC 2: KIỂM TRA TRẠNG THÁI PHIẾU GỐC (PREPAYMENT / PAYMENT)
    // Chỉ cho phép chạy tiếp nếu phiếu ở trạng thái APPROVED hoặc ACCOUNTED
    // ------------------------------------------------------------------------
    var upperPrepaymentId = String(prepaymentId).toUpperCase();
    var tableName = "";
    if (upperPrepaymentId.indexOf('TU') === 0) {
        tableName = "esdHTKTprepayment";
    } else if (upperPrepaymentId.indexOf('TT') === 0) {
        tableName = "esdHTKTpayment";
    }

    if (tableName) {
        var requestRec = new SCFile(tableName, SCFILE_READONLY);
        if (requestRec.doSelect('id="' + escapeQueryValue(prepaymentId) + '"') === RC_SUCCESS) {
            var prepStatus = String(requestRec['status'] || "").toLowerCase();
            if (prepStatus !== "approved" && prepStatus !== "accounted") {
                return; // Dừng lại nếu phiếu chưa được phê duyệt hoặc kế toán
            }
        }
    }

    // ------------------------------------------------------------------------
    // BƯỚC 3: RẼ NHÁNH THEO EVENT TYPE (GỌI CÁC HÀM XỬ LÝ RIÊNG)
    // ------------------------------------------------------------------------
    if (eventType === "DELETE") {
        // ===> [LUỒNG XÓA BẢN GHI]: Gọi hàm handleAccountingDelete
        handleAccountingDelete(oldRec, prepaymentId);
    } else if (eventType === "ADD") {
        // ===> [LUỒNG THÊM MỚI BẢN GHI]: Gọi hàm handleAccountingAdd
        handleAccountingAdd(newRec, prepaymentId, tableName);
    } else if (eventType === "UPDATE") {
        // ===> [LUỒNG CẬP NHẬT BẢN GHI]: Gọi hàm handleAccountingUpdate
        handleAccountingUpdate(newRec, prepaymentId, tableName);
    }
}


/**
 * ============================================================================
 * HÀM 1: XỬ LÝ KHI EVENT TYPE = "DELETE" (XÓA GIAO DỊCH HẠCH TOÁN)
 * ============================================================================
 */
function handleAccountingDelete(oldRec, prepaymentId) {
    var deleteTargetRec = new SCFile("esdHTKTaccountingErrorHandling");
    var deleteQuery = 'request.id="' + prepaymentId + '"';

    if (deleteTargetRec.doSelect(deleteQuery) === RC_SUCCESS) {
        var remainRec = new SCFile("esdHTKTaccountingInformation");
        var remainQuery = 'prepayment.id="' + prepaymentId + '"';
        var totalTrans = 0;
        var totalErrorTrans = 0;

        if (remainRec.doSelect(remainQuery) === RC_SUCCESS) {
            do {
                totalTrans += 1;
                var remainStatus = String(remainRec['status'] || "").toUpperCase();
                if (remainStatus === "ERROR") {
                    totalErrorTrans += 1;
                }
            } while (remainRec.getNext() === RC_SUCCESS);
        }

        // YÊU CẦU 2 & 3: Giữ lại bản ghi, chỉ cập nhật số lượng và trạng thái thay vì doDelete()
        deleteTargetRec['total_trans'] = totalTrans;
        deleteTargetRec['total_error_trans'] = totalErrorTrans;
        deleteTargetRec['status'] = (totalErrorTrans > 0) ? ACCOUNTING_STATUS.ERROR : "ACCOUNTED";
        deleteTargetRec.doUpdate();
    }
}


/**
 * ============================================================================
 * HÀM 2: XỬ LÝ KHI EVENT TYPE = "ADD" (TẠO MỚI GIAO DỊCH HẠCH TOÁN)
 * ============================================================================
 */
function handleAccountingAdd(newRec, prepaymentId, tableName) {
    // Nếu tạo mới một giao dịch nhưng giao dịch đó KHÔNG BỊ LỖI -> Không cần tạo Error handling
    var isNewError = (String(newRec['status'] || "").toUpperCase() === "ERROR");
    if (!isNewError) return;

    // Thực hiện đếm số lượng giao dịch và đồng bộ thông tin lỗi
    processAccountingSync(newRec, prepaymentId, tableName);
}


/**
 * ============================================================================
 * HÀM 3: XỬ LÝ KHI EVENT TYPE = "UPDATE" (CẬP NHẬT GIAO DỊCH HẠCH TOÁN)
 * ============================================================================
 */
function handleAccountingUpdate(newRec, prepaymentId, tableName) {
    // Thực hiện tính toán lại tổng số giao dịch, lỗi còn lại và cập nhật Error handling
    processAccountingSync(newRec, prepaymentId, tableName);
}


/**
 * ============================================================================
 * HÀM HELPER: TÍNH TOÁN DỮ LIỆU & ĐỒNG BỘ BẢNG ERROR HANDLING / PHIẾU GỐC
 * (Dùng chung cho cả luồng ADD và UPDATE)
 * ============================================================================
 */
function processAccountingSync(newRec, prepaymentId, tableName) {
    var upperPrepaymentId = String(prepaymentId).toUpperCase();

    // ------------------------------------------------------------------------
    // BƯỚC A: QUÉT TẤT CẢ GIAO DỊCH CỦA PHIẾU ĐỂ ĐẾM VÀ TÌM LỖI
    // ------------------------------------------------------------------------
    var accountingRec = new SCFile("esdHTKTaccountingInformation");
    var accountingQuery = 'prepayment.id="' + escapeQueryValue(prepaymentId) + '"';

    var totalTrans = 0;
    var totalErrorTrans = 0;
    var totalHandlingTrans = 0;
    var totalCompletedTrans = 0;
    var totalOglTrans = 0;
    var totalOglCompletedTrans = 0;
    var detectedErrorChannel = "";

    if (accountingRec.doSelect(accountingQuery) === RC_SUCCESS) {
        do {
            totalTrans++;
            var accStatus = "";
            var accType = "";

            // Kiểm tra xem dòng trong DB có trùng với dòng newRec đang sửa/lưu hay không
            var isCurrentRecord = false;
            if (newRec) {
                var curRecId = newRec['id'] || newRec['request.id'] || newRec['request_id'];
                var dbRecId = accountingRec['id'] || accountingRec['request.id'] || accountingRec['request_id'];
                if (curRecId && dbRecId && String(curRecId) === String(dbRecId)) {
                    isCurrentRecord = true;
                }
            }

            // Nếu đúng dòng đang sửa -> Lấy giá trị mới nhất từ newRec (tránh lỗi cache DB)
            if (isCurrentRecord) {
                accStatus = String(newRec['status'] || "").toUpperCase();
                accType = String(newRec['type'] || "").toUpperCase();
            } else {
                accStatus = String(accountingRec['status'] || "").toUpperCase();
                accType = String(accountingRec['type'] || "").toUpperCase();
            }

            // Đếm trạng thái giao dịch
            if (accStatus === "ERROR") {
                totalErrorTrans++;
                if (!detectedErrorChannel) {
                    detectedErrorChannel = accType; // Lấy type giao dịch bị lỗi (VD: CORE)
                }
            }
            if (accStatus === "CREATED" || accStatus === "IN_QUEUE" || accStatus === "NEW") {
                totalHandlingTrans++;
            }
            if (accStatus === "COMPLETED") {
                totalCompletedTrans++;
            }

            if (accType === "AP" || accType === "GL") {
                totalOglTrans++;
                if (accStatus === "COMPLETED") {
                    totalOglCompletedTrans++;
                }
            }

        } while (accountingRec.getNext() === RC_SUCCESS);
    }

    // ------------------------------------------------------------------------
    // BƯỚC B: GỌI HÀM CORE KHI TẤT CẢ GIAO DỊCH OGL (AP, GL) HOÀN THÀNH
    // ------------------------------------------------------------------------
    var currentType = String(newRec && newRec['type'] || "").toUpperCase();
    if (
            (currentType === "AP" || currentType === "GL") &&
            totalOglTrans > 0 && totalOglCompletedTrans === totalOglTrans
    ) {
        try {
            if (typeof lib.ESD_HTKT_ACCOUNTING_UTILS !== "undefined" && lib.ESD_HTKT_ACCOUNTING_UTILS.checkCompleteAccounting) {
                lib.ESD_HTKT_ACCOUNTING_UTILS.checkCompleteAccounting(prepaymentId);
            }
        } catch (e) {
//            print('[Trigger ERROR] Lỗi khi gọi hàm xử lý CORE: ' + e);
        }
    }

    // Query lại vì checkCompleteAccounting() có thể vừa cập nhật CORE.
    var recountRec = new SCFile(
            "esdHTKTaccountingInformation",
            SCFILE_READONLY
    );

    totalTrans = 0;
    totalErrorTrans = 0;
    totalHandlingTrans = 0;
    totalCompletedTrans = 0;
    detectedErrorChannel = "";

    if (recountRec.doSelect(accountingQuery) === RC_SUCCESS) {
        do {
            totalTrans++;

            var recountStatus =
                    String(recountRec['status'] || "").toUpperCase();

            var recountType =
                    String(recountRec['type'] || "").toUpperCase();

            if (recountStatus === "ERROR") {
                totalErrorTrans++;

                if (!detectedErrorChannel) {
                    detectedErrorChannel = recountType;
                }
            }

            if (
                    recountStatus === "CREATED" ||
                    recountStatus === "IN_QUEUE" ||
                    recountStatus === "NEW"
            ) {
                totalHandlingTrans++;
            }

            if (recountStatus === "COMPLETED") {
                totalCompletedTrans++;
            }

        } while (recountRec.getNext() === RC_SUCCESS);
    }

    recountRec.doClose();
    // ================== [END NEW] ==================

    // ------------------------------------------------------------------------
    // BƯỚC C: ĐỒNG BỘ TRẠNG THÁI CHO PHIẾU GỐC (PREPAYMENT / PAYMENT)
    // ------------------------------------------------------------------------
    if (tableName) {
        var parentRec = new SCFile(tableName);
        var parentQuery = 'id="' + escapeQueryValue(prepaymentId) + '"';

        if (parentRec.doSelect(parentQuery) === RC_SUCCESS) {
            if (totalTrans > 0 && totalCompletedTrans === totalTrans) {
                if (parentRec['status'] !== "accounted") {
                    parentRec['status'] = "accounted";
                    parentRec.doUpdate();
                }
            } else if (totalErrorTrans > 0 || totalHandlingTrans > 0) {
                if (parentRec['status'] === "accounted") {
                    parentRec['status'] = "approved";
                    parentRec.doUpdate();
                }
            }
        }
    }

    // ------------------------------------------------------------------------
    // BƯỚC D: LẤY THÔNG TIN BỔ SUNG ĐỂ GHI VÀO ERROR HANDLING
    // ------------------------------------------------------------------------
    var requestType = (upperPrepaymentId.indexOf('TT') === 0) ? "THANH_TOAN" : "TAM_UNG";
    var extraInfo = {
        requestTypeLabel: "",
        contractCode: "",
        amount: 0,
        paymentMethod: "",
        errorChannel: detectedErrorChannel, // Kênh lỗi thực sự lấy từ Bước A (CORE)
        // Giữ đúng nguồn dữ liệu: updated.at của bản ghi accountingInformation
        // vừa phát sinh trigger. Nếu trống thì bảng tổng hợp cũng để trống.
        updatedAt: newRec ? (newRec['updated.at'] || null) : null,
        unitLv1: "",
        unitLv2: "",
        requestUnitLv1: "",
        requestUnitLv2: "",
        paymentCreatedAt: null,
        department: ""
    };

    if (tableName) {
        var detailRec = new SCFile(tableName, SCFILE_READONLY);
        if (detailRec.doSelect('id="' + escapeQueryValue(prepaymentId) + '"') === RC_SUCCESS) {
            extraInfo.requestTypeLabel = detailRec['transaction.type'] || detailRec['transaction_type'] || "";
            extraInfo.contractCode = detailRec['contract.code'] || detailRec['contract_code'] || detailRec['contract_id'] || "";
            extraInfo.amount = Number(detailRec['amount'] || detailRec['total_amount_paid'] || 0);

            extraInfo.requestUnitLv1 = detailRec['unit.lv1'] || detailRec['unit_lv1'] || "";
            extraInfo.requestUnitLv2 = detailRec['unit.lv2'] || detailRec['unit_lv2'] || "";
            var rawUnitLv1 = String(detailRec['unit_lv1'] || "");
            var rawUnitLv2 = String(detailRec['unit_lv2'] || "");
            extraInfo.unitLv1 = rawUnitLv1 ? Number(rawUnitLv1) : 0;
            extraInfo.unitLv2 = rawUnitLv2 ? Number(rawUnitLv2) : 0;
            extraInfo.paymentCreatedAt = detailRec['created.at'];
            extraInfo.department = String(detailRec['department'] || "").trim();
        }
    }

    // Lấy Phương thức thanh toán từ Vendor
    var vendorTableName = (upperPrepaymentId.indexOf('TT') === 0) ? "esdHTKTpaymentVendor" : "esdHTKTprepaymentVendor";
    var vendorQueryField = (upperPrepaymentId.indexOf('TT') === 0) ? "payment.id" : "prepayment.id";

    if (vendorTableName) {
        var vendorRec = new SCFile(vendorTableName, SCFILE_READONLY);
        if (vendorRec.doSelect(vendorQueryField + '="' + escapeQueryValue(prepaymentId) + '"') === RC_SUCCESS) {
            var hasTransfer = false;
            var hasCash = false;
            do {
                var rawMethod = String(vendorRec['payment.method'] || "").toUpperCase().replace(/[^A-Z]/g, '');
                if (rawMethod.indexOf("CHUYENKHOAN") !== -1 || rawMethod.indexOf("CK") !== -1) {
                    hasTransfer = true;
                } else if (rawMethod.indexOf("TIENMAT") !== -1 || rawMethod.indexOf("TM") !== -1) {
                    hasCash = true;
                }
            } while (vendorRec.getNext() === RC_SUCCESS);

            if (hasTransfer && hasCash) extraInfo.paymentMethod = "Hỗn hợp";
            else if (hasTransfer) extraInfo.paymentMethod = "CHUYENKHOAN";
            else if (hasCash) extraInfo.paymentMethod = "TIENMAT";
        }
    }

    // ------------------------------------------------------------------------
    // BƯỚC E: CẬP NHẬT HOẶC TẠO MỚI BẢN GHI TRONG BẢNG ERROR HANDLING
    // ------------------------------------------------------------------------
    var targetRec = new SCFile("esdHTKTaccountingErrorHandling");
    var targetQuery = 'request.id="' + escapeQueryValue(prepaymentId) + '"';
    var finalStatus = (totalErrorTrans > 0) ? "ERROR" : "ACCOUNTED";

    if (targetRec.doSelect(targetQuery) === RC_SUCCESS) {
        // ===> ĐÃ CÓ BẢN GHI -> TIẾN HÀNH CẬP NHẬT (UPDATE)
        targetRec['request.type'] = requestType;
        targetRec['contract.id'] = (newRec && (newRec['contract.id'] || newRec['contract_id'])) || targetRec['contract.id'] || "";
        targetRec['total.trans'] = totalTrans;
        targetRec['total.error.trans'] = totalErrorTrans;
        targetRec['status'] = finalStatus;

        targetRec['request.type.label'] = extraInfo.requestTypeLabel;
        targetRec['contract.code'] = extraInfo.contractCode;
        targetRec['amount'] = extraInfo.amount;
        targetRec['payment.method'] = extraInfo.paymentMethod;
        targetRec['error.channel'] = extraInfo.errorChannel; // Đặt đúng kênh bị lỗi
        targetRec['updated.at'] = extraInfo.updatedAt;
        targetRec['payment.created.at'] = extraInfo.paymentCreatedAt;
        targetRec['unit.lv1'] = extraInfo.unitLv1;
        targetRec['unit.lv2'] = extraInfo.unitLv2;
        targetRec['request.unit.lv1'] = extraInfo.requestUnitLv1;
        targetRec['request.unit.lv2'] = extraInfo.requestUnitLv2;
        targetRec['department'] = extraInfo.department;
        targetRec.doUpdate();

    } else {
        // ===> CHƯA CÓ BẢN GHI -> TẠO MỚI (INSERT) NẾU ĐANG CÓ LỖI
        if (totalErrorTrans <= 0) return;

        var rc = 0;
        var newId = new SCDatum();
        rc = system.functions.rtecall("getnumber", rc, newId, "esdHTKTaccountingErrorHandling");
        var generatedId = newId ? String(newId.getText() || "") : "";

        if (!generatedId) return;

        targetRec['id'] = generatedId;
        targetRec['request.id'] = prepaymentId;
        targetRec['request.type'] = requestType;
        targetRec['contract.id'] = (newRec && (newRec['contract.id'] || newRec['contract_id'])) || "";
        targetRec['status'] = finalStatus;
        targetRec['total.trans'] = totalTrans;
        targetRec['total.error.trans'] = totalErrorTrans;

        targetRec['request.type.label'] = extraInfo.requestTypeLabel;
        targetRec['contract.code'] = extraInfo.contractCode;
        targetRec['amount'] = extraInfo.amount;
        targetRec['payment.method'] = extraInfo.paymentMethod;
        targetRec['error.channel'] = extraInfo.errorChannel;
        targetRec['updated.at'] = extraInfo.updatedAt;
        targetRec['payment.created.at'] = extraInfo.paymentCreatedAt;
        targetRec['unit.lv1'] = extraInfo.unitLv1;
        targetRec['unit.lv2'] = extraInfo.unitLv2;
        targetRec['request.unit.lv1'] = extraInfo.requestUnitLv1;
        targetRec['request.unit.lv2'] = extraInfo.requestUnitLv2;
        targetRec['department'] = extraInfo.department;
        targetRec.doInsert();
    }
}



// ===========================================================================
// ===========================================================================
// ===========================================================================
// ===========================================================================
/**
 * Helper dùng để escape các ký tự đặc biệt (\, ") trong chuỗi query
 */
function qHTKT(value) {
    return (value == null ? "" : String(value)).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Truy vấn bảng `contacts` dựa trên username đăng nhập để lấy thông tin chi tiết của người dùng như:
 * - Họ tên, Mã chi nhánh.
 * - Cấu trúc phòng ban/đơn vị (lv1, lv2, lv3, orgUnit).
 * - Chức danh (position, positionName).
 *
 * @param {string} currentUser - Mã/Tên tài khoản người dùng đăng nhập.
 * @return {Object} Đối tượng chứa chi tiết thông tin cá nhân và cấu trúc tổ chức của người dùng.
 */
function readHTKTContactInfo(currentUser) {
    // 1. Khởi tạo đối tượng chứa thông tin mặc định (giá trị rỗng)
    var result = {
        fullName: "",
        branchCode: "",
        lv1: "",
        lv2: "",
        lv3: "",
        orgUnit: "",
        position: "",
        positionName: ""
    };

    var contactFile = null;

    try {
        // 2. Mở kết nối đọc bảng 'contacts' trong DB theo cơ chế Read-Only
        contactFile = new SCFile("contacts", SCFILE_READONLY);
        var rcContact = contactFile.doSelect('contact.name="' + qHTKT(currentUser) + '"');

        // 3. Nếu tìm thấy bản ghi thông tin contact thành công
        if (rcContact == RC_SUCCESS) {
            // Lấy thông tin phân cấp cơ cấu tổ chức (Hỗ trợ fallback cả dạng CamelCase và Snake_case)
            result.lv1 = contactFile["lv1.id"] || contactFile.lv1_id || "";
            result.lv2 = contactFile["lv2.id"] || contactFile.lv2_id || "";
            result.lv3 = contactFile["lv3.id"] || contactFile.lv3_id || "";
            result.orgUnit = contactFile["org.unit"] || contactFile.org_unit || "";

            // Lấy thông tin chức danh
            result.position = contactFile["position"] || "";
            result.positionName = contactFile["position.name"] || contactFile.position_name || "";

            // Lấy thông tin Họ tên (Ưu tiên theo thứ tự trường dữ liệu tồn tại)
            result.fullName = contactFile["full.name"] ||
                    contactFile["contact.full.name"] ||
                    contactFile["contact.name"] ||
                    "";
            // Lấy Mã chi nhánh
            result.branchCode = contactFile["branch.code"] ||
                    contactFile["branch_code"] ||
                    "";
        }
    } catch (eContact) {
        // Bắt ngoại lệ nếu xảy ra lỗi truy vấn -> Giữ nguyên kết quả rỗng an toàn
        result = result;
    } finally {
        // 4. Giải phóng bộ nhớ/đóng con trỏ kết nối DB trong khối finally để tránh leak resource
        if (contactFile) {
            try {
                contactFile.doClose();
            } catch (eCloseContact) {}
        }
    }
    return result;
}


/**
 * Trích xuất danh sách các Mã quyền (Rights ID) của người dùng hiện tại từ biến toàn cục `$G.rights`.
 * Hàm hỗ trợ tự động ép kiểu, làm sạch khoảng trắng và lọc bỏ các mã quyền trùng lặp.
 *
 * @return {Array} Mảng chứa các chuỗi mã quyền (Rights ID) duy nhất của người dùng.
 */
function getHTKTRightsArray() {
    var rightsArray = [];

    // 1. Kiểm tra biến toàn cục $G.rights (biến lưu danh sách quyền của user trong phiên đăng nhập SM)
    try {
        rightsArray = vars['$G.rights'] ?
                vars['$G.rights'].toArray().map(function(r) {
                    return String(r == null ? "" : r).trim();
                }) : [];
    } catch (eRights) {
        // 2. Bắt lỗi ngoại lệ nếu biến $G.rights không tồn tại hoặc lỗi ép kiểu -> Khởi tạo mảng rỗng
        rightsArray = [];
    }

    // 3. Loại bỏ các phần tử trùng lặp và giá trị rỗng bằng hàm uniqueHTKTArray
    return uniqueHTKTArray(rightsArray);
}



/**
 * Lọc trùng lặp, loại bỏ giá trị rỗng/null và làm sạch mảng dữ liệu (Array hoặc ServiceManager Array).
 * Hàm hỗ trợ tự động chuyển đổi đối tượng mảng kiểu SM (SCDatum/Array) sang JS Array thuần túy.
 *
 * @param {Array|Object} arr - Mảng hoặc đối tượng mảng cần lọc/làm sạch.
 * @return {Array} Mảng các chuỗi ký tự đã được loại bỏ khoảng trắng thừa và lọc trùng.
 */
function uniqueHTKTArray(arr) {
    var result = [];
    var seen = {};

    // 1. Kiểm tra đầu vào rỗng/null -> Trả về mảng rỗng
    if (!arr) {
        return result;
    }

    // 2. Chuyển đổi mảng SM (SCDatum) sang JavaScript Array nếu đối tượng hỗ trợ phương thức .toArray()
    try {
        if (arr.toArray) {
            arr = arr.toArray();
        }
    } catch (eToArray) {} // Bỏ qua lỗi nếu chuyển đổi thất bại, tiếp tục xử lý mảng như hiện tại

    // 3. Kiểm tra độ dài mảng sau khi ép kiểu
    if (!arr.length) {
        return result;
    }

    // 4. Duyệt qua từng phần tử để làm sạch và lọc trùng lặp
    for (var i = 0; i < arr.length; i++) {
        var value = String(arr[i] == null ? "" : arr[i]).trim(); // Chuyển phần tử về dạng chuỗi và cắt bỏ khoảng trắng thừa ở 2 đầu

        // Bỏ qua nếu giá trị bị rỗng hoặc đã xuất hiện trong Hash Map (seen)
        if (!value || seen[value]) {
            continue;
        }

        // Đánh dấu giá trị đã xuất hiện và thêm vào mảng kết quả
        seen[value] = true;
        result.push(value);
    }

    // 5. Trả về mảng dữ liệu sạch không chứa phần tử trùng lặp
    return result;
}



/**
 * Lấy và chuẩn hóa phạm vi phân quyền dữ liệu (Data Permission) của người dùng theo Phân hệ con (SubModule).
 * Hàm này tương tác với thư viện hệ thống lib.ESD_PERMS_RIGHTS để truy vấn danh sách đơn vị
 * và phạm vi (Scope) được phép truy cập.
 *
 * @param {string} currentUser - Mã contact/tài khoản người dùng hiện tại cần kiểm tra quyền.
 * @param {string} subModule - Mã phân hệ con (Ví dụ: "004004").
 * @return {Object} Đối tượng phân quyền dữ liệu đã qua xử lý chuẩn hóa (Bao gồm scope và mảng unit).
 */
function getHTKTDataPermission(currentUser, subModule) {
    // 1. Khởi tạo đối tượng phân quyền mặc định (Scope rỗng và danh sách đơn vị rỗng)
    var dataPermission = {
        scope: "",
        unit: []
    };

    try {
        // 2. Gọi thư viện core ESD_PERMS_RIGHTS để truy vấn dữ liệu phân quyền thực tế của User
        dataPermission = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(currentUser, subModule) || dataPermission;
    } catch (eDP) {
        // 3. Bắt lỗi ngoại lệ (nếu thư viện không tồn tại hoặc lỗi Runtime) -> Trả về cấu hình an toàn mặc định
        dataPermission = {
            scope: "",
            unit: []
        };
    }
    // 4. Gọi hàm normalizeHTKTDataPermission để chuẩn hóa dữ liệu đầu ra (xử lý trùng lặp unit, gán scope mặc định...)
    return normalizeHTKTDataPermission(dataPermission);
}


/**
 * Chuẩn hóa thông tin phân quyền dữ liệu (Data Permission) người dùng.
 * Hàm giúp trích xuất phạm vi phân quyền (scope) và danh sách đơn vị (unit)
 * từ nhiều cấu trúc dữ liệu đầu vào khác nhau.
 *
 * @param {Object} dataPermission - Đối tượng chứa thông tin phân quyền truyền vào.
 * @return {Object} Đối tượng gồm scope đã chuẩn hóa và mảng đơn vị không trùng lặp.
 */
function normalizeHTKTDataPermission(dataPermission) {
    var scope = "";
    var unitArr = [];

    if (dataPermission) {
        // 1. Lấy giá trị scope từ các trường thuộc tính có thể xảy ra trong object
        scope = String(
                dataPermission.scope ||
                dataPermission.dataScopeList ||
                dataPermission["permission.scope"] ||
                ""
        ).trim();
        // 2. Lấy mảng danh sách đơn vị được phân quyền từ các trường tương ứng
        unitArr = dataPermission.unit
                || dataPermission.arrUnitRights
                || dataPermission.units || [];
    }

    // 3. Nếu không tìm thấy phạm vi phân quyền, gán giá trị mặc định là "QT_PQDL_01" (Quyền toàn hệ thống/toàn đơn vị)
    if (!scope) {
        scope = "QT_PQDL_01";
    }
    // 4. Trả về object đã chuẩn hóa, lọc loại bỏ các đơn vị trùng lặp trong mảng
    return {
        scope: scope,
        unit: uniqueHTKTArray(unitArr)
    };
}


/**
 * Tạo câu điều kiện truy vấn DB (defaultFilter) theo danh sách Người liên quan.
 * Nếu người dùng có quyền xem, hệ thống tự động lọc danh sách chỉ hiển thị các bản ghi
 * mà người đó tham gia xử lý (Người tạo, KTTC, ĐMMS, người phê duyệt cuối...).
 *
 * @param {string} currentUser - Mã/Tên tài khoản của người dùng hiện tại.
 * @param {boolean} hasView - Cờ xác định user có quyền xem danh sách hay không.
 * @return {Object} Đối tượng chứa câu filter SQL/Query, phạm vi dữ liệu và các trường liên quan.
 */
function buildHTKTPaymentCreatedByFilter(currentUser, hasView) {
    // 1. Khởi tạo đối tượng kết quả mặc định: Không có quyền xem (Query trả về 1=0)
    var result = {
        defaultFilter: "(1=0)",
        dataScope: "Không có quyền xem",
        dataScopeCode: "",
        dataScopeField: "",
        dataScopeUnits: []
    };

    // Chuẩn hóa mã user đầu vào, loại bỏ khoảng trắng thừa
    var safeCurrentUser = String(currentUser == null ? "" : currentUser).trim();

    // 2. Nếu không có quyền xem hoặc mã user rỗng -> Trả về kết quả mặc định 
    if (!hasView || !safeCurrentUser) {
        return result;
    }

    // 3. Danh sách các trường (fields) trong DB ghi nhận sự tham gia xử lý của User
    var relatedUserFields = [
        "created.by",
        "user.checker.kttc",
        "user.checker.dmms",
        "user.approver.dmms",
        "user.approver.kttc",
        "user.checker.final",
        "user.approver.final"
    ];

    // 4. Duyệt qua từng trường để ghép chuỗi điều kiện query
    var conditions = [];
    for (var i = 0; i < relatedUserFields.length; i++) {
        conditions.push(
                relatedUserFields[i] + '="' + qHTKT(safeCurrentUser) + '"'
        );
    }

    // 5. Tổng hợp các điều kiện lại thành dạng: (created.by="USER" OR user.checker.kttc="USER" OR ...)
    result.defaultFilter = "(" + conditions.join(" OR ") + ")";
    result.dataScope = "Nguoi tao hoac nguoi duoc giao xu ly";
    result.dataScopeCode = "HTKT_PAYMENT_RELATED_USER";
    result.dataScopeField = relatedUserFields.join("+");
    result.dataScopeUnits = [safeCurrentUser];

    return result;
}


/**
 * Xây dựng điều kiện lọc (Filter Query) và phạm vi dữ liệu dựa theo danh sách Đơn vị
 * mà cán bộ KTTC được phân quyền quản lý.
 *
 * @param {Object} dataPermission - Đối tượng phân quyền dữ liệu (đã qua chuẩn hóa).
 * @param {boolean} hasView - Cờ xác định user có quyền xem dữ liệu hay không.
 * @return {Object} Kết quả chứa chuỗi filter DB (defaultFilter), tên phạm vi (dataScope) và mảng đơn vị.
 */
function buildHTKTUnitFilter(dataPermission, hasView) {
    // 1. Khởi tạo giá trị mặc định: Mặc định không có quyền xem dữ liệu (Query trả về 1=0)
    var result = {
        defaultFilter: "(1=0)",
        dataScope: "Không có quyền xem",
        dataScopeUnits: []
    };

    // 2. Nếu cờ hasView = false (không có quyền xem), lập tức trả về kết quả mặc định
    if (!hasView) {
        return result;
    }

    // 3. Trường hợp phân quyền Toàn hệ thống/Toàn bộ dữ liệu (Query trả về 1=1 để lấy tất cả)
    if (dataPermission.scope === "QT_PQDL_01" || dataPermission.scope === "ALL") {
        result.defaultFilter = "(1=1)";
        result.dataScope = "Toàn hệ thống";
        return result;
    }

    // 4. Trường hợp phân quyền theo Danh sách Đơn vị cụ thể
    var units = dataPermission.unit || [];
    if (units.length > 0) {
        var unitConditions = [];

        // Tạo mảng chuỗi điều kiện OR cho từng đơn vị (đã được escape bằng hàm qHTKT)
        for (var i = 0; i < units.length; i++) {
            // Lưu ý: Thay 'org.unit' bằng tên field chứa Mã đơn vị trong bảng DB thực tế nếu khác
            unitConditions.push('org.unit="' + qHTKT(units[i]) + '"');
        }

        // Ghép các điều kiện đơn vị lại thành biểu thức dạng: (org.unit="DV1" OR org.unit="DV2")
        result.defaultFilter = "(" + unitConditions.join(" OR ") + ")";
        result.dataScope = "Theo đơn vị quản lý";
        result.dataScopeUnits = units;
    }
    // 5. Trả về kết quả điều kiện lọc đã xây dựng
    return result;
}


/**
 * Lấy thông tin chi tiết của người dùng hiện tại bao gồm:
 * - Thông tin cá nhân, chức danh, đơn vị công tác.
 * - Danh sách quyền chức năng (Rights) và phân quyền dữ liệu (Data Permission).
 * - Biểu thức Query lọc dữ liệu theo đơn vị (defaultFilter/permissionQuery).
 * - Cấu hình ẩn/hiện danh sách các nút chức năng (btnConfig) trên giao diện.
 *
 * @return {Object} Đối tượng chứa toàn bộ thông tin User, Quyền hạn và Cấu hình UI.
 */
function getUserAndPermissionInfor() {
    var userInfor = {};

    // 1. LẤY THÔNG TIN TÀI KHOẢN VÀ DANH SÁCH QUYỀN TRÊN HỆ THỐNG
    var currentUser = vars['$lo.contact.name'];
    var smLoginUser = system.user.name;
    var contactInfo = readHTKTContactInfo(currentUser);
    var rightsArray = getHTKTRightsArray();

    // 2. KHAI BÁO CÁC MÃ QUYỀN CHỨC NĂNG (RIGHT CODES) PHÂN HỆ LỖI HẠCH TOÁN
    var RIGHT_ERROR_HANDLING_VIEW   = "0040040009000001"; // Mã quyền: Xem danh sách lỗi hạch toán
    var RIGHT_ERROR_HANDLING_ACTION = "0040040009000002"; // Mã quyền: Xử lý/Khai báo chi tiết lỗi hạch toán

    // Kiểm tra User có nắm giữ các quyền chức năng tương ứng hay không
    var hasViewErrorList = rightsArray.indexOf(RIGHT_ERROR_HANDLING_VIEW) >= 0;
    var hasHandleError   = rightsArray.indexOf(RIGHT_ERROR_HANDLING_ACTION) >= 0;

    // 2. MÃ PHÂN HỆ CON (SUBMODULE)
    // XÁC ĐỊNH PHÂN QUYỀN DỮ LIỆU CỦA SUBMODULE
    var DATA_PERMISSION_SUB_MODULE = "004004";
    var dataPermission = getHTKTDataPermission(currentUser, DATA_PERMISSION_SUB_MODULE);

    // 4. XÂY DỰNG QUERY LỌC DỮ LIỆU TỰ ĐỘNG THEO ĐƠN VỊ QUẢN LÝ CỦA USER CÁN BỘ KTTC
    var dataFilterInfo = buildHTKTUnitFilter(dataPermission, hasViewErrorList);

    // 5. TỔNG HỢP VÀ CHUẨN HÓA DỮ LIỆU TRẢ VỀ
    userInfor = {
        // Thông tin tài khoản & cá nhân
        user: currentUser,
        currentUser: currentUser,
        contactId: currentUser,
        operatorName: smLoginUser,
        fullName: contactInfo.fullName,
        branchCode: contactInfo.branchCode,

        // Cơ cấu tổ chức & Đơn vị công tá
        unit: {
            lv1: contactInfo.lv1,
            lv2: contactInfo.lv2,
            lv3: contactInfo.lv3,
            orgUnit: contactInfo.orgUnit,
            position: contactInfo.position,
            positionName: contactInfo.positionName
        },

        // Cấu hình Filter Query truy vấn DB theo Đơn vị
        defaultFilter: dataFilterInfo.defaultFilter,            // Chuỗi điều kiện SQL/Query mặc định
        permissionQuery: dataFilterInfo.defaultFilter,          // Chuỗi Query phân quyền
        dataScope: dataFilterInfo.dataScope,                    // Tên phạm vi (VD: Toàn hệ thống, Theo đơn vị...)
        dataScopeUnits: dataFilterInfo.dataScopeUnits,          // Mảng danh sách mã đơn vị được quản lý
        dataPermissionSubModule: DATA_PERMISSION_SUB_MODULE,
        dataPermission: dataPermission,

        // Danh sách và Cờ phân quyền chức năng
        rights: rightsArray,
        permission: {
            view: hasViewErrorList,
            handle: hasHandleError
        },

        // MẢNG CẤU HÌNH ẨN/HIỆN NÚT TRÊN GIAO DIỆN (BUTTON CONFIGURATION)
        btnConfig: [
            { id: 'export', visible: hasViewErrorList },     // Nút Xuất file (Màn danh sách)
            { id: 'retry', visible: hasHandleError },        // Nút Thử lại (Màn chi tiết)
            { id: 'handleResult', visible: hasHandleError }  // Nút Khai báo kết quả (Màn chi tiết)
        ],
        debugSource: "ESD_HTKT_ACCOUNTING_ERROR_HANDLING"
    };
    return userInfor;
}
// ======================================================================
// ======================================================================
// ======================================================================

