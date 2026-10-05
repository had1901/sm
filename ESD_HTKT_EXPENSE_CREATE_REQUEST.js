/**
 * ScriptLibrary : ESD_HTKT_EXPENSE_CREATE_REQUEST
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị dự chi
 * Version      : 1.0.0
 * Chức năng:
 * - Khởi tạo và lưu thông tin phiếu đề nghị dự chi mới vào bảng esdHTKTpayment (transaction.type = "Dự chi").
 * - Tự động sinh mã phiếu định dạng DC.<branchCode>.<year>.<sequence> từ bộ đếm esdHTKTexpense.
 * - Khởi tạo trạng thái và phân quyền theo cấp đơn vị/vai trò của người lập (KTTC / DMMS).
 * - Tra cứu và phân trang danh sách các phiếu đề nghị dự chi (getList).
 * -----------------------------------------------------------------------------
 */

var createActivity = lib.ESD_Utils.createActivity;

/**
 * Khởi tạo phiếu đề nghị dự chi mới
 * @param {SCFile|object} input
 * @returns {object} { success: boolean, message: string, id?: string }
 */
function createExpenseRequest(input) {
    try {
        var rawData = input ? (input.queryString || input.details) : null;
        if (!rawData) return { success: false, message: "Thiếu dữ liệu đầu vào." };

        var expenseData = {};
        if (typeof rawData === "string") {
            try {
                var parsed = JSON.parse(rawData);
                expenseData = Array.isArray(parsed) ? (parsed[0] || {}) : (parsed || {});
            } catch (eJson) {
                return { success: false, message: "Dữ liệu JSON đầu vào không hợp lệ: " + eJson.toString() };
            }
        } else if (typeof rawData === "object") {
            expenseData = Array.isArray(rawData) ? (rawData[0] || {}) : rawData;
        }

        /*
         * Xác định người dùng hiện tại
         */
        var currentUser = htktCreateExpense_resolveCurrentUser(expenseData);
        if (!currentUser) {
            return {
                success: false,
                message: "Không xác định được người tạo phiếu dự chi."
            };
        }

        expenseData["currentUser"] = currentUser;
        expenseData["user"] = currentUser;
        expenseData["createdBy"] = currentUser;

        var rawDepartment = expenseData['unitLv1'] || expenseData['unitLv2'] || expenseData['unitLv3'] || expenseData['department'] || "";

        var entityInfo = null;
        try {
            if (lib.ESD_HTKT_ACCOUNTING_UTILS && lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity) {
                entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(rawDepartment);
            }
        } catch (eEntity) {
            entityInfo = null;
        }

        // Lấy giá trị oglBranchCode từ Object trả về
        var oglBranchCode = (entityInfo && entityInfo.oglBranchCode) ? String(entityInfo.oglBranchCode).replace(/^0+/, '') : '';
        if (!oglBranchCode && rawDepartment) {
            oglBranchCode = getOglBranchCodeByDepartment(rawDepartment);
        }

        var branchCode = oglBranchCode || "100";
        var docType = "DC";

        // Bảng lưu trữ vẫn là esdHTKTpayment
        var expenseRec = new SCFile("esdHTKTpayment");

        // Sinh mã phiếu DC.xxx.yy.zzzzzzz từ sequential number esdHTKTexpense
        var newExpenseId = generateDocumentCode(docType, branchCode);

        // Map dữ liệu vào record
        mapExpenseRecord(expenseRec, expenseData, newExpenseId);

        var returnCode;
        var previousSkipAutoPaymentActivity = htktCreateExpense_normalizeValue(
                vars["$L.skipAutoPaymentActivity"]
        );

        try {
            vars["$L.skipAutoPaymentActivity"] = "true";
            returnCode = expenseRec.doAction("add");
        } finally {
            // Khôi phục giá trị cũ để không ảnh hưởng các xử lý tiếp theo
            vars["$L.skipAutoPaymentActivity"] = previousSkipAutoPaymentActivity;
        }

        if (returnCode == RC_SUCCESS) {
            // Lưu lịch sử với operator là user thật
            createActivity(
                    "activityHTKTpayment",
                    'Thêm mới Đề nghị Dự chi: Mã đề nghị: "' +
                    expenseRec["id"] +
                    '"',
                    expenseRec["id"],
                    "Thêm mới",
                    currentUser
            );

            return {
                success: true,
                message: "Thêm đề nghị dự chi thành công.",
                id: expenseRec['id']
            };
        } else {
            return {
                success: false,
                message: "Lỗi ghi nhận vào Database esdHTKTpayment. Code: " + returnCode + " reason " + (expenseRec.getMessages ? expenseRec.getMessages() : "")
            };
        }

    } catch (error) {
        return { success: false, message: "Lỗi thực thi createExpenseRequest: " + error.toString() };
    }
}

