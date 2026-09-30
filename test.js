/**
 * Bản test bổ sung phân trang, filter và sort server cho listPurchaseContracts hiện tại.
 * Khi test trên SM: chỉ thay function listPurchaseContracts(input) đang có hiệu lực.
 * Các helper htktCreatePay_resolveCurrentUser, mapRowToObject và escapeSmQueryValue giữ nguyên từ SL hiện tại.
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
