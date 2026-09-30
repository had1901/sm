/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_CREATE_REQUEST
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Khởi tạo và lưu thông tin phiếu đề nghị thanh toán mới (esdHTKTpayment).
 * - Tự động sinh mã phiếu, khởi tạo trạng thái và phân quyền theo cấp đơn vị của người lập.
 * - Tra cứu danh sách hợp đồng mua sắm (esdHTKTpurchaseContract) và nhà cung cấp liên kết.
 * - Xử lý lưu danh sách tài liệu đính kèm và đồng bộ thông tin hợp đồng liên quan.
 * -----------------------------------------------------------------------------
 */

var createActivity = lib.ESD_Utils.createActivity;

function run() {

    try {
        var input = vars['$L.file'];

        if (!input) { return; }

        var name = input.name;
        if (!name) {
            input.queryReturn = JSON.stringify({ success: false, error: 'Missing action "name"' });
            return;
        }

        var result;
        switch (name) {
            case 'createPaymentRequest':
                result = createPaymentRequest(input);
                break;
            case 'listPurchaseContracts':
                result = listPurchaseContracts(input);
                break;
            case 'listFileAttachment':
                listFileAttachment(input);
                break;


            default:
                result = { success: false, message: "Hành động (name) không hợp lệ: " + name };
        }

        // Ép kiểu chuỗi JSON 
        input.queryReturn = JSON.stringify(result);

    } catch (e) {
        if (vars['$L.file']) {
            vars['$L.file'].queryReturn = JSON.stringify({ success: false, error: 'Gateway Error: ' + e.toString() });
        }
    }
}

function createPaymentRequest(input) {
    try {
        var rawData = input.queryString;
        if (!rawData) return { success: false, message: "Thiếu dữ liệu." };

        var contractList = JSON.parse(rawData);
        var contractData = contractList[0];

        // =========================================================================
        // BỔ SUNG: Tính toán động số tiền còn lại của hợp đồng trước khi tạo phiếu
        // =========================================================================
        var contractId = contractData['id'];

        if (contractId) {
            try {
                var currentContractAmount = String(
                    contractData['totalValue'] ||
                    contractData['total.budget'] ||
                    contractData['contract.value.after.tax'] ||
                    contractData['contract.amount'] ||
                    "0"
                );
                var remainingContractValue = calculateContractRemainingValue(contractId, currentContractAmount);
                var remainingRefundValue = calculateContractRemainingRefund(contractId);
                var remainingPayableValue = calculateContractRemainingPayable(contractId);

                // 4. KIỂM TRA CHẶN: Chặn tạo nếu giá trị HĐ còn lại = 0 VÀ hoàn ứng còn lại = 0 VÀ số tiền phải trả còn lại = 0
                if (Number(remainingContractValue) <= 0 && Number(remainingRefundValue) <= 0 && Number(remainingPayableValue) <= 0) {
                    return {
                        success: false,
                        message: "Tổng giá trị HĐ/KMS còn lại, hoàn ứng còn lại và số tiền phải trả còn lại của hợp đồng đều đã về 0. Không thể tạo thêm phiếu thanh toán mới."
                    };
                }

            } catch (eCalc) {
                return {
                    success: false,
                    message: "Lỗi hệ thống khi tính toán số dư hợp đồng: " + eCalc.toString()
                };
            }
        }
        // =========================================================================

        /*
         * HTKT PAYMENT CURRENT USER
         */
        var currentUser = htktCreatePay_resolveCurrentUser(contractData);
        // print("Người dùng hiện tại: " + currentUser);
        if (!currentUser) {
            return {
                success: false,
                message: "Không xác định được người tạo phiếu thanh toán."
            };
        }

        contractData["currentUser"] = currentUser;
        contractData["user"] = currentUser;
        contractData["createdBy"] = currentUser;

        var rawDepartment = contractData['unitLv1'] || contractData['unitLv2'] || contractData['unitLv3'];

        var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(rawDepartment);

        // 2. Lấy giá trị oglBranchCode từ Object trả về
        var oglBranchCode = (entityInfo && entityInfo.oglBranchCode) ? String(entityInfo.oglBranchCode).replace(/^0+/, '') : '';

        var branchCode = oglBranchCode || "100";

        var docType = "TT";

        var paymentRec = new SCFile("esdHTKTpayment");

        var newPaymentId = generateDocumentCode(docType, branchCode);

        // Map dữ liệu
        mapPaymentRecord(paymentRec, contractData, newPaymentId);
        // print("New Payment", paymentRec);


        var returnCode;
        var previousSkipAutoPaymentActivity = htktCreatePay_normalizeValue(
            vars["$L.skipAutoPaymentActivity"]
        );

        try {
            vars["$L.skipAutoPaymentActivity"] = "true";
            returnCode = paymentRec.doAction("add");
        } finally {
            /*
             * Khôi phục giá trị cũ để không ảnh hưởng các xử lý tiếp theo
             */
            vars["$L.skipAutoPaymentActivity"] = previousSkipAutoPaymentActivity;
        }

        if (returnCode == RC_SUCCESS) {
            /*
             * Lưu lịch sử với operator là user thật.
             */
            createActivity(
                "activityHTKTpayment",
                'Thêm mới Đề nghị Thanh toán: Mã đề nghị: "' +
                paymentRec["id"] +
                '"',
                paymentRec["id"],
                "Thêm mới",
                currentUser
            );

            //Đồng bộ giá trị Tạm ứng/Thanh toán giữa Squad 6 và Squad 2
            try {
                lib.ESD_HD_Integration.createContractPayment(paymentRec);
            } catch (ex) {
                // print("[ERROR] Đồng bộ createContractPayment thất bại cho ID: " + paymentRec["id"] + " | Detail: " + ex);
            }


            return {
                success: true,
                message: "Thêm đề nghị thanh toán thành công.",
                id: paymentRec['id']
            };
        } else {
            return {
                success: false,
                message: "Lỗi ghi nhận vào Database esdHTKTpayment. Code: " + returnCode + " reason " + paymentRec.getMessages()
            };
        }

    } catch (error) {

        return { success: false, message: "Lỗi thực thi createPaymentRequest: " + error.toString() };
    }
}