/**
 * Map các thông tin vào SCFile esdHTKTpayment cho đề nghị dự chi
 */
function mapExpenseRecord(expenseRec, expenseData, expenseId) {
    expenseRec['id'] = expenseId;

    // Thiết lập loại giao dịch là "Dự chi"
    expenseRec['transaction.type'] = "Dự chi";
    expenseRec['department'] =
            expenseData['unitLv3'] ||
            expenseData['unitLv2'] ||
            expenseData['unitLv1'] ||
            expenseData['department'] ||
            "";

    expenseRec['description'] = expenseData['description'] || "";

    expenseRec['require.check.level1'] = false;
    expenseRec['require.check.level2'] = false;
    expenseRec['user.checker.kttc'] = "";
    expenseRec['user.checker.dmms'] = "";
    expenseRec['user.approver.dmms'] = "";
    expenseRec['user.approver.kttc'] = "";
    expenseRec['user.checker.final'] = "";
    expenseRec['user.approver.final'] = "";
    expenseRec['return.reason'] = "";
    expenseRec['unit.lv1'] = expenseData['unitLv1'] || expenseData['unit.lv1'] || "";
    expenseRec['unit.lv2'] = expenseData['unitLv2'] || expenseData['unit.lv2'] || "";

    expenseRec['created.at'] = new Date();
    expenseRec['created.by'] = expenseData['createdBy'] || expenseData['currentUser'];
    expenseRec['currency'] = expenseData['currency'] || "VND";
    expenseRec['total.contract.amount'] = Number(expenseData['totalAmount'] || expenseData['totalValue'] || expenseData['total.amount'] || expenseData['total.contract.amount'] || 0);

    // Không tạo kèm hợp đồng hay khoản mua sắm
    expenseRec['contract.id'] = "";
    expenseRec['contract.name'] = "";

    expenseRec['current.phase'] = "start";
    expenseRec['executor.payment'] = expenseData['currentUser'];

    var creatorUser = htktCreateExpense_resolveCurrentUser(expenseData);
    if (!creatorUser) {
        throw new Error("Không xác định được người tạo phiếu dự chi.");
    }

    // TODO: Tạm thời bỏ qua phân quyền người tạo phiếu dự chi.
    // Uncomment lại khối code bên dưới khi cần kích hoạt phân quyền kiểm tra vai trò khởi tạo (KTTC/DMMS).
    /*
    var initialRole = htktCreateExpense_detectInitialRoleByRights(creatorUser);

    if (initialRole === "kttc") {
        expenseRec['status'] = "kttc_created";
        expenseRec['initial.role'] = "kttc";
    } else if (initialRole === "dmms") {
        expenseRec['status'] = "dmms_created";
        expenseRec['initial.role'] = "dmms";
    } else {
        throw new Error(
                "Người tạo " +
                creatorUser +
                " chưa có quyền phù hợp để lập phiếu dự chi. Cần quyền lập đề nghị thanh toán/dự chi; nếu là KTTC cần thêm quyền nhập liệu hạch toán."
        );
    }
    */

    // Mặc định tạm thời khi bỏ qua phân quyền:
    var initialRole = "dmms";
    try {
        var detectedRole = htktCreateExpense_detectInitialRoleByRights(creatorUser);
        if (detectedRole) {
            initialRole = detectedRole;
        }
    } catch (eRole) {}

    expenseRec['initial.role'] = initialRole;
    expenseRec['status'] = (initialRole === "kttc") ? "kttc_created" : "dmms_created";
}

