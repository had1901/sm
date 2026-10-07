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
    try {
        var rawData = input.queryString;
        if (!rawData) return { success: false, message: "Thiếu dữ liệu." };

        var expenseList = JSON.parse(rawData);
        var expenseData = Array.isArray(expenseList) ? expenseList[0] : expenseList;

        if (!expenseData) {
            return { success: false, message: "Thiếu dữ liệu dự chi." };
        }

        var currentUser = String(expenseData['currentUser'] || "").replace(/^\s+|\s+$/g, "");
        if (!currentUser) {
            return {
                success: false,
                message: "Không xác định được người tạo phiếu dự chi."
            };
        }

        expenseData["currentUser"] = currentUser;
        expenseData["createdBy"] = currentUser;

        var rawDepartment = expenseData['unitLv1'] || expenseData['unitLv2'] || expenseData['unitLv3'];
        var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(rawDepartment);
        var oglBranchCode = (entityInfo && entityInfo.oglBranchCode) ? String(entityInfo.oglBranchCode).replace(/^0+/, '') : '';
        var branchCode = oglBranchCode || "100";
        var docType = "DC";

        var expenseRec = new SCFile("esdHTKTpayment");
        var newExpenseId = generateDocumentCode(docType, branchCode);
        mapExpenseRecord(expenseRec, expenseData, newExpenseId);

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

        if (returnCode == RC_SUCCESS) {
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
                message: "Lỗi ghi nhận phiếu Dự chi vào Database esdHTKTpayment. Code: " + returnCode + " reason " + expenseRec.getMessages()
            };
        }

    } catch (error) {
        return { success: false, message: "Lỗi thực thi createExpenseRequest: " + error.toString() };
    }
}

/**
 * Map thông tin đề nghị dự chi vào SCFile dùng chung esdHTKTpayment.
 */
function mapExpenseRecord(expenseRec, expenseData, expenseId) {
    expenseRec['id'] = expenseId;
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
    expenseRec['created.by'] = expenseData['createdBy'];
    expenseRec['total.amount.paid'] = 0;
    expenseRec['total.contract.amount'] = 0;
    expenseRec['current.phase'] = "start";
    expenseRec['executor.payment'] = expenseData['currentUser'];

    var creatorUser = String(expenseData['currentUser'] || "").replace(/^\s+|\s+$/g, "");
    if (!creatorUser) {
        throw new Error("Không xác định được người tạo phiếu dự chi.");
    }

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
                " chưa có quyền phù hợp để lập phiếu dự chi. Cần quyền lập đề nghị dự chi; nếu là KTTC cần thêm quyền nhập liệu hạch toán."
        );
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
    } catch (ignore) {}
}