function mapPaymentRecord(paymentRec, contractData, paymentId) {
    // Mã đã được cấp bởi Sequential Numbers trước khi insert.
    paymentRec['id'] = paymentId;

    // 4. Map riêng biệt chi tiết từng trường một từ JSON vào Record
    paymentRec['transaction.type'] = "Thanh toán";
    paymentRec['department'] =
        contractData['unitLv3'] ||
        contractData['unitLv2'] ||
        contractData['unitLv1'] ||
        "";

    paymentRec['description'] = "";

    paymentRec['require.check.level1'] = false;
    paymentRec['require.check.level2'] = false;
    paymentRec['user.checker.kttc'] = "";
    paymentRec['user.checker.dmms'] = "";
    paymentRec['user.approver.dmms'] = "";
    paymentRec['user.approver.kttc'] = "";
    paymentRec['user.checker.final'] = "";
    paymentRec['user.approver.final'] = "";
    paymentRec['return.reason'] = "";
    paymentRec['unit.lv1'] = contractData['unitLv1'] || "";
    paymentRec['unit.lv2'] = contractData['unitLv2'] || "";

    paymentRec['created.at'] = new Date();
    paymentRec['created.by'] = contractData['createdBy'];
    paymentRec['currency'] = "VND";
    paymentRec['total.contract.amount'] = contractData['totalValue'] || 0;
    paymentRec['contract.id'] = contractData['id'];
    paymentRec['contract.name'] = contractData['name'];
    paymentRec['current.phase'] = "start";
    paymentRec['executor.payment'] = contractData['currentUser'];


    var creatorUser = htktCreatePay_resolveCurrentUser(
        contractData
    );

    if (!creatorUser) {
        throw new Error("Không xác định được người tạo phiếu thanh toán.");
    }

    var initialRole = htktCreatePay_detectInitialRoleByRights(creatorUser);

    if (initialRole === "kttc") {
        paymentRec['status'] = "kttc_created";
        paymentRec['initial.role'] = "kttc";
    } else if (initialRole === "dmms") {
        paymentRec['status'] = "dmms_created";
        paymentRec['initial.role'] = "dmms";
    } else {
        throw new Error(
            "Người tạo " +
            creatorUser +
            " chưa có quyền phù hợp để lập phiếu thanh toán. Cần quyền lập đề nghị thanh toán; nếu là KTTC cần thêm quyền nhập liệu hạch toán."
        );
    }

}


function generateDocumentCode(docType, branchCode) {
    var fullYear = new Date().getFullYear();
    var year = ("0" + (fullYear % 100)).slice(-2);
    // Shared existing SM counter; never reset when the year changes.
    var numberClass = "esdHTKTpayment";
    var numberRc = new SCDatum();
    numberRc.setValue(-1);
    var nextNumber = new SCDatum();
    system.functions.rtecall(
        "getnumber", numberRc, nextNumber, numberClass
    );
    // String(SCDatum) includes a native-object label; read its payload instead.
    var rcText = String(numberRc.getText()).replace(/^\s+|\s+$/g, "");
    var rawNumber = String(nextNumber.getText()).replace(/^\s+|\s+$/g, "");
    // SM may render a string datum with surrounding quotes.
    if (/^"[^"]*"$/.test(rawNumber) || /^'[^']*'$/.test(rawNumber)) {
        rawNumber = rawNumber.substring(1, rawNumber.length - 1);
    }
    // The existing class has a TT prefix.
    // Padding/length from Sequential Numbers is normalized below to 7 digits.
    if (rawNumber.indexOf(docType) === 0) {
        rawNumber = rawNumber.substring(docType.length);
    }
    // Never fall back to MAX + 1, which races between concurrent sessions.
    // Use the output status and payload, not JS truthiness of the bridge return.
    if (rcText !== "0" || !/^\d+$/.test(rawNumber)) {
        throw new Error("Không cấp được số phiếu từ Sequential Numbers: " +
            numberClass + ". Kiểm tra bộ đếm hiện có, Prefix TT, Suffix trống, " +
            "Increment=1 và không Decrement. rc=" + rcText +
            ", number=" + rawNumber);
    }
    var sequence = Number(rawNumber);
    if (sequence < 1 || sequence > 9999999) {
        throw new Error("Số phiếu ngoài phạm vi 0000001..9999999: " + rawNumber);
    }
    var paymentId = docType + "." + branchCode + "." + year + "." +
        ("0000000" + sequence).slice(-7);
    // Detect a mis-seeded counter. Concurrency safety comes from getnumber.
    var existing = new SCFile("esdHTKTpayment", SCFILE_READONLY);
    try {
        var rc = existing.doSelect('id="' + escapeSmQueryValue(paymentId) + '"');
        if (rc === RC_SUCCESS) {
            throw new Error("Bộ đếm " + numberClass + " cấp mã đã tồn tại: " +
                paymentId + ". Dừng tạo phiếu và đồng bộ bộ đếm với dữ liệu hiện có.");
        }
        if (rc !== RC_NO_MORE) {
            throw new Error("Không kiểm tra được mã phiếu " + paymentId + ". Code: " + rc);
        }
    } finally {
        closeSCFile(existing);
    }
    return paymentId;
}

function listPurchaseContracts() {
    var result = {
        total_count: 0,
        data: []
    };

    var countFile = new SCFile('esdHDcontract', SCFILE_READONLY);
    result.total_count = countFile.doCount("true");

    if (result.total_count === 0) {
        return result;
    }

    // 2. Khai báo các trường để lấy dữ liệu
    var fieldMappings = [
        ['name', 'name', 'S'],
        ['status', 'status', 'S'],
        ['current.phase', 'current_phase', 'S'],
        ['created.by', 'created_by', 'S'],
        ['created.at', 'created_at', 'D'],
        ['sysmodtime', 'sysmodtime', 'D'],
        ['sysmoduser', 'sysmoduser', 'S'],
        ['total.budget', 'total_budget', 'S'],
        ['is.budgeted', 'is_budgeted', 'S'],
        ['execution.dependency', 'execution_dependency', 'S'],
        ['start.date', 'start_date', 'D'],
        ['execution.duration', 'execution_duration', 'N'],
        ['expected.end.date', 'expected_end_date', 'D'],
        ['actual.end.date', 'actual_end_date', 'D'],
        ['executor.id', 'executor_id', 'S'],
        ['total.executed.value', 'total_executed_value', 'S'],
        ['total.unexecuted.value', 'total_unexecuted_value', 'S'],
        ['total.paid.amount', 'total_paid_amount', 'S'],
        ['remaining.amount', 'remaining_amount', 'S'],
        ['category', 'category', 'S'],
        ['item.id', 'item_id', 'S'],
        ['item.name', 'item_name', 'S'],
        ['signed.date', 'signed_date', 'D'],
        ['total.contract.value', 'total_contract_value', 'S'],
        ['contract.group', 'contract_group', 'S'],
        ['contract.value.before.tax', 'contract_value_before_tax', 'S'],
        ['contract.value.after.tax', 'contract_value_after_tax', 'S'],
        ['tax.amount', 'tax_amount', 'S'],
        ['unit.lv1', 'unit_lv1', 'S'],
        ['unit.lv2', 'unit_lv2', 'S'],
        ['unit.lv3', 'unit_lv3', 'S'],
        ['contract.type', 'contract_type', 'S'],
        ['contract.no', 'contract_no', 'S'],
        ['signer', 'signer', 'S'],
        ['note', 'note', 'S'],
        ['contract.end.date', 'contract_end_date', 'S'],
        ['duration.unit', 'duration_unit', 'S'],
        ['contact.list', 'contact_list', 'S']
    ];

    var sqlFields = [];
    for (var i = 0; i < fieldMappings.length; i++) {
        sqlFields.push(fieldMappings[i][0]);
    }

    var statusParam = "Dang thuc hien"; // Biến động truyền từ ngoài vào

    var select = " SELECT " + sqlFields.join(", ");
    var mapping = ' FROM esdHDcontract c ';
    //    var control = " WHERE 1=1 AND c.current.phase = '" + statusParam + "'";
    var control = " WHERE 1=1 ";

    var querySQL = select + mapping + control;

    var f = new SCFile('esdHDcontract', SCFILE_READONLY);

    var rc = f.doSelect(querySQL);
    while (rc == RC_SUCCESS) {

        var item = mapRowToObject(f, fieldMappings);
        result.data.push(item);

        rc = f.getNext();
    }

    try { if (f) f.doClose(); } catch (e) {}

    return result;
}