/**
 * Sinh mã phiếu định dạng DC.<branchCode>.<year>.<sequence> từ sequential number esdHTKTexpense
 */
function generateDocumentCode(docType, branchCode) {
    docType = docType || "DC";
    branchCode = branchCode || "100";

    var fullYear = new Date().getFullYear();
    var year = ("0" + (fullYear % 100)).slice(-2);

    // Lấy số từ sequential number esdHTKTexpense
    var numberClass = "esdHTKTexpense";
    var numberRc = new SCDatum();
    numberRc.setValue(-1);
    var nextNumber = new SCDatum();
    system.functions.rtecall(
            "getnumber", numberRc, nextNumber, numberClass
    );

    var rcText = String(numberRc.getText()).replace(/^\s+|\s+$/g, "");
    var rawNumber = String(nextNumber.getText()).replace(/^\s+|\s+$/g, "");

    if (/^"[^"]*"$/.test(rawNumber) || /^'[^']*'$/.test(rawNumber)) {
        rawNumber = rawNumber.substring(1, rawNumber.length - 1);
    }

    if (rawNumber.indexOf(docType) === 0) {
        rawNumber = rawNumber.substring(docType.length);
    }

    if (rcText !== "0" || !/^\d+$/.test(rawNumber)) {
        throw new Error("Không cấp được số phiếu từ Sequential Numbers: " +
                numberClass + ". Kiểm tra bộ đếm hiện có, Prefix " + docType + ", Suffix trống, " +
                "Increment=1 và không Decrement. rc=" + rcText +
                ", number=" + rawNumber);
    }
    var sequence = Number(rawNumber);
    if (sequence < 1 || sequence > 9999999) {
        throw new Error("Số phiếu ngoài phạm vi 0000001..9999999: " + rawNumber);
    }
    var expenseId = docType + "." + branchCode + "." + year + "." +
            ("0000000" + sequence).slice(-7);

    // Kiểm tra tính duy nhất trong bảng esdHTKTpayment
    var existing = new SCFile("esdHTKTpayment", SCFILE_READONLY);
    try {
        var rc = existing.doSelect('id="' + escapeSmQueryValue(expenseId) + '"');
        if (rc === RC_SUCCESS) {
            throw new Error("Bộ đếm " + numberClass + " cấp mã đã tồn tại: " +
                    expenseId + ". Dừng tạo phiếu và đồng bộ bộ đếm với dữ liệu hiện có.");
        }
        if (rc !== RC_NO_MORE) {
            throw new Error("Không kiểm tra được mã phiếu " + expenseId + ". Code: " + rc);
        }
    } finally {
        closeSCFile(existing);
    }
    return expenseId;
}

/**
 * Tra cứu và phân trang danh sách các phiếu đề nghị dự chi từ bảng esdHTKTpayment
 * @param {SCFile|object} input
 * @returns {object}
 */
