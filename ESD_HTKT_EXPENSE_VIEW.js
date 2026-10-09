/**
 * ScriptLibrary : ESD_HTKT_EXPENSE_VIEW
 * Module        : HTKT - De nghi du chi
 *
 * Khoi tao context cho man hinh danh sach Du chi theo cung contract initData
 * voi man hinh Thanh toan, bao gom ca pham vi du lieu cua role Hau kiem.
 */

function htktExpenseView_escapeQueryValue(value) {
    return (value == null ? "" : String(value))
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

function htktExpenseView_uniqueArray(source) {
    var values = source || [];
    var result = [];
    var seen = {};

    try {
        if (values.toArray) {
            values = values.toArray();
        }
    } catch (eToArray) {
        values = [];
    }

    for (var i = 0; i < values.length; i++) {
        var value = String(values[i] == null ? "" : values[i]).replace(/^\s+|\s+$/g, "");
        if (value && !seen[value]) {
            seen[value] = true;
            result.push(value);
        }
    }

    return result;
}

function htktExpenseView_readContact(currentUser) {
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

    if (!currentUser) {
        return result;
    }

    try {
        contactFile = new SCFile("contacts", SCFILE_READONLY);
        var rcContact = contactFile.doSelect(
            'contact.name="' + htktExpenseView_escapeQueryValue(currentUser) + '"'
        );

        if (rcContact == RC_SUCCESS) {
            result.fullName = contactFile["full.name"] || contactFile["contact.full.name"] || contactFile["contact.name"] || "";
            result.branchCode = contactFile["branch.code"] || contactFile.branch_code || "";
            result.lv1 = contactFile["lv1.id"] || contactFile.lv1_id || "";
            result.lv2 = contactFile["lv2.id"] || contactFile.lv2_id || "";
            result.lv3 = contactFile["lv3.id"] || contactFile.lv3_id || "";
            result.orgUnit = contactFile["org.unit"] || contactFile.org_unit || "";
            result.position = contactFile.position || "";
            result.positionName = contactFile["position.name"] || contactFile.position_name || "";
        }
    } catch (eContact) {
        return result;
    } finally {
        if (contactFile) {
            try {
                contactFile.doClose();
            } catch (eCloseContact) {}
        }
    }

    return result;
}

function htktExpenseView_getRights() {
    var rights = [];

    try {
        rights = vars['$G.rights'] ? vars['$G.rights'].toArray() : [];
    } catch (eRights) {
        rights = [];
    }

    return htktExpenseView_uniqueArray(rights);
}

function htktExpenseView_getDataPermission(currentUser) {
    var result = {
        scope: "QT_PQDL_01",
        unit: []
    };

    try {
        var permission = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(currentUser, "00401") || {};
        result.scope = String(
            permission.scope ||
            permission.dataScopeList ||
            permission["permission.scope"] ||
            "QT_PQDL_01"
        ).replace(/^\s+|\s+$/g, "");
        result.unit = htktExpenseView_uniqueArray(
            permission.unit || permission.arrUnitRights || permission.units || []
        );
    } catch (eDataPermission) {}

    return result;
}

function htktExpenseView_buildRelatedUserFilter(currentUser, hasView) {
    if (!hasView || !currentUser) {
        return "(1=0)";
    }

    var fields = [
        "created.by",
        "user.checker.kttc",
        "user.checker.dmms",
        "user.approver.dmms",
        "user.approver.kttc",
        "user.checker.final",
        "user.approver.final"
    ];
    var conditions = [];

    for (var i = 0; i < fields.length; i++) {
        conditions.push(fields[i] + '="' + htktExpenseView_escapeQueryValue(currentUser) + '"');
    }

    return "(" + conditions.join(" OR ") + ")";
}

function htktExpenseView_getActiveEntityCodeByPsCode(psCode) {
    var safePsCode = String(psCode || "").replace(/^\s+|\s+$/g, "");
    var entityFile = null;
    var entityCodes = [];

    if (!safePsCode) {
        return "";
    }

    try {
        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
        var rcEntity = entityFile.doSelect(
            'ps.code="' + htktExpenseView_escapeQueryValue(safePsCode) + '" and status="ACTIVE"'
        );

        while (rcEntity == RC_SUCCESS) {
            var entityCode = String(entityFile["entity.code"] || "").replace(/^\s+|\s+$/g, "");
            if (entityCode && entityCodes.indexOf(entityCode) < 0) {
                entityCodes.push(entityCode);
            }
            rcEntity = entityFile.getNext();
        }
    } catch (eEntity) {
        return "";
    } finally {
        if (entityFile) {
            try {
                entityFile.doClose();
            } catch (eCloseEntity) {}
        }
    }

    return entityCodes.length === 1 ? entityCodes[0] : "";
}

function htktExpenseView_getActivePsCodesByEntityCode(entityCode, psPrefix) {
    var safeEntityCode = String(entityCode || "").replace(/^\s+|\s+$/g, "");
    var safePrefix = String(psPrefix || "").replace(/^\s+|\s+$/g, "");
    var entityFile = null;
    var result = [];

    if (!safeEntityCode) {
        return result;
    }

    try {
        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
        var rcEntity = entityFile.doSelect(
            'entity.code="' + htktExpenseView_escapeQueryValue(safeEntityCode) + '" and status="ACTIVE"'
        );

        while (rcEntity == RC_SUCCESS) {
            var psCode = String(entityFile["ps.code"] || "").replace(/^\s+|\s+$/g, "");
            if (psCode && (!safePrefix || psCode.indexOf(safePrefix) === 0) && result.indexOf(psCode) < 0) {
                result.push(psCode);
            }
            rcEntity = entityFile.getNext();
        }
    } catch (ePsCode) {
        return [];
    } finally {
        if (entityFile) {
            try {
                entityFile.doClose();
            } catch (eClosePsCode) {}
        }
    }

    return result;
}

function htktExpenseView_buildPostAuditFilter(contactInfo, dataPermission) {
    var result = {
        defaultFilter: "(1=0)",
        dataScope: "Khong co quyen xem",
        dataScopeCode: "",
        dataScopeField: "unit.lv1",
        dataScopeUnits: []
    };
    var scope = dataPermission ? dataPermission.scope : "";

    if (scope === "QT_PQDL_06") {
        result.defaultFilter = "true";
        result.dataScope = "Toan hang - Hau kiem";
        result.dataScopeCode = "QT_PQDL_06";
        result.dataScopeField = "ALL";
        return result;
    }

    if (scope !== "QT_PQDL_04") {
        return result;
    }

    var lv1 = String(contactInfo && contactInfo.lv1 || "").replace(/^\s+|\s+$/g, "");
    result.dataScope = "Khoi/CN/DVSN - Hau kiem";
    result.dataScopeCode = "QT_PQDL_04";

    if (!lv1) {
        return result;
    }

    var HEAD_OFFICE_PS_PREFIX = "0999";
    var HEAD_OFFICE_OGL_SEG1 = "1010098";
    var allowedLv1 = [];

    if (lv1.indexOf(HEAD_OFFICE_PS_PREFIX) !== 0) {
        allowedLv1 = [lv1];
    } else if (htktExpenseView_getActiveEntityCodeByPsCode(lv1) === HEAD_OFFICE_OGL_SEG1) {
        allowedLv1 = htktExpenseView_getActivePsCodesByEntityCode(
            HEAD_OFFICE_OGL_SEG1,
            HEAD_OFFICE_PS_PREFIX
        );
        result.dataScope = "Tru so chinh - Hau kiem";
    }

    if (allowedLv1.length === 0) {
        return result;
    }

    var conditions = [];
    for (var i = 0; i < allowedLv1.length; i++) {
        conditions.push('unit.lv1="' + htktExpenseView_escapeQueryValue(allowedLv1[i]) + '"');
    }

    result.defaultFilter = conditions.length === 1 ? conditions[0] : "(" + conditions.join(" OR ") + ")";
    result.dataScopeUnits = allowedLv1;
    return result;
}




// ======================================================================================
// ======================================================================================
// ======================================================================================


function renderExpenseList() {
    var currentUser = String(vars['$lo.contact.name'] || "").replace(/^\s+|\s+$/g, "");
    var operatorName = String(system.user.name || "").replace(/^\s+|\s+$/g, "");
    var contactInfo = htktExpenseView_readContact(currentUser);
    var rights = htktExpenseView_getRights();

    var RIGHT_EXPENSE_VIEW = "0040040003000001";
    var RIGHT_EXPENSE_VIEW_APPROVAL = "0040040003000009";
    var RIGHT_EXPENSE_CREATE = "0040040003000002";
    var RIGHT_EXPENSE_ACCOUNTING = "0040040003000003";
    var RIGHT_EXPENSE_POST_AUDIT = "0040040003000010";

    var hasView = rights.indexOf(RIGHT_EXPENSE_VIEW) >= 0 ||
        rights.indexOf(RIGHT_EXPENSE_VIEW_APPROVAL) >= 0;
    var hasCreate = rights.indexOf(RIGHT_EXPENSE_CREATE) >= 0;
    var hasAccounting = rights.indexOf(RIGHT_EXPENSE_ACCOUNTING) >= 0;
    var isPostAuditRole = rights.indexOf(RIGHT_EXPENSE_POST_AUDIT) >= 0;
    var initialRole = "";

    if (hasCreate) {
        initialRole = hasAccounting ? "kttc" : "dmms";
    }

    var dataPermission = htktExpenseView_getDataPermission(currentUser);
    var relatedUserFields = "created.by+user.checker.kttc+user.checker.dmms+user.approver.dmms+user.approver.kttc+user.checker.final+user.approver.final";
    var dataFilterInfo;

    if (isPostAuditRole) {
        dataFilterInfo = htktExpenseView_buildPostAuditFilter(contactInfo, dataPermission);
        dataPermission = {
            scope: dataFilterInfo.dataScopeCode,
            unit: dataFilterInfo.dataScopeUnits
        };
    } else {
        dataFilterInfo = {
            defaultFilter: htktExpenseView_buildRelatedUserFilter(currentUser, hasView),
            dataScope: "Nguoi tao hoac nguoi duoc giao xu ly",
            dataScopeCode: "HTKT_EXPENSE_RELATED_USER",
            dataScopeField: relatedUserFields,
            dataScopeUnits: currentUser ? [currentUser] : []
        };
    }

    var defaultFilter = dataFilterInfo.defaultFilter;

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        'HachToanKeToan/DuChi/DanhSachDuChi',
        '',
        {
            user: currentUser,
            currentUser: currentUser,
            contactId: currentUser,
            initialRole: initialRole,
            operatorName: operatorName,
            fullName: contactInfo.fullName,
            branchCode: contactInfo.branchCode,
            unit: {
                lv1: contactInfo.lv1,
                lv2: contactInfo.lv2,
                lv3: contactInfo.lv3,
                orgUnit: contactInfo.orgUnit,
                position: contactInfo.position,
                positionName: contactInfo.positionName
            },
            defaultFilter: defaultFilter,
            permissionQuery: defaultFilter,
            dataScope: dataFilterInfo.dataScope,
            dataScopeCode: dataFilterInfo.dataScopeCode,
            dataScopeField: dataFilterInfo.dataScopeField,
            dataScopeUnits: dataFilterInfo.dataScopeUnits,
            dataPermissionSubModule: "00401",
            dataPermission: dataPermission,
            rights: rights,
            permission: {
                view: isPostAuditRole ? true : hasView,
                expenseView: isPostAuditRole ? true : hasView,
                create: hasCreate,
                accounting: hasAccounting,
                postAudit: isPostAuditRole
            },
            btnConfig: [
                { id: 'create', visible: hasCreate },
                { id: 'accounting', visible: hasAccounting }
            ],
            debugSource: "ESD_HTKT_EXPENSE"
        }
    );
}
/**
 * Tab Tài liệu đính kèm (Chỉ hiện tab đối với role KTTC trở đi)
 */