// ===============================================================
// ========= List HD pagination and filter =======================
// ===============================================================
/**
 * Bản bổ sung phân trang, filter và sort server cho listPurchaseContracts hiện tại.
 */
function listPurchaseContracts(input) {
    // 1. Lấy dữ liệu linh hoạt từ details hoặc queryString
    var rawData = input ? (input.details || input.queryString) : null;
    if (!rawData) return { success: false, message: "Thiếu dữ liệu đầu vào." };

    var params = {};
    try {
        params = JSON.parse(rawData);
        if (Array.isArray(params)) {
            params = params[0] || {};
        }
    } catch (e) {
        return { success: false, message: "Dữ liệu JSON đầu vào không hợp lệ." };
    }

    /*
     * HTKT PAYMENT CURRENT USER
     */
    var currentUser = htktCreatePay_resolveCurrentUser(params);

    if (!currentUser) {
        return {
            success: false,
            message: "Không xác định được người tạo phiếu thanh toán."
        };
    }

    // PHÂN TRANG: chỉ bổ sung start/count, không thay đổi điều kiện nghiệp vụ.
    var start = parseInt(params.start, 10);
    var count = parseInt(params.count, 10);
    start = isNaN(start) || start < 1 ? 1 : start;
    count = isNaN(count) || count < 1 ? 10 : count;

    var fieldMappings = [
        ['id', 'id', 'S'],
        ['name', 'name', 'S'],
        ['status', 'status', 'S'],
        ['current.phase', 'current.phase', 'S'],
        ['created.by', 'created.by', 'S'],
        ['created.at', 'created.at', 'D'],
        ['sysmodtime', 'sysmodtime', 'D'],
        ['sysmoduser', 'sysmoduser', 'S'],
        ['total.budget', 'total.budget', 'S'],
        ['is.budgeted', 'is.budgeted', 'B'],
        ['execution.dependency', 'execution.dependency', 'S'],
        ['start.date', 'start.date', 'D'],
        ['execution.duration', 'execution.duration', 'N'],
        ['expected.end.date', 'expected.end.date', 'D'],
        ['actual.end.date', 'actual.end.date', 'D'],
        ['executor.id', 'executor.id', 'S'],
        ['total.executed.value', 'total.executed.value', 'S'],
        ['total.unexecuted.value', 'total.unexecuted.value', 'S'],
        ['total.paid.amount', 'total.paid.amount', 'S'],
        ['remaining.amount', 'remaining.amount', 'S'],
        ['category', 'category', 'S'],
        ['item.id', 'item.id', 'S'],
        ['item.name', 'item.name', 'S'],
        ['signed.date', 'signed.date', 'D'],
        ['total.contract.value', 'total.contract.value', 'S'],
        ['contract.group', 'contract.group', 'S'],
        ['contract.value.before.tax', 'contract.value.before.tax', 'S'],
        ['contract.value.after.tax', 'totalValue', 'S'],
        ['tax.amount', 'tax.amount', 'S'],
        ['unit.lv1', 'unit.lv1', 'S'],
        ['unit.lv2', 'unit.lv2', 'S'],
        ['unit.lv3', 'unit.lv3', 'S'],
        ['contract.type', 'contract.type', 'S'],
        ['contract.no', 'contract.no', 'S'],
        ['signer', 'signer', 'S'],
        ['note', 'note', 'S'],
        ['contract.end.date', 'contract.end.date', 'S'],
        ['duration.unit', 'duration.unit', 'S'],
        ['contact.list', 'contact.list', 'S']
    ];

    // 2. Xây dựng điều kiện lọc WHERE
    var conditions = [];

    conditions.push("((category=\"HD_GT\" and contract.value.after.tax > 0) or (category=\"HD_KMS\" and total.budget > 0))");

    var role = params.initialRole || (input ? input.initialRole : null);
    if (role) {
        role = String(role).trim().toLowerCase();
        if (role === "dmms") {
            conditions.push("executor.id=\"" + params.currentUser + "\"");
        }
    }

    if (params.status) {
        conditions.push("status=\"" + params.status + "\"");
    }

    var unitLv1Param = params.unitLv1 || params["unit.lv1"];

    if (unitLv1Param && String(unitLv1Param).trim() === "099917000") {
        conditions.push("unit.lv1 like \"0999*\"");
    } else {
        conditions.push("unit.lv1=\"" + unitLv1Param + "\"");
    }

    // FILTER: bổ sung 3 điều kiện trên popup
    var categoryFilter = String(params.category || "").trim();
    if (categoryFilter === "HD_GT" || categoryFilter === "HD_KMS") {
        conditions.push('category="' + escapeSmQueryValue(categoryFilter) + '"');
    }

    var keywordFilter = String(params.keyword || "").trim().toLowerCase();
    if (keywordFilter) {
        conditions.push('tolower(id) like "*' + escapeSmQueryValue(keywordFilter) + '*"');
    }

    if (params.createdAtFrom) {
        conditions.push('created.at >= "' + escapeSmQueryValue(params.createdAtFrom) + '"');
    }
    if (params.createdAtTo) {
        conditions.push('created.at <= "' + escapeSmQueryValue(params.createdAtTo) + '"');
    }

    //    var unitLv1Param = params.unitLv1 || params["unit.lv1"];
    //    if (unitLv1Param && String(unitLv1Param).trim() !== "099917000") {
    //        conditions.push("unit.lv1=\"" + unitLv1Param + "\"");
    //    }
    //    conditions.push("contract.value.after.tax > 0");
    //    if (params.status) {
    //        conditions.push("status=\"" + params.status + "\"");
    //    }
    //    var unitLv1Param = params.unitLv1 || params["unit.lv1"];
    //    if (unitLv1Param) {
    //        conditions.push("unit.lv1=\"" + unitLv1Param + "\"");
    //    }


    var whereClause = conditions.length > 0 ? conditions.join(" and ") : "true";


    var sqlFields = fieldMappings.map(function(item) {
        return item[0];
    });

    // PHÂN TRANG: đếm trên SCFile riêng với đúng whereClause nghiệp vụ hiện tại.
    var totalCount = 0;
    var countFile = new SCFile('esdHDcontract', SCFILE_READONLY);
    try {
        totalCount = countFile.doCount(whereClause);
    } finally {
        try { if (countFile) countFile.doClose(); } catch (e) {}
    }

    var dataArray = [];
    var f = new SCFile('esdHDcontract', SCFILE_READONLY);

    try {
        // Tương đương danh sách cột trong SELECT cũ; không thay đổi field trả về.
        f.setFields(sqlFields);

        // SORT SERVER: chỉ cho phép các field thật của esdHDcontract để tránh chèn field tùy ý.
        var sortFieldMap = {
            "id": "id",
            "category": "category",
            "created.at": "created.at",
            "executor.id": "executor.id",
            "status": "status"
        };
        var smSortField = sortFieldMap[String(params.sortField || "")];
        if (smSortField) {
            var sortSequence = parseInt(params.sortOrder, 10) === -1 ? SCFILE_DSC : SCFILE_ASC;
            var sortFields = [smSortField];
            var sortSequences = [sortSequence];

            // Giữ thứ tự ổn định giữa các trang khi nhiều bản ghi có cùng giá trị sort.
            if (smSortField !== "id") {
                sortFields.push("id");
                sortSequences.push(SCFILE_ASC);
            }
            f.setOrderBy(sortFields, sortSequences);
        }

        // PHÂN TRANG: lấy đúng trang sau khi đã áp dụng filter/sort phía SM.
        var rc = f.doSelectEx(whereClause, start, count);

        while (rc == RC_SUCCESS) {
            var itemData = mapRowToObject(f, fieldMappings);

            // --- XỬ LÝ ĐỔI GIÁ TRỊ CỦA NAME VÀ TOTAL VALUE THEO CATEGORY ---
            if (itemData.category === "HD_KMS") {
                itemData.name = itemData["item.name"] || itemData.name;
                itemData.totalValue = itemData["total.budget"] || "0";
            } else if (itemData.category === "HD_GT") {
                itemData.name = itemData.name;
                itemData.totalValue = itemData["contract.value.after.tax"] || itemData.totalValue || "0";
            }

            // Không tính/lọc số dư tại đây để tránh query lồng theo từng hợp đồng.
            dataArray.push(itemData);

            rc = f.getNext();
        }
    } catch (e) {
        // print("[ERROR listPurchaseContracts] Lỗi doSelectEx: " + e);
        return {
            success: false,
            message: "Lỗi lấy danh sách hợp đồng mua sắm: " + e.toString()
        };
    } finally {
        try { if (f) f.doClose(); } catch (e) {}
    }

    return {
        success: true,
        data: dataArray,
        totalCount: totalCount,
        start: start,
        count: count,
        returnedCount: dataArray.length,
        hasMore: start - 1 + dataArray.length < totalCount
    };
}
// ===============================================================
// ========= List HD pagination and filter =======================
// ===============================================================