function getList(input) {
    var rawData = input ? (input.details || input.queryString) : null;
    var params = {};

    if (rawData) {
        if (typeof rawData === "string") {
            try {
                params = JSON.parse(rawData);
                if (Array.isArray(params)) {
                    params = params[0] || {};
                }
            } catch (e) {
                params = {};
            }
        } else if (typeof rawData === "object") {
            params = Array.isArray(rawData) ? (rawData[0] || {}) : rawData;
        }
    } else if (input && typeof input === "object") {
        params = input;
    }

    var currentUser = htktCreateExpense_resolveCurrentUser(params);

    // Phân trang
    var start = parseInt(params.start, 10);
    var count = parseInt(params.count, 10);
    start = isNaN(start) || start < 1 ? 1 : start;
    count = isNaN(count) || count < 1 ? 10 : count;

    var fieldMappings = [
        ['id', 'id', 'S'],
        ['status', 'status', 'S'],
        ['current.phase', 'current.phase', 'S'],
        ['created.by', 'created.by', 'S'],
        ['created.at', 'created.at', 'D'],
        ['sysmodtime', 'sysmodtime', 'D'],
        ['sysmoduser', 'sysmoduser', 'S'],
        ['transaction.type', 'transaction.type', 'S'],
        ['unit.lv1', 'unit.lv1', 'S'],
        ['unit.lv2', 'unit.lv2', 'S'],
        ['department', 'department', 'S'],
        ['description', 'description', 'S'],
        ['currency', 'currency', 'S'],
        ['total.contract.amount', 'total.contract.amount', 'N'],
        ['total.amount.paid', 'total.amount.paid', 'N'],
        ['executor.payment', 'executor.payment', 'S'],
        ['initial.role', 'initial.role', 'S'],
        ['user.checker.kttc', 'user.checker.kttc', 'S'],
        ['user.checker.dmms', 'user.checker.dmms', 'S'],
        ['user.approver.dmms', 'user.approver.dmms', 'S'],
        ['user.approver.kttc', 'user.approver.kttc', 'S'],
        ['user.checker.final', 'user.checker.final', 'S'],
        ['user.approver.final', 'user.approver.final', 'S']
    ];

    // Điều kiện lọc WHERE: chỉ lấy các bản ghi dự chi
    var conditions = ['(transaction.type="Dự chi" or id like "DC.*")'];

    if (params.id) {
        conditions.push('id="' + escapeSmQueryValue(params.id) + '"');
    }

    if (params.keyword) {
        var keywordFilter = String(params.keyword).trim().toLowerCase();
        conditions.push('(tolower(id) like "*' + escapeSmQueryValue(keywordFilter) + '*" or tolower(description) like "*' + escapeSmQueryValue(keywordFilter) + '*")');
    }

    if (params.status) {
        conditions.push('status="' + escapeSmQueryValue(params.status) + '"');
    }

    if (params.currentPhase || params["current.phase"]) {
        var phase = params.currentPhase || params["current.phase"];
        conditions.push('current.phase="' + escapeSmQueryValue(phase) + '"');
    }

    if (params.createdBy || params["created.by"]) {
        var createdBy = params.createdBy || params["created.by"];
        conditions.push('created.by="' + escapeSmQueryValue(createdBy) + '"');
    }

    if (params.createdAtFrom) {
        conditions.push('created.at >= "' + escapeSmQueryValue(params.createdAtFrom) + '"');
    }
    if (params.createdAtTo) {
        conditions.push('created.at <= "' + escapeSmQueryValue(params.createdAtTo) + '"');
    }

    // Lọc theo đơn vị nếu có
    var unitLv1Param = params.unitLv1 || params["unit.lv1"];
    if (unitLv1Param) {
        var cleanUnitLv1 = String(unitLv1Param).trim();
        if (cleanUnitLv1.indexOf("0999") === 0) {
            conditions.push('unit.lv1 like "0999*"');
        } else {
            conditions.push('unit.lv1="' + escapeSmQueryValue(cleanUnitLv1) + '"');
        }
    }

    var role = params.initialRole || params.role;
    if (role) {
        role = String(role).trim().toLowerCase();
        if (role === "dmms" && currentUser) {
            conditions.push('executor.payment="' + escapeSmQueryValue(currentUser) + '"');
        }
    }

    var whereClause = conditions.join(" and ");

    var sqlFields = fieldMappings.map(function(item) {
        return item[0];
    });

    // Đếm tổng số bản ghi
    var totalCount = 0;
    var countFile = new SCFile('esdHTKTpayment', SCFILE_READONLY);
    try {
        totalCount = countFile.doCount(whereClause);
    } finally {
        closeSCFile(countFile);
    }

    var dataArray = [];
    var f = new SCFile('esdHTKTpayment', SCFILE_READONLY);

    try {
        f.setFields(sqlFields);

        // Sắp xếp
        var sortFieldMap = {
            "id": "id",
            "created.at": "created.at",
            "status": "status",
            "total.contract.amount": "total.contract.amount"
        };
        var smSortField = sortFieldMap[String(params.sortField || "created.at")];
        if (smSortField) {
            var sortSequence = parseInt(params.sortOrder, 10) === 1 ? SCFILE_ASC : SCFILE_DSC;
            var sortFields = [smSortField];
            var sortSequences = [sortSequence];

            if (smSortField !== "id") {
                sortFields.push("id");
                sortSequences.push(SCFILE_DSC);
            }
            f.setOrderBy(sortFields, sortSequences);
        }

        var rc = f.doSelectEx(whereClause, start, count);

        while (rc == RC_SUCCESS) {
            var itemData = mapRowToObject(f, fieldMappings);
            dataArray.push(itemData);
            rc = f.getNext();
        }
    } catch (e) {
        return {
            success: false,
            message: "Lỗi lấy danh sách đề nghị dự chi: " + e.toString()
        };
    } finally {
        closeSCFile(f);
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

/* =========================================================
 * CÁC HÀM TIỆN ÍCH & XÁC THỰC QUYỀN
 * ========================================================= */

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

function htktCreateExpense_detectInitialRoleByRights(contactId) {
    var RIGHT_VIEW_INVOICE = "0040040003000001";
    var RIGHT_VIEW_PAYMENT = "0040040003000001";
    var RIGHT_CREATE_PAYMENT = "0040040003000002";
    var RIGHT_ACCOUNTING_INPUT = "0040040003000003";

    var rights = htktCreateExpense_getRights(contactId);

    if (
            htktCreateExpense_hasAllRights(rights, [
                RIGHT_VIEW_INVOICE,
                RIGHT_VIEW_PAYMENT,
                RIGHT_CREATE_PAYMENT,
                RIGHT_ACCOUNTING_INPUT
            ])
    ) {
        return "kttc";
    }

    if (
            htktCreateExpense_hasAllRights(rights, [
                RIGHT_VIEW_INVOICE,
                RIGHT_VIEW_PAYMENT,
                RIGHT_CREATE_PAYMENT
            ])
    ) {
        return "dmms";
    }

    return "";
}

function htktCreateExpense_getRights(contactId) {
    try {
        return htktCreateExpense_normalizeArray(
                lib.ESD_PERMS_RIGHTS.permsRight(contactId) || []
        );
    } catch (e) {
        return [];
    }
}

function htktCreateExpense_hasAllRights(userRights, requiredRights) {
    userRights = htktCreateExpense_normalizeArray(userRights);
    requiredRights = htktCreateExpense_normalizeArray(requiredRights);

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

function htktCreateExpense_resolveCurrentUser(source) {
    source = source || {};

    return htktCreateExpense_normalizeValue(
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
            (vars && vars['$lo.contact.name']) ||
            (system && system.user ? system.user.name : "") ||
            ""
    );
}

function htktCreateExpense_normalizeValue(value) {
    return String(value == null ? "" : value).trim();
}

function htktCreateExpense_normalizeArray(source) {
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
        var value = htktCreateExpense_normalizeValue(array[i]);

        if (value && !seen[value]) {
            seen[value] = true;
            result.push(value);
        }
    }

    return result;
}

function htktCreateExpense_getVar(name) {
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
        // ignore
    } finally {
        closeSCFile(entityFile);
    }

    return "";
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