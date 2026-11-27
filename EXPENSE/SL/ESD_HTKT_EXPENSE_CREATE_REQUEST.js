/**
 * ScriptLibrary : ESD_HTKT_EXPENSE_CREATE_REQUEST
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị dự chi
 * Version      : 1.0.0
 * Chức năng:
 * - Khởi tạo và lưu phiếu đề nghị dự chi vào bảng dùng chung esdHTKTpayment.
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
    var timingStart = new Date().getTime();
    var timingRights = 0;
    var timingEntity = 0;
    var timingUnits = 0;
    var timingGetNumber = 0;
    var timingAdd = 0;
    var timingXdcb = 0;
    var timingActivity = 0;
    var timingDashboard = 0;
    var createdExpenseId = "";
    var expenseRec = null;

    try {
        var rawData = input.queryString;
        if (!rawData) return { success: false, message: "Thiếu dữ liệu." };

        var expenseList = JSON.parse(rawData);
        var expenseData = Array.isArray(expenseList) ? expenseList[0] : expenseList;

        if (!expenseData) {
            return { success: false, message: "Thiếu dữ liệu dự chi." };
        }

        var contractCategory = String(expenseData.contractCategory || "HHDV").trim().toUpperCase();
        if (contractCategory !== "HHDV" && contractCategory !== "XDCB") {
            return { success: false, message: "Hạng mục Dự chi không hợp lệ." };
        }
        expenseData.contractCategory = contractCategory;

        var currentUser = String(expenseData['currentUser'] || "").replace(/^\s+|\s+$/g, "");
        if (!currentUser) {
            return {
                success: false,
                message: "Không xác định được người tạo phiếu dự chi."
            };
        }

        expenseData["currentUser"] = currentUser;
        expenseData["createdBy"] = currentUser;

        // Kiểm tra quyền tạo phiếu TRƯỚC khi lấy bộ đếm getnumber để không tiêu tốn số
        // và không giữ khóa bộ đếm nếu người dùng chưa đủ quyền.
        var initialRole = htktCreateExpense_detectInitialRoleByRights(currentUser);
        timingRights = new Date().getTime();
        if (initialRole !== "kttc" && initialRole !== "dmms") {
            throw new Error(
                "Người tạo " +
                currentUser +
                " chưa có quyền phù hợp để lập phiếu dự chi. Cần quyền lập đề nghị dự chi; nếu là KTTC cần thêm quyền nhập liệu hạch toán."
            );
        }

        var rawDepartment = htktCreateExpense_normalizeValue(
            expenseData['unitLv1'] || expenseData['unit.lv1'] || expenseData['unitLv2'] || expenseData['unitLv3']
        );
        var entityInfo = rawDepartment ? lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(rawDepartment) : null;
        var unitLv1 = htktCreateExpense_normalizeValue(expenseData['unitLv1'] || expenseData['unit.lv1']);
        var unitLv1EntityInfo = unitLv1 === rawDepartment
            ? entityInfo
            : (unitLv1 ? lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(unitLv1) : null);
        timingEntity = new Date().getTime();

        var unitLv2 = htktCreateExpense_normalizeValue(expenseData['unitLv2'] || expenseData['unit.lv2']);
        var needLv1Name = !(expenseData['unitLv1Name'] || expenseData['unit.lv1.name']) && !!unitLv1;
        var needLv2Name = !(expenseData['unitLv2Name'] || expenseData['unit.lv2.name']) && !!unitLv2;
        var unitNameMap = {};
        if (needLv1Name || needLv2Name) {
            var lookupUnitIds = [];
            if (needLv1Name) lookupUnitIds.push(unitLv1);
            if (needLv2Name && unitLv2 !== unitLv1) lookupUnitIds.push(unitLv2);
            unitNameMap = htktCreateExpense_getUnitNames(lookupUnitIds);
        }
        timingUnits = new Date().getTime();

        var oglBranchCode = (entityInfo && entityInfo.oglBranchCode) ? String(entityInfo.oglBranchCode).replace(/^0+/, '') : '';
        var branchCode = oglBranchCode || "100";
        var docType = "DC";

        var newExpenseId = generateDocumentCode(docType, branchCode);
        timingGetNumber = new Date().getTime();

        expenseRec = new SCFile("esdHTKTpayment");
        mapExpenseRecord(expenseRec, expenseData, newExpenseId, {
            initialRole: initialRole,
            entityInfo: unitLv1EntityInfo,
            unitNameMap: unitNameMap
        });

        var returnCode;
        var previousSkipAutoExpenseActivity = htktCreateExpense_normalizeValue(
            vars["$L.skipAutoExpenseActivity"]
        );

        try {
            vars["$L.skipAutoExpenseActivity"] = "true";
            returnCode = expenseRec.doAction("add");
        } finally {
            vars["$L.skipAutoExpenseActivity"] = previousSkipAutoExpenseActivity;
        }
        timingAdd = new Date().getTime();

        if (returnCode == RC_SUCCESS) {
            createdExpenseId = String(expenseRec['id'] || newExpenseId || "");

            // DC tạo trước HĐ/NCC: điểm nối tự bỏ qua khi chưa có HS, không gửi phiếu XDCB sang S2.
            // Tiền thực tế và tiến độ chỉ gửi khi Đã hạch toán; không gọi hàm hoàn tất tại lúc tạo phiếu trống.
            if (contractCategory === "XDCB") {
                try {
                    lib.ESD_HTKT_PAYMENT_VENDOR.syncXdcbCreatedToSquad4(expenseRec);
                } catch (squadError) {
                    print("Phiếu đã tạo; chưa đồng bộ S4: " + String(squadError.message || squadError));
                }
            }
            timingXdcb = new Date().getTime();

            // Giữ nguyên cơ chế getnumber("activityHTKTpayment") nhưng bỏ ghi file đĩa C:/LOG/SM_LOG.txt
            // trong ESD_Utils.createActivity để tránh tranh chấp I/O khi nhiều user tạo phiếu đồng thời.
            htktCreateExpense_createActivity(
                "activityHTKTpayment",
                'Thêm mới Đề nghị Dự chi: Mã đề nghị: "' +
                createdExpenseId +
                '"',
                createdExpenseId,
                "Thêm mới",
                currentUser
            );
            timingActivity = new Date().getTime();

            // =================================================================
            // ĐỒNG BỘ DASHBOARD CHO PHIẾU DỰ CHI VỪA TẠO MỚI
            // =================================================================
            try {
                lib.ESD_HTKT_DASHBOARD_SET_DATA.setDataDashboard(expenseRec, null, "esdHTKTpayment");
            } catch (errDash) {
                // Ghi log cảnh báo để không làm gián đoạn luồng trả kết quả tạo phiếu
                print("Lỗi đồng bộ Dashboard khi tạo Dự chi: " + errDash);
            }
            timingDashboard = new Date().getTime();

            return {
                success: true,
                message: "Thêm đề nghị dự chi thành công.",
                id: createdExpenseId
            };
        } else {
            return {
                success: false,
                message: "Lỗi ghi nhận phiếu Dự chi vào Database esdHTKTpayment. Code: " + returnCode + " reason " + expenseRec.getMessages()
            };
        }

    } catch (error) {
        return { success: false, message: "Lỗi thực thi createExpenseRequest: " + error.toString() };
    } finally {
        try {
            var timingEnd = new Date().getTime();
            print(
                "[EXP_CREATE][TIMING] id=" + createdExpenseId +
                " rights=" + (timingRights ? timingRights - timingStart : -1) +
                " entity=" + (timingRights && timingEntity ? timingEntity - timingRights : -1) +
                " units=" + (timingEntity && timingUnits ? timingUnits - timingEntity : -1) +
                " getnumber=" + (timingUnits && timingGetNumber ? timingGetNumber - timingUnits : -1) +
                " add=" + (timingGetNumber && timingAdd ? timingAdd - timingGetNumber : -1) +
                " xdcb=" + (timingAdd && timingXdcb ? timingXdcb - timingAdd : -1) +
                " activity=" + (timingXdcb && timingActivity ? timingActivity - timingXdcb : -1) +
                " dashboard=" + (timingActivity && timingDashboard ? timingDashboard - timingActivity : -1) +
                " total=" + (timingEnd - timingStart) + "ms"
            );
        } catch (timingError) { }
        closeSCFile(expenseRec);
    }
}

/**
 * Map thông tin đề nghị dự chi vào SCFile dùng chung esdHTKTpayment.
 */