function mapRowToObject(scFileRecord, fieldMappings) {
    var item = {};
    for (var j = 0; j < fieldMappings.length; j++) {
        var jsonKey = fieldMappings[j][1];
        var dataType = fieldMappings[j][2];
        var dbValue = scFileRecord[j];

        if (dataType === "N") {
            item[jsonKey] = dbValue ? Number(dbValue) : 0;
        } else if (dataType === "D") {
            item[jsonKey] = dbValue ? (dbValue.toISOString ? dbValue.toISOString() : String(dbValue)) : "";
        } else {
            item[jsonKey] = dbValue ? String(dbValue) : "";
        }
    }
    return item;
}

// ================= Lay het du lieu HD ===================
//function listPurchaseContracts(input) {
//    // 1. Lấy dữ liệu linh hoạt từ details hoặc queryString
//    var rawData = input ? (input.details || input.queryString) : null;
//    if (!rawData) return { success: false, message: "Thiếu dữ liệu đầu vào." };
//
//    var params = {};
//    try {
//        params = JSON.parse(rawData);
//        if (Array.isArray(params)) {
//            params = params[0] || {};
//        }
//    } catch (e) {
//        return { success: false, message: "Dữ liệu JSON đầu vào không hợp lệ." };
//    }
//
//    /*
//     * HTKT PAYMENT CURRENT USER
//     */
//    var currentUser = htktCreatePay_resolveCurrentUser(params);
//
//    if (!currentUser) {
//        return {
//            success: false,
//            message: "Không xác định được người tạo phiếu thanh toán."
//        };
//    }
//
//    var fieldMappings = [
//        ['id', 'id', 'S'],
//        ['name', 'name', 'S'],
//        ['status', 'status', 'S'],
//        ['current.phase', 'current.phase', 'S'],
//        ['created.by', 'created.by', 'S'],
//        ['created.at', 'created.at', 'D'],
//        ['sysmodtime', 'sysmodtime', 'D'],
//        ['sysmoduser', 'sysmoduser', 'S'],
//        ['total.budget', 'total.budget', 'S'],
//        ['is.budgeted', 'is.budgeted', 'B'],
//        ['execution.dependency', 'execution.dependency', 'S'],
//        ['start.date', 'start.date', 'D'],
//        ['execution.duration', 'execution.duration', 'N'],
//        ['expected.end.date', 'expected.end.date', 'D'],
//        ['actual.end.date', 'actual.end.date', 'D'],
//        ['executor.id', 'executor.id', 'S'],
//        ['total.executed.value', 'total.executed.value', 'S'],
//        ['total.unexecuted.value', 'total.unexecuted.value', 'S'],
//        ['total.paid.amount', 'total.paid.amount', 'S'],
//        ['remaining.amount', 'remaining.amount', 'S'],
//        ['category', 'category', 'S'],
//        ['item.id', 'item.id', 'S'],
//        ['item.name', 'item.name', 'S'],
//        ['signed.date', 'signed.date', 'D'],
//        ['total.contract.value', 'total.contract.value', 'S'],
//        ['contract.group', 'contract.group', 'S'],
//        ['contract.value.before.tax', 'contract.value.before.tax', 'S'],
//        ['contract.value.after.tax', 'totalValue', 'S'],
//        ['tax.amount', 'tax.amount', 'S'],
//        ['unit.lv1', 'unit.lv1', 'S'],
//        ['unit.lv2', 'unit.lv2', 'S'],
//        ['unit.lv3', 'unit.lv3', 'S'],
//        ['contract.type', 'contract.type', 'S'],
//        ['contract.no', 'contract.no', 'S'],
//        ['signer', 'signer', 'S'],
//        ['note', 'note', 'S'],
//        ['contract.end.date', 'contract.end.date', 'S'],
//        ['duration.unit', 'duration.unit', 'S'],
//        ['contact.list', 'contact.list', 'S']
//
//    ];
//
//    // 2. Xây dựng điều kiện lọc WHERE
//    var conditions = [];
//
//    conditions.push("((category=\"HD_GT\" and contract.value.after.tax > 0) or (category=\"HD_KMS\" and total.budget > 0))");
//
//    var role = params.initialRole || (input ? input.initialRole : null);
//    if (role) {
//        role = String(role).trim().toLowerCase();
//        if (role === "dmms") {
//            conditions.push("executor.id=\"" + params.currentUser + "\"");
//        }
//    }
//
//    if (params.status) {
//        conditions.push("status=\"" + params.status + "\"");
//    }
//
//    var unitLv1Param = params.unitLv1 || params["unit.lv1"];
//
//    if (unitLv1Param && String(unitLv1Param).trim() === "099917000") {
//        conditions.push("unit.lv1 like \"0999*\"");
//    } else {
//        conditions.push("unit.lv1=\"" + unitLv1Param + "\"");
//    }
//
//    //    var unitLv1Param = params.unitLv1 || params["unit.lv1"];
//    //    if (unitLv1Param && String(unitLv1Param).trim() !== "099917000") {
//    //        conditions.push("unit.lv1=\"" + unitLv1Param + "\"");
//    //    }
//    //    conditions.push("contract.value.after.tax > 0");
//    //    if (params.status) {
//    //        conditions.push("status=\"" + params.status + "\"");
//    //    }
//    //    var unitLv1Param = params.unitLv1 || params["unit.lv1"];
//    //    if (unitLv1Param) {
//    //        conditions.push("unit.lv1=\"" + unitLv1Param + "\"");
//    //    }
//
//
//    var whereClause = conditions.length > 0 ? conditions.join(" and ") : "true";
//
//
//    var sqlFields = fieldMappings.map(function(item) {
//        return item[0];
//    }).join(", ");
//
//    // Câu SQL Query
//    var querySQL = " SELECT " + sqlFields + " FROM esdHDcontract WHERE " + whereClause;
//
//    var dataArray = [];
//    var f = new SCFile('esdHDcontract', SCFILE_READONLY);
//
//    try {
//        var rc = f.doSelect(querySQL);
//
//        while (rc == RC_SUCCESS) {
//            var itemData = mapRowToObject(f, fieldMappings);
//
//            // --- XỬ LÝ ĐỔI GIÁ TRỊ CỦA NAME VÀ TOTAL VALUE THEO CATEGORY ---
//            if (itemData.category === "HD_KMS") {
//                itemData.name = itemData["item.name"] || itemData.name;
//                itemData.totalValue = itemData["total.budget"] || "0";
//            } else if (itemData.category === "HD_GT") {
//                itemData.name = itemData.name;
//                itemData.totalValue = itemData["contract.value.after.tax"] || itemData.totalValue || "0";
//            }
//
//            // Không tính/lọc số dư tại đây để tránh query lồng theo từng hợp đồng.
//            dataArray.push(itemData);
//
//            rc = f.getNext();
//        }
//    } catch (e) {
//        // print("[ERROR listPurchaseContracts] Lỗi doSelect: " + e);
//        return {
//            success: false,
//            message: "Lỗi lấy danh sách hợp đồng mua sắm: " + e.toString()
//        };
//    } finally {
//        try { if (f) f.doClose(); } catch (e) {}
//    }
//
//    return {
//        success: true,
//        data: dataArray
//    };
//}

// Các hàm calculate chỉ dùng để kiểm tra số dư khi createPaymentRequest.
// listPurchaseContracts không gọi chúng để tránh query lồng theo từng hợp đồng.
function calculateContractRemainingValue(contractId, currentContractAmount) {
    if (!contractId) return String(currentContractAmount || "0");

    try {
        // 1. TỔNG GIÁ TRỊ ĐÃ TẠM ỨNG
        var totalPrepayment = "0";
        var prepaymentFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
        var sqlPrepayment = 'contract.id="' + contractId + '" and (status="approved" or status="accounted")';

        if (prepaymentFile.doSelect(sqlPrepayment) === RC_SUCCESS) {
            do {
                var prepaymentVendorFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
                if (prepaymentVendorFile.doSelect('prepayment.id="' + prepaymentFile.id + '"') === RC_SUCCESS) {
                    do {
                        // Đảm bảo amount không bị rỗng/null để thư viện cộng chuỗi không báo lỗi
                        var vendorAmt = prepaymentVendorFile.amount ? String(prepaymentVendorFile.amount) : "0";
                        totalPrepayment = lib.ESD_HTKT_Utils.addStringsManual(totalPrepayment, vendorAmt);

                    } while (prepaymentVendorFile.getNext() === RC_SUCCESS);
                }
                prepaymentVendorFile.doClose();

            } while (prepaymentFile.getNext() === RC_SUCCESS);
        }
        prepaymentFile.doClose();

        // 2. TỔNG GIÁ TRỊ ĐÃ THANH TOÁN (ĐNTT có trạng thái = "Đã duyệt" hoặc "Đã hạch toán")
        var totalPayment = "0";
        var paymentFile = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        var sqlPayment = 'contract.id="' + contractId + '" and (status="approved" or status="accounted")';

        if (paymentFile.doSelect(sqlPayment) === RC_SUCCESS) {
            do {
                var paidAmt = paymentFile["total.amount.paid"] ? String(paymentFile["total.amount.paid"]) : "0";
                totalPayment = lib.ESD_HTKT_Utils.addStringsManual(totalPayment, paidAmt);
            } while (paymentFile.getNext() === RC_SUCCESS);
        }
        paymentFile.doClose();

        // 3. GIÁ TRỊ HĐ/KMS CÒN LẠI
        var remainingContractValue = lib.ESD_HTKT_Utils.subtractStringsManual(String(currentContractAmount || "0"), totalPrepayment);
        remainingContractValue = lib.ESD_HTKT_Utils.subtractStringsManual(remainingContractValue, totalPayment);

        if (
            remainingContractValue &&
            (remainingContractValue.charAt(0) === "-" ||
                lib.ESD_HTKT_Utils.compareMoneyStrings(remainingContractValue, "0") < 0)
        ) {
            remainingContractValue = "0";
        }

        return remainingContractValue;
    } catch (e) {
        return String(currentContractAmount || "0");
    }
}

function calculateContractRemainingRefund(contractId) {
    if (!contractId) return 0;

    var query =
        "SELECT " +
        "ai.request.id AS requestId, " +
        "ai.prepayment.id AS prepaymentId, " +
        "ai.vendor.id AS vendorId, " +
        "ai.amount AS advance_amount, " +
        "pe.amount AS payment_entry_amount, " +
        "pe.payment.id AS entry_payment_id, " +
        "aip.status AS ogl_status " +
        "FROM esdHTKTaccountingInformation ai " +
        "LEFT JOIN esdHTKTpaymentEntry pe " +
        'ON (ai.prepayment.id = pe.ref.id AND pe.entry.type = "PREPAYMENT" AND pe.vendor.id = ai.vendor.id) ' +
        "LEFT JOIN esdHTKTaccountingInformation aip " +
        "ON (pe.accounting.request.id = aip.request.id) " +
        'WHERE ai.sub.type = "TAM_UNG" ' +
        'AND ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
        'AND ai.status = "COMPLETED" ' +
        'AND ai.type = "AP" ' +
        'ORDER BY ai.checked.time DESC';

    var resultMap = {};
    var resultOrder = [];
    var file = null;

    try {
        file = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
        var rc = file.doSelect(query);

        while (rc == RC_SUCCESS) {
            var accountingInformationId = String(file["requestId"] || "").trim();
            var prepaymentId = String(file["prepaymentId"] || "").trim();
            var vendorId = String(file["vendorId"] || "").trim();
            var advanceAmount = getNumberField(file, ["advance_amount", "ai.amount", "amount"]);
            var paymentEntryAmount = getNumberField(file, ["payment_entry_amount", "pe.amount"]);
            var oglStatus = String(file["aip.status"] || "").trim().toLowerCase();

            var key = accountingInformationId + "|" + prepaymentId + "|" + vendorId;

            if (!resultMap[key]) {
                resultMap[key] = {
                    advance_amount: advanceAmount,
                    refunded_amount: 0,
                    other_pending_amount: 0
                };
                resultOrder.push(key);
            }

            var item = resultMap[key];
            if (paymentEntryAmount > 0) {
                if (oglStatus === "completed") {
                    item.refunded_amount += paymentEntryAmount;
                } else if (oglStatus !== "rejected" && oglStatus !== "cancelled" && oglStatus !== "failed") {
                    item.other_pending_amount += paymentEntryAmount;
                }
            }

            rc = file.getNext();
        }
    } catch (e) {
        // print("[DEBUG calculateContractRemainingRefund] Error: " + e);
    } finally {
        closeSCFile(file);
    }

    var totalRemainingRefund = 0;
    for (var i = 0; i < resultOrder.length; i++) {
        var resItem = resultMap[resultOrder[i]];
        var rem = resItem.advance_amount - resItem.refunded_amount - resItem.other_pending_amount;
        if (rem > 0) {
            totalRemainingRefund += rem;
        }
    }

    return totalRemainingRefund;
}

function calculateContractRemainingPayable(contractId) {
    if (!contractId) return 0;

    var query =
        "SELECT " +
        "ai.request.id AS requestId, " +
        "ai.prepayment.id AS prepaymentId, " +
        "ai.vendor.id AS vendorId, " +
        "pe.amount AS payable_amount " +
        "FROM esdHTKTaccountingInformation ai " +
        "JOIN esdHTKTpaymentEntry pe " +
        'ON (ai.prepayment.id = pe.payment.id AND pe.entry.type = "PAYABLE" AND pe.account.type = "ASSET" AND pe.vendor.id = ai.vendor.id) ' +
        'WHERE ai.sub.type = "THANH_TOAN" ' +
        'AND ai.contract.id = "' + escapeSmQueryValue(contractId) + '" ' +
        'AND ai.status = "COMPLETED" ' +
        'AND ai.type = "AP" ' +
        'ORDER BY ai.checked.time DESC';

    var totalRemainingPayable = 0;
    var file = null;

    try {
        file = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
        var rc = file.doSelect(query);

        while (rc == RC_SUCCESS) {
            var prepaymentId = String(file["prepaymentId"] || "").trim();
            var vendorId = String(file["vendorId"] || "").trim();
            var payableAmount = getNumberField(file, ["payable_amount", "pe.amount"]);

            // Tính tổng tiền đã trả của khoản nợ này
            var paidAmount = 0;
            if (prepaymentId) {
                var queryPaid =
                    "SELECT amount FROM esdHTKTpaymentEntry " +
                    'WHERE entry.type = "PAYABLE" ' +
                    'AND account.type = "DEBIT" ' +
                    'AND ref.id = "' + escapeSmQueryValue(prepaymentId) + '"' +
                    (vendorId ? ' AND vendor.id = "' + escapeSmQueryValue(vendorId) + '"' : '');

                var debitFile = new SCFile("esdHTKTpaymentEntry", SCFILE_READONLY);
                if (debitFile.doSelect(queryPaid) === RC_SUCCESS) {
                    do {
                        paidAmount += getNumberField(debitFile, ["amount"]);
                    } while (debitFile.getNext() === RC_SUCCESS);
                }
                closeSCFile(debitFile);
            }

            var remainingAmount = payableAmount - paidAmount;
            if (remainingAmount > 0) {
                totalRemainingPayable += remainingAmount;
            }

            rc = file.getNext();
        }
    } catch (e) {
        // print("[DEBUG calculateContractRemainingPayable] Error: " + e);
    } finally {
        closeSCFile(file);
    }

    return totalRemainingPayable;
}
function getNumberField(file, fieldNames) {
    for (var i = 0; i < fieldNames.length; i++) {
        var value = file[fieldNames[i]];
        if (value !== null && value !== undefined && value !== "") {
            var numberValue = Number(value);
            if (!isNaN(numberValue)) return numberValue;
        }
    }
    return 0;
}

function escapeSmQueryValue(value) {
    return String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

function closeSCFile(file) {
    try {
        if (file) file.doClose();
    } catch (ignore) {}
}

function mapRowToObject(scFileRecord, fieldMappings) {
    var item = {};
    for (var j = 0; j < fieldMappings.length; j++) {
        var fieldName = fieldMappings[j][0];
        var jsonKey = fieldMappings[j][1];
        var dataType = fieldMappings[j][2];

        var dbValue = scFileRecord[fieldName];

        if (dataType === "N") {
            item[jsonKey] = dbValue ? Number(dbValue) : 0;
        } else if (dataType === "B") {
            item[jsonKey] = Boolean(dbValue);
        } else if (dataType === "D") {
            item[jsonKey] = dbValue ? (dbValue.toISOString ? dbValue.toISOString() : String(dbValue)) : "";
        } else {
            item[jsonKey] = dbValue ? String(dbValue) : "";
        }
    }
    return item;
}

/* =========================================================
 * HTKT PAYMENT CREATE
 * ========================================================= */

function htktCreatePay_detectInitialRoleByRights(contactId) {
    var RIGHT_VIEW_INVOICE = "0040040003000001";
    var RIGHT_VIEW_PAYMENT = "0040040003000001";
    var RIGHT_CREATE_PAYMENT = "0040040003000002";
    var RIGHT_ACCOUNTING_INPUT = "0040040003000003";

    var rights = htktCreatePay_getRights(contactId);
    // print("=== [DEBUG] Kiểm tra quyền của User: " + contactId + " ===");
    // print("Danh sách quyền thực tế: " + JSON.stringify(rights));
    /*
     * Quy tắc nhận diện role khi khởi tạo phiếu:
     *
     * 1. KTTC khởi tạo:
     *    - Có quyền xem hóa đơn
     *    - Có quyền xem danh sách đề nghị thanh toán
     *    - Có quyền lập đề nghị thanh toán
     *    - Có quyền nhập liệu hạch toán
     *
     * 2. DMMS khởi tạo:
     *    - Có quyền xem hóa đơn
     *    - Có quyền xem danh sách đề nghị thanh toán
     *    - Có quyền lập đề nghị thanh toán
     *    - Không bắt buộc quyền rà soát DMMS 1
     *
     * Lưu ý:
     * - 0040040003000004 là quyền Rà soát đề nghị thanh toán 1,
     *   không phải quyền khởi tạo DMMS.
     * - Ưu tiên KTTC trước vì KTTC có thêm quyền đặc thù 0003.
     */

    if (
        htktCreatePay_hasAllRights(rights, [
            RIGHT_VIEW_INVOICE,
            RIGHT_VIEW_PAYMENT,
            RIGHT_CREATE_PAYMENT,
            RIGHT_ACCOUNTING_INPUT
        ])
    ) {
        return "kttc";
    }

    if (
        htktCreatePay_hasAllRights(rights, [
            RIGHT_VIEW_INVOICE,
            RIGHT_VIEW_PAYMENT,
            RIGHT_CREATE_PAYMENT
        ])
    ) {
        return "dmms";
    }

    return "";
}

function htktCreatePay_getRights(contactId) {
    try {
        return htktCreatePay_normalizeArray(
            lib.ESD_PERMS_RIGHTS.permsRight(contactId) || []
        );
    } catch (e) {
        return [];
    }
}

function htktCreatePay_hasAllRights(userRights, requiredRights) {
    userRights = htktCreatePay_normalizeArray(userRights);
    requiredRights = htktCreatePay_normalizeArray(requiredRights);

    var map = {};

    for (var i = 0; i < userRights.length; i++) {
        map[userRights[i]] = true;
    }

    for (var j = 0; j < requiredRights.length; j++) {
        if (!map[requiredRights[j]]) {
            return false;
        }
    }

    return true;
}

function htktCreatePay_resolveCurrentUser(source) {
    source = source || {};

    return htktCreatePay_normalizeValue(
        source["currentUser"] ||
        source["current_user"] ||
        source["user"] ||
        source["contactId"] ||
        source["contact_id"] ||
        source["contact.id"] ||
        source["contact.name"] ||
        source["createdBy"] ||
        source["created.by"] ||
        source["created_by"] ||
        ""
    );
}

function htktCreatePay_normalizeValue(value) {
    return String(value == null ? "" : value).trim();
}

function htktCreatePay_normalizeArray(source) {
    var array = source || [];
    var result = [];
    var seen = {};

    try {
        if (array.toArray) {
            array = array.toArray();
        }
    } catch (eToArray) {
        array = [];
    }

    if (!array || typeof array.length === "undefined") {
        return result;
    }

    for (var i = 0; i < array.length; i++) {
        var value = htktCreatePay_normalizeValue(array[i]);

        if (value && !seen[value]) {
            seen[value] = true;
            result.push(value);
        }
    }

    return result;
}

function htktCreatePay_getVar(name) {
    try {
        return vars[name];
    } catch (e) {
        return "";
    }
}

function getOglBranchCodeByDepartment(departmentCode) {
    if (!departmentCode) return "";

    try {
        var entityFile = new SCFile("esdDMentity", SCFILE_READONLY);

        var safeDeptCode = String(departmentCode).trim().replace(/^0+/, "");
        var query = 'ps.code="' + safeDeptCode + '"';

        if (entityFile.doSelect(query) === RC_SUCCESS) {
            var rawOglCode = entityFile["ogl.branch.code"] || "";
            return String(rawOglCode).trim().replace(/^0+/, "");
        }
    } catch (e) {
        // print("Lỗi truy vấn esdDMentity: " + e.toString());
    }

    return "";
}

//-----
//function listFileAttachment(input) {
//
//    // 1. Lấy dữ liệu linh hoạt từ details hoặc queryString
//    var rawData = input ? (input.details || input.queryString) : null;
//    if (!rawData) return { success: false, message: "Thiếu dữ liệu đầu vào." };
//
//    var params = {};
//    try {
//        params = JSON.parse(rawData);
//        if (Array.isArray(params)) {
//            params = params[0] || {};
//        }
//    } catch (e) {
//        return { success: false, message: "Dữ liệu JSON đầu vào không hợp lệ." };
//    }
//
//    // 2. Định nghĩa fieldMappings chỉ cho bảng esdHDtlks
//    var fieldMappings = [
//        ['id', 'id', 'S'],
//        ['id.activity.vj', 'id.activity.vj', 'S'],
//        ['name', 'name', 'S'],
//        ['status', 'status', 'S'],
//        ['created.by', 'created.by', 'S'],
//        ['created.at', 'created.at', 'D'],
//        ['sysmodtime', 'sysmodtime', 'D'],
//        ['sysmoduser', 'sysmoduser', 'S'],
//        ['sizeKb', 'sizeKb', 'N'],
//        ['parent.id', 'parent.id', 'S'],
//        ['attach.type', 'attach.type', 'S'],
//        ['note', 'note', 'S'],
//        ['executor', 'executor', 'S'],
//        ['document.type', 'document.type', 'S'],
//        ['attach.id', 'attach.id', 'S'],
//        ['table', 'table', 'S'],
//        ['doc.id', 'doc.id', 'S'],
//        ['document.source', 'document.source', 'S'],
//        ['document.date', 'document.date', 'D'],
//        ['category', 'category', 'S'],
//        ['step.status', 'step.status', 'S'],
//        ['transaction.id', 'transaction.id', 'S'],
//        ['function', 'function', 'S'],
//        ['original.id', 'original.id', 'S']
//    ];
//
//    // 3. Xây dựng điều kiện lọc WHERE
//    var conditions = [];
//
//    if (params.status) {
//        conditions.push("status=\"" + params.status + "\"");
//    }
//    if (params.role !== "kttc") {
//        if (params.createdBy) {
//            conditions.push("tolower(executor)=\"" + params.createdBy.toLowerCase() + "\"");
//        }
//    }
//
//    var querySQL = conditions.length > 0 ? conditions.join(" and ") : "true";
//
//    // 4. Truy vấn đơn bảng trong Service Manager
//    var dataArray = [];
//    var f = new SCFile('esdHDtlks', SCFILE_READONLY);
//
//    try {
//        var rc = f.doSelect(querySQL);
//
//        while (rc == RC_SUCCESS) {
//            var itemData = mapRowToObject(f, fieldMappings);
//
//            var wrappedItem = {
//                "esdHDtlks": itemData
//            };
//
//            dataArray.push(JSON.stringify(wrappedItem));
//
//            rc = f.getNext();
//        }
//    } catch (e) {
//        print("[ERROR listFileAttachment] Lỗi doSelect: " + e);
//    } finally {
//        try { if (f) f.doClose(); } catch (e) {}
//    }
//
//    // Trả mảng kết quả
//    input.queryReturnArray = system.functions.denull(dataArray);
//}

//----
function listFileAttachment(input) {

    // 1. Lấy dữ liệu linh hoạt từ details hoặc queryString
    var rawData = input ? (input.details || input.queryString) : null;
    if (!rawData) return { success: false, message: "Thiếu dữ liệu đầu vào." };

    var params = {};
    try {
        params = JSON.parse(rawData);
        if (Array.isArray(params)) {
            params = params[0] || {};
        }
    } catch (e) {
        return { success: false, message: "Dữ liệu JSON đầu vào không hợp lệ." };
    }

    // 2. Định nghĩa fieldMappings chuẩn cho bảng esdHDtlks
    var fieldMappings = [
        ['t.id', 'id', 'S'],
        ['t.id.activity.vj', 'id.activity.vj', 'S'],
        ['t.name', 'name', 'S'],
        ['t.status', 'status', 'S'],
        ['t.created.by', 'created.by', 'S'],
        ['t.created.at', 'created.at', 'D'],
        ['t.sysmodtime', 'sysmodtime', 'D'],
        ['t.sysmoduser', 'sysmoduser', 'S'],
        ['t.sizeKb', 'sizeKb', 'N'],
        ['t.parent.id', 'parent.id', 'S'],
        ['t.attach.type', 'attach.type', 'S'],
        ['t.note', 'note', 'S'],
        ['t.executor', 'executor', 'S'],
        ['t.document.type', 'document.type', 'S'],
        ['t.attach.id', 'attach.id', 'S'],
        ['t.table', 'table', 'S'],
        ['t.doc.id', 'doc.id', 'S'],
        ['t.document.source', 'document.source', 'S'],
        ['t.document.date', 'document.date', 'D'],
        ['t.category', 'category', 'S'],
        ['t.step.status', 'step.status', 'S'],
        ['t.transaction.id', 'transaction.id', 'S'],
        ['t.function', 'function', 'S'],
        ['t.original.id', 'original.id', 'S']
    ];

    // 3. Xây dựng điều kiện lọc chung (WHERE Clause)
    var whereConditions = [];
    var cId = params.contractId;
    if (cId) {
        whereConditions.push('c.id="' + cId + '"');
    }
    if (params.status) {
        whereConditions.push('t.status="' + params.status + '"');
    }
    if (params.role !== "kttc" && params.createdBy) {
        whereConditions.push('tolower(t.executor)="' + params.createdBy.toLowerCase() + '"');
    }

    var baseWhereClause = whereConditions.length > 0 ? " and " + whereConditions.join(" and ") : "";

    var dataArray = [];
    // Khởi tạo Object để lưu các t.id đã duyệt qua (lọc trùng)
    var processedIds = {};

    // Danh sách các cột cần lấy từ alias t (bảng esdHDtlks)
    var selectFields = "t.id, t.id.activity.vj, t.name, t.status, t.created.by, t.created.at, t.sysmodtime, t.sysmoduser, " +
                       "t.sizeKb, t.parent.id, t.attach.type, t.note, t.executor, t.document.type, t.attach.id, " +
                       "t.table, t.doc.id, t.document.source, t.document.date, t.category, t.step.status, t.transaction.id, " +
                       "t.function, t.original.id ";

    // ==========================================
    // LUỒNG 1: DIGITIZATION (c JOIN d JOIN t)
    // ==========================================
    var querySQL1 = "SELECT " + selectFields +
                     "FROM esdHDcontract c " +
                     "JOIN esdHDdigitization d ON (c.id = d.id.contract) " +
                     "JOIN esdHDtlks t ON (d.id = t.parent.id) " +
                     "WHERE true" + baseWhereClause;

    var f1 = new SCFile('esdHDtlks', SCFILE_READONLY);
    try {
        var rc1 = f1.doSelect(querySQL1);
        while (rc1 == RC_SUCCESS) {
            var itemData1 = mapRowToObject(f1, fieldMappings);
            var itemId1 = itemData1["id"];

            // Kiểm tra trùng t.id: Nếu chưa có thì mới xử lý
            if (itemId1 && !processedIds[itemId1]) {
                processedIds[itemId1] = true; // Đánh dấu đã tồn tại

                if (!itemData1["table"]) {
                    itemData1["table"] = "esdHDdigitization";
                }

                dataArray.push(JSON.stringify({ "esdHDtlks": itemData1 }));
            }

            rc1 = f1.getNext();
        }
    } catch (e) {
        print("[ERROR listFileAttachment] Lỗi Luồng 1 (Digitization): " + e);
    } finally {
        try { if (f1) f1.doClose(); } catch (e) {}
    }

    // ==========================================
    // LUỒNG 2: ATTACHMENT (c JOIN a JOIN t)
    // ==========================================
    var querySQL2 = "SELECT " + selectFields +
                     "FROM esdHDcontract c " +
                     "JOIN esdHDattachment a ON (c.id = a.parent.id) " +
                     "JOIN esdHDtlks t ON (t.original.id = a.id) " +
                     "WHERE true" + baseWhereClause;

    var f2 = new SCFile('esdHDtlks', SCFILE_READONLY);
    try {
        var rc2 = f2.doSelect(querySQL2);
        while (rc2 == RC_SUCCESS) {
            var itemData2 = mapRowToObject(f2, fieldMappings);
            var itemId2 = itemData2["id"];

            // Kiểm tra trùng t.id: Nếu chưa có thì mới xử lý
            if (itemId2 && !processedIds[itemId2]) {
                processedIds[itemId2] = true; // Đánh dấu đã tồn tại

                if (!itemData2["table"]) {
                    itemData2["table"] = "esdHDattachment";
                }

                dataArray.push(JSON.stringify({ "esdHDtlks": itemData2 }));
            }

            rc2 = f2.getNext();
        }
    } catch (e) {
        print("[ERROR listFileAttachment] Lỗi Luồng 2 (Attachment): " + e);
    } finally {
        try { if (f2) f2.doClose(); } catch (e) {}
    }

    // 4. Trả mảng kết quả tổng hợp
    input.queryReturnArray = system.functions.denull(dataArray);
}
