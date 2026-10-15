/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_ENTRY_ERROR
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Tra cứu và phân trang danh sách các đề nghị thanh toán bị lỗi hạch toán hoặc lỗi đồng bộ OGL.
 * - Phân quyền dữ liệu theo phạm vi quyền hạn của người dùng (Data Scope / Permission).
 * - Cung cấp bộ lọc tìm kiếm nâng cao theo trạng thái lỗi, đơn vị, người tạo và khoảng thời gian.
 * - Trả về cấu trúc dữ liệu chuẩn hóa phục vụ hiển thị trên giao diện NextJS/Web.
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

    var dataFilterInfo = buildHTKTPaymentCreatedByFilter(currentUser, hasView);
    var defaultFilter = dataFilterInfo.defaultFilter;
    var dataScope = dataFilterInfo.dataScope;

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
            'HachToanKeToan/ThanhToan/DanhSachLoiHachToan',
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
                    view: hasView,
                    invoiceView: hasInvoiceView,
                    paymentView: hasPaymentView,
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