function mapExpenseRecord(expenseRec, expenseData, expenseId, preloaded) {
    preloaded = preloaded || {};
    expenseRec['id'] = expenseId;
    expenseRec['transaction.type'] = "Dự chi";
    expenseRec['original.contract.category'] = expenseData.contractCategory || "HHDV";

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
    var unitLv1 = String(expenseRec['unit.lv1'] || "").replace(/^\s+|\s+$/g, "");
    var unitLv2 = String(expenseRec['unit.lv2'] || "").replace(/^\s+|\s+$/g, "");
    var entityInfo = typeof preloaded.entityInfo !== "undefined"
        ? preloaded.entityInfo
        : (unitLv1 ? lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(unitLv1) : null);
    expenseRec['entity.code'] = entityInfo && entityInfo.entity ? String(entityInfo.entity) : "";

    var unitNameMap = preloaded.unitNameMap;
    expenseRec['unit.lv1.name'] = expenseData['unitLv1Name'] || expenseData['unit.lv1.name'] ||
        (unitNameMap && unitLv1 && unitNameMap.hasOwnProperty(unitLv1)
            ? unitNameMap[unitLv1]
            : htktCreateExpense_getUnitName(unitLv1));
    expenseRec['unit.lv2.name'] = expenseData['unitLv2Name'] || expenseData['unit.lv2.name'] ||
        (unitNameMap && unitLv2 && unitNameMap.hasOwnProperty(unitLv2)
            ? unitNameMap[unitLv2]
            : htktCreateExpense_getUnitName(unitLv2));

    expenseRec['created.at'] = new Date();
    expenseRec['created.by'] = expenseData['createdBy'];
    expenseRec['total.transaction'] = 0;
    expenseRec['total.contract'] = 0;
    expenseRec['total.amount.paid'] = 0;
    expenseRec['total.contract.amount'] = 0;
    expenseRec['current.phase'] = "start";
    expenseRec['currency'] = "VND";
    expenseRec['current.executor'] = expenseData['currentUser'];

    var creatorUser = String(expenseData['currentUser'] || "").replace(/^\s+|\s+$/g, "");
    if (!creatorUser) {
        throw new Error("Không xác định được người tạo phiếu dự chi.");
    }

    var initialRole = preloaded.initialRole || htktCreateExpense_detectInitialRoleByRights(creatorUser);

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
            " chưa có quyền phù hợp để lập phiếu dự chi. Cần quyền lập đề nghị dự chi; nếu là KTTC cần thêm quyền nhập liệu hạch toán."
        );
    }
}

/**
 * Lấy tên nhiều đơn vị trong 1 query esdQTorgUnit duy nhất.
 */
function htktCreateExpense_getUnitNames(unitIds) {
    var result = {};
    var safeIds = htktCreateExpense_normalizeArray(unitIds);
    if (!safeIds.length) return result;

    var conditions = [];
    for (var i = 0; i < safeIds.length; i++) {
        conditions.push('unit.id="' + escapeSmQueryValue(safeIds[i]) + '"');
    }

    var unitFile = null;
    try {
        unitFile = new SCFile("esdQTorgUnit", SCFILE_READONLY);
        unitFile.setFields(["unit.id", "unit.name"]);
        var rc = unitFile.doSelect("(" + conditions.join(" or ") + ")");
        while (rc === RC_SUCCESS) {
            var uid = htktCreateExpense_normalizeValue(unitFile["unit.id"]);
            var uname = htktCreateExpense_normalizeValue(unitFile["unit.name"]);
            if (uid) result[uid] = uname;
            rc = unitFile.getNext();
        }
    } catch (error) {
        return result;
    } finally {
        closeSCFile(unitFile);
    }

    return result;
}

/**
 * Lấy tên đơn vị theo mã để lưu snapshot trên phiếu, tránh phải lookup lại khi tải danh sách.
 */
function htktCreateExpense_getUnitName(unitId) {
    var normalizedUnitId = String(unitId || "").replace(/^\s+|\s+$/g, "");
    if (!normalizedUnitId) return "";
    var map = htktCreateExpense_getUnitNames([normalizedUnitId]);
    return map[normalizedUnitId] || "";
}

/**
 * Ghi bản ghi activity giữ nguyên cơ chế getnumber của SM nhưng không ghi file đĩa SM_LOG.txt.
 */
function htktCreateExpense_createActivity(tableName, description, number, type, user) {
    var safeUser = user || vars["$lo.user.name"] || "";
    var date = system.functions.tod();
    var numberRc = new SCDatum();
    var nextNumberDatum = new SCDatum();
    system.functions.rtecall("getnumber", numberRc, nextNumberDatum, tableName);
    var nextNumber = String(nextNumberDatum.getText() || "").replace(/^\s+|\s+$/g, "");

    var activityFile = null;
    try {
        activityFile = new SCFile(tableName);
        activityFile["thenumber"] = nextNumber;
        activityFile["operator"] = safeUser;
        activityFile["description"] = [description];
        activityFile["number"] = number;
        activityFile["datestamp"] = date;
        activityFile["negdatestamp"] = lib.OctaneUtil.calcNegDate(date);
        activityFile["cust.visible"] = false;
        activityFile["type"] = type;
        return activityFile.doInsert() == RC_SUCCESS;
    } catch (eActivity) {
        print("[EXP_CREATE][ACTIVITY] ERROR: " + String(eActivity && eActivity.message ? eActivity.message : eActivity));
        return false;
    } finally {
        closeSCFile(activityFile);
    }
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

    // Kiểm tra tính duy nhất trong bảng dùng chung esdHTKTpayment.
    var existing = new SCFile("esdHTKTpayment", SCFILE_READONLY);
    try {
        existing.setFields(["id"]);
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

/* =========================================================
 * CÁC HÀM TIỆN ÍCH & XÁC THỰC QUYỀN
 * ========================================================= */

function htktCreateExpense_detectInitialRoleByRights(contactId) {
    var RIGHT_VIEW_EXPENSE = "0040040004000001";
    var RIGHT_CREATE_EXPENSE = "0040040004000002";
    var RIGHT_ACCOUNTING_INPUT = "0040040004000003";

    var rights = htktCreateExpense_getRights(contactId, [
        RIGHT_VIEW_EXPENSE,
        RIGHT_CREATE_EXPENSE,
        RIGHT_ACCOUNTING_INPUT
    ]);

    if (
        htktCreateExpense_hasAllRights(rights, [
            RIGHT_VIEW_EXPENSE,
            RIGHT_CREATE_EXPENSE,
            RIGHT_ACCOUNTING_INPUT
        ])
    ) {
        return "kttc";
    }

    if (
        htktCreateExpense_hasAllRights(rights, [
            RIGHT_VIEW_EXPENSE,
            RIGHT_CREATE_EXPENSE
        ])
    ) {
        return "dmms";
    }

    return "";
}

function htktCreateExpense_getRights(contactId, targetRightIds) {
    var safeContact = htktCreateExpense_normalizeValue(contactId);
    if (!safeContact) return [];

    // Nếu đang chạy đúng phiên SM của chính contact thì đọc thẳng $G.rights (0 DB query).
    try {
        var sessionContact = htktCreateExpense_normalizeValue(
            vars["$lo.contact.name"] ||
            (vars.$lo_operator ? vars.$lo_operator["contact.name"] : "")
        );
        if (sessionContact && sessionContact.toLowerCase() === safeContact.toLowerCase() && vars["$G.rights"]) {
            return htktCreateExpense_normalizeArray(vars["$G.rights"]);
        }
    } catch (eSessionRights) { }

    var safeRights = htktCreateExpense_normalizeArray(targetRightIds);
    if (!safeRights.length) {
        try {
            return htktCreateExpense_normalizeArray(
                lib.ESD_PERMS_RIGHTS.permsRight(safeContact) || []
            );
        } catch (eFallbackRights) {
            return [];
        }
    }

    // Chỉ truy vấn đúng các mã quyền cần thiết thay vì kéo toàn bộ danh sách quyền của user.
    var contactCandidates = htktCreateExpense_normalizeArray([safeContact, safeContact.toUpperCase()]);
    var contactParts = [];
    for (var cIndex = 0; cIndex < contactCandidates.length; cIndex++) {
        contactParts.push('jcpg.contact.id="' + escapeSmQueryValue(contactCandidates[cIndex]) + '"');
    }
    var rightParts = [];
    for (var rIndex = 0; rIndex < safeRights.length; rIndex++) {
        rightParts.push('jrp.rights.id="' + escapeSmQueryValue(safeRights[rIndex]) + '"');
    }

    var sql =
        "SELECT jrp.rights.id AS rightId " +
        "FROM esdjoinRightsPermission jrp " +
        "JOIN esdQTpermissionGroup pg ON (jrp.permission.group.id = pg.id) " +
        "JOIN esdjoinContactsPermissionGroup jcpg ON (jcpg.permission.group.id = pg.id) " +
        'WHERE pg.status = "Dang hoat dong" ' +
        "AND (pg.start.date <= tod() OR pg.start.date = NULL) " +
        "AND (pg.end.date >= tod() OR pg.end.date = NULL) " +
        "AND (jcpg.start.date <= tod() OR jcpg.start.date = NULL) " +
        "AND (jcpg.end.date >= tod() OR jcpg.end.date = NULL) " +
        "AND (" + contactParts.join(" or ") + ") " +
        "AND (" + rightParts.join(" or ") + ")";

    var matched = [];
    var seen = {};
    var rightFile = null;
    try {
        rightFile = new SCFile("esdjoinRightsPermission", SCFILE_READONLY);
        var rc = rightFile.doSelect(sql);
        while (rc === RC_SUCCESS) {
            var rightId = "";
            try { rightId = htktCreateExpense_normalizeValue(rightFile["rightId"]); } catch (e1) { }
            if (!rightId) {
                try { rightId = htktCreateExpense_normalizeValue(rightFile["rights.id"]); } catch (e2) { }
            }
            if (!rightId) {
                try { rightId = htktCreateExpense_normalizeValue(rightFile[0]); } catch (e3) { }
            }
            if (rightId && !seen[rightId]) {
                seen[rightId] = true;
                matched.push(rightId);
            }
            rc = rightFile.getNext();
        }
    } catch (eQueryRights) {
        return [];
    } finally {
        closeSCFile(rightFile);
    }

    return matched;
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

function escapeSmQueryValue(value) {
    return String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

function closeSCFile(file) {
    try {
        if (file) file.doClose();
    } catch (ignore) { }
}
