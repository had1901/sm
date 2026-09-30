//function renderList(endpoint, input, extraData) {
//    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('TamUngMuaSam/DanhSachTamUng', '', {});
//}

function getTabThongTinPheDuyet(endpoint, input, extraData) {
    var prepayment = vars["$L.file"] || vars.$L_file || extraData;
    var currentUser = String(vars["$lo.contact.name"] ||
        (vars.$lo_operator ? vars.$lo_operator["contact.name"] : "") || "").trim();
    var initData = prepayment
        ? lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX.getPrepaymentApprovalInitData(prepayment, currentUser)
        : {};
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        'TamUngMuaSam/ThongTinPheDuyet', '', initData
    );
}

function qHTKT(value) {
    return (value == null ? "" : String(value)).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function uniqueHTKTArray(arr) {
    var result = [];
    var seen = {};

    if (!arr) {
        return result;
    }

    try {
        if (arr.toArray) {
            arr = arr.toArray();
        }
    } catch (eToArray) {}

    if (!arr.length) {
        return result;
    }

    for (var i = 0; i < arr.length; i++) {
        var value = String(arr[i] == null ? "" : arr[i]).trim();

        if (!value || seen[value]) {
            continue;
        }

        seen[value] = true;
        result.push(value);
    }

    return result;
}

function normalizeHTKTQueryForRest(query) {
    var text = String(query == null ? "" : query).trim();

    if (!text) {
        return "";
    }

    if (text === "true" || text === "false") {
        return text;
    }

    // Chuẩn hóa format query trước khi đẩy qua REST.
    return text
        .replace(/\s+or\s+/g, " OR ")
        .replace(/\s+and\s+/g, " AND ");
}

function getHTKTDataScopeName(scope) {
    if (scope === "QT_PQDL_01") {
        return "Ca nhan";
    }

    if (scope === "QT_PQDL_02") {
        return "Phong ban thuoc trung tam";
    }

    if (scope === "QT_PQDL_03") {
        return "Phong ban/Trung tam";
    }

    if (scope === "QT_PQDL_04") {
        return "Khoi/CN/DVSN";
    }

    if (scope === "QT_PQDL_06") {
        return "Toan hang";
    }

    return scope || "Khong xac dinh";
}

function getHTKTDataScopeField(scope) {
    if (scope === "QT_PQDL_01") {
        return "created.by";
    }

    if (scope === "QT_PQDL_06") {
        return "ALL";
    }

    return "unit.lv1/unit.lv2/unit.lv3+created.by";
}

function normalizeHTKTDataPermission(dataPermission) {
    var scope = "";
    var unitArr = [];

    if (dataPermission) {
        scope =
            String(
                dataPermission.scope ||
                dataPermission.dataScopeList ||
                dataPermission["permission.scope"] ||
                ""
            ).trim();

        unitArr =
            dataPermission.unit ||
            dataPermission.arrUnitRights ||
            dataPermission.units || [];
    }

    if (!scope) {
        scope = "QT_PQDL_01";
    }

    return {
        scope: scope,
        unit: uniqueHTKTArray(unitArr)
    };
}

function buildHTKTFallbackPermissionQuery(scope, unitIds, fieldNames, createdByField, currentUser) {
    var safeScope = String(scope == null ? "" : scope).trim() || "QT_PQDL_01";
    var safeUnits = uniqueHTKTArray(unitIds);
    var safeFields = uniqueHTKTArray(fieldNames);
    var safeCreatedByField = createdByField || "created.by";
    var safeCurrentUser = String(currentUser == null ? "" : currentUser).trim();

    if (!safeCurrentUser) {
        return "(1=0)";
    }

    if (safeScope === "QT_PQDL_06") {
        return "true";
    }

    var createdByCond = safeCreatedByField + '="' + qHTKT(safeCurrentUser) + '"';

    if (safeScope === "QT_PQDL_01") {
        return createdByCond;
    }

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

    //user upload luôn xem được hóa đơn của mình.
    conditions.push("(" + createdByCond + ")");

    conditions = uniqueHTKTArray(conditions);

    if (conditions.length === 0) {
        return createdByCond;
    }

    return conditions.length === 1 ? conditions[0] : "(" + conditions.join(" OR ") + ")";
}

function buildHTKTCommonPermissionQuery(scope, unitIds, fieldNames, createdByField, currentUser) {
    var commonQuery = "";

    try {
        if (lib.ESD_Utils && lib.ESD_Utils.buildPermissionQuery) {
            commonQuery = lib.ESD_Utils.buildPermissionQuery(
                scope,
                unitIds,
                fieldNames,
                createdByField
            );
        }
    } catch (eCommonPermission) {
        commonQuery = "";
    }

    commonQuery = String(commonQuery == null ? "" : commonQuery).trim();

    // Một số version hàm chung trả "false" khi scope đơn vị chưa có unit.
    // Với hóa đơn, vẫn phải đảm bảo người upload tự xem được hóa đơn mình upload.
    if (!commonQuery || commonQuery === "false") {
        commonQuery = buildHTKTFallbackPermissionQuery(
            scope,
            unitIds,
            fieldNames,
            createdByField,
            currentUser
        );
    }

    return normalizeHTKTQueryForRest(commonQuery);
}

function buildHTKTInvoiceDataFilter(currentUser, hasView, dataPermission) {
    var result = {
        defaultFilter: "(1=0)",
        dataScope: "Khong co quyen xem",
        dataScopeCode: "",
        dataScopeField: "",
        dataScopeUnits: []
    };

    var safeCurrentUser = String(currentUser == null ? "" : currentUser).trim();

    if (!hasView || !safeCurrentUser) {
        return result;
    }

    var normalizedPermission = normalizeHTKTDataPermission(dataPermission);
    var scope = normalizedPermission.scope;
    var unitArr = normalizedPermission.unit;

    result.dataScopeCode = scope;
    result.dataScope = getHTKTDataScopeName(scope);
    result.dataScopeField = getHTKTDataScopeField(scope);
    result.dataScopeUnits = scope === "QT_PQDL_01" ? [safeCurrentUser] : unitArr;

    if (scope === "QT_PQDL_06") {
        result.defaultFilter = "true";
        result.dataScopeField = "ALL";
        result.dataScopeUnits = [];
        return result;
    }

    result.defaultFilter = buildHTKTCommonPermissionQuery(
        scope,
        unitArr,
        ["unit.lv1", "unit.lv2", "unit.lv3"],
        "created.by",
        safeCurrentUser
    );

    if (!result.defaultFilter || result.defaultFilter === "false") {
        result.defaultFilter = 'created.by="' + qHTKT(safeCurrentUser) + '"';
    }

    if (result.defaultFilter !== "true") {
        result.defaultFilter = normalizeHTKTQueryForRest(result.defaultFilter);
    }

    return result;
}

function buildHTKTPrepaymentCreatedByFilter(currentUser, hasView) {
    var result = {
        defaultFilter: "(1=0)",
        dataScope: "Khong co quyen xem",
        dataScopeCode: "",
        dataScopeField: "",
        dataScopeUnits: []
    };

    var safeCurrentUser = String(currentUser == null ? "" : currentUser).trim();

    if (!hasView || !safeCurrentUser) {
        return result;
    }

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

    var draftCreatedByCondition =
        '((status="dmms_created" OR status="kttc_created") AND created.by="' + user + '")';

    var nonDraftRelatedCondition =
        '((status~="dmms_created" AND status~="kttc_created") AND (' +
        relatedUserConditions.join(" OR ") +
        '))';

    result.defaultFilter = "(" + draftCreatedByCondition + " OR " + nonDraftRelatedCondition + ")";

    result.defaultFilter = normalizeHTKTQueryForRest(result.defaultFilter);

    result.dataScope = "Tao moi chi nguoi tao xem; sau khi trinh thi nguoi lien quan xem";
    result.dataScopeCode = "HTKT_PREPAYMENT_DRAFT_AWARE_RELATED_USER";
    result.dataScopeField = "status+created.by+related.users";
    result.dataScopeUnits = [safeCurrentUser];

    return result;
}

/**
 * HẬU KIỂM - nhận diện bằng RIGHT chức năng riêng của module Tạm ứng.
 *
 * 0040040002000010 = Hậu kiểm đề nghị tạm ứng.
 *
 * Không suy luận Hậu kiểm từ tổ hợp quyền 0009 / quyền Hóa đơn nữa,
 * tránh nhận diện nhầm Checker/Approver/ApproverFinal hoặc các role mới sau này.
 */
function isHTKTPostAuditRole(rightsArray) {
    var rights = uniqueHTKTArray(rightsArray);
    var RIGHT_PREPAYMENT_POST_AUDIT = "0040040002000010";

    return rights.indexOf(RIGHT_PREPAYMENT_POST_AUDIT) >= 0;
}

/**
 * HẬU KIỂM - mapping PS -> OGL Seg1 qua esdDMentity.
 *
 * Chỉ xét bản ghi ACTIVE. Nếu một PS code map ra nhiều entity.code khác nhau
 * thì coi là không xác định và nhánh Trụ sở chính sẽ fail-closed.
 */
function getHTKTActiveEntityCodeByPsCode(psCode) {
    var safePsCode = String(psCode == null ? "" : psCode).trim();

    if (!safePsCode) {
        return "";
    }

    var entityFile = null;
    var entityCodes = [];
    var seenEntityCodes = {};

    try {
        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
        var rcEntity = entityFile.doSelect(
            'ps.code="' + qHTKT(safePsCode) + '" and status="ACTIVE"'
        );

        while (rcEntity == RC_SUCCESS) {
            var entityCode = String(entityFile["entity.code"] || "").trim();

            if (entityCode && !seenEntityCodes[entityCode]) {
                seenEntityCodes[entityCode] = true;
                entityCodes.push(entityCode);
            }

            rcEntity = entityFile.getNext();
        }
    } catch (eEntityByPs) {
        return "";
    } finally {
        if (entityFile) {
            try {
                entityFile.doClose();
            } catch (eCloseEntityByPs) {}
        }
    }

    return entityCodes.length === 1 ? entityCodes[0] : "";
}

/**
 * HẬU KIỂM - lấy toàn bộ PS code ACTIVE thuộc một entity.code.
 *
 * psPrefix được dùng để chỉ lấy PS Trụ sở chính (0999) khi cần.
 */
function getHTKTActivePsCodesByEntityCode(entityCode, psPrefix) {
    var safeEntityCode = String(entityCode == null ? "" : entityCode).trim();
    var safePrefix = String(psPrefix == null ? "" : psPrefix).trim();
    var result = [];
    var seenPsCodes = {};

    if (!safeEntityCode) {
        return result;
    }

    var entityFile = null;

    try {
        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
        var rcEntity = entityFile.doSelect(
            'entity.code="' + qHTKT(safeEntityCode) + '" and status="ACTIVE"'
        );

        while (rcEntity == RC_SUCCESS) {
            var psCode = String(entityFile["ps.code"] || "").trim();

            if (
                psCode &&
                (!safePrefix || psCode.indexOf(safePrefix) === 0) &&
                !seenPsCodes[psCode]
            ) {
                seenPsCodes[psCode] = true;
                result.push(psCode);
            }

            rcEntity = entityFile.getNext();
        }
    } catch (ePsByEntity) {
        return [];
    } finally {
        if (entityFile) {
            try {
                entityFile.doClose();
            } catch (eClosePsByEntity) {}
        }
    }

    return result;
}
/**
 * HẬU KIỂM - phân miền dữ liệu đề nghị tạm ứng.
 *
 * RIGHT quyết định user có phải Hậu kiểm hay không.
 * Data Permission + thông tin tổ chức quyết định phạm vi dữ liệu:
 *
 * 1. QT_PQDL_06:
 *    - Hậu kiểm toàn hệ thống.
 *    - Xem tất cả Trụ sở chính + Chi nhánh.
 *
 * 2. QT_PQDL_04 + LV1 không bắt đầu 0999:
 *    - Hậu kiểm Chi nhánh.
 *    - Chỉ xem đúng LV1 của currentUser.
 *
 * 3. QT_PQDL_04 + LV1 bắt đầu 0999:
 *    - Chỉ hợp lệ khi PS map ACTIVE sang entity.code = 1010098.
 *    - Xem toàn bộ PS ACTIVE bắt đầu 0999 thuộc entity.code = 1010098.
 *
 * Nếu cấu hình scope/LV1/mapping không hợp lệ => fail-closed bằng (1=0).
 */
function buildHTKTPrepaymentPostAuditLv1Filter(currentUser, hasView, contactInfo, dataPermission) {
    var result = {
        defaultFilter: "(1=0)",
        dataScope: "Khong co quyen xem",
        dataScopeCode: "",
        dataScopeField: "",
        dataScopeUnits: []
    };

    var safeCurrentUser = String(currentUser == null ? "" : currentUser).trim();

    if (!hasView || !safeCurrentUser) {
        return result;
    }

    var normalizedPermission = normalizeHTKTDataPermission(dataPermission);
    var permissionScope = normalizedPermission.scope;

    // CASE 1 - Hậu kiểm toàn hệ thống.
    if (permissionScope === "QT_PQDL_06") {
        result.defaultFilter = "true";
        result.dataScope = "Toan hang - Hau kiem";
        result.dataScopeCode = "QT_PQDL_06";
        result.dataScopeField = "ALL";
        result.dataScopeUnits = [];
        return result;
    }

    // CASE 2/3 bắt buộc dùng scope Khối/CN/DVSN.
    if (permissionScope !== "QT_PQDL_04") {
        return result;
    }

    var safeLv1 = String(
        contactInfo && contactInfo.lv1 != null ? contactInfo.lv1 : ""
    ).trim();

    if (!safeLv1) {
        return result;
    }

    var HEAD_OFFICE_PS_PREFIX = "0999";
    var HEAD_OFFICE_OGL_SEG1 = "1010098";

    // CASE 2 - Hậu kiểm Chi nhánh: chỉ đúng LV1 của currentUser.
    if (safeLv1.indexOf(HEAD_OFFICE_PS_PREFIX) !== 0) {
        result.defaultFilter = 'unit.lv1="' + qHTKT(safeLv1) + '"';
        result.defaultFilter = normalizeHTKTQueryForRest(result.defaultFilter);
        result.dataScope = "Khoi/CN/DVSN - Hau kiem";
        result.dataScopeCode = "QT_PQDL_04";
        result.dataScopeField = "unit.lv1";
        result.dataScopeUnits = [safeLv1];
        return result;
    }

    // CASE 3 - Hậu kiểm Trụ sở chính.
    var currentEntityCode = getHTKTActiveEntityCodeByPsCode(safeLv1);

    if (currentEntityCode !== HEAD_OFFICE_OGL_SEG1) {
        return result;
    }

    var headOfficePsCodes = getHTKTActivePsCodesByEntityCode(
        HEAD_OFFICE_OGL_SEG1,
        HEAD_OFFICE_PS_PREFIX
    );

    if (headOfficePsCodes.length === 0) {
        return result;
    }

    var headOfficeConditions = [];

    for (var i = 0; i < headOfficePsCodes.length; i++) {
        headOfficeConditions.push(
            'unit.lv1="' + qHTKT(headOfficePsCodes[i]) + '"'
        );
    }

    result.defaultFilter =
        headOfficeConditions.length === 1 ?
        headOfficeConditions[0] :
        "(" + headOfficeConditions.join(" OR ") + ")";

    result.defaultFilter = normalizeHTKTQueryForRest(result.defaultFilter);
    result.dataScope = "Tru so chinh - Hau kiem";
    result.dataScopeCode = "QT_PQDL_04";
    result.dataScopeField = "unit.lv1";
    result.dataScopeUnits = headOfficePsCodes;

    return result;
}

function readHTKTContactInfo(currentUser) {
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
        contactFile = new SCFile("contacts", SCFILE_READONLY);
        var rcContact = contactFile.doSelect('contact.name="' + qHTKT(currentUser) + '"');

        if (rcContact == RC_SUCCESS) {
            result.fullName =
                contactFile["full.name"] ||
                contactFile["contact.full.name"] ||
                contactFile["contact.name"] ||
                "";

            result.branchCode =
                contactFile["branch.code"] ||
                contactFile["branch_code"] ||
                "";

            result.lv1 = contactFile["lv1.id"] || contactFile.lv1_id || "";
            result.lv2 = contactFile["lv2.id"] || contactFile.lv2_id || "";
            result.lv3 = contactFile["lv3.id"] || contactFile.lv3_id || "";
            result.orgUnit = contactFile["org.unit"] || contactFile.org_unit || "";
            result.position = contactFile["position"] || "";
            result.positionName = contactFile["position.name"] || contactFile.position_name || "";
        }
    } catch (eContact) {
        result = result;
    } finally {
        if (contactFile) {
            try {
                contactFile.doClose();
            } catch (eCloseContact) {}
        }
    }

    return result;
}

function getHTKTRightsArray() {
    var rightsArray = [];

    try {
        rightsArray = vars['$G.rights'] ?
            vars['$G.rights'].toArray().map(function(r) {
                return String(r == null ? "" : r).trim();
            }) : [];
    } catch (eRights) {
        rightsArray = [];
    }

    return uniqueHTKTArray(rightsArray);
}

function getHTKTDataPermission(currentUser, subModule) {
    var dataPermission = {
        scope: "",
        unit: []
    };

    try {
        dataPermission = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(currentUser, subModule) || dataPermission;
    } catch (eDP) {
        dataPermission = {
            scope: "",
            unit: []
        };
    }

    return normalizeHTKTDataPermission(dataPermission);
}

function renderList() {
    var currentUser = vars['$lo.contact.name'];
    var smLoginUser = system.user.name;

    var contactInfo = readHTKTContactInfo(currentUser);

    var rightsArray = getHTKTRightsArray();

    /*
     * Quyền view tách theo loại tác vụ:
     *
     * Khởi tạo:
     * - 0040040001000001: Xem danh sách & chi tiết hóa đơn - Khởi tạo
     * - 0040040002000001: Xem danh sách đề nghị tạm ứng - Khởi tạo
     *
     * Xử lý / phê duyệt:
     * - 0040040001000004: Xem danh sách & chi tiết hóa đơn - Phê duyệt
     * - 0040040002000009: Xem danh sách đề nghị tạm ứng - Phê duyệt
     */
    var initialRole = "";

    if (rightsArray.indexOf("0040040002000002") >= 0) {
        initialRole =
            rightsArray.indexOf("0040040002000003") >= 0 ?
            "kttc" :
            "dmms";
    }
    var RIGHT_INVOICE_VIEW_CREATE = "0040040001000001";
    var RIGHT_INVOICE_VIEW_APPROVAL = "0040040001000004";

    var RIGHT_PREPAYMENT_VIEW_CREATE = "0040040002000001";
    var RIGHT_PREPAYMENT_VIEW_APPROVAL = "0040040002000009";

    var RIGHT_INVOICE_UPLOAD = "0040040001000002";
    var RIGHT_INVOICE_DELETE = "0040040001000003";

    var hasInvoiceView =
        rightsArray.indexOf(RIGHT_INVOICE_VIEW_CREATE) >= 0 ||
        rightsArray.indexOf(RIGHT_INVOICE_VIEW_APPROVAL) >= 0;

    var hasPrepaymentView =
        rightsArray.indexOf(RIGHT_PREPAYMENT_VIEW_CREATE) >= 0 ||
        rightsArray.indexOf(RIGHT_PREPAYMENT_VIEW_APPROVAL) >= 0;

    /*
     * User được vào danh sách tạm ứng nếu có đủ quyền xem hóa đơn
     * và quyền xem danh sách đề nghị tạm ứng theo một trong hai nhóm:
     * khởi tạo hoặc xử lý/phê duyệt.
     */
    var hasView = hasInvoiceView && hasPrepaymentView;
    var hasUpload = rightsArray.indexOf(RIGHT_INVOICE_UPLOAD) >= 0;
    var hasDelete = rightsArray.indexOf(RIGHT_INVOICE_DELETE) >= 0;

    // Phân quyền dữ liệu Hợp đồng đang cấu hình chung ở sub.module = 00401.
    // Quyền chức năng view đã tách khởi tạo / phê duyệt theo rule HTKT tạm ứng.
    var DATA_PERMISSION_SUB_MODULE = "00401";
    var dataPermission = getHTKTDataPermission(currentUser, DATA_PERMISSION_SUB_MODULE);

    /*
     * HẬU KIỂM:
     * - Nhận diện DUY NHẤT bằng right 0040040002000010.
     * - Không suy luận từ 0009 / quyền Hóa đơn.
     * - Không thay initialRole, không tham gia logic xử lý workflow DMMS/KTTC.
     *
     * Scope dữ liệu Hậu kiểm:
     * - QT_PQDL_06: toàn hệ thống.
     * - QT_PQDL_04 + LV1 != 0999*: đúng Chi nhánh/LV1.
     * - QT_PQDL_04 + LV1 = 0999* + entity 1010098: toàn Trụ sở chính.
     *
     * Các user cũ (DMMS/KTTC/Checker/Approver/ApproverFinal...) vẫn chạy nguyên
     * buildHTKTPrepaymentCreatedByFilter() đã chốt UAT.
     */
    var isPostAuditRole = isHTKTPostAuditRole(rightsArray);
    var hasPostAuditView = isPostAuditRole;
    var dataFilterInfo;

    if (isPostAuditRole) {
        dataFilterInfo = buildHTKTPrepaymentPostAuditLv1Filter(
            currentUser,
            hasPostAuditView,
            contactInfo,
            dataPermission
        );

        // Trả đúng metadata scope Hậu kiểm đã resolve ở SM xuống FE/NextJS.
        dataPermission = {
            scope: dataFilterInfo.dataScopeCode,
            unit: dataFilterInfo.dataScopeUnits
        };
    } else {
        // GIỮ NGUYÊN 100% logic phân quyền danh sách đã UAT cho các role cũ.
        dataFilterInfo = buildHTKTPrepaymentCreatedByFilter(currentUser, hasView);
    }

    var defaultFilter = dataFilterInfo.defaultFilter;
    var dataScope = dataFilterInfo.dataScope;

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        'TamUngMuaSam/DanhSachTamUng',
        '', {
            // Giữ user để tương thích code cũ
            user: currentUser,

            // FE HeaderComponents đang đọc 2 field này
            currentUser: currentUser,
            contactId: currentUser,
            initialRole: initialRole,
            // Thông tin phụ
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

            // Phân quyền dữ liệu danh sách hóa đơn
            defaultFilter: defaultFilter,
            permissionQuery: defaultFilter,
            dataScope: dataScope,
            dataScopeCode: dataFilterInfo.dataScopeCode,
            dataScopeField: dataFilterInfo.dataScopeField,
            dataScopeUnits: dataFilterInfo.dataScopeUnits,
            dataPermissionSubModule: DATA_PERMISSION_SUB_MODULE,
            dataPermission: dataPermission,

            // Phân quyền chức năng hóa đơn
            rights: rightsArray,
            permission: {
                view: isPostAuditRole ? hasPostAuditView : hasView,
                invoiceView: hasInvoiceView,
                prepaymentView: isPostAuditRole ? hasPostAuditView : hasPrepaymentView,
                upload: hasUpload,
                delete: hasDelete
            },

            btnConfig: [
                { id: 'upload', visible: hasUpload },
                { id: 'delete', visible: hasDelete },
                { id: 'check', visible: hasView }
            ],

            debugSource: "ESD_HTKT_PREPAYMENT"
        }
    );
}


//function renderTabSugesstionInfomation(endpoint, input, extraData) {
//    var currentRecord = extraData;
//    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
//        if (vars.$L_file) {
//            currentRecord = {
//                "id": vars.$L_file["id"]
//            };
//        }
//    }
//   return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('TamUngMuaSam/ThongTinDeNghi', '', currentRecord);
//}

function renderTabSugesstionInfomation(endpoint, input, extraData) {
    var currentRecord = extraData;

    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
        if (vars.$L_file) {
            var prepaymentId = vars.$L_file["id"];
            var currentPhase = vars.$L_file["current.phase"];
            var initialRole = vars.$L_file["initial.role"];

            // Nếu thiếu phase hoặc role nhưng có prepayment.id, thực hiện query để lấy từ bảng esdHTKTprepayment
            if ((!currentPhase || !initialRole) && prepaymentId) {
                var prepFile = new SCFile("esdHTKTprepayment");
                var sqlPrep = "id=\"" + prepaymentId + "\"";
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

            currentRecord = {
                "id": vars.$L_file["id"],
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
                "status": vars.$L_file["status"]
            };
        }
    }

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('TamUngMuaSam/ThongTinDeNghi', '', currentRecord);
}


function renderTabApprovalInfomation() {
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('TamUngMuaSam/ThongTinPheDuyet', '', {});
}

// tab ho so dinh kem
function renderTabAttachment(endpoint, input, extraData) {
    var currentRecord = extraData;
    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
        if (vars.$L_file) {
            currentRecord = {
                "id": vars.$L_file["id"],
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
    }

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('TamUngMuaSam/TabHoSoDinhKem', '', currentRecord)
}

// tab thong tin hach toan
function renderTabAccounting(endpoint, input, extraData) {
    var formRecord = vars['$L.file'];
    var currentRecord = extraData || {};

    if (
        (!currentRecord || Object.keys(currentRecord).length === 0) &&
        formRecord
    ) {
        currentRecord = formRecord;
    }

    var transactionId = currentRecord ?
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

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        'TamUngMuaSam/TabThongTinHT',
        '', {
            id: transactionId,
            prepaymentId: transactionId,
            transactionId: transactionId,

            user: currentUser,
            currentUser: currentUser,
            contactId: currentUser,

            currentPhase: currentPhase,
            userCheckerKttc: userCheckerKttc,
            initialRole: initialRole,

            currentRecord: {
                id: transactionId,
                currentPhase: currentPhase,
                userCheckerKttc: userCheckerKttc,
                initialRole: initialRole
            }
        }
    );
}

// tab ket qua hach toan
function renderTabAccountingResults() {
    return lib.ESD_HTKT_PREPAYMENT_ENTRY_RESULT
        .renderTabAccountingResults();
}

function renderFormKySo() {
    var file = vars['$L.file'];
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

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('TamUngMuaSam/ky-so', `?id=${file.id}&userad=${vars["$lo.contact.name"]}`, {
        defaultFilter: '',
        user: vars['$lo.contact.name'],
        phieuId: file.id,
    });

}

function buildRawDataRow(file, fields) {
    let obj = {};
    fields.forEach(k => {
        var newKey = k.replace(/\./g, '_');
        obj[newKey] = file[k];
    });
    return obj;
}

var configTables = {
    "esdDMbank": [
        { field: 'citad.branch.code', name: 'Mã Citad Chi nhánh', width: '20%' },
        { field: 'citad.code', name: 'Mã Citad Hội sở', width: '20%' },
        { field: 'napas.code', name: 'Mã Napas', width: '20%' },
        { field: 'name', name: 'Tên Ngân hàng', width: '40%' },
    ],
    "esdDMentity": [
        { field: 'entity.code', name: 'Entity Code', width: '10%' },
        { field: 'ps.code', name: 'Ps Code', width: '10%' },
        { field: 'ogl.branch.code', name: 'Org Branch Code', width: '10%' },
        { field: 'org.transaction.code', name: 'Org Transaction Code', width: '10%' },
        { field: 'branch.name', name: 'Branch Name', width: '40%' },
        { field: 'status', name: 'Status', width: '20%' },
    ],
    "esdDMcostCenter": [
        { field: 'cost.center', name: 'Cost Center', width: '10%' },
        { field: 'org.code', name: 'Org Code', width: '10%' },
        { field: 'division.code', name: 'Division Code', width: '10%' },
        { field: 'department.code', name: 'Department Code', width: '10%' },
        { field: 'name', name: 'Name', width: '40%' },
        { field: 'status', name: 'Status', width: '20%' },
    ],
    "esdDMglAccount": [
        { field: 'account', name: 'Account', width: '20%' },
        { field: 'name', name: 'Name', width: '40%' },
        { field: 'account.type', name: 'Account ', width: '20%' },
        { field: 'type', name: 'Type', width: '20%' }
    ],
}

function renderBankCategory() {
    return renderCategoryList('esdDMbank');
}

function renderCostCenterCategory() {
    return renderCategoryList('esdDMcostCenter');
}

function renderGlAccountCategory() {
    return renderCategoryList('esdDMglAccount');
}

function renderCategoryList(fileName) {
    let configTable = configTables[fileName] || [];
    let fields = configTable.map(x => x.field);
    let escapeFields = fields.map(x => x.replace(/\./g, '_'));
    let raw_data = [];
    let f = new SCFile(fileName);
    let rc = f.doSelect(true);
    while (rc == RC_SUCCESS) {
        const row = buildRawDataRow(f, fields);
        raw_data.push(
            lib.ESD_Validate_Fields.escapeFields(row, escapeFields)
        );
        rc = f.getNext();
    }
    try { if (f) f.doClose(); } catch (e) {}

    let dynamicColumns = configTable.map((item, index) => {
        let colDef = {
            data: item.field.replace(/\./g, '_'),
            title: item.name || item.field,
            width: item.width || 'auto'
        };

        if (index === 0) {
            colDef.render = function(data, type, row, meta) {
                if (type === "display" && data) {
                    return '<a class="link-ticket" data-dm-id="' + data + '" href="javascript:void(0);">' + data + '</a>';
                }
                return data || '';
            };
        }
        return colDef;
    });

    var strVar = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="../js/sl/css/dataTables.dataTables.css">
            <link rel="stylesheet" href="../js/sl/css/buttons.dataTables.css">
            <link rel="stylesheet" href="../js/sl/css/base.css">
            <link rel="stylesheet" href="../js/sl/css/iconhpt.css">
        </head>
        <body>
          <table id="tableID" class="display" style="width:100%">
            <thead></thead>
            <tbody></tbody>
          </table>
            <script src="../js/sl/js/jquery-3.7.1.js"></script>
            <script src="../js/sl/js/dataTables-2.0.5.js"></script>
            <script src="../js/sl/js/dataTables.buttons.min.js"></script>
            <script src="../js/sl/js/buttons.dataTables.min.js"></script>
            <script src="../js/sl/js/jszip.min.js"></script>
            <script src="../js/sl/js/buttons.html5.min.js"></script>
            <script src="../js/sl/js/utils/defaultDatatable.js"></script>
          <script>
//            function openTaskDetails(fileName, taskNumber, fieldId) {
//                var queryFilter = encodeURIComponent(fieldId+'="' + taskNumber + '"');
//                var builder = parent.cwc.getDetailURLBuilder();
//                builder.addParam('ctx', 'docEngine');
//                builder.addParam('wflink', 'true');
//                builder.addParam('file', fileName);
//                builder.addParam('query', queryFilter);
//                var wfUrl = builder.toURL();
//                var newTab = parent.cwc.updateActiveTab(wfUrl);
//            }

//            function setupLinkClickEvent(selector, fileName, dataAttr, fieldId) {
//                // Sử dụng Event Delegation gắn vào $(document) hoặc $('#tableID')
//                $(document).on('click', selector, function (e) {
//                    e.preventDefault(); // Ngăn chặn hành vi nhảy trang mặc định của thẻ <a>
//                    
//                    // Lấy giá trị ID (mã ticket) từ data-attribute (ví dụ: data-dm-id="...")
//                    var taskNumber = $(this).data(dataAttr); 
//                    
//                    if (taskNumber) {
//                        // Gọi hàm openTaskDetails đã được định nghĩa sẵn
//                        openTaskDetails(fileName, taskNumber, fieldId);
//                    } else {
//                        console.warn("Không tìm thấy giá trị ID trên thẻ link!");
//                    }
//                });
//            }

            var raw_data = ${JSON.stringify(raw_data)};
            var columnsConfig = ${JSON.stringify(dynamicColumns)};

            if (columnsConfig.length > 0) {
                columnsConfig[0].render = function (data, type, row, meta) {
                    if (type === "display" && data) {
                        return '<a class="link-ticket" data-dm-id="' + data + '" href="javascript:void(0);">' + data + '</a>';
                    }
                    return data || '';
                };
            }
            const tableOptions = getDefaultDataTableOptions(raw_data, {
              order: [[0, 'asc']],
              scrollCollapse: true,
              scrollY: '40rem',
              
              columns: columnsConfig,
              pageLength: 10,
              columnDefs: [
                { targets: '_all', defaultContent: "" },
              ],
        
              layout: {
                topStart: {
                  buttons: [{
                    text: '<i class="iconhpt-cloud-download"></i> Xuất file',
                    extend: 'excelHtml5',
                    messageTop: null,
                    messageBottom: null,
                    autoFilter: true,
                    sheetName: 'Exported data',
                  }]
                }
              },
            });
            const table = new DataTable('#tableID', tableOptions);
            
            setupLinkClickEvent('a.link-ticket', '${fileName}', 'dm-id', '${fields[0]}');
        </script>
        </body>
        </html>`;
    return strVar;
}


function renderEntityCategory() {
    let fileName = "esdDMentity";
    let configTable = configTables[fileName] || [];
    let fields = configTable.map(x => x.field);
    let escapeFields = fields.map(x => x.replace(/\./g, '_'));
    let raw_data = [];
    let f = new SCFile(fileName);
    let rc = f.doSelect(true);
    while (rc == RC_SUCCESS) {
        const row = buildRawDataRow(f, fields);
        raw_data.push(
            lib.ESD_Validate_Fields.escapeFields(row, escapeFields)
        );
        rc = f.getNext();
    }
    try { if (f) f.doClose(); } catch (e) {}

    let dynamicColumns = configTable.map((item, index) => {
        let colDef = {
            data: item.field.replace(/\./g, '_'),
            title: item.name || item.field,
            width: item.width || 'auto'
        };
        return colDef;
    });

    var strVar = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link rel="stylesheet" href="../js/sl/css/dataTables.dataTables.css">
            <link rel="stylesheet" href="../js/sl/css/buttons.dataTables.css">
            <link rel="stylesheet" href="../js/sl/css/base.css">
            <link rel="stylesheet" href="../js/sl/css/iconhpt.css">
        </head>
        <body>
          <table id="tableID" class="display" style="width:100%">
            <thead></thead>
            <tbody></tbody>
          </table>
            <script src="../js/sl/js/jquery-3.7.1.js"></script>
            <script src="../js/sl/js/dataTables-2.0.5.js"></script>
            <script src="../js/sl/js/dataTables.buttons.min.js"></script>
            <script src="../js/sl/js/buttons.dataTables.min.js"></script>
            <script src="../js/sl/js/jszip.min.js"></script>
            <script src="../js/sl/js/buttons.html5.min.js"></script>
            <script src="../js/sl/js/utils/defaultDatatable.js"></script>
          <script>
            function openTaskDetails(fileName, queryString) {
                var builder = parent.cwc.getDetailURLBuilder();
                builder.addParam('ctx', 'docEngine');
                builder.addParam('wflink', 'true');
                builder.addParam('file', fileName);
                builder.addParam('query', queryString);
                var wfUrl = builder.toURL();
                var newTab = parent.cwc.updateActiveTab(wfUrl);
            }

            function setupLinkClickEvent(selector, fileName, dataAttr) {
                // Sử dụng Event Delegation gắn vào $(document) hoặc $('#tableID')
                $(document).on('click', selector, function (e) {
                    e.preventDefault(); // Ngăn chặn hành vi nhảy trang mặc định của thẻ <a>
                    
                    // Lấy giá trị ID (mã ticket) từ data-attribute (ví dụ: data-dm-id="...")
                    var queryString = $(this).data(dataAttr); 
                    
                    if (queryString) {
                        // Gọi hàm openTaskDetails đã được định nghĩa sẵn
                        openTaskDetails(fileName, queryString);
                    } else {
                        console.warn("Không tìm thấy giá trị ID trên thẻ link!");
                    }
                });
            }

            var raw_data = ${JSON.stringify(raw_data)};
            var columnsConfig = ${JSON.stringify(dynamicColumns)};

            if (columnsConfig.length > 0) {
                columnsConfig[0].render = function (data, type, row, meta) {
                    var dataClick = encodeURIComponent('entity.code = "' + row.entity_code + '" and ps.code = "'+ row.ps_code +'"');
                    if (type === "display" && data) {
                        return '<a class="link-ticket" data-dm-id="' + dataClick + '" href="javascript:void(0);">' + data + '</a>';
                    }
                    return data || '';
                };
            }
            const tableOptions = getDefaultDataTableOptions(raw_data, {
              order: [[0, 'asc']],
              scrollCollapse: true,
              scrollY: '40rem',
              
              columns: columnsConfig,
              pageLength: 10,
              columnDefs: [
                { targets: '_all', defaultContent: "" },
              ],
        
              layout: {
                topStart: {
                  buttons: [{
                    text: '<i class="iconhpt-cloud-download"></i> Xuất file',
                    extend: 'excelHtml5',
                    messageTop: null,
                    messageBottom: null,
                    autoFilter: true,
                    sheetName: 'Exported data',
                  }]
                }
              },
            });
            const table = new DataTable('#tableID', tableOptions);
            
            setupLinkClickEvent('a.link-ticket', '${fileName}', 'dm-id');
        </script>
        </body>
        </html>`;
    return strVar;
}

function renderHdsd() {
    var scFile = new SCFile('esdAttachments');
    var result = scFile.doSelect(`id = "HDSD" and module = "HTKT" and function = "Tam ung"`);
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