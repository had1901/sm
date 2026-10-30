/**
 * ScriptLibrary: ESD_HTKT_EXPENSE_CONTRACT
 * Đọc HĐ S4 theo quyền Dự chi; cung cấp khóa gói thầu cho resolver NCC.
 * API này không thay đổi listPurchaseContracts của Thanh toán/Tạm ứng.
 */

/** Nguồn HĐ được xác định từ phiếu đã lưu, không lấy từ lựa chọn phía client. */
function listExpenseContracts(input) {
    var payment = null;
    try {
        var params = expenseContractParams(input);
        var paymentId = expenseContractText(params.paymentId);
        var actor = expenseContractText(params.currentUser);
        if (paymentId.indexOf("DC.") !== 0 || !actor) {
            throw expenseContractError("INVALID_EXPENSE", "Thiếu phiếu Dự chi hoặc người thực hiện hợp lệ.");
        }
        payment = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        payment.setFields(["id", "transaction.type", "original.contract.category", "current.phase",
            "initial.role", "created.by", "user.checker.kttc"]);
        if (payment.doSelect('id="' + expenseContractQuote(paymentId) + '"') !== RC_SUCCESS ||
                expenseContractText(payment["transaction.type"]) !== "Dự chi") {
            throw expenseContractError("INVALID_EXPENSE", "Không tìm thấy phiếu Dự chi hợp lệ.");
        }
        var phase = expenseContractText(payment["current.phase"]);
        var role = expenseContractText(payment["initial.role"]);
        var creator = expenseContractText(payment["created.by"]).toLowerCase();
        var checker = expenseContractText(payment["user.checker.kttc"]).toLowerCase();
        var canSelect = (phase === "initial_dmms" && role === "dmms" && actor.toLowerCase() === creator) ||
                (phase === "initial_kttc" && (actor.toLowerCase() === checker || (role === "kttc" && actor.toLowerCase() === creator)));
        if (!canSelect) throw expenseContractError("EXPENSE_NOT_EDITABLE", "Không có quyền chọn HĐ tại bước hiện tại của phiếu Dự chi.");
        var category = expenseContractText(payment["original.contract.category"]).toUpperCase() || "HHDV";
        var result;
        if (category === "HHDV") {
            var hhdvParams = lib.ESD_HTKT_EXPENSE_VENDOR.expenseImportGetContractParams(payment, actor);
            var filters = ["start", "count", "category", "keyword", "createdAtFrom", "createdAtTo", "sortField", "sortOrder"];
            for (var i = 0; i < filters.length; i++) {
                if (params[filters[i]] != null) hhdvParams[filters[i]] = params[filters[i]];
            }
            result = lib.ESD_HTKT_PAYMENT_CREATE_REQUEST.listPurchaseContracts({ queryString: JSON.stringify(hhdvParams) });
        } else if (category === "XDCB") {
            var filterCategory = expenseContractText(params.category);
            if (filterCategory && filterCategory !== "HD_GT") {
                throw expenseContractError("XDCB_CATEGORY_UNSUPPORTED", "Nguồn XDCB hiện chỉ hỗ trợ Hợp đồng.");
            }
            var sortMap = { id: "id", name: "name", "created.at": "effectiveDate",
                totalValue: "contractAmount", status: "status", "executor.id": "responsibleOfficer" };
            var requestedSort = expenseContractText(params.sortField);
            if (requestedSort && !Object.prototype.hasOwnProperty.call(sortMap, requestedSort)) {
                throw expenseContractError("INVALID_SORT_FIELD", "Cột sắp xếp HĐ XDCB không hợp lệ.");
            }
            result = listExpenseXdcbContracts({ details: {
                currentUser: actor, paymentId: paymentId, start: params.start, count: params.count, keyword: params.keyword,
                effectiveDateFrom: expenseContractText(params.createdAtFrom).substring(0, 10),
                effectiveDateTo: expenseContractText(params.createdAtTo).substring(0, 10),
                sortField: requestedSort ? sortMap[requestedSort] : "id",
                sortOrder: Number(params.sortOrder) === -1 ? "desc" : "asc"
            } });
            if (result.success) {
                for (var j = 0; j < result.data.length; j++) {
                    var row = result.data[j];
                    row.category = "HD_GT";
                    row.totalValue = row.contractAmount;
                    row["created.at"] = row.effectiveDate;
                    row["start.date"] = row.effectiveDate;
                    row["expected.end.date"] = row.expireDate;
                    row["contract.no"] = row.id;
                    row["executor.id"] = row.responsibleOfficer;
                }
            }
        } else {
            throw expenseContractError("INVALID_EXPENSE_CATEGORY", "Hạng mục của phiếu Dự chi không hợp lệ.");
        }
        if (!result) throw expenseContractError("CONTRACT_QUERY_FAILED", "Không nhận được kết quả danh sách HĐ.");
        result.contractCategory = category;
        return result;
    } catch (error) {
        return { success: false, data: [], totalCount: 0, errorCode: error.expenseContractCode || "EXPENSE_CONTRACT_READ_FAILED",
            message: String(error.message || error) };
    } finally {
        expenseContractClose(payment);
    }
}

