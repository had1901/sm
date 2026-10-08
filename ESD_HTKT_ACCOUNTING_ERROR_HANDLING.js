var logger = getLog('ESD_HTKT_ACCOUNTING_ERROR_HANDLING');

var ACCOUNTING_STATUS = {
    ERROR: "ERROR",
    IN_QUEUE: "IN_QUEUE",
    PENDING_APPROVAL: "PENDING_APPROVAL",
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
 * Xác định cán bộ KTTC xử lý ban đầu giống cơ chế Người đang xử lý của Tạm ứng:
 * - Phiếu do KTTC khởi tạo: created.by.
 * - Phiếu chuyển từ ĐMMS sang KTTC: user.checker.kttc.
 */
function resolveInitialAccountingErrorExecutor(requestRec) {
    if (!requestRec) return "";

    var initialRole = String(
            requestRec['initial.role'] || requestRec['initial_role'] || ""
    ).trim().toLowerCase();
    var createdBy = String(
            requestRec['created.by'] || requestRec['created_by'] || ""
    ).trim();
    var checkerKttc = String(
            requestRec['user.checker.kttc'] || ""
    ).trim();

    // Một số phiếu cũ không có initial.role hoặc chưa gán user.checker.kttc.
    // Không ghi rỗng xuống field Người đang xử lý của bảng tổng hợp.
    return initialRole === "kttc"
            ? (createdBy || checkerKttc)
            : (checkerKttc || createdBy);
}

function getInitialAccountingErrorExecutor(requestId) {
    var requestFile = null;
    try {
        var normalizedId = String(requestId || "").trim();
        var upperId = normalizedId.toUpperCase();
        var tableName = upperId.indexOf("TT") === 0
                ? "esdHTKTpayment"
                : (upperId.indexOf("TU") === 0 ? "esdHTKTprepayment" : "");

        if (!tableName || !normalizedId) return "";

        requestFile = new SCFile(tableName, SCFILE_READONLY);
        if (requestFile.doSelect(
                'id="' + escapeQueryValue(normalizedId) + '"'
        ) !== RC_SUCCESS) {
            return "";
        }

        return resolveInitialAccountingErrorExecutor(requestFile);
    } catch (e) {
        return "";
    } finally {
        try { if (requestFile) requestFile.doClose(); } catch (eClose) {}
    }
}

/**
 * Bổ sung Người đang xử lý cho các bản ghi tổng hợp cũ còn thiếu dữ liệu.
 * UI chỉ đọc user.approver.kttc từ esdHTKTaccountingErrorHandling.
 */
function backfillMissingAccountingErrorExecutors() {
    var handlingRec = null;
    var accountingRec = null;
    var totalUpdated = 0;

    try {
        handlingRec = new SCFile("esdHTKTaccountingErrorHandling");
        var handlingRc = handlingRec.doSelect("true");

        while (handlingRc === RC_SUCCESS) {
            var existingExecutor = String(
                    handlingRec['user.approver.kttc'] || ""
            ).trim();
            var handlingStatus = String(
                    handlingRec['status'] || ""
            ).trim().toUpperCase();
            var handlingRequestId = String(
                    handlingRec['request.id'] || ""
            ).trim();
            var resolvedExecutor = "";

            if (!existingExecutor && handlingRequestId) {
                if (handlingStatus === ACCOUNTING_STATUS.ERROR) {
                    resolvedExecutor = getInitialAccountingErrorExecutor(
                            handlingRequestId
                    );
                } else if (
                        handlingStatus === ACCOUNTING_STATUS.PENDING_APPROVAL
                ) {
                    accountingRec = new SCFile(
                            "esdHTKTaccountingInformation",
                            SCFILE_READONLY
                    );
                    var accountingRc = accountingRec.doSelect(
                            'prepayment.id="' +
                            escapeQueryValue(handlingRequestId) +
                            '"'
                    );

                    while (accountingRc === RC_SUCCESS) {
                        var accountingStatus = String(
                                accountingRec['status'] || ""
                        ).trim().toUpperCase();

                        if (
                                accountingStatus ===
                                ACCOUNTING_STATUS.PENDING_APPROVAL
                        ) {
                            resolvedExecutor = String(
                                    accountingRec['user.approver.kttc'] || ""
                            ).trim();
                            if (resolvedExecutor) break;
                        }

                        accountingRc = accountingRec.getNext();
                    }

                    try { accountingRec.doClose(); } catch (eAccountingClose) {}
                    accountingRec = null;
                }

                if (resolvedExecutor) {
                    handlingRec['user.approver.kttc'] = resolvedExecutor;
                    if (handlingRec.doUpdate() === RC_SUCCESS) {
                        totalUpdated++;
                    }
                }
            }

            handlingRc = handlingRec.getNext();
        }

        return { success: true, updated: totalUpdated };
    } catch (e) {
        return { success: false, updated: totalUpdated, message: String(e) };
    } finally {
        try { if (accountingRec) accountingRec.doClose(); } catch (e1) {}
        try { if (handlingRec) handlingRec.doClose(); } catch (e2) {}
    }
}

/**
 * Lấy Người đang xử lý trực tiếp từ bảng tổng hợp theo danh sách mã đề nghị.
 * Dùng cho trường hợp External Access chưa expose field user.approver.kttc.
 */
function getAccountingErrorHandlingApproverKttc(input) {
    var handlingRec = null;

    try {
        var details = JSON.parse(input && input.queryString || "{}");
        var requestIds = details.requestIds || [];

        if (!Array.isArray(requestIds)) {
            return {
                success: false,
                message: "Danh sách mã đề nghị không hợp lệ."
            };
        }

        var items = [];
        var seen = {};
        handlingRec = new SCFile(
                "esdHTKTaccountingErrorHandling",
                SCFILE_READONLY
        );

        for (var i = 0; i < requestIds.length && i < 200; i++) {
            var requestId = String(requestIds[i] || "").trim();
            var requestKey = requestId.toLowerCase();

            if (!requestId || seen[requestKey]) continue;
            seen[requestKey] = true;

            if (handlingRec.doSelect(
                    'request.id="' + escapeQueryValue(requestId) + '"'
            ) === RC_SUCCESS) {
                items.push({
                    requestId: requestId,
                    "user.approver.kttc": String(
                            handlingRec['user.approver.kttc'] || ""
                    ).trim()
                });
            }
        }

        return { success: true, data: { items: items } };
    } catch (e) {
        return {
            success: false,
            message: String(e && e.message || e)
        };
    } finally {
        try { if (handlingRec) handlingRec.doClose(); } catch (eClose) {}
    }
}

/**
 * Lay danh sach distinct Nguoi dang xu ly trong dung scope cua user.
 * Khong dung REST EXPAND/@totalcount vi UI chi can mot field duy nhat.
 */
function getAccountingErrorExecutorOptions(input) {
    var handlingRec = null;

    try {
        var details = JSON.parse(input && input.queryString || "{}");
        var currentUser = String(details.currentUser || "").trim();
        if (!currentUser) {
            return { success: false, message: "Khong xac dinh duoc nguoi dung dang nhap." };
        }

        var contactInfo = readHTKTContactInfo(currentUser);
        var dataPermission = getHTKTDataPermission(currentUser, "00401");
        var dataFilterInfo = buildHTKTUnitFilter(
                dataPermission,
                true,
                contactInfo.lv1
        );
        var query = String(dataFilterInfo.defaultFilter || "(1=0)");
        var seen = {};
        var values = [];

        handlingRec = new SCFile(
                "esdHTKTaccountingErrorHandling",
                SCFILE_READONLY
        );
        var rc = handlingRec.doSelect(query);

        while (rc === RC_SUCCESS) {
            var executor = String(
                    handlingRec['user.approver.kttc'] || ""
            ).trim();
            var executorKey = executor.toLowerCase();

            if (executor && !seen[executorKey]) {
                seen[executorKey] = true;
                values.push(executor);
            }

            rc = handlingRec.getNext();
        }

        values.sort();
        var options = [];
        for (var i = 0; i < values.length; i++) {
            options.push({ label: values[i], value: values[i] });
        }

        return { success: true, data: { executorOptions: options } };
    } catch (e) {
        return { success: false, message: String(e && e.message || e) };
    } finally {
        try { if (handlingRec) handlingRec.doClose(); } catch (eClose) {}
    }
}

/** Danh sách Phê duyệt KTTC cho popup Khai báo kết quả (AP và CORE). */
function getAccountingErrorApproverKttcOptions(input) {
    var requestFile = null;
    try {
        var details = JSON.parse(input && input.queryString || "{}");
        var requestId = String(details.prepaymentId || details.paymentId || "").trim();
        if (!requestId) throw new Error("Thiếu mã đề nghị.");

        var currentUser = String(details.currentUser || "").trim();
        if (!currentUser) throw new Error("Không xác định được người dùng đăng nhập.");
        var approvalLib = lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX;
        if (!approvalLib || typeof approvalLib.loadPrepaymentApprovalComboBoxesInternal !== "function" ||
            typeof approvalLib.resolvePrepaymentApprovalContactId !== "function") {
            throw new Error("Thiếu ScriptLibrary danh sách cán bộ phê duyệt KTTC.");
        }

        var tableName = requestId.toUpperCase().indexOf("TT") === 0 ? "esdHTKTpayment" : "esdHTKTprepayment";
        requestFile = new SCFile(tableName, SCFILE_READONLY);
        if (requestFile.doSelect('id="' + escapeQueryValue(requestId) + '"') !== RC_SUCCESS) {
            throw new Error("Không tìm thấy đề nghị " + requestId + ".");
        }

        var page = Math.max(1, Math.floor(Number(details.page) || 1));
        var pageSize = Math.max(1, Math.min(100, Math.floor(Number(details.pageSize) || 100)));
        var loaded = approvalLib.loadPrepaymentApprovalComboBoxesInternal(
            requestFile, "user.approver.kttc", {
                currentUser: approvalLib.resolvePrepaymentApprovalContactId(currentUser),
                page: page,
                pageSize: pageSize,
                keyword: String(details.keyword || "").trim()
            }
        );
        if (!loaded || loaded.success !== true || !loaded.kttcApprove2 || loaded.kttcApprove2.success !== true) {
            return { success: false, message: loaded && loaded.message || "Không tải được danh sách cán bộ phê duyệt KTTC." };
        }

        var combo = loaded.kttcApprove2;
        var items = [];
        for (var i = 0; i < combo.ids.length; i++) {
            items.push({ value: combo.ids[i], label: combo.names[i] });
        }
        return { success: true, data: { items: items, page: page, pageSize: pageSize, hasMore: combo.hasMore === true } };
    } catch (e) {
        return { success: false, message: String(e && e.message || e) };
    } finally {
        try { if (requestFile) requestFile.doClose(); } catch (closeError) {}
    }
}

function validateAccountingErrorApproverKttc(requestId, currentUser, approverKttc) {
    var requestFile = null;
    try {
        var approvalLib = lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX;
        if (!approvalLib || typeof approvalLib.loadPrepaymentApprovalComboBoxesInternal !== "function" ||
            typeof approvalLib.resolvePrepaymentApprovalContactId !== "function") {
            return { success: false, message: "Thiếu ScriptLibrary danh sách cán bộ phê duyệt KTTC." };
        }

        var tableName = requestId.toUpperCase().indexOf("TT") === 0 ? "esdHTKTpayment" : "esdHTKTprepayment";
        requestFile = new SCFile(tableName, SCFILE_READONLY);
        if (requestFile.doSelect('id="' + escapeQueryValue(requestId) + '"') !== RC_SUCCESS) {
            return { success: false, message: "Không tìm thấy đề nghị " + requestId + "." };
        }

        var loaded = approvalLib.loadPrepaymentApprovalComboBoxesInternal(
            requestFile,
            "user.approver.kttc",
            {
                currentUser: approvalLib.resolvePrepaymentApprovalContactId(currentUser),
                page: 1,
                pageSize: 1,
                keyword: "",
                selectedId: approverKttc
            }
        );
        var combo = loaded && loaded.kttcApprove2;
        if (!loaded || loaded.success !== true || !combo || combo.success !== true || combo.ids.indexOf(approverKttc) < 0) {
            return {
                success: false,
                message: loaded && loaded.message || "Cán bộ phê duyệt KTTC không còn hợp lệ theo quyền và đơn vị."
            };
        }
        return { success: true };
    } catch (e) {
        return { success: false, message: String(e && e.message || e) };
    } finally {
        try { if (requestFile) requestFile.doClose(); } catch (closeError) {}
    }
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
    // Backfill du lieu cu la migration mot lan, khong quet toan bang moi lan render.
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
                        totalPendingApprovalTrans: 0,
                        totalCompletedTrans: 0,
                        approverKttc: "",
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
                        accStatus === "NEW" ||
                        accStatus === ACCOUNTING_STATUS.PENDING_APPROVAL
                ) {
                    summary.totalHandlingTrans++;
                }

                if (accStatus === ACCOUNTING_STATUS.PENDING_APPROVAL) {
                    summary.totalPendingApprovalTrans++;
                    if (!summary.approverKttc) {
                        summary.approverKttc = String(
                                accountingRec['user.approver.kttc'] || ""
                        ).trim();
                    }
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
            var initialKttcExecutor = "";
            
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
                initialKttcExecutor = resolveInitialAccountingErrorExecutor(
                        detailRec
                );

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
            
            var finalStatus = item.totalTrans > 0 &&
                    item.totalCompletedTrans === item.totalTrans
                    ? "ACCOUNTED"
                    : (item.totalPendingApprovalTrans > 0
                            ? ACCOUNTING_STATUS.PENDING_APPROVAL
                            : ACCOUNTING_STATUS.ERROR);
            var currentExecutorKttc = finalStatus === ACCOUNTING_STATUS.PENDING_APPROVAL
                    ? item.approverKttc
                    : (finalStatus === ACCOUNTING_STATUS.ERROR
                            ? initialKttcExecutor
                            : "");

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
                targetRec['user.approver.kttc'] = currentExecutorKttc;
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
                targetRec['user.approver.kttc'] = currentExecutorKttc;
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

//getLatestAccountingCheckedTime("TT.100.26.0000090");


function appendAccountingRetryChange(lines, label, previousValue, currentValue) {
    var beforeText = String(previousValue == null ? "" : previousValue).trim();
    var afterText = String(currentValue == null ? "" : currentValue).trim();

    // Chỉ ghi lịch sử khi hệ thống đã trả về một giá trị mới thực tế.
    if (!afterText || beforeText === afterText) return;

    lines.push(
        "Thay đổi " + label + " từ " +
        (beforeText || "(trống)") + " thành " +
        (afterText || "(trống)")
    );
}

function buildAccountingRetryTitle(accountingType, prepaymentId, subType, invoiceNumber) {
    if (accountingType === "CORE") {
        return "Thử lại giao dịch chuyển tiền";
    }

    if (accountingType === "AP") {
        var requestPrefix = String(prepaymentId || "").toUpperCase().slice(0, 2);
        var normalizedSubType = String(subType || "").toUpperCase();
        var apType = "Standard";

        if (
            requestPrefix === "TU" &&
            normalizedSubType !== "THUE" &&
            normalizedSubType !== "TAX"
        ) {
            apType = "Prepayment";
        }

        var invoiceText = String(invoiceNumber || "").trim();
        var invoiceSuffix = invoiceText.length >= 5 ? invoiceText.slice(-5) : "";
        var formattedCode = "QLTS_" + getFormattedDateStr() +
            (invoiceSuffix ? ("_" + invoiceSuffix) : "");

        return "Thử lại bút toán AP - " + apType + " " + formattedCode;
    }

    return "Thử lại giao dịch " + accountingType;
}

/**
 * Lấy mã tham chiếu kênh đã được lưu trong payload CORE.
 * CITAD chỉ gửi 16 ký tự request.id, còn INHOUSE gửi toàn bộ request.id.
 */
function resolveCoreRetryInquiryChanRefno(payload, requestId, subType) {
    var payloadData = payload && payload.data &&
            typeof payload.data === "object" &&
            !Array.isArray(payload.data)
            ? payload.data
            : {};
    var chanRefno = String(
            payloadData.chanRefno ||
            payloadData.chanRefNum ||
            payload.chanRefno ||
            payload.chanRefNum ||
            payload.trnRefNum ||
            ""
    ).trim();

    if (chanRefno) return chanRefno;

    var normalizedRequestId = String(
            payload.requestId || requestId || ""
    ).trim();
    return String(subType || "").trim().toUpperCase() === "CITAD"
            ? normalizedRequestId.substring(0, 16)
            : normalizedRequestId;
}

/**
 * Vấn tin CORE trước khi gửi lại. Mọi lỗi vấn tin hoặc trạng thái
 * khác C đều trả completed=false để luồng retry gọi callApiCore().
 */
function inquireCoreStatusBeforeRetry(payload, requestId, subType) {
    var result = {
        completed: false,
        chanRefno: resolveCoreRetryInquiryChanRefno(
                payload,
                requestId,
                subType
        ),
        pmtStatus: "",
        hostRefNum: "",
        inquiryResult: null
    };

    try {
        var inquiryLib = lib.ESD_HTKT_FUND_TRANSFER_INTEGRATION;
        if (!inquiryLib ||
                typeof inquiryLib.inquireTransactionStatus !== "function" ||
                !result.chanRefno) {
            return result;
        }

        result.inquiryResult = inquiryLib.inquireTransactionStatus({
            chanRefno: result.chanRefno,
            useSitMock: true
        });

        var body = result.inquiryResult && result.inquiryResult.body;
        var inquiryData = body && body.data &&
                typeof body.data === "object"
                ? body.data
                : {};
        var inquiryTransactionInfo = inquiryData.txnInfo &&
                typeof inquiryData.txnInfo === "object"
                ? inquiryData.txnInfo
                : {};

        result.pmtStatus = String(
                inquiryData.pmtStatus || ""
        ).trim().toUpperCase();
        result.hostRefNum = String(
                inquiryTransactionInfo.hostRefNum ||
                inquiryData.hostRefNum ||
                ""
        ).trim();
        result.completed = result.inquiryResult &&
                String(result.inquiryResult.statusCode || "").trim() === "0" &&
                result.pmtStatus === "C" &&
                !!result.hostRefNum;
    } catch (eInquiry) {
        result.inquiryResult = {
            success: false,
            error: String(eInquiry && eInquiry.message || eInquiry)
        };
    }

    return result;
}

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
            var previousBatchName = String(accountingInfo["batch.name"] || "").trim();
            var previousInvoiceNumber = String(accountingInfo["ap.code"] || "").trim();
            var previousPaymentNumber = String(accountingInfo["payment.number"] || "").trim();
            var previousHostRefNum = String(accountingInfo["host.res.num"] || "").trim();
            var retrySubType = String(accountingInfo["sub.type"] || "").trim();
            var retryPrepaymentId = String(
                accountingInfo["prepayment.id"] || row.prepaymentId || ""
            ).trim();

            // Cấu hình mã mock theo loại giao dịch
            var mockCodeByType = {
                AP: "0",
                GL: "0",
                CORE: "0"
            };

            var mockMessageByCode = {
                "0": "Thành công (Giả lập)",
                "1": "Thất bại (Giả lập)",
                "1001": "Lỗi server (Giả lập)",
                "98": "Time out call sang XES (Giả lập)",
                "202": "Lỗi kết nối database (Giả lập)",
                "100": "Lỗi dữ liệu. Mã lỗi hệ thống chung (Giả lập)"
            };

            // Bước 8: Kiểm tra loại giao dịch và tạm comment API thật
            if (accountingType === "AP") {
                // retrySuccess = lib.ESD_HTKT_ACCOUNTING_UTILS.callApiAp(accountingInfo);
            } else if (accountingType === "GL") {
                // retrySuccess = lib.ESD_HTKT_ACCOUNTING_UTILS.callApiGl(accountingInfo);
            } else if (accountingType === "CORE") {
                // retrySuccess = lib.ESD_HTKT_ACCOUNTING_UTILS.callApiCore(accountingInfo);
            } else {
                result.failed++;
                result.errors.push({
                    requestId: targetRequestId,
                    message: "Loại giao dịch không hỗ trợ thử lại: " + accountingType
                });
                continue;
            }

            // AP đã được OGL tiếp nhận (HTTP 200) nhưng trả trạng thái nghiệp vụ E,
            // hoặc trả C mà chưa có payment.number thì không được phép thử lại.
            if (accountingType === "AP") {
                var apRetryResponse = {};
                if (previousResponse.trim()) {
                    try {
                        apRetryResponse = JSON.parse(previousResponse);
                    } catch (eApRetryResponse) {
                        apRetryResponse = {};
                    }
                }

                var rawApRetryHttpStatus = accountingInfo["response.http.status"];
                var apRetryHttpStatus = rawApRetryHttpStatus === null ||
                    rawApRetryHttpStatus === undefined
                    ? ""
                    : String(rawApRetryHttpStatus).trim();
                var apRetryDataStatus = String(
                    apRetryResponse.data && apRetryResponse.data.status || ""
                ).trim().toUpperCase();
                var rawApRetryPaymentNumber = accountingInfo["payment.number"];
                var apRetryPaymentNumber = rawApRetryPaymentNumber === null ||
                    rawApRetryPaymentNumber === undefined
                    ? ""
                    : String(rawApRetryPaymentNumber).trim();
                var isApRetryBlocked = apRetryHttpStatus === "200" && (
                    apRetryDataStatus === "E" ||
                    (apRetryDataStatus === "C" && !apRetryPaymentNumber)
                );

                if (isApRetryBlocked) {
                    result.blocked++;
                    result.errors.push({
                        requestId: targetRequestId,
                        type: accountingType,
                        message: apRetryDataStatus === "E"
                            ? "Không được phép thử lại AP khi OGL trả trạng thái E với HTTP 200"
                            : "Không được phép thử lại AP khi OGL trả trạng thái C với HTTP 200 nhưng chưa có Số Payment"
                    });
                    continue;
                }
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
                // CORE phải gửi lại đúng chuỗi data đang lưu trong DB.
                data: accountingType === "CORE"
                        ? previousData
                        : JSON.stringify(currentPayload)
            };

            // Bước 10: Chọn mã mock; ưu tiên mockCode do FE truyền lên
            var mockCode = String(
                row.mockCode || mockCodeByType[accountingType] || "100"
            ).trim();

            var mockDetail = mockMessageByCode[mockCode] ||
                ("Mã phản hồi không xác định: " + mockCode);

            if (accountingType === "CORE") {
                mockDetail = "Gửi lại CORE thất bại";
            }

            var retrySuccess = mockCode === "0";
            var mockResponse;

            // MOCK RIÊNG AP THÀNH CÔNG: mô phỏng cấu trúc response OGL.
            if (accountingType === "AP" && retrySuccess) {
                mockResponse = {
                    success: true,
                    data: {
                        requestId: "69bf39c1-83f0-488d-8e9e-0b62dc87c4f1",
                        transactionId: "8d756c37-4e64-4873-9f39-4da13a2a0469",
                        referenceId: "dntt",
                        status: "C",
                        errorCode: null,
                        batchName: "TH.DUY_02062026_11_01",
                        invoiceNumber: "TH.DUY_02062026_11_01_01",
                        paymentNumber: 114299333
                    }
                };
            } else {
                mockResponse = {
                    status: {
                        code: mockCode,
                        detail: mockDetail
                    }
                };
            }

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

            var coreInquiryCompleted = false;

            if (accountingType === "CORE") {
                // CORE dùng tích hợp thật: vấn tin trước để tránh
                // gửi lại một giao dịch đã được Core Banking ghi nhận.
                var coreInquiry = inquireCoreStatusBeforeRetry(
                        currentPayload,
                        targetRequestId,
                        retrySubType
                );

                if (coreInquiry.completed) {
                    var inquiryCheckedTime = system.functions.tod();
                    var inquiryBody = coreInquiry.inquiryResult &&
                            coreInquiry.inquiryResult.body;

                    accountingInfo["host.res.num"] = coreInquiry.hostRefNum;
                    accountingInfo["response"] = inquiryBody
                            ? JSON.stringify(inquiryBody)
                            : previousResponse;
                    accountingInfo["message"] = "";
                    accountingInfo["status"] = ACCOUNTING_STATUS.COMPLETED;
                    accountingInfo["checked.time"] = inquiryCheckedTime;
                    accountingInfo["updated.at"] = inquiryCheckedTime;

                    if (accountingInfo.doUpdate() !== RC_SUCCESS) {
                        result.failed++;
                        result.errors.push({
                            requestId: targetRequestId,
                            type: accountingType,
                            message: "Không lưu được kết quả vấn tin CORE"
                        });
                        continue;
                    }

                    retrySuccess = true;
                    coreInquiryCompleted = true;
                } else {
                    // Vấn tin lỗi, không có bản ghi hoặc pmtStatus khác C:
                    // chuyển về CREATED rồi gửi lại nguyên data trong DB.
                    accountingInfo["data"] = previousData;
                    accountingInfo["response"] = "";
                    accountingInfo["message"] = "";
                    accountingInfo["status"] = ACCOUNTING_STATUS.CREATED;
                    accountingInfo["transaction.id"] = "";
                    accountingInfo["host.res.num"] = "";
                    var coreRetryTime = system.functions.tod();
                    accountingInfo["checked.time"] = coreRetryTime;
                    accountingInfo["updated.at"] = coreRetryTime;

                    if (accountingInfo.doUpdate() !== RC_SUCCESS) {
                        result.failed++;
                        result.errors.push({
                            requestId: targetRequestId,
                            type: accountingType,
                            message: "Không lưu được bản ghi trước khi thử lại CORE"
                        });
                        continue;
                    }

                    try {
                        accountingInfo.doClose();
                    } catch (eCloseBeforeCoreRetry) {}
                    accountingInfo = null;

                    retrySuccess = lib.ESD_HTKT_ACCOUNTING_UTILS.callApiCore(
                            retryAccountingInfo
                    );

                    accountingInfo = new SCFile(
                            "esdHTKTaccountingInformation",
                            SCFILE_READONLY
                    );
                    if (accountingInfo.doSelect(
                            'request.id="' +
                            escapeQueryValue(newRequestId) +
                            '"'
                    ) === RC_SUCCESS) {
                        if (!retrySuccess) {
                            mockDetail = String(
                                    accountingInfo["message"] ||
                                    "Gửi lại CORE thất bại"
                            );
                        }
                    }
                }
            } else {
                // AP/GL trên SIT tiếp tục dùng response giả lập hiện tại.
                accountingInfo["request.id"] = newRequestId;
                accountingInfo["data"] = retryAccountingInfo.data;
                accountingInfo["response"] = JSON.stringify(mockResponse);
                accountingInfo["message"] = retrySuccess ? "" : mockDetail;
                accountingInfo["status"] = retrySuccess
                    ? ACCOUNTING_STATUS.COMPLETED
                    : ACCOUNTING_STATUS.ERROR;
                var retryCheckedTime = system.functions.tod();
                accountingInfo["checked.time"] = retryCheckedTime;
                accountingInfo["updated.at"] = retryCheckedTime;

                if (retrySuccess) {
                    accountingInfo["host.res.num"] = "ABCXYZ";
                }

                // Map dữ liệu mock AP sang các field kết quả; không dùng
                // mockResponse.data.requestId để ghi đè request.id của bản ghi.
                if (accountingType === "AP" && retrySuccess && mockResponse.data) {
                    accountingInfo["transaction.id"] = mockResponse.data.transactionId;
                    accountingInfo["ref.id"] = mockResponse.data.referenceId;
                    accountingInfo["batch.name"] = mockResponse.data.batchName;
                    accountingInfo["ap.code"] = mockResponse.data.invoiceNumber;
                    accountingInfo["payment.number"] = mockResponse.data.paymentNumber;
                }

                if (accountingInfo.doUpdate() !== RC_SUCCESS) {
                    result.failed++;
                    result.errors.push({
                        requestId: targetRequestId,
                        type: accountingType,
                        message: "Không lưu được kết quả giả lập"
                    });
                    continue;
                }
            }

            // Bước 13: Ghi lịch sử thử lại tại màn hình xử lý lỗi và phiếu gốc.
            var retryUser = String(
                row.user || vars['$lo.contact.name'] || system.user.name || ""
            ).trim();
            var currentBatchName = String(accountingInfo["batch.name"] || "").trim();
            var currentInvoiceNumber = String(accountingInfo["ap.code"] || "").trim();
            var currentPaymentNumber = String(accountingInfo["payment.number"] || "").trim();
            var currentHostRefNum = String(accountingInfo["host.res.num"] || "").trim();
            var retryActivityLines = [
                buildAccountingRetryTitle(
                    accountingType,
                    retryPrepaymentId,
                    retrySubType,
                    currentInvoiceNumber || previousInvoiceNumber
                ),
                coreInquiryCompleted
                    ? "Kết quả vấn tin: Giao dịch CORE đã hoàn thành"
                    : "Kết quả thử lại: " +
                        (accountingType === "CORE"
                            ? (retrySuccess
                                ? "Đã gửi sang hệ thống tích hợp"
                                : mockDetail)
                            : (retrySuccess
                                ? "Thành công (Giả lập)"
                                : mockDetail))
            ];

            if (retrySuccess && accountingType === "AP") {
                appendAccountingRetryChange(
                    retryActivityLines,
                    "Batch name (OGL)",
                    previousBatchName,
                    currentBatchName
                );
                appendAccountingRetryChange(
                    retryActivityLines,
                    "Số Invoice (OGL)",
                    previousInvoiceNumber,
                    currentInvoiceNumber
                );
                appendAccountingRetryChange(
                    retryActivityLines,
                    "Số Payment (OGL)",
                    previousPaymentNumber,
                    currentPaymentNumber
                );
            } else if (retrySuccess && accountingType === "CORE") {
                appendAccountingRetryChange(
                    retryActivityLines,
                    "Mã giao dịch",
                    previousHostRefNum,
                    currentHostRefNum
                );
            }
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
//                    "[retryAccountingErrorsResult SIT] Không ghi được lịch sử thử lại: " +
//                    String(eRetryActivity)
//                );
            }

            // Bước 14: Tổng hợp kết quả
            if (retrySuccess) {
                result.retried++;
            } else {
                result.failed++;
                result.errors.push({
                    requestId: targetRequestId,
                    type: accountingType,
                    code: accountingType === "CORE" ? "CORE_RETRY_FAILED" : mockCode,
                    message: mockDetail
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
    var approverKttc = String(data.approverKttc || (rows[0] && rows[0].approverKttc) || "").trim();
    if (!approverKttc) {
        return { success: false, message: "Thiếu cán bộ phê duyệt KTTC", updated: 0, failed: 1, errors: [{ message: "Thiếu cán bộ phê duyệt KTTC" }] };
    }
    var handlingRequestIdFromPayload = String((rows[0] && rows[0].prepaymentId) || "").trim();
    if (!handlingRequestIdFromPayload) {
        return { success: false, message: "Thiếu mã phiếu xử lý lỗi hạch toán", updated: 0, failed: 1, errors: [{ message: "Thiếu mã phiếu xử lý lỗi hạch toán" }] };
    }
    for (var approverIndex = 0; approverIndex < rows.length; approverIndex++) {
        var rowApproverKttc = String((rows[approverIndex] && rows[approverIndex].approverKttc) || approverKttc).trim();
        if (rowApproverKttc !== approverKttc) {
            return { success: false, message: "Cán bộ phê duyệt KTTC không đồng nhất", updated: 0, failed: 1, errors: [{ message: "Cán bộ phê duyệt KTTC không đồng nhất" }] };
        }
        var rowHandlingRequestId = String((rows[approverIndex] && rows[approverIndex].prepaymentId) || "").trim();
        if (rowHandlingRequestId !== handlingRequestIdFromPayload) {
            return { success: false, message: "Mã phiếu xử lý lỗi hạch toán không đồng nhất", updated: 0, failed: 1, errors: [{ message: "Mã phiếu xử lý lỗi hạch toán không đồng nhất" }] };
        }
    }
    // External Access chạy bằng tài khoản kỹ thuật, vì vậy phải dùng
    // currentUser đã được Next.js xác thực từ ESS token.
    var authenticatedUser = String(
            (rows[0] && rows[0].currentUser) || ""
    ).trim();
    if (!authenticatedUser) {
        return { success: false, message: "Không xác định được người dùng đăng nhập", updated: 0, failed: 1, errors: [{ message: "Không xác định được người dùng đăng nhập" }] };
    }
    for (var userIndex = 0; userIndex < rows.length; userIndex++) {
        var rowCurrentUser = String(
                (rows[userIndex] && rows[userIndex].currentUser) || ""
        ).trim();
        if (rowCurrentUser.toLowerCase() !== authenticatedUser.toLowerCase()) {
            return { success: false, message: "Người dùng khai báo không đồng nhất", updated: 0, failed: 1, errors: [{ message: "Người dùng khai báo không đồng nhất" }] };
        }
    }
    var approverValidation = validateAccountingErrorApproverKttc(handlingRequestIdFromPayload, authenticatedUser, approverKttc);
    if (!approverValidation.success) {
        return { success: false, message: approverValidation.message, updated: 0, failed: 1, errors: [{ message: approverValidation.message }] };
    }
    var userContact = authenticatedUser;

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

                var recordType = String(rec["type"] || row.type || "").trim().toUpperCase();
                if (recordType === "CORE") {
                    if (!transId) {
                        result.failed++;
                        result.errors.push({
                            requestId: targetRequestId,
                            message: "Mã giao dịch là bắt buộc"
                        });
                        continue;
                    }
                } else if (
                        !String(row.batchName || "").trim() ||
                        !String(row.invoiceNumber || "").trim() ||
                        !String(row.paymentNumber || "").trim()
                ) {
                    result.failed++;
                    result.errors.push({
                        requestId: targetRequestId,
                        message: "Batch name, Số Invoice và Số Payment là bắt buộc"
                    });
                    continue;
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
                rec["user.approver.kttc"] = approverKttc;
                rec["status"] = ACCOUNTING_STATUS.PENDING_APPROVAL;
//                rec["message"] = "";

                // Lấy thông tin cơ bản
                var dateCode = getFormattedDateStr(); // DDMMYYYY
                var noteText = String(row.note || "").trim();
                rec["note"] = noteText;
                var noteSuffix = noteText ? ("Ghi chú: " + noteText) : "";
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
                
                // Hiển thị đúng các giá trị người dùng vừa khai báo theo loại giao dịch.
                if (recordType === "CORE") {
                    var declaredHostRefNum = String(rec["host.res.num"] || "").trim();
                    if (declaredHostRefNum) {
                        logLines.push("Mã giao dịch: " + declaredHostRefNum);
                    }
                } else if (recordType === "AP") {
                    var declaredBatchName = String(rec["batch.name"] || "").trim();
                    var declaredInvoiceNumber = String(rec["ap.code"] || "").trim();
                    var declaredPaymentNumber = String(rec["payment.number"] || "").trim();

                    if (declaredBatchName) {
                        logLines.push("Batch name: " + declaredBatchName);
                    }
                    if (declaredInvoiceNumber) {
                        logLines.push("Số Invoice: " + declaredInvoiceNumber);
                    }
                    if (declaredPaymentNumber) {
                        logLines.push("Số Payment: " + declaredPaymentNumber);
                    }
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

/** Tạo nội dung lịch sử phê duyệt tương ứng với lịch sử khai báo kết quả. */
function buildAccountingApprovalActivityDescription(accountingRec, handlingRequestId) {
    var recordType = String(accountingRec["type"] || "").trim().toUpperCase();
    var subType = String(accountingRec["sub.type"] || "").trim().toUpperCase();
    var requestPrefix = String(handlingRequestId || "").trim().toUpperCase().slice(0, 2);
    var dateCode = getFormattedDateStr();
    var lines = [];

    if (recordType === "CORE") {
        lines.push("Phê duyệt kết quả giao dịch chuyển tiền");
    } else if (recordType === "AP") {
        var apType = "Standard";
        if (
            requestPrefix === "TU" &&
            subType !== "THUE" &&
            subType !== "TAX"
        ) {
            apType = "Prepayment";
        }

        var invoiceNumber = String(accountingRec["ap.code"] || "").trim();
        var invoiceSuffix = invoiceNumber.length >= 5
            ? invoiceNumber.slice(-5)
            : "";
        var formattedCode = "QLTS_" + dateCode +
            (invoiceSuffix ? ("_" + invoiceSuffix) : "");

        lines.push(
            "Phê duyệt kết quả bút toán AP - " + apType + " " + formattedCode
        );
    } else if (recordType === "GL") {
        lines.push("Phê duyệt kết quả bút toán GL QLTS_" + dateCode);
    } else {
        lines.push("Phê duyệt kết quả giao dịch hạch toán OGL QLTS_" + dateCode);
    }

    var errorMessage = String(accountingRec["message"] || "").trim();
    if (errorMessage) lines.push("Nội dung lỗi: " + errorMessage);

    if (recordType === "CORE") {
        var hostRefNum = String(accountingRec["host.res.num"] || "").trim();
        if (hostRefNum) lines.push("Mã giao dịch: " + hostRefNum);
    } else if (recordType === "AP") {
        var batchName = String(accountingRec["batch.name"] || "").trim();
        var apCode = String(accountingRec["ap.code"] || "").trim();
        var paymentNumber = String(accountingRec["payment.number"] || "").trim();

        if (batchName) lines.push("Batch name: " + batchName);
        if (apCode) lines.push("Số Invoice: " + apCode);
        if (paymentNumber) lines.push("Số Payment: " + paymentNumber);
    }

    var note = String(accountingRec["note"] || "").trim();
    if (note) lines.push("Ghi chú: " + note);

    return lines.join("\n");
}

/** Xác nhận kết quả khai báo bởi đúng cán bộ được gán tại user.approver.kttc. */
function approveAccountingErrorsResult(input) {
    var data = {};
    try {
        data = JSON.parse(input.queryString);
    } catch (eParseInput) {
        return { success: false, approved: 0, failed: 1, errors: [{ message: "Dữ liệu đầu vào không hợp lệ: " + String(eParseInput) }] };
    }

    var rows = data.rows || (Array.isArray(data) ? data : [data]);
    if (!rows || rows.length === 0) {
        return { success: false, approved: 0, failed: 1, errors: [{ message: "Danh sách giao dịch phê duyệt trống" }] };
    }

    var handlingRequestId = String((rows[0] && rows[0].prepaymentId) || "").trim();
    if (!handlingRequestId) {
        return { success: false, approved: 0, failed: 1, errors: [{ message: "Thiếu mã phiếu xử lý lỗi hạch toán" }] };
    }

    var reviewDecision = String(
            (rows[0] && rows[0].decision) || "APPROVE"
    ).trim().toUpperCase();
    if (reviewDecision !== "APPROVE" && reviewDecision !== "REJECT") {
        return { success: false, approved: 0, rejected: 0, failed: 1, errors: [{ message: "Quyết định phê duyệt không hợp lệ" }] };
    }

    // External Access được gọi bằng tài khoản kỹ thuật USERNAME_API, vì vậy
    // system.user.name không phải người dùng nghiệp vụ đang mở màn hình.
    // currentUser được lấy từ initData và đã được Next.js đối chiếu với ESS token.
    var authenticatedUser = String(
            (rows[0] && rows[0].currentUser) || ""
    ).trim();
    if (!authenticatedUser) {
        return { success: false, approved: 0, failed: 1, errors: [{ message: "Không xác định được người dùng đăng nhập" }] };
    }

    for (var userIndex = 0; userIndex < rows.length; userIndex++) {
        var rowCurrentUser = String(
                (rows[userIndex] && rows[userIndex].currentUser) || ""
        ).trim();
        if (rowCurrentUser.toLowerCase() !== authenticatedUser.toLowerCase()) {
            return { success: false, approved: 0, failed: 1, errors: [{ message: "Người dùng phê duyệt không đồng nhất" }] };
        }

        var rowDecision = String(
                (rows[userIndex] && rows[userIndex].decision) || "APPROVE"
        ).trim().toUpperCase();
        if (rowDecision !== reviewDecision) {
            return { success: false, approved: 0, rejected: 0, failed: 1, errors: [{ message: "Quyết định phê duyệt không đồng nhất" }] };
        }
    }

    var result = { success: true, approved: 0, rejected: 0, failed: 0, errors: [] };
    var processedRequestIds = {};
    var currentTime = system.functions.tod();
    var clientTimeText = String(
            (rows[0] && rows[0].clientTime) || ""
    ).trim();

    // Đồng bộ thời gian phê duyệt theo máy người dùng. Nếu clientTime bị thiếu
    // hoặc không hợp lệ thì giữ giờ server để không làm gián đoạn nghiệp vụ.
    if (clientTimeText) {
        try {
            var parsedClientTime = new Date(clientTimeText);
            if (!isNaN(parsedClientTime.getTime())) {
                currentTime = parsedClientTime;
            }
        } catch (eClientTime) {}
    }

    for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {};
        var rowHandlingRequestId = String(row.prepaymentId || "").trim();
        var targetRequestId = String(row.requestId || row.id || "").trim();

        if (rowHandlingRequestId !== handlingRequestId) {
            result.failed++;
            result.errors.push({ requestId: targetRequestId, message: "Mã phiếu xử lý lỗi hạch toán không đồng nhất" });
            continue;
        }
        if (!targetRequestId) {
            result.failed++;
            result.errors.push({ index: i, message: "Thiếu requestId" });
            continue;
        }
        if (processedRequestIds[targetRequestId]) continue;
        processedRequestIds[targetRequestId] = true;

        var accountingRec = null;
        try {
            accountingRec = new SCFile("esdHTKTaccountingInformation");
            if (accountingRec.doSelect('request.id="' + escapeQueryValue(targetRequestId) + '"') !== RC_SUCCESS) {
                throw new Error("Không tìm thấy giao dịch hạch toán");
            }

            var recordHandlingRequestId = String(accountingRec["prepayment.id"] || "").trim();
            if (recordHandlingRequestId !== handlingRequestId) {
                throw new Error("Giao dịch không thuộc phiếu được phê duyệt");
            }

            var assignedApprover = String(
                    accountingRec["user.approver.kttc"] || ""
            ).trim();
            if (
                    !assignedApprover ||
                    assignedApprover.toLowerCase() !== authenticatedUser.toLowerCase()
            ) {
                throw new Error("Bạn không phải cán bộ được giao phê duyệt giao dịch này");
            }

            var currentStatus = String(accountingRec["status"] || "").trim().toUpperCase();
            if (currentStatus !== ACCOUNTING_STATUS.PENDING_APPROVAL) {
                throw new Error("Giao dịch không còn ở trạng thái chờ phê duyệt");
            }

            var recordType = String(accountingRec["type"] || "").trim().toUpperCase();
            if (reviewDecision === "REJECT") {
                var rejectionResponse = {};
                var rejectionResponseParsed = false;
                var rawRejectionResponse = String(accountingRec["response"] || "").trim();

                if (rawRejectionResponse) {
                    try {
                        rejectionResponse = JSON.parse(rawRejectionResponse);
                        rejectionResponseParsed = true;
                    } catch (eParseRejectionResponse) {
                        rejectionResponse = {};
                    }
                }

                if (recordType === "CORE") {
                    accountingRec["transaction.id"] = "";
                    accountingRec["host.res.num"] = "";

                    if (rejectionResponse && typeof rejectionResponse === "object") {
                        delete rejectionResponse.hostRefNum;
                        if (
                                rejectionResponse.data &&
                                typeof rejectionResponse.data === "object" &&
                                !Array.isArray(rejectionResponse.data)
                        ) {
                            delete rejectionResponse.data.hostRefNum;
                        }
                    }
                } else {
                    accountingRec["batch.name"] = "";
                    accountingRec["ap.code"] = "";
                    accountingRec["payment.number"] = "";

                    if (
                            rejectionResponse &&
                            typeof rejectionResponse === "object" &&
                            rejectionResponse.data &&
                            typeof rejectionResponse.data === "object" &&
                            !Array.isArray(rejectionResponse.data)
                    ) {
                        delete rejectionResponse.data.paymentNumber;
                    }
                }

                if (rejectionResponseParsed) {
                    accountingRec["response"] = JSON.stringify(rejectionResponse);
                }
                accountingRec["note"] = "";
                accountingRec["user.approver.kttc"] = "";
                accountingRec["status"] = ACCOUNTING_STATUS.ERROR;
                accountingRec["updated.at"] = currentTime;
                accountingRec["updated.by"] = authenticatedUser;

                if (accountingRec.doUpdate() !== RC_SUCCESS) {
                    throw new Error("Không cập nhật được trạng thái từ chối của giao dịch hạch toán");
                }

                result.rejected++;

                try {
                    if (lib.ESD_Utils && lib.ESD_Utils.createActivity) {
                        lib.ESD_Utils.createActivity(
                                "activityHTKTaccountingErrorHandling",
                                "Từ chối kết quả " + recordType + "\nMã giao dịch hạch toán: " + targetRequestId,
                                handlingRequestId,
                                "Từ chối kết quả",
                                authenticatedUser
                        );
                    }
                } catch (eRejectActivity) {}

                continue;
            }

            if (recordType === "CORE") {
                var oglRec = null;
                try {
                    oglRec = new SCFile(
                            "esdHTKTaccountingInformation",
                            SCFILE_READONLY
                    );
                    var oglRc = oglRec.doSelect(
                            'prepayment.id="' +
                            escapeQueryValue(handlingRequestId) +
                            '"'
                    );

                    while (oglRc === RC_SUCCESS) {
                        var oglType = String(
                                oglRec["type"] || ""
                        ).trim().toUpperCase();
                        var oglStatus = String(
                                oglRec["status"] || ""
                        ).trim().toUpperCase();

                        if (
                                (oglType === "AP" || oglType === "GL") &&
                                oglStatus !== ACCOUNTING_STATUS.COMPLETED
                        ) {
                            throw new Error(
                                    "Chưa thể phê duyệt CORE khi bút toán AP/GL chưa thành công"
                            );
                        }

                        oglRc = oglRec.getNext();
                    }
                } finally {
                    try {
                        if (oglRec) oglRec.doClose();
                    } catch (eCloseOgl) {}
                }

                if (!String(accountingRec["transaction.id"] || "").trim()) {
                    throw new Error("Giao dịch CORE chưa có mã giao dịch để phê duyệt");
                }
            } else if (
                    !String(accountingRec["batch.name"] || "").trim() ||
                    !String(accountingRec["ap.code"] || "").trim() ||
                    !String(accountingRec["payment.number"] || "").trim()
            ) {
                throw new Error("Bút toán chưa có đầy đủ Batch name, Số Invoice và Số Payment để phê duyệt");
            }

            var approvalActivityDescription =
                    buildAccountingApprovalActivityDescription(
                            accountingRec,
                            handlingRequestId
                    );
                    
//               ======MAIL 07     
            // Lưu lại thông tin cũ trước khi update để làm oldAccountingRecord nếu cần thiết
            var oldAccountingRecord = {
                oldResponse: accountingRec["response"],
                oldMessage: accountingRec["message"],
                oldCheckedTime: accountingRec["checked.time"]
            };
//            ========END MAIL 07
                    

            accountingRec["status"] = ACCOUNTING_STATUS.COMPLETED;
            accountingRec["message"] = "";
            accountingRec["checked.time"] = currentTime;
            accountingRec["updated.at"] = currentTime;
            accountingRec["updated.by"] = authenticatedUser;

            if (accountingRec.doUpdate() !== RC_SUCCESS) {
                throw new Error("Không cập nhật được trạng thái giao dịch hạch toán");
            }

            result.approved++;
            
            
            
            // --- MAIL 07 TÍCH HỢP GỬI MAIL KHI PHÊ DUYỆT THÀNH CÔNG ---
            try {
                var processer = accountingRec["updated.by"];
                lib.ESD_HTKT_ACTION_WF_SEND_EMAIL.sendAccountingErrorResolvedEmail(oldAccountingRecord, accountingRec, processer);
            } catch (eMailSend) {
            }
            // ---------END MAIL 07-----------------------------------------
            
            

            try {
                if (lib.ESD_Utils && lib.ESD_Utils.createActivity) {
                    lib.ESD_Utils.createActivity(
                            "activityHTKTaccountingErrorHandling",
                            approvalActivityDescription,
                            handlingRequestId,
                            "Phê duyệt kết quả",
                            authenticatedUser
                    );

                    var approvalParentActivityTable = "";
                    var approvalRequestPrefix = handlingRequestId
                            .toUpperCase()
                            .slice(0, 2);
                    if (approvalRequestPrefix === "TU") {
                        approvalParentActivityTable = "activityHTKTprepayment";
                    } else if (approvalRequestPrefix === "TT") {
                        approvalParentActivityTable = "activityHTKTpayment";
                    }

                    if (approvalParentActivityTable) {
                        lib.ESD_Utils.createActivity(
                                approvalParentActivityTable,
                                approvalActivityDescription,
                                handlingRequestId,
                                "Phê duyệt kết quả",
                                authenticatedUser
                        );
                    }
                }
            } catch (eActivity) {}
        } catch (eApprove) {
            result.failed++;
            result.errors.push({
                requestId: targetRequestId,
                message: String(eApprove.message || eApprove)
            });
        } finally {
            try { if (accountingRec) accountingRec.doClose(); } catch (eCloseAccounting) {}
        }
    }

    result.success = result.failed === 0 &&
            (result.approved > 0 || result.rejected > 0);
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
                approverKttc: String(
                        errorRec['user.approver.kttc'] || ""
                ).trim(),
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
                note: errorRec['note'] || "",
                amount: errorRec['amount'] || 0,
                checkedTime: currentCheckedTime,
                updatedBy: errorRec['updated.by'] || errorRec['updated_by'] || errorRec['sysmoduser'] || (activitiesList && activitiesList.length > 0 ? activitiesList[0].operator : "") || null,
                updatedAt: currentUpdatedAt,
                data: parseData,
                response: parseResponse,
                responseHttpStatus: errorRec['response.http.status'] === null ||
                        errorRec['response.http.status'] === undefined
                        ? ""
                        : String(errorRec['response.http.status']),
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
        var totalCompletedTrans = 0;
        var totalPendingApprovalTrans = 0;
        var currentApproverKttc = "";

        if (remainRec.doSelect(remainQuery) === RC_SUCCESS) {
            do {
                totalTrans += 1;
                var remainStatus = String(remainRec['status'] || "").toUpperCase();
                if (remainStatus === "ERROR") {
                    totalErrorTrans += 1;
                }
                if (remainStatus === ACCOUNTING_STATUS.COMPLETED) {
                    totalCompletedTrans += 1;
                }
                if (remainStatus === ACCOUNTING_STATUS.PENDING_APPROVAL) {
                    totalPendingApprovalTrans += 1;
                    if (!currentApproverKttc) {
                        currentApproverKttc = String(
                                remainRec['user.approver.kttc'] || ""
                        ).trim();
                    }
                }
            } while (remainRec.getNext() === RC_SUCCESS);
        }

        // YÊU CẦU 2 & 3: Giữ lại bản ghi, chỉ cập nhật số lượng và trạng thái thay vì doDelete()
        var deleteFinalStatus = totalTrans > 0 && totalCompletedTrans === totalTrans
                ? "ACCOUNTED"
                : (totalPendingApprovalTrans > 0
                        ? ACCOUNTING_STATUS.PENDING_APPROVAL
                        : ACCOUNTING_STATUS.ERROR);
        var deleteExecutorKttc = deleteFinalStatus === ACCOUNTING_STATUS.PENDING_APPROVAL
                ? currentApproverKttc
                : (deleteFinalStatus === ACCOUNTING_STATUS.ERROR
                        ? getInitialAccountingErrorExecutor(prepaymentId)
                        : "");
        deleteTargetRec['total_trans'] = totalTrans;
        deleteTargetRec['total_error_trans'] = totalErrorTrans;
        deleteTargetRec['user.approver.kttc'] = deleteExecutorKttc;
        deleteTargetRec['status'] = deleteFinalStatus;
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
    var totalPendingApprovalTrans = 0;
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
            if (
                    accStatus === "CREATED" ||
                    accStatus === "IN_QUEUE" ||
                    accStatus === "NEW" ||
                    accStatus === ACCOUNTING_STATUS.PENDING_APPROVAL
            ) {
                totalHandlingTrans++;
            }
            if (accStatus === ACCOUNTING_STATUS.PENDING_APPROVAL) {
                totalPendingApprovalTrans++;
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
    totalPendingApprovalTrans = 0;
    var totalCoreTrans = 0;
    var totalCoreCompletedTrans = 0;
    var currentApproverKttc = "";
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
                    recountStatus === "NEW" ||
                    recountStatus === ACCOUNTING_STATUS.PENDING_APPROVAL
            ) {
                totalHandlingTrans++;
            }

            if (recountStatus === ACCOUNTING_STATUS.PENDING_APPROVAL) {
                totalPendingApprovalTrans++;
                if (!currentApproverKttc) {
                    currentApproverKttc = String(
                            recountRec['user.approver.kttc'] || ""
                    ).trim();
                }
            }

            if (recountStatus === "COMPLETED") {
                totalCompletedTrans++;
            }

            if (recountType === "CORE") {
                totalCoreTrans++;
                if (recountStatus === "COMPLETED") {
                    totalCoreCompletedTrans++;
                }
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
            var isAllAccountingCompleted =
                    totalTrans > 0 &&
                    totalCompletedTrans === totalTrans &&
                    totalCoreTrans > 0 &&
                    totalCoreCompletedTrans === totalCoreTrans;

            if (isAllAccountingCompleted) {
                // Luồng xử lý lỗi có thể hoàn tất ở giao dịch CORE nên không đi qua
                // updatePaymentAccountingCompletedStatus(). Phải đồng bộ cả ngày
                // hoàn thành, đồng thời backfill nếu status đã accounted nhưng ngày trống.
                if (
                        parentRec['status'] !== "accounted" ||
                        !parentRec['completed.date']
                ) {
                    parentRec['status'] = "accounted";
                    if (!parentRec['completed.date']) {
                        parentRec['completed.date'] = system.functions.tod();
                    }
                    parentRec.doUpdate();
                }
            } else {
                // Còn ít nhất một giao dịch chưa COMPLETED thì phiếu trở về
                // trạng thái đã phê duyệt, chờ tiếp tục xử lý hạch toán.
                if (parentRec['status'] !== "approved") {
                    parentRec['status'] = "approved";
                    parentRec.doUpdate();
                }
            }
        }

        try {
            parentRec.doClose();
        } catch (eParentClose) {}
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
        requestUnitLv1: "",
        requestUnitLv2: "",
        paymentCreatedAt: null,
        department: "",
        initialKttcExecutor: ""
    };

    if (tableName) {
        var detailRec = new SCFile(tableName, SCFILE_READONLY);
        if (detailRec.doSelect('id="' + escapeQueryValue(prepaymentId) + '"') === RC_SUCCESS) {
            extraInfo.requestTypeLabel = detailRec['transaction.type'] || detailRec['transaction_type'] || "";
            extraInfo.contractCode = detailRec['contract.code'] || detailRec['contract_code'] || detailRec['contract_id'] || "";
            extraInfo.amount = Number(detailRec['amount'] || detailRec['total_amount_paid'] || 0);
            extraInfo.requestUnitLv1 = detailRec['unit.lv1'] || detailRec['unit_lv1'] || "";
            extraInfo.requestUnitLv2 = detailRec['unit.lv2'] || detailRec['unit_lv2'] || "";
            extraInfo.paymentCreatedAt = detailRec['created.at'];
            extraInfo.department = String(detailRec['department'] || "").trim();
            extraInfo.initialKttcExecutor = resolveInitialAccountingErrorExecutor(
                    detailRec
            );
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
    var finalStatus = totalTrans > 0 && totalCompletedTrans === totalTrans
            ? "ACCOUNTED"
            : (totalPendingApprovalTrans > 0
                    ? ACCOUNTING_STATUS.PENDING_APPROVAL
                    : ACCOUNTING_STATUS.ERROR);
    var currentExecutorKttc = finalStatus === ACCOUNTING_STATUS.PENDING_APPROVAL
            ? currentApproverKttc
            : (finalStatus === ACCOUNTING_STATUS.ERROR
                    ? String(extraInfo.initialKttcExecutor || "").trim()
                    : "");

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
        targetRec['request.unit.lv1'] = extraInfo.requestUnitLv1;
        targetRec['request.unit.lv2'] = extraInfo.requestUnitLv2;
        targetRec['department'] = extraInfo.department;
        targetRec['user.approver.kttc'] = currentExecutorKttc;
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
        targetRec['request.unit.lv1'] = extraInfo.requestUnitLv1;
        targetRec['request.unit.lv2'] = extraInfo.requestUnitLv2;
        targetRec['department'] = extraInfo.department;
        targetRec['user.approver.kttc'] = currentExecutorKttc;
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
        scope = "QT_PQDL_04";
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
 * @param {string} currentUnitLv1 - Đơn vị cấp 1 của tài khoản đang đăng nhập.
 * @return {Object} Kết quả chứa chuỗi filter DB (defaultFilter), tên phạm vi (dataScope) và mảng đơn vị.
 */
function buildHTKTUnitFilter(dataPermission, hasView, currentUnitLv1) {
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

    // Chỉ quyền toàn hàng mới được xem toàn bộ dữ liệu.
    if (dataPermission.scope === "QT_PQDL_06" || dataPermission.scope === "ALL") {
        result.defaultFilter = "true";
        result.dataScope = "Toàn hệ thống";
        return result;
    }

    // KTTC Trụ sở chính: mở rộng từ đúng đơn vị 099917000 sang toàn bộ
    // hồ sơ có đơn vị cấp 1 bắt đầu bằng 0999.
    var normalizedCurrentUnitLv1 = String(currentUnitLv1 || "").trim();
    if (normalizedCurrentUnitLv1 === "099917000") {
        // Prefix 0999* duoc viet thanh khoang khoa de DB co the su dung index
        // tren request.unit.lv1 thay vi quet wildcard.
        result.defaultFilter = '(request.unit.lv1 >= "0999" AND request.unit.lv1 < "1000")';
        result.dataScope = "Toàn bộ đơn vị Trụ sở chính 0999*";
        result.dataScopeUnits = ["0999*"];
        return result;
    }

    // Bảng lỗi không lưu người tạo hồ sơ; không thể mở rộng quyền cá nhân thành quyền đơn vị.
    if (dataPermission.scope === "QT_PQDL_01") {
        return result;
    }

    // Ưu tiên cấp 1; chỉ đối chiếu cấp 2 khi hồ sơ không có cấp 1.
    var units = dataPermission.unit || [];
    if (units.length > 0) {
        var unitConditions = [];

        for (var i = 0; i < units.length; i++) {
            var safeUnit = qHTKT(units[i]);
            unitConditions.push('(request.unit.lv1="' + safeUnit + '" OR (request.unit.lv1="" AND request.unit.lv2="' + safeUnit + '"))');
        }

        result.defaultFilter = "(" + unitConditions.join(" OR ") + ")";
        result.dataScope = "Theo đơn vị quản lý";
        result.dataScopeUnits = units;
    }
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
    var DATA_PERMISSION_SUB_MODULE = "00401";
    var dataPermission = getHTKTDataPermission(currentUser, DATA_PERMISSION_SUB_MODULE);

    // 4. XÂY DỰNG QUERY LỌC DỮ LIỆU TỰ ĐỘNG THEO ĐƠN VỊ QUẢN LÝ CỦA USER CÁN BỘ KTTC
    var dataFilterInfo = buildHTKTUnitFilter(
            dataPermission,
            hasViewErrorList,
            contactInfo.lv1
    );

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