function getTabTaiLieuDinhKem() {
    var currentRecord = {};
    if (vars.$L_file) {
        var prepaymentId = vars.$L_file["id"];
        var contractId = vars.$L_file["contract.id"] || "";

        if (!contractId && prepaymentId) {
            var prepFile = new SCFile("esdHTKTpayment");
            var sqlPrep = "id=\"" + prepaymentId + "\"";
            var rcPrep = prepFile.doSelect(sqlPrep);

            if (rcPrep == RC_SUCCESS) {
                contractId = prepFile["contract.id"] || "";
            }
        }

        currentRecord = {
            "id": prepaymentId || "",
            "contractId": contractId,
            "vendorId": vars.$L_file["vendor.id"] || "",
            "currentPhase": vars.$L_file["current.phase"],
            "initialRole": vars.$L_file["initial.role"],
            "userCheckerKttc": vars.$L_file["user.checker.kttc"],
            "userCheckerDmms": vars.$L_file["user.checker.dmms"],
            "userApproverKttc": vars.$L_file["user.approver.kttc"],
            "userApproverDmms": vars.$L_file["user.approver.dmms"],
            "userCheckerFinal": vars.$L_file["user.checker.final"],
            "userApproverFinal": vars.$L_file["user.approver.final"],
            "createdBy": vars.$L_file["created.by"],
            "currentUser": vars['$lo.contact.name'],
            "status": vars.$L_file["status"]
        };
    }

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/DuChi/TabTaiLieuDinhKem', '', currentRecord);
}

