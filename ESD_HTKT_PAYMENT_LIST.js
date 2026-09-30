/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_LIST
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Tra cứu và phân trang danh sách các phiếu đề nghị thanh toán (esdHTKTpayment).
 * - Phân quyền dữ liệu tra cứu theo quyền hạn và phạm vi đơn vị của người dùng (Data Permission).
 * - Hỗ trợ các bộ lọc tìm kiếm theo mã phiếu, trạng thái workflow, người tạo, ngày lập.
 * - Chuẩn hóa định dạng danh sách trả về cho giao diện NextJS/Web frontend.
 * -----------------------------------------------------------------------------
 */

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


function buildHTKTPaymentCreatedByFilter(currentUser, hasView) {
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


    var relatedUserFields = [
        "created.by",
        "user.checker.kttc",
        "user.checker.dmms",
        "user.approver.dmms",
        "user.approver.kttc",
        "user.checker.final",
        "user.approver.final"
    ];

    var conditions = [];

    for (var i = 0; i < relatedUserFields.length; i++) {
        conditions.push(
            relatedUserFields[i] + '="' + qHTKT(safeCurrentUser) + '"'
        );
    }

    result.defaultFilter = "(" + conditions.join(" OR ") + ")";
    result.dataScope = "Nguoi tao hoac nguoi duoc giao xu ly";
    result.dataScopeCode = "HTKT_PAYMENT_RELATED_USER";
    result.dataScopeField = relatedUserFields.join("+");
    result.dataScopeUnits = [safeCurrentUser];

    return result;
}


/**
 * HẬU KIỂM - nhận diện bằng RIGHT chức năng riêng của module Thanh toán.
 *
 * 0040040003000010 = Hậu kiểm đề nghị thanh toán.
 *
 * Không suy luận Hậu kiểm từ quyền Hóa đơn / 0009 / quyền Tạm ứng nữa,
 * tránh nhận diện nhầm Checker/Approver/ApproverFinal hoặc các role mới sau này.
 */
function isHTKTPaymentPostAuditRole(rightsArray) {
    var rights = uniqueHTKTArray(rightsArray);
    var RIGHT_PAYMENT_POST_AUDIT = "0040040003000010";

    return rights.indexOf(RIGHT_PAYMENT_POST_AUDIT) >= 0;
}

/**
 * HẬU KIỂM - mapping PS -> OGL Seg1 qua esdDMentity.
 *
 * Chỉ xét bản ghi ACTIVE. Nếu một PS code map ra nhiều entity.code khác nhau
 * thì coi là không xác định và nhánh Trụ sở chính sẽ fail-closed.
 */
function getHTKTPaymentActiveEntityCodeByPsCode(psCode) {
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
function getHTKTPaymentActivePsCodesByEntityCode(entityCode, psPrefix) {
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
 * HẬU KIỂM - phân miền dữ liệu đề nghị thanh toán.
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
 * Lưu ý PAYMENT:
 * - Không ép query vật lý unit.lv1 trên esdHTKTpayment.
 * - Addon NextJS hiện scope PAYMENT theo created.by -> contacts.lv1.id.
 * - Vì vậy SM truyền metadata dataScopeCode/dataScopeField/dataScopeUnits tin cậy.
 *
 * Nếu cấu hình scope/LV1/mapping không hợp lệ => fail-closed.
 */
function buildHTKTPaymentPostAuditLv1Filter(currentUser, hasView, contactInfo, dataPermission) {
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
        // Giữ metadata QT_PQDL_04 để addon fail-closed bằng unit rỗng.
        result.defaultFilter = "true";
        result.dataScope = "Khoi/CN/DVSN - Hau kiem";
        result.dataScopeCode = "QT_PQDL_04";
        result.dataScopeField = "unit.lv1";
        result.dataScopeUnits = [];
        return result;
    }

    var HEAD_OFFICE_PS_PREFIX = "0999";
    var HEAD_OFFICE_OGL_SEG1 = "1010098";

    // CASE 2 - Hậu kiểm Chi nhánh: chỉ đúng LV1 của currentUser.
    if (safeLv1.indexOf(HEAD_OFFICE_PS_PREFIX) !== 0) {
        result.defaultFilter = "true";
        result.dataScope = "Khoi/CN/DVSN - Hau kiem";
        result.dataScopeCode = "QT_PQDL_04";
        result.dataScopeField = "unit.lv1";
        result.dataScopeUnits = [safeLv1];
        return result;
    }

    // CASE 3 - Hậu kiểm Trụ sở chính.
    var currentEntityCode = getHTKTPaymentActiveEntityCodeByPsCode(safeLv1);

    result.defaultFilter = "true";
    result.dataScope = "Tru so chinh - Hau kiem";
    result.dataScopeCode = "QT_PQDL_04";
    result.dataScopeField = "unit.lv1";
    result.dataScopeUnits = [];

    if (currentEntityCode !== HEAD_OFFICE_OGL_SEG1) {
        return result;
    }

    var headOfficePsCodes = getHTKTPaymentActivePsCodesByEntityCode(
        HEAD_OFFICE_OGL_SEG1,
        HEAD_OFFICE_PS_PREFIX
    );

    if (headOfficePsCodes.length === 0) {
        return result;
    }

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
     * - 0040040003000001: Xem danh sách đề nghị tạm ứng - Khởi tạo
     *
     * Xử lý / phê duyệt:
     * - 0040040001000004: Xem danh sách & chi tiết hóa đơn - Phê duyệt
     * - 0040040003000009: Xem danh sách đề nghị tạm ứng - Phê duyệt
     */
    var initialRole = "";

    if (rightsArray.indexOf("0040040003000002") >= 0) {
        initialRole =
            rightsArray.indexOf("0040040003000003") >= 0 ?
            "kttc" :
            "dmms";
    }
    var RIGHT_INVOICE_VIEW_CREATE = "0040040001000001";
    var RIGHT_INVOICE_VIEW_APPROVAL = "0040040001000004";

    var RIGHT_PAYMENT_VIEW_CREATE = "0040040003000001";
    var RIGHT_PAYMENT_VIEW_APPROVAL = "0040040003000009";

    var RIGHT_INVOICE_UPLOAD = "0040040001000002";
    var RIGHT_INVOICE_DELETE = "0040040001000003";

    var hasInvoiceView =
        rightsArray.indexOf(RIGHT_INVOICE_VIEW_CREATE) >= 0 ||
        rightsArray.indexOf(RIGHT_INVOICE_VIEW_APPROVAL) >= 0;

    var hasPaymentView =
        rightsArray.indexOf(RIGHT_PAYMENT_VIEW_CREATE) >= 0 ||
        rightsArray.indexOf(RIGHT_PAYMENT_VIEW_APPROVAL) >= 0;

    /*
     * User được vào danh sách tạm ứng nếu có đủ quyền xem hóa đơn
     * và quyền xem danh sách đề nghị tạm ứng theo một trong hai nhóm:
     * khởi tạo hoặc xử lý/phê duyệt.
     */
    var hasView = hasInvoiceView && hasPaymentView;
    var hasUpload = rightsArray.indexOf(RIGHT_INVOICE_UPLOAD) >= 0;
    var hasDelete = rightsArray.indexOf(RIGHT_INVOICE_DELETE) >= 0;

    // Phân quyền dữ liệu Hợp đồng đang cấu hình chung ở sub.module = 00401.
    // Quyền chức năng view đã tách khởi tạo / phê duyệt theo rule HTKT tạm ứng.
    var DATA_PERMISSION_SUB_MODULE = "00401";
    var dataPermission = getHTKTDataPermission(currentUser, DATA_PERMISSION_SUB_MODULE);

    /*
     * HẬU KIỂM:
     * - Nhận diện DUY NHẤT bằng right 0040040003000010.
     * - Không suy luận từ 0009 / quyền Hóa đơn / quyền Tạm ứng.
     * - Không thay initialRole, không tham gia logic xử lý workflow DMMS/KTTC.
     *
     * Scope dữ liệu Hậu kiểm:
     * - QT_PQDL_06: toàn hệ thống.
     * - QT_PQDL_04 + LV1 != 0999*: đúng Chi nhánh/LV1.
     * - QT_PQDL_04 + LV1 = 0999* + entity 1010098: toàn Trụ sở chính.
     *
     * Các user cũ (DMMS/KTTC/Checker/Approver/ApproverFinal...) vẫn chạy nguyên
     * buildHTKTPaymentCreatedByFilter() đã chốt.
     */
    var isPostAuditRole = isHTKTPaymentPostAuditRole(rightsArray);
    var hasPostAuditView = isPostAuditRole;
    var dataFilterInfo;

    if (isPostAuditRole) {
        dataFilterInfo = buildHTKTPaymentPostAuditLv1Filter(
            currentUser,
            hasPostAuditView,
            contactInfo,
            dataPermission
        );

        // Trả đúng metadata scope Hậu kiểm đã resolve ở SM xuống addon.
        dataPermission = {
            scope: dataFilterInfo.dataScopeCode,
            unit: dataFilterInfo.dataScopeUnits
        };
    } else {
        // GIỮ NGUYÊN logic phân quyền user thường đã chốt.
        dataFilterInfo = buildHTKTPaymentCreatedByFilter(currentUser, hasView);
    }

    var defaultFilter = dataFilterInfo.defaultFilter;
    var dataScope = dataFilterInfo.dataScope;
    
    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        'HachToanKeToan/ThanhToan/DanhSachDeNghi',
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
                paymentView: isPostAuditRole ? hasPostAuditView : hasPaymentView,
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