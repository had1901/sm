/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_VIEW
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Truy vấn và tổng hợp toàn bộ dữ liệu của một đề nghị thanh toán phục vụ hiển thị chi tiết.
 * - Xác định quyền xem/sửa và trạng thái các nút hành động của người dùng đối với phiếu.
 * - Chuẩn hóa payload chi tiết phiếu đề nghị thanh toán trả về cho NextJS/Web frontend.
 * -----------------------------------------------------------------------------
 */

// BỔ SUNG CÁC HÀM HELPER XỬ LÝ PHÂN QUYỀN VÀ TÁI PHÂN CÔNG (Tương tự Prepayment)
function qHTKT(value) {
    return (value == null ? "" : String(value)).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function uniqueHTKTArray(arr) {
    var result = [];
    var seen = {};
    if (!arr) return result;
    try { if (arr.toArray) arr = arr.toArray(); } catch (e) {}
    if (!arr.length) return result;
    for (var i = 0; i < arr.length; i++) {
        var value = String(arr[i] == null ? "" : arr[i]).trim();
        if (!value || seen[value]) continue;
        seen[value] = true;
        result.push(value);
    }
    return result;
}

function normalizeHTKTQueryForRest(query) {
    var text = String(query == null ? "" : query).trim();
    if (!text) return "";
    if (text === "true" || text === "false") return text;
    return text.replace(/\s+or\s+/g, " OR ").replace(/\s+and\s+/g, " AND ");
}

function getHTKTDataScopeName(scope) {
    if (scope === "QT_PQDL_01") return "Ca nhan";
    if (scope === "QT_PQDL_02") return "Phong ban thuoc trung tam";
    if (scope === "QT_PQDL_03") return "Phong ban/Trung tam";
    if (scope === "QT_PQDL_04") return "Khoi/CN/DVSN";
    if (scope === "QT_PQDL_06") return "Toan hang";
    return scope || "Khong xac dinh";
}

function getHTKTDataScopeField(scope) {
    if (scope === "QT_PQDL_01") return "created.by";
    if (scope === "QT_PQDL_06") return "ALL";
    return "unit.lv1/unit.lv2/unit.lv3+created.by";
}

function normalizeHTKTDataPermission(dataPermission) {
    var scope = "";
    var unitArr = [];
    if (dataPermission) {
        scope = String(dataPermission.scope || dataPermission.dataScopeList || dataPermission["permission.scope"] || "").trim();
        unitArr = dataPermission.unit || dataPermission.arrUnitRights || dataPermission.units || [];
    }
    if (!scope) scope = "QT_PQDL_01";
    return { scope: scope, unit: uniqueHTKTArray(unitArr) };
}

function buildHTKTFallbackPermissionQuery(scope, unitIds, fieldNames, createdByField, currentUser) {
    var safeScope = String(scope == null ? "" : scope).trim() || "QT_PQDL_01";
    var safeUnits = uniqueHTKTArray(unitIds);
    var safeFields = uniqueHTKTArray(fieldNames);
    var safeCreatedByField = createdByField || "created.by";
    var safeCurrentUser = String(currentUser == null ? "" : currentUser).trim();

    if (!safeCurrentUser) return "(1=0)";
    if (safeScope === "QT_PQDL_06") return "true";

    var createdByCond = safeCreatedByField + '="' + qHTKT(safeCurrentUser) + '"';
    if (safeScope === "QT_PQDL_01") return createdByCond;

    var conditions = [];
    if (safeUnits.length > 0 && safeFields.length > 0) {
        for (var i = 0; i < safeUnits.length; i++) {
            var unitClauses = [];
            for (var j = 0; j < safeFields.length; j++) {
                unitClauses.push(safeFields[j] + '="' + qHTKT(safeUnits[i]) + '"');
            }
            if (unitClauses.length > 0) {
                conditions.push("(" + unitClauses.join(" OR ") + ")");
            }
        }
    }
    conditions.push("(" + createdByCond + ")");
    conditions = uniqueHTKTArray(conditions);
    if (conditions.length === 0) return createdByCond;
    return conditions.length === 1 ? conditions[0] : "(" + conditions.join(" OR ") + ")";
}

function buildHTKTCommonPermissionQuery(scope, unitIds, fieldNames, createdByField, currentUser) {
    var commonQuery = "";
    try {
        if (lib.ESD_Utils && lib.ESD_Utils.buildPermissionQuery) {
            commonQuery = lib.ESD_Utils.buildPermissionQuery(scope, unitIds, fieldNames, createdByField);
        }
    } catch (e) {
        commonQuery = "";
    }
    commonQuery = String(commonQuery == null ? "" : commonQuery).trim();
    if (!commonQuery || commonQuery === "false") {
        commonQuery = buildHTKTFallbackPermissionQuery(scope, unitIds, fieldNames, createdByField, currentUser);
    }
    return normalizeHTKTQueryForRest(commonQuery);
}

/**
 * TÁI PHÂN CÔNG & PHÊ DUYỆT: Xác định role lãnh đạo để mở quyền nhìn sớm cho Payment[cite: 2].
 * Mã quyền Payment sử dụng dải 0040040001 (Thay vì 002 của Tạm ứng)[cite: 1, 2].
 */
function getHTKTPaymentLeadershipAccess(rightsArray) {
    var rights = uniqueHTKTArray(rightsArray);
    var RIGHT_APPROVE_DMMS = "0040040003000005"; 
    var RIGHT_APPROVE_KTTC = "0040040003000006";

    return {
        isApprovalDmms: rights.indexOf(RIGHT_APPROVE_DMMS) >= 0,
        isApprovalKttc: rights.indexOf(RIGHT_APPROVE_KTTC) >= 0
    };
}

function buildHTKTPaymentLeadershipVisibilityClause(currentUser, rightsArray, dataPermission) {
    var safeCurrentUser = String(currentUser == null ? "" : currentUser).trim();
    var leadership = getHTKTPaymentLeadershipAccess(rightsArray);

    if (!safeCurrentUser || (!leadership.isApprovalDmms && !leadership.isApprovalKttc)) {
        return "";
    }

    var normalizedPermission = normalizeHTKTDataPermission(dataPermission);
    var permissionScope = normalizedPermission.scope;
    var permissionUnits = normalizedPermission.unit;

    var permissionQuery = buildHTKTCommonPermissionQuery(
        permissionScope, permissionUnits, ["unit.lv1", "unit.lv2", "unit.lv3"], "created.by", safeCurrentUser
    );
    permissionQuery = String(permissionQuery == null ? "" : permissionQuery).trim();

    if (!permissionQuery || permissionQuery === "false" || permissionQuery === "(1=0)") return "";

    var initialRoleClause = "";
    if (leadership.isApprovalKttc) {
        initialRoleClause = '(initial.role="dmms" OR initial.role="kttc")';
    } else if (leadership.isApprovalDmms) {
        initialRoleClause = 'initial.role="dmms"';
    }

    if (!initialRoleClause) return "";
    if (permissionQuery === "true") return "(" + initialRoleClause + ")";
    return "((" + permissionQuery + ") AND (" + initialRoleClause + "))";
}

function buildHTKTPaymentCreatedByFilter(currentUser, hasView, rightsArray, dataPermission) {
    var result = {
        defaultFilter: "(1=0)", dataScope: "Khong co quyen xem", dataScopeCode: "", dataScopeField: "", dataScopeUnits: []
    };

    var safeCurrentUser = String(currentUser == null ? "" : currentUser).trim();
    if (!hasView || !safeCurrentUser) return result;

    var user = qHTKT(safeCurrentUser);
    var relatedUserConditions = [
        'created.by="' + user + '"',
        'user.checker.kttc="' + user + '"',
        'user.checker.dmms="' + user + '"',
        'user.approver.dmms="' + user + '"',
        'user.approver.kttc="' + user + '"',
        'user.checker.final="' + user + '"',
        'user.approver.final="' + user + '"'
    ];

    var draftCreatedByCondition = '((status="dmms_created" OR status="kttc_created") AND created.by="' + user + '")';
    var nonDraftRelatedCondition = '((status~="dmms_created" AND status~="kttc_created") AND (' + relatedUserConditions.join(" OR ") + '))';

    var visibilityConditions = [draftCreatedByCondition, nonDraftRelatedCondition];
    var leadershipVisibilityClause = buildHTKTPaymentLeadershipVisibilityClause(safeCurrentUser, rightsArray, dataPermission);
    if (leadershipVisibilityClause) visibilityConditions.push(leadershipVisibilityClause);

    result.defaultFilter = "(" + visibilityConditions.join(" OR ") + ")";
    result.defaultFilter = normalizeHTKTQueryForRest(result.defaultFilter);

    var leadership = getHTKTPaymentLeadershipAccess(rightsArray);
    if (leadership.isApprovalDmms || leadership.isApprovalKttc) {
        result.dataScope = "Logic cu + lanh dao DMMS/KTTC duoc nhin som ho so trong pham vi Data Permission";
        result.dataScopeCode = "HTKT_PAYMENT_DRAFT_AWARE_RELATED_USER_WITH_LEADERSHIP";
        result.dataScopeField = "status+created.by+related.users+initial.role+data.permission";
        var leadershipDataPermission = normalizeHTKTDataPermission(dataPermission);
        result.dataScopeUnits = leadershipDataPermission.scope === "QT_PQDL_01" ? [safeCurrentUser] : leadershipDataPermission.unit;
    } else {
        result.dataScope = "Tao moi chi nguoi tao xem; sau khi trinh thi nguoi lien quan xem";
        result.dataScopeCode = "HTKT_PAYMENT_DRAFT_AWARE_RELATED_USER";
        result.dataScopeField = "status+created.by+related.users";
        result.dataScopeUnits = [safeCurrentUser];
    }
    return result;
}

function isHTKTPaymentPostAuditRole(rightsArray) {
    var rights = uniqueHTKTArray(rightsArray);
    var RIGHT_PAYMENT_POST_AUDIT = "0040040001000010"; // Quyền hậu kiểm Payment
    return rights.indexOf(RIGHT_PAYMENT_POST_AUDIT) >= 0;
}

function getHTKTActiveEntityCodeByPsCode(psCode) { /* ... Giữ nguyên logic như Prepayment ... */
    var safePsCode = String(psCode == null ? "" : psCode).trim();
    if (!safePsCode) return "";
    var entityFile = null; var entityCodes = []; var seenEntityCodes = {};
    try {
        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
        var rcEntity = entityFile.doSelect('ps.code="' + qHTKT(safePsCode) + '" and status="ACTIVE"');
        while (rcEntity == RC_SUCCESS) {
            var entityCode = String(entityFile["entity.code"] || "").trim();
            if (entityCode && !seenEntityCodes[entityCode]) {
                seenEntityCodes[entityCode] = true; entityCodes.push(entityCode);
            }
            rcEntity = entityFile.getNext();
        }
    } catch (e) { return ""; } finally { if (entityFile) { try { entityFile.doClose(); } catch (e) {} } }
    return entityCodes.length === 1 ? entityCodes[0] : "";
}

function getHTKTActivePsCodesByEntityCode(entityCode, psPrefix) { /* ... Giữ nguyên logic như Prepayment ... */
    var safeEntityCode = String(entityCode == null ? "" : entityCode).trim();
    var safePrefix = String(psPrefix == null ? "" : psPrefix).trim();
    var result = []; var seenPsCodes = {};
    if (!safeEntityCode) return result;
    var entityFile = null;
    try {
        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
        var rcEntity = entityFile.doSelect('entity.code="' + qHTKT(safeEntityCode) + '" and status="ACTIVE"');
        while (rcEntity == RC_SUCCESS) {
            var psCode = String(entityFile["ps.code"] || "").trim();
            if (psCode && (!safePrefix || psCode.indexOf(safePrefix) === 0) && !seenPsCodes[psCode]) {
                seenPsCodes[psCode] = true; result.push(psCode);
            }
            rcEntity = entityFile.getNext();
        }
    } catch (e) { return []; } finally { if (entityFile) { try { entityFile.doClose(); } catch (e) {} } }
    return result;
}

function buildHTKTPaymentPostAuditLv1Filter(currentUser, hasView, contactInfo, dataPermission) {
    var result = { defaultFilter: "(1=0)", dataScope: "Khong co quyen xem", dataScopeCode: "", dataScopeField: "", dataScopeUnits: [] };
    var safeCurrentUser = String(currentUser == null ? "" : currentUser).trim();
    if (!hasView || !safeCurrentUser) return result;

    var normalizedPermission = normalizeHTKTDataPermission(dataPermission);
    var permissionScope = normalizedPermission.scope;

    if (permissionScope === "QT_PQDL_06") {
        result.defaultFilter = "true"; result.dataScope = "Toan hang - Hau kiem"; result.dataScopeCode = "QT_PQDL_06"; result.dataScopeField = "ALL"; result.dataScopeUnits = []; return result;
    }
    if (permissionScope !== "QT_PQDL_04") return result;

    var safeLv1 = String(contactInfo && contactInfo.lv1 != null ? contactInfo.lv1 : "").trim();
    if (!safeLv1) return result;

    var HEAD_OFFICE_PS_PREFIX = "0999"; var HEAD_OFFICE_OGL_SEG1 = "1010098";
    if (safeLv1.indexOf(HEAD_OFFICE_PS_PREFIX) !== 0) {
        result.defaultFilter = 'unit.lv1="' + qHTKT(safeLv1) + '"';
        result.defaultFilter = normalizeHTKTQueryForRest(result.defaultFilter);
        result.dataScope = "Khoi/CN/DVSN - Hau kiem"; result.dataScopeCode = "QT_PQDL_04"; result.dataScopeField = "unit.lv1"; result.dataScopeUnits = [safeLv1];
        return result;
    }

    var currentEntityCode = getHTKTActiveEntityCodeByPsCode(safeLv1);
    if (currentEntityCode !== HEAD_OFFICE_OGL_SEG1) return result;

    var headOfficePsCodes = getHTKTActivePsCodesByEntityCode(HEAD_OFFICE_OGL_SEG1, HEAD_OFFICE_PS_PREFIX);
    if (headOfficePsCodes.length === 0) return result;

    var headOfficeConditions = [];
    for (var i = 0; i < headOfficePsCodes.length; i++) {
        headOfficeConditions.push('unit.lv1="' + qHTKT(headOfficePsCodes[i]) + '"');
    }
    result.defaultFilter = headOfficeConditions.length === 1 ? headOfficeConditions[0] : "(" + headOfficeConditions.join(" OR ") + ")";
    result.defaultFilter = normalizeHTKTQueryForRest(result.defaultFilter);
    result.dataScope = "Tru so chinh - Hau kiem"; result.dataScopeCode = "QT_PQDL_04"; result.dataScopeField = "unit.lv1"; result.dataScopeUnits = headOfficePsCodes;
    return result;
}

function readHTKTContactInfo(currentUser) {
    // ... Logic query bảng contacts ... (Giữ nguyên như Prepayment)
    var result = { fullName: "", branchCode: "", lv1: "", lv2: "", lv3: "", orgUnit: "", position: "", positionName: "" };
    var contactFile = null;
    try {
        contactFile = new SCFile("contacts", SCFILE_READONLY);
        var rcContact = contactFile.doSelect('contact.name="' + qHTKT(currentUser) + '"');
        if (rcContact == RC_SUCCESS) {
            result.fullName = contactFile["full.name"] || contactFile["contact.full.name"] || contactFile["contact.name"] || "";
            result.branchCode = contactFile["branch.code"] || contactFile["branch_code"] || "";
            result.lv1 = contactFile["lv1.id"] || contactFile.lv1_id || "";
            result.lv2 = contactFile["lv2.id"] || contactFile.lv2_id || "";
            result.lv3 = contactFile["lv3.id"] || contactFile.lv3_id || "";
            result.orgUnit = contactFile["org.unit"] || contactFile.org_unit || "";
            result.position = contactFile["position"] || "";
            result.positionName = contactFile["position.name"] || contactFile.position_name || "";
        }
    } catch (e) {} finally { if (contactFile) { try { contactFile.doClose(); } catch (e) {} } }
    return result;
}

function getHTKTRightsArray() {
    var rightsArray = [];
    try {
        rightsArray = vars['$G.rights'] ? vars['$G.rights'].toArray().map(function(r) { return String(r == null ? "" : r).trim(); }) : [];
    } catch (e) { rightsArray = []; }
    return uniqueHTKTArray(rightsArray);
}

function getHTKTDataPermission(currentUser, subModule) {
    var dataPermission = { scope: "", unit: [] };
    try {
        dataPermission = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(currentUser, subModule) || dataPermission;
    } catch (e) {}
    return normalizeHTKTDataPermission(dataPermission);
}

// THAY THẾ HÀM getList() bị comment trong Payment
function getList() {
    var currentUser = vars['$lo.contact.name'];
    var smLoginUser = system.user.name;
    var contactInfo = readHTKTContactInfo(currentUser);
    var rightsArray = getHTKTRightsArray();

    var initialRole = "";
    if (rightsArray.indexOf("0040040003000002") >= 0) {
        initialRole = rightsArray.indexOf("0040040003000003") >= 0 ? "kttc" : "dmms";
    }

    var RIGHT_PAYMENT_VIEW_CREATE = "0040040001000001";
    var RIGHT_PAYMENT_VIEW_APPROVAL = "0040040001000004";
    var RIGHT_PAYMENT_UPLOAD = "0040040001000002";
    var RIGHT_PAYMENT_DELETE = "0040040001000003";

    var hasView = rightsArray.indexOf(RIGHT_PAYMENT_VIEW_CREATE) >= 0 || rightsArray.indexOf(RIGHT_PAYMENT_VIEW_APPROVAL) >= 0;
    var hasUpload = rightsArray.indexOf(RIGHT_PAYMENT_UPLOAD) >= 0;
    var hasDelete = rightsArray.indexOf(RIGHT_PAYMENT_DELETE) >= 0;

    var DATA_PERMISSION_SUB_MODULE = "00401";
    var dataPermission = getHTKTDataPermission(currentUser, DATA_PERMISSION_SUB_MODULE);

    var isPostAuditRole = isHTKTPaymentPostAuditRole(rightsArray);
    var hasPostAuditView = isPostAuditRole;
    var dataFilterInfo;

    if (isPostAuditRole) {
        dataFilterInfo = buildHTKTPaymentPostAuditLv1Filter(currentUser, hasPostAuditView, contactInfo, dataPermission);
        dataPermission = { scope: dataFilterInfo.dataScopeCode, unit: dataFilterInfo.dataScopeUnits };
    } else {
        dataFilterInfo = buildHTKTPaymentCreatedByFilter(currentUser, hasView, rightsArray, dataPermission);
    }

    var defaultFilter = dataFilterInfo.defaultFilter;
    var dataScope = dataFilterInfo.dataScope;

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        'HachToanKeToan/ThanhToan/DanhSachDeNghi',
        '', {
            user: currentUser,
            currentUser: currentUser,
            contactId: currentUser,
            initialRole: initialRole,
            operatorName: smLoginUser,
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
            dataScope: dataScope,
            dataScopeCode: dataFilterInfo.dataScopeCode,
            dataScopeField: dataFilterInfo.dataScopeField,
            dataScopeUnits: dataFilterInfo.dataScopeUnits,
            dataPermissionSubModule: DATA_PERMISSION_SUB_MODULE,
            dataPermission: dataPermission,
            rights: rightsArray,
            leadershipAccess: getHTKTPaymentLeadershipAccess(rightsArray),
            permission: {
                view: isPostAuditRole ? hasPostAuditView : hasView,
                paymentView: hasView,
                upload: hasUpload,
                delete: hasDelete
            },
            btnConfig: [
                { id: 'upload', visible: hasUpload },
                { id: 'delete', visible: hasDelete },
                { id: 'check', visible: hasView }
            ],
            debugSource: "ESD_HTKT_PAYMENT"
        }
    );
}
//function getList() {
//    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/DanhSachDeNghi', '', {})
//}

function getTabThongTinPheDuyet(endpoint, input, extraData) {
    var payment = vars["$L.file"] || vars.$L_file || extraData;
    var currentUser = String(vars["$lo.contact.name"] ||
        (vars.$lo_operator ? vars.$lo_operator["contact.name"] : "") || "").trim();
    var initData = payment
        ? lib.ESD_HTKT_PAYMENT_LOAD_APRROVAL_COMBOBOX.getPaymentApprovalInitData(payment, currentUser)
        : {};
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        'HachToanKeToan/ThanhToan/TabThongTinPheDuyet', '', initData
    );
}


function getTabThongTinDeNghi(endpoint, input, extraData) {
    var currentRecord = extraData;

    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
        if (vars.$L_file) {
            var paymentId = vars.$L_file["id"];
            var currentPhase = vars.$L_file["current.phase"];
            var contractId = vars.$L_file["contract.id"];
            var initialRole = vars.$L_file["initial.role"];

            // Nếu thiếu phase hoặc role nhưng có payment.id, thực hiện query để lấy từ bảng esdHTKTpayment
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
                }
            }

            vars.$G_payment_id = paymentId;
            vars.$G_contract_id = contractId;

            currentRecord = {
                "id": vars.$L_file["id"],
                "contractId": contractId,
                "currentPhase": currentPhase,
                "initialRole": initialRole,
                "userCheckerKttc": vars.$L_file["user.checker.kttc"],
                "userCheckerDmms": vars.$L_file["user.checker.dmms"],
                "userApproverKttc": vars.$L_file["user.approver.kttc"],
                "userApproverDmms": vars.$L_file["user.approver.dmms"],
                "userCheckerFinal": vars.$L_file["user.checker.final"],
                "userApproverFinal": vars.$L_file["user.approver.final"],
                "createdBy": vars.$L_file["created.by"],
                "currentUser": vars['$lo.contact.name'],
                "status": vars.$L_file["status"],
                "isVendorEditable": (currentPhase == "initial_dmms" && vars.$L_file["created.by"] == vars['$lo.contact.name']) || (currentPhase == "initial_kttc" && initialRole == "kttc")
            };
        }
    }

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/TabThongTinDeNghi', '', currentRecord);
}


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

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/TabThongTinHT/ChiTietHachToan', '', currentRecord)
}

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
            'HachToanKeToan/ThanhToan/TabThongTinHT',
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


//function getTabHoSoDinhKem() {
//    var currentRecord = {};
//
//    if (vars.$L_file) {
//        currentRecord = {
//            "id": vars.$L_file["id"] || "",
//            "contractId": vars.$L_file["contract.id"] || "",
//            "vendorId": vars.$L_file["vendor.id"] || "",
//            "currentPhase": vars.$L_file["current.phase"],
//            "initialRole": vars.$L_file["initial.role"],
//            "userCheckerKttc": vars.$L_file["user.checker.kttc"],
//            "userCheckerDmms": vars.$L_file["user.checker.dmms"],
//            "userApproverKttc": vars.$L_file["user.approver.kttc"],
//            "userApproverDmms": vars.$L_file["user.approver.dmms"],
//            "userCheckerFinal": vars.$L_file["user.checker.final"],
//            "userApproverFinal": vars.$L_file["user.approver.final"],
//            "createdBy": vars.$L_file["created.by"],
//            "currentUser": vars['$lo.contact.name'],
//            "status": vars.$L_file["status"]
//        };
//    }
//
//    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
//            'HachToanKeToan/ThanhToan/TabHoSoDinhKem',
//            '',
//            currentRecord
//    );
//}

//---
function getTabHoSoDinhKem() {
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

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        'HachToanKeToan/ThanhToan/TabHoSoDinhKem',
        '',
        currentRecord
    );
}

function getTabKetQuaHachToan() {
    return lib.ESD_HTKT_PAYMENT_ENTRY_RESULT
            .renderTabAccountingResults();
}

function renderFormKySo() {
    var file = vars.$L_file;

    //    var conditionKySo = lib.ESD_MS_DXMS_CONDITION_WF.conditionKySo(file.id) || false;
    var conditionKySo = true;
    if (!conditionKySo) { return `<div style="
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px;
  background-color: #fff3cd;
  border-left: 5px solid #ffc107;
  color: #856404;
  border-radius: 6px;
  font-family: Arial, sans-serif;
  font-size: 14px;
">
  <span style="font-size: 18px;">⚠️</span>
  <span><strong>Đang có người ký số</strong>, vui lòng thử lại trong ít phút.</span>
</div>` }

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('HachToanKeToan/ThanhToan/ky-so', `?id=${file.id}&userad=${vars["$lo.contact.name"]}`, {
        defaultFilter: '',
        user: vars['$lo.contact.name'],
        phieuId: vars.$L_file.id,
    });

}


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