/** Lọc, đếm và phân trang HĐ S4 đủ điều kiện trong phạm vi người dùng. */
function listExpenseXdcbContracts(input) {
    var countFile = null;
    var contractFile = null;
    try {
        var params = expenseContractParams(input);
        var scopeQuery = expenseContractScope(params.currentUser, params.paymentId);
        var start = expenseContractPageNumber(params.start, 1);
        var count = Math.min(expenseContractPageNumber(params.count, 10), 100);
        var projectType = expenseContractText(params.projectType);
        if (projectType && projectType !== "REPAIR" && projectType !== "CONSTRUCTION") {
            throw expenseContractError("INVALID_PROJECT_TYPE", "Loại công trình/dự án XDCB không hợp lệ.");
        }

        var repairPresent = '(not null(repair.id) and repair.id~="")';
        var repairEmpty = '(null(repair.id) or repair.id="")';
        var constructionPresent = '(not null(construction.id) and construction.id~="")';
        var constructionEmpty = '(null(construction.id) or construction.id="")';
        var repairQuery = '(' + repairPresent + ' and ' + constructionEmpty + ')';
        var constructionQuery = '(' + constructionPresent + ' and ' + repairEmpty + ')';
        var conditions = [
            '(null(deleted.flag) or deleted.flag=false)',
            // Chỉ cho chọn HĐ đang thực hiện; dùng chung cho picker, thêm món và import.
            'status="Đang thực hiện"',
            scopeQuery,
            projectType === "REPAIR" ? repairQuery :
                    (projectType === "CONSTRUCTION" ? constructionQuery :
                            '(' + repairQuery + ' or ' + constructionQuery + ')')
        ];
        var keyword = expenseContractText(params.keyword);
        var contractId = expenseContractText(params.contractId);
        // contractCode là tên tham số API cũ; mã HĐ XDCB được đối chiếu bằng ID nguồn.
        var contractCode = expenseContractText(params.contractCode);
        if (contractId) conditions.push('id="' + expenseContractQuote(contractId) + '"');
        if (contractCode) conditions.push('id="' + expenseContractQuote(contractCode) + '"');
        if (keyword) {
            var escapedKeyword = expenseContractQuote(keyword.toLowerCase());
            conditions.push('(tolower(id) like "*' + escapedKeyword +
                    '*" or tolower(contract.name) like "*' + escapedKeyword + '*")');
        }
        var dateFrom = expenseContractDateFilter(params.effectiveDateFrom);
        var dateTo = expenseContractDateFilter(params.effectiveDateTo);
        if (dateFrom && dateTo && dateFrom > dateTo) {
            throw expenseContractError("INVALID_DATE_RANGE", "Khoảng ngày hiệu lực không hợp lệ.");
        }
        if (dateFrom) conditions.push('effective.date >= "' + dateFrom + ' 00:00:00"');
        if (dateTo) conditions.push('effective.date < "' + expenseContractNextDate(dateTo) + ' 00:00:00"');

        var sortFields = {
            id: "id", contractCode: "id", name: "contract.name",
            contractAmount: "contract.amount", effectiveDate: "effective.date", status: "status", responsibleOfficer: "responsible.officer"
        };
        var requestedSort = expenseContractText(params.sortField) || "id";
        var sortField = sortFields[requestedSort];
        if (!Object.prototype.hasOwnProperty.call(sortFields, requestedSort)) {
            throw expenseContractError("INVALID_SORT_FIELD", "Cột sắp xếp HĐ XDCB không hợp lệ.");
        }
        var direction = expenseContractText(params.sortOrder) || "asc";
        if (direction !== "asc" && direction !== "desc") {
            throw expenseContractError("INVALID_SORT_ORDER", "Chiều sắp xếp HĐ XDCB không hợp lệ.");
        }

        var query = conditions.join(" and ");
        countFile = new SCFile("esdXDCBrepairProjectCtr", SCFILE_READONLY);
        var totalCount = Number(countFile.doCount(query));
        if (!isFinite(totalCount) || totalCount < 0 || Math.floor(totalCount) !== totalCount) {
            throw expenseContractError("CONTRACT_COUNT_FAILED", "Không đếm được danh sách HĐ XDCB.");
        }
        contractFile = new SCFile("esdXDCBrepairProjectCtr", SCFILE_READONLY);
        contractFile.setFields([
            "id", "contract.name", "contract.amount", "currency",
            "signed.date", "effective.date", "expire.date", "status", "responsible.officer",
            "repair.id", "construction.id", "type.budget", "vendor.name", "tax.code", "vendor.address", "tender.package.id"
        ]);
        var orderFields = [sortField];
        var orderSequences = [direction === "desc" ? SCFILE_DSC : SCFILE_ASC];
        if (sortField !== "id") {
            orderFields.push("id");
            orderSequences.push(SCFILE_ASC);
        }
        contractFile.setOrderBy(orderFields, orderSequences);
        var rows = [];
        var rc = contractFile.doSelectEx(query, start, count);
        while (rc === RC_SUCCESS) {
            rows.push(expenseContractRow(contractFile));
            rc = contractFile.getNext();
        }
        if (rc !== RC_NO_MORE) {
            throw expenseContractError("CONTRACT_QUERY_FAILED", "Không tải được danh sách HĐ XDCB.");
        }
        return {
            success: true, data: rows, totalCount: totalCount,
            start: start, count: count, returnedCount: rows.length,
            hasMore: start - 1 + rows.length < totalCount
        };
    } catch (error) {
        return {
            success: false, data: [], totalCount: 0, returnedCount: 0, hasMore: false,
            errorCode: error.expenseContractCode || "EXPENSE_CONTRACT_READ_FAILED",
            message: String(error.message || error)
        };
    } finally {
        expenseContractClose(contractFile);
        expenseContractClose(countFile);
    }
}