/**
 * Tab Kết quả hạch toán
 */
function getTabKetQuaHachToan() {
    return lib.ESD_HTKT_PAYMENT_ENTRY_RESULT.renderTabAccountingResults();
}


function getTabKetQuaGD() {
    return lib.ESD_HTKT_PAYMENT_ENTRY_RESULT.renderTabAccountingResults();
}

//Dung cho tab tài liệu đính kèm của NCC
function renderTabTaiLieuDinhKemNCC(endpoint, input, extraData) {
    var currentRecord = extraData;

    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
        if (vars.$L_file) {
            var paymentId = vars.$L_file["payment.id"];
            var currentPhase = vars.$L_file["current.phase"];
            var initialRole = vars.$L_file["initial.role"];
            var userCheckerKttc = vars.$L_file["user.checker.kttc"];
            var userCheckerDmms = vars.$L_file["use.checker.dmms"];
            //
            var userApproverKttc = vars.$L_file["user.approver.kttc"];
            var userApproverDmms = vars.$L_file["user.approver.dmms"];
            var userCheckerFinal = vars.$L_file["user.checker.final"];
            var userApproverFinal = vars.$L_file["user.approver.final"];
            var userApproverKttc = vars.$L_file["user.approver.kttc"];
            var createdBy = vars.$L_file["created.by"];

            var status = vars.$L_file["status"];

            if ((!currentPhase || !initialRole) && paymentId) {
                var prepFile = new SCFile("esdHTKTpayment");
                var sqlPrep = "id=\"" + paymentId + "\"";
                var rcPrep = prepFile.doSelect(sqlPrep);

                if (rcPrep == RC_SUCCESS) {
                    if (!currentPhase && prepFile["current.phase"]) {
                        currentPhase = prepFile["current.phase"];
                    }
                    if (!initialRole && prepFile["initial.role"]) {
                        initialRole = prepFile["initial.role"];
                    }
                    if (!userCheckerKttc && prepFile["user.checker.kttc"]) {
                        userCheckerKttc = prepFile["user.checker.kttc"];
                    }
                    if (!userCheckerDmms && prepFile["use.checker.dmms"]) {
                        userCheckerDmms = prepFile["use.checker.dmms"];
                    }
                    //
                    if (!userApproverKttc && prepFile["user.approver.kttc"]) {
                        userApproverKttc = prepFile["user.approver.kttc"];
                    }
                    if (!userApproverDmms && prepFile["user.approver.dmms"]) {
                        userApproverDmms = prepFile["user.approver.dmms"];
                    }
                    if (!userCheckerFinal && prepFile["user.checker.final"]) {
                        userCheckerFinal = prepFile["user.checker.final"];
                    }
                    if (!userApproverFinal && prepFile["user.approver.final"]) {
                        userApproverFinal = prepFile["user.approver.final"];
                    }
                    if (!createdBy && prepFile["created.by"]) {
                        createdBy = prepFile["created.by"];
                    }
                    if (!status && prepFile["status"]) {
                        status = prepFile["status"];
                    }
                }
            }

            // Gán dữ liệu vào currentRecord
            currentRecord = {
                "id": vars.$L_file["id"],
                "payment.id": paymentId,
                "contract.id": vars.$L_file["contract.id"],
                "payment.status": vars.$L_file["payment.status"],
                "vendor.number": vars.$L_file["vendor.number"],
                "vendor.id": vars.$L_file["vendor.id"],
                "currentPhase": currentPhase,
                "initialRole": initialRole,
                "userCheckerKttc": userCheckerKttc,
                "userCheckerDmms": userCheckerDmms,

                "userApproverKttc": userApproverKttc,
                "userApproverDmms": userApproverDmms,
                "userCheckerFinal": userCheckerFinal,
                "userApproverFinal": userApproverFinal,
                "createdBy": createdBy,

                "status": status,
                "currentUser": vars['$lo.contact.name']
            };
        }
    }

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/DuChi/TabThongTinMonDuChi/TabTaiLieuDinhKem', '', currentRecord);
}

//Dung cho tab thong tin cong no của NCC
function renderTabLiabilityInfo(endpoint, input, extraData) {
    var currentRecord = extraData;

    // 1. Kiểm tra và khởi tạo object nếu extraData trống
    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
        if (vars.$L_file) {
            currentRecord = {
                "id": vars.$L_file["id"],
                "payment.id": vars.$L_file["payment.id"],
                "contract.id": vars.$L_file["contract.id"],
                "payment.status": vars.$L_file["payment.status"],
                "vendor.number": vars.$L_file["vendor.number"],
                "vendor.id": vars.$L_file["vendor.id"]
            };
        } else {
            currentRecord = {};
        }
    }

    // 2. Thêm query lấy contract.id dựa vào payment.id nếu contract.id chưa có giá trị

    var paymentId = currentRecord["payment.id"] || vars.$L_file["payment.id"];
    if (paymentId && !currentRecord["contract.id"]) {
        var paymentRec = new SCFile("esdHTKTpayment");
        var sql = "id=\"" + paymentId + "\"";

        if (paymentRec.doSelect(sql) === RC_SUCCESS) {
            currentRecord = {
                "id": vars.$L_file["id"],
                "paymentId": paymentId,
                "contractId": paymentRec["contract.id"],
                "vendorId": vars.$L_file["vendor.id"],
                "currentPhase": paymentRec["current.phase"],
                "initialRole": paymentRec["initial.role"],
                "createdBy": paymentRec["created.by"],
                "userCheckerDmms": paymentRec["user.checker.dmms"],
                "userCheckerKttc": paymentRec["user.checker.kttc"],
                "userApproverKttc": paymentRec["user.approver.kttc"],
                "userApproverDmms": paymentRec["user.approver.dmms"],
                "userCheckerFinal": paymentRec["user.checker.final"],
                "userApproverFinal": paymentRec["user.approver.final"],
                "currentUser": vars['$lo.contact.name'],
                "status": paymentRec["status"]
            };
        }
    }
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS("HachToanKeToan/DuChi/TabThongTinMonDuChi/TabThongTinCongNo", '', currentRecord);
}


/**
 * Render tab Thông tin hạch toán
 */
function getTabThongTinHT(endpoint, input, extraData) {
    var formRecord = vars['$L.file'];
    var currentRecord = extraData || {};

    if (
            (!currentRecord || Object.keys(currentRecord).length === 0) &&
            formRecord
    ) {
        currentRecord = formRecord;
    }

    var paymentId = currentRecord ?
            String(currentRecord['id'] || '') :
            '';

    var currentUser = String(
            vars['$lo.contact.name'] || ''
    ).trim();

    var currentPhase = formRecord ?
            String(formRecord['current.phase'] || '').trim() :
            '';

    var userCheckerKttc = formRecord ?
            String(formRecord['user.checker.kttc'] || '').trim() :
            '';

    var initialRole = formRecord ?
            String(formRecord['initial.role'] || '').trim() :
            '';

    var createdBy = formRecord ?
            String(formRecord['created.by'] || '').trim() :
            '';

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
            'HachToanKeToan/DuChi/TabThongTinHachToan',
            '', {
                id: paymentId,
                paymentId: paymentId,
                user: currentUser,
                currentUser: currentUser,
                contactId: currentUser,
                createdBy: createdBy,
                currentPhase: currentPhase,
                userCheckerKttc: userCheckerKttc,
                initialRole: initialRole,
                currentRecord: {
                    id: paymentId,
                    currentPhase: currentPhase,
                    userCheckerKttc: userCheckerKttc,
                    initialRole: initialRole
                }
            }
    );
}


/**
 * Render tab Chi tiết thông tin hạch toán
 */
function getTabChiTietThongTinHT(endpoint, input, extraData) {
    var formRecord = vars['$L.file'];
    var currentRecord = extraData || {};

    if (
            (!currentRecord || Object.keys(currentRecord).length === 0) &&
            formRecord
    ) {
        currentRecord = formRecord;
    }

    var paymentId = vars.$G_payment_id;
    if (paymentId) {
        var paymentRec = new SCFile("esdHTKTpayment");
        var sql = "id=\"" + paymentId + "\"";

        if (paymentRec.doSelect(sql) === RC_SUCCESS) {
            currentRecord = {
                "paymentId": paymentId,
                "currentPhase": paymentRec["current.phase"],
                "initialRole": paymentRec["initial.role"],
                "createdBy": paymentRec["created.by"],
                "userCheckerDmms": paymentRec["user.checker.dmms"],
                "userCheckerKttc": paymentRec["user.checker.kttc"],
                "userApproverKttc": paymentRec["user.approver.kttc"],
                "userApproverDmms": paymentRec["user.approver.dmms"],
                "userCheckerFinal": paymentRec["user.checker.final"],
                "userApproverFinal": paymentRec["user.approver.final"],
                "currentUser": vars['$lo.contact.name'],
                "status": paymentRec["status"]
            };
        }
    }

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/DuChi/TabThongTinHachToan/ChiTietHachToan', '', currentRecord)
}

/**
 * Render tab Thông tin món Dự chi cho phiếu đang mở.
 * Ngoài id phiếu, tab cần cùng context người dùng/phạm vi dữ liệu như màn
 * danh sách để API listPurchaseContracts áp dụng đúng role và data scope.
 */