/** Đọc một HĐ theo ID nội bộ, áp dụng cùng điều kiện và quyền với danh sách. */
function getExpenseXdcbContract(input) {
    try {
        var params = expenseContractParams(input);
        if (!expenseContractText(params.contractId)) {
            throw expenseContractError("MISSING_CONTRACT_ID", "Thiếu khóa HĐ XDCB.");
        }
        params.start = 1;
        params.count = 1;
        var result = listExpenseXdcbContracts({ details: params });
        if (!result.success) return {
            success: false, data: null, errorCode: result.errorCode, message: result.message
        };
        if (!result.data.length) {
            throw expenseContractError("CONTRACT_NOT_AVAILABLE", "Không tìm thấy HĐ XDCB đủ điều kiện trong phạm vi được xem.");
        }
        return { success: true, data: result.data[0] };
    } catch (error) {
        return {
            success: false, data: null,
            errorCode: error.expenseContractCode || "EXPENSE_CONTRACT_READ_FAILED",
            message: String(error.message || error)
        };
    }
}

/** Áp dụng phạm vi HĐ như S2, ánh xạ executor.id/unit.lv1 sang field S4. */
function expenseContractScope(currentUser, paymentId) {
    var actor = expenseContractText(currentUser);
    if (!actor) throw expenseContractError("MISSING_ACTOR", "Không xác định được người thực hiện.");
    var contact = null;
    var contactId;
    var unitLv1;
    try {
        contact = new SCFile("contacts", SCFILE_READONLY);
        contact.setFields(["contact.name", "lv1.id"]);
        var rc = contact.doSelect('contact.name="' + expenseContractQuote(actor) + '"');
        if (rc === RC_NO_MORE) {
            rc = contact.doSelect('tolower(contact.name)="' + expenseContractQuote(actor.toLowerCase()) + '"');
        }
        if (rc !== RC_SUCCESS) throw expenseContractError("ACTOR_LOOKUP_FAILED", "Không xác định được hồ sơ người thực hiện.");
        contactId = expenseContractText(contact["contact.name"]);
        unitLv1 = expenseContractText(contact["lv1.id"]);
        if (!contactId || contact.getNext() !== RC_NO_MORE) {
            throw expenseContractError("ACTOR_LOOKUP_FAILED", "Không xác định được duy nhất hồ sơ người thực hiện.");
        }
    } finally {
        expenseContractClose(contact);
    }
    var rights = expenseContractArray(lib.ESD_PERMS_RIGHTS.permsRight(contactId));
    if (rights.indexOf("0040040004000001") < 0) {
        throw expenseContractError("EXPENSE_VIEW_DENIED", "Không có quyền xem dữ liệu Dự chi.");
    }
    var permission = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(contactId, "00401") || {};
    var scope = expenseContractText(permission.scope || permission.dataScopeList || permission["permission.scope"]) || "QT_PQDL_01";
    if (!unitLv1 && scope !== "QT_PQDL_06") {
        throw expenseContractError("CONTRACT_SCOPE_EMPTY", "Hồ sơ người thực hiện chưa có đơn vị cấp 1 để kiểm tra phạm vi HĐ XDCB.");
    }
    var conditions = [];
    var role = expenseContractSelectionRole(paymentId);
    if (role === "dmms") {
        conditions.push('responsible.officer="' + expenseContractQuote(contactId) + '"');
    }
    if (scope === "QT_PQDL_06") return conditions.length ? conditions.join(" and ") : "true";
    if (scope === "QT_PQDL_04" && unitLv1.indexOf("0999") === 0) {
        var entity = null;
        try {
            entity = new SCFile("esdDMentity", SCFILE_READONLY);
            var entityRc = entity.doSelect('ps.code="' + expenseContractQuote(unitLv1) +
                    '" and status="ACTIVE" and entity.code="1010098"');
            if (entityRc !== RC_SUCCESS && entityRc !== RC_NO_MORE) {
                throw expenseContractError("CONTRACT_SCOPE_QUERY_FAILED", "Không kiểm tra được mapping entity của đơn vị hội sở.");
            }
            // Giữ nhánh hội sở S2: có mapping lấy 0999*, không có mapping không lọc đơn vị.
            conditions.push(entityRc === RC_SUCCESS ? 'unit.level1 like "0999*"' : '1=1');
        } finally { expenseContractClose(entity); }
    } else {
        // S2 dùng LV1 của hồ sơ đăng nhập cho các scope còn lại, không dùng danh sách unit từ client.
        conditions.push('unit.level1="' + expenseContractQuote(unitLv1) + '"');
    }
    return conditions.join(" and ");
}

/** Lấy vai trò từ phiếu như S2; các entrypoint hiện có vẫn kiểm tra quyền thao tác/phase. */
function expenseContractSelectionRole(paymentId) {
    var id = expenseContractText(paymentId);
    if (!id) return ""; // API chỉ đọc không gắn phiếu vẫn áp phạm vi LV1/quyền xem ở trên.
    var payment = null;
    try {
        payment = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        payment.setFields(["id", "transaction.type", "original.contract.category", "current.phase",
            "initial.role"]);
        if (id.indexOf("DC.") !== 0 || payment.doSelect('id="' + expenseContractQuote(id) + '"') !== RC_SUCCESS ||
                expenseContractText(payment["transaction.type"]) !== "Dự chi" ||
                expenseContractText(payment["original.contract.category"]).toUpperCase() !== "XDCB") {
            throw expenseContractError("INVALID_EXPENSE", "Không tìm thấy phiếu Dự chi XDCB hợp lệ.");
        }
        var phase = expenseContractText(payment["current.phase"]);
        var role = expenseContractText(payment["initial.role"]).toLowerCase();
        return phase === "initial_kttc" ? "kttc" : role;
    } finally { expenseContractClose(payment); }
}

/** Dùng ID S4 làm mã HĐ; trả phân loại và NCC trên HĐ để resolver chọn đúng nguồn NCC. */
function expenseContractRow(record) {
    var repairId = expenseContractText(record["repair.id"]);
    return {
        id: expenseContractText(record["id"]),
        contractCode: expenseContractText(record["id"]),
        name: expenseContractText(record["contract.name"]),
        contractAmount: Number(record["contract.amount"] || 0),
        currency: expenseContractText(record["currency"]),
        signedDate: expenseContractDate(record["signed.date"]),
        effectiveDate: expenseContractDate(record["effective.date"]),
        expireDate: expenseContractDate(record["expire.date"]),
        status: expenseContractText(record["status"]),
        responsibleOfficer: expenseContractText(record["responsible.officer"]),
        projectType: repairId ? "REPAIR" : "CONSTRUCTION",
        repairId: repairId,
        constructionId: expenseContractText(record["construction.id"]),
        budgetType: expenseContractText(record["type.budget"]),
        vendorName: expenseContractText(record["vendor.name"]),
        vendorTaxCode: expenseContractText(record["tax.code"]),
        vendorAddress: expenseContractText(record["vendor.address"]),
        tenderPackageId: expenseContractText(record["tender.package.id"]),
        source: "S4"
    };
}

/** Đọc payload object/JSON dùng chung cho các entrypoint HĐ Dự chi. */
function expenseContractParams(input) {
    var value = input ? (input.details || input.queryString || input) : {};
    try {
        if (typeof value === "string") value = JSON.parse(value);
        if (value instanceof Array) value = value[0];
        if (!value || typeof value !== "object") throw new Error("Invalid input");
        return value;
    } catch (error) {
        throw expenseContractError("INVALID_INPUT", "Dữ liệu đọc HĐ XDCB không hợp lệ.");
    }
}

/** Giữ mã định danh dạng text, gồm cả số 0 đầu. */
function expenseContractText(value) {
    return value == null ? "" : String(value).replace(/^\s+|\s+$/g, "");
}

/** Escape giá trị trước khi ghép vào query SM. */
function expenseContractQuote(value) {
    return expenseContractText(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Chỉ nhận số nguyên dương cho start/count. */
function expenseContractPageNumber(value, fallback) {
    if (value == null || value === "") return fallback;
    var number = Number(value);
    if (!isFinite(number) || number < 1 || number > 9007199254740991 || Math.floor(number) !== number) {
        throw expenseContractError("INVALID_PAGINATION", "Thông tin phân trang HĐ XDCB không hợp lệ.");
    }
    return number;
}

/** Kiểm tra ngày lọc có đúng định dạng và tồn tại trên lịch. */
function expenseContractDateFilter(value) {
    var text = expenseContractText(value);
    if (!text) return "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
        throw expenseContractError("INVALID_DATE", "Ngày hiệu lực cần có định dạng YYYY-MM-DD.");
    }
    var parts = text.split("-");
    var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
    if (date.getUTCFullYear() !== Number(parts[0]) || date.getUTCMonth() !== Number(parts[1]) - 1 || date.getUTCDate() !== Number(parts[2])) {
        throw expenseContractError("INVALID_DATE", "Ngày hiệu lực không hợp lệ.");
    }
    return text;
}

/** Chuẩn hóa ngày SM thành giá trị trả về API. */
function expenseContractDate(value) {
    return value && value.toISOString ? value.toISOString() : expenseContractText(value);
}

/** Lấy đầu ngày kế tiếp để bộ lọc bao gồm toàn bộ ngày kết thúc. */
function expenseContractNextDate(value) {
    var parts = value.split("-");
    var date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + 1));
    return date.toISOString().substring(0, 10);
}

/** Chuẩn hóa danh sách quyền/đơn vị và bỏ giá trị trùng. */
function expenseContractArray(value) {
    var values = value && value.toArray ? value.toArray() : value;
    if (typeof values === "string") values = [values];
    var result = [];
    for (var i = 0; values && i < values.length; i++) {
        var item = expenseContractText(values[i]);
        if (item && result.indexOf(item) < 0) result.push(item);
    }
    return result;
}

/** Gắn mã lỗi nghiệp vụ để caller phân biệt lỗi dữ liệu và quyền. */
function expenseContractError(code, message) {
    var error = new Error(message);
    error.expenseContractCode = code;
    return error;
}

/** Giải phóng SCFile kể cả khi truy vấn thất bại. */
function expenseContractClose(file) {
    try { if (file) file.doClose(); } catch (closeError) {}
}