function getTabThongTinMonDuChi(endpoint, input, extraData) {
    var currentRecord = extraData || {};
    var expenseRecord = vars["$L.file"] || vars.$L_file;
    var loadedExpenseFile = null;
    var expenseId = String(currentRecord.id || "").replace(/^\s+|\s+$/g, "");

    if (!expenseId && expenseRecord) {
        expenseId = String(expenseRecord["id"] || "").replace(/^\s+|\s+$/g, "");
    }

    // Luôn tải lại theo id để quyền sửa dùng phase mới nhất trong database.
    // $L.file có thể vẫn giữ phase cũ sau khi hồ sơ vừa chuyển bước workflow.
    if (expenseId) {
        var expenseFile = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        if (expenseFile.doSelect('id="' + expenseId.replace(/"/g, '\\"') + '"') == RC_SUCCESS) {
            expenseRecord = expenseFile;
            loadedExpenseFile = expenseFile;
        }
    }

    vars.$G_payment_id = expenseId;

    var currentUser = String(vars['$lo.contact.name'] || "").replace(/^\s+|\s+$/g, "");
    var operatorName = String(system.user.name || "").replace(/^\s+|\s+$/g, "");
    var contactInfo = htktExpenseView_readContact(currentUser);
    var rights = htktExpenseView_getRights();
    var hasCreate = rights.indexOf("0040040003000002") >= 0;
    var hasAccounting = rights.indexOf("0040040003000003") >= 0;
    var roleFromRights = hasCreate ? (hasAccounting ? "kttc" : "dmms") : "";
    var currentPhase = String(
        (expenseRecord && (expenseRecord["current.phase"] || expenseRecord.current_phase)) ||
        currentRecord.currentPhase || currentRecord["current.phase"] || ""
    ).replace(/^\s+|\s+$/g, "");
    var initialRole = String(
        (expenseRecord && (expenseRecord["initial.role"] || expenseRecord.initial_role)) ||
        currentRecord.initialRole || currentRecord["initial.role"] || roleFromRights || ""
    ).replace(/^\s+|\s+$/g, "");
    var createdBy = String(
        (expenseRecord && (expenseRecord["created.by"] || expenseRecord.created_by)) ||
        currentRecord.createdBy || currentRecord["created.by"] || ""
    ).replace(/^\s+|\s+$/g, "");
    try {
        if (loadedExpenseFile) loadedExpenseFile.doClose();
    } catch (eCloseExpenseFile) {}
    var isVendorEditable =
        (currentPhase == "initial_dmms" && createdBy == currentUser) ||
        (currentPhase == "initial_kttc" && initialRole == "kttc");
    var dataPermission = htktExpenseView_getDataPermission(currentUser);

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        'HachToanKeToan/DuChi/TabThongTinMonDuChi',
        expenseId ? '?id=' + encodeURIComponent(expenseId) : '',
        {
            id: expenseId,
            user: currentUser,
            currentUser: currentUser,
            contactId: currentUser,
            operatorName: operatorName,
            fullName: contactInfo.fullName,
            branchCode: contactInfo.branchCode,
            initialRole: initialRole,
            currentPhase: currentPhase,
            createdBy: createdBy,
            isVendorEditable: isVendorEditable,
            unit: {
                lv1: contactInfo.lv1,
                lv2: contactInfo.lv2,
                lv3: contactInfo.lv3,
                orgUnit: contactInfo.orgUnit,
                position: contactInfo.position,
                positionName: contactInfo.positionName
            },
            dataScope: dataPermission.scope,
            dataScopeCode: dataPermission.scope,
            dataScopeUnits: dataPermission.unit,
            dataPermissionSubModule: "00401",
            dataPermission: dataPermission,
            rights: rights
        }
    );
}
// ======================================================================================
// ======================================================================================
// ======================================================================================

function renderHdsd() {
    var scFile = new SCFile('esdAttachments');
    var result = scFile.doSelect(`id = "HDSD_HTKT_Thanh_toan" and module = "HTKT" and function = "Thanh toan"`);
    var base64PDF = "";
    if (result == RC_SUCCESS) {
        var attachments = scFile.getAttachments();

        for (var i = 0; i < attachments.length; i++) {
            var att = attachments[i];
            var binaryData = att.value;
            if (att.value) {
                var base64 = base64Encode(binaryData);
                base64PDF = lib.ESD_HTKT_PAYMENT_COMMON.htktEscapeForJavaScript(base64);
            }
        }
    }
    if (scFile) scFile.doClose();
    return (
        "<div style='border-radius: 6px; height: 100%; width: 100%; box-shadow: 0 2px 8px rgb(0 0 0 / 26%); overflow: hidden; box-sizing: border-box; font-family: Arial, sans-serif;'>" +
        "<div style='margin:10px;border-bottom: 1px solid #ddd; padding-bottom: 10px; margin: 10px 15px; font-size: 17px; font-weight: 600; color: #0835D9;'>Hướng dẫn thực hiện</div>" +
        "<div style='margin:10px;border:1px solid #ddd;padding:0;width:100%;height:100%;font-family:Arial,sans-serif;'>" +
        "<iframe id='htktPdfFrame' width='100%' height='100%' style='min-height:700px;border:none;background:#e5e7eb;'></iframe>" +
        "<script>" +
        "(function(){" +
        "var base64='" + base64PDF + "';" +
        "function toBytes(value){" +
        "var binary=atob(value);" +
        "var bytes=new Uint8Array(binary.length);" +
        "for(var i=0;i<binary.length;i++){bytes[i]=binary.charCodeAt(i);}" +
        "return bytes;" +
        "}" +
        "try{" +
        "var blob=new Blob([toBytes(base64)],{type:'application/pdf'});" +
        "var url=URL.createObjectURL(blob);" +
        "var frame=document.getElementById('htktPdfFrame');" +
        "frame.src=url+'#toolbar=0&navpanes=0&view=FitH';" +
        "window.addEventListener('beforeunload',function(){URL.revokeObjectURL(url);});" +
        "}catch(e){" +
        "document.body.innerHTML='<div style=\"padding:16px;color:red;font-family:Arial;\">Lỗi render PDF: '+e+'</div>';" +
        "}" +
        "})();" +
        "</script>" +
        "</div>" +
        "</div>"
    );
}
