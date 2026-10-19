//function renderList(endpoint, input, extraData) {
//    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('TamUngMuaSam/DanhSachTamUng', '', {});
//}

function getTabThongTinPheDuyet(endpoint, input, extraData) {
    var prepayment = vars["$L.file"] || vars.$L_file || extraData;
    var currentUser = String(vars["$lo.contact.name"] ||
        (vars.$lo_operator ? vars.$lo_operator["contact.name"] : "") || "").trim();
    var approvalLib = lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX;
    var prepaymentId = String(prepayment && prepayment.id || "").trim();
    var initData = {};

    // $L.file có thể còn giữ người được phân công trước khi doUpdate().
    // Đọc bản ghi mới nhất khi mở lại tab để combobox hiển thị đúng ngay.
    if (prepaymentId && currentUser) {
        try {
            var fresh = approvalLib.getPrepaymentApprovalData({
                prepaymentId: prepaymentId,
                currentUser: currentUser
            });
            if (fresh && fresh.success && fresh.data) {
                initData = fresh.data;
            }
        } catch (eApprovalData) {}
    }

    if (!initData.prepaymentId && prepayment) {
        initData = approvalLib.getPrepaymentApprovalInitData(prepayment, currentUser);
    }
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

/**
 * Xác định hai role lãnh đạo được bổ sung quyền nhìn sớm / tái phân công.
 *
 * - 0040040002000005: approval_dmms - Lãnh đạo ĐMMS.
 * - 0040040002000006: approval_kttc - Lãnh đạo KTTC.
 *
 * Chỉ đọc Functional Right hiện hữu, không thay đổi role/phase workflow.
 */
function getHTKTPrepaymentLeadershipAccess(rightsArray) {
    var rights = uniqueHTKTArray(rightsArray);
    var RIGHT_APPROVE_DMMS = "0040040002000005";
    var RIGHT_APPROVE_KTTC = "0040040002000006";

    return {
        isApprovalDmms: rights.indexOf(RIGHT_APPROVE_DMMS) >= 0,
        isApprovalKttc: rights.indexOf(RIGHT_APPROVE_KTTC) >= 0
    };
}

/**
 * Dựng scope nhìn sớm cho lãnh đạo.
 *
 * Quy tắc bổ sung:
 * - Chỉ cần có approval_dmms HOẶC approval_kttc.
 * - Xem toàn bộ hồ sơ có unit.lv1 thuộc Data Permission đã resolve.
 * - Không giới hạn theo initial.role hoặc actor workflow hiện tại.
 *
 * Không có right lãnh đạo hoặc không resolve được scope => không mở rộng dữ liệu.
 */

/**
 * Chuẩn hóa Data Permission riêng cho 2 role lãnh đạo Tạm ứng.
 *
 * Quy tắc phân miền theo tổ chức hiện tại:
 * - User thuộc TSC (entity.code=1010098): xem toàn bộ PS ACTIVE của TSC.
 * - User thuộc Chi nhánh: chỉ xem toàn bộ phiếu của đúng LV1 Chi nhánh đó.
 * - Không trộn thêm unit Data Permission nằm ngoài miền tổ chức hiện tại.
 */
function resolveHTKTPrepaymentLeadershipDataPermission(dataPermission, currentLv1) {
    /*
     * Code cu:
     * var normalizedPermission = normalizeHTKTDataPermission(dataPermission);
     * var originalUnits = uniqueHTKTArray(normalizedPermission.unit);
     * return {
     *     scope: normalizedPermission.scope,
     *     unit: originalUnits
     * };
     */
    // truong them
    var safeCurrentLv1 = String(currentLv1 == null ? "" : currentLv1).trim();

    if (!safeCurrentLv1) {
        return {
            scope: "QT_PQDL_04",
            unit: []
        };
    }

    var HEAD_OFFICE_ENTITY_CODE = "1010098";
    var currentEntityCode =
        getHTKTActiveEntityCodeByPsCode(
            safeCurrentLv1
        );

    if (currentEntityCode === HEAD_OFFICE_ENTITY_CODE) {
        return {
            scope: "QT_PQDL_04",
            unit: [HEAD_OFFICE_ENTITY_CODE],
            entityCode: HEAD_OFFICE_ENTITY_CODE
        };
    }

    return {
        scope: "QT_PQDL_04",
        unit: [safeCurrentLv1]
    };
}

// truong them
/**
 * Hai quyen phe duyet DMMS/KTTC deu xem danh sach theo unit.lv1.
 * Khong cong them created.by va khong suy dien theo actor workflow.
 */
function buildHTKTPrepaymentLeadershipLv1Query(scope, unitIds) {
    var safeScope = String(scope == null ? "" : scope).trim();
    var safeUnits = uniqueHTKTArray(unitIds);

    if (safeScope === "QT_PQDL_06") {
        return "true";
    }

    /* Rule leadership hien tai chi mo theo scope Khoi/CN/DVSN. */
    if (safeScope !== "QT_PQDL_04" || safeUnits.length === 0) {
        return "(1=0)";
    }

    var conditions = [];

    for (var i = 0; i < safeUnits.length; i++) {
        conditions.push(
            'unit.lv1="' + qHTKT(safeUnits[i]) + '"'
        );
    }

    return conditions.length === 1 ?
        conditions[0] :
        "(" + conditions.join(" OR ") + ")";
}

function buildHTKTPrepaymentLeadershipVisibilityClause(currentUser, rightsArray, resolvedDataPermission) {
    var safeCurrentUser = String(currentUser == null ? "" : currentUser).trim();
    var leadership = getHTKTPrepaymentLeadershipAccess(rightsArray);

    if (!safeCurrentUser || (!leadership.isApprovalDmms && !leadership.isApprovalKttc)) {
        return "";
    }
    if (resolvedDataPermission && resolvedDataPermission.entityCode === "1010098") {
        return 'entity.code="1010098"';
    }

    /*
     * resolvedDataPermission đã được resolve MỘT LẦN ở
     * buildHTKTPrepaymentCreatedByFilter().
     *
     * Trước đây hàm này tự resolve TSC, sau đó caller lại resolve lần nữa để
     * dựng dataScopeUnits => lặp SCFile esdDMentity không cần thiết.
     */
    var normalizedPermission =
        normalizeHTKTDataPermission(resolvedDataPermission);
    var permissionScope = normalizedPermission.scope;
    var permissionUnits = normalizedPermission.unit;

    /*
     * Code cu:
     * var permissionFields =
     *     permissionScope === "QT_PQDL_04" ?
     *     ["unit.lv1"] :
     *     ["unit.lv1", "unit.lv2", "unit.lv3"];
     *
     * var permissionQuery = buildHTKTCommonPermissionQuery(
     *     permissionScope,
     *     permissionUnits,
     *     permissionFields,
     *     "created.by",
     *     safeCurrentUser
     * );
     */
    // truong them
    var permissionQuery = buildHTKTPrepaymentLeadershipLv1Query(
        permissionScope,
        permissionUnits
    );

    permissionQuery = String(permissionQuery == null ? "" : permissionQuery).trim();

    if (!permissionQuery || permissionQuery === "false" || permissionQuery === "(1=0)") {
        return "";
    }

    /*
     * Code cu:
     * - approval_kttc loc initial.role=(dmms OR kttc).
     * - approval_dmms chi loc initial.role=dmms.
     * - chi user co dong thoi hai right moi bo loc initial.role.
     */
    // truong them
    return permissionQuery === "true" ?
        "true" :
        "(" + permissionQuery + ")";
}

function buildHTKTPrepaymentCreatedByFilter(currentUser, hasView, rightsArray, dataPermission, currentLv1) {
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

    /*
     * LOGIC GOLIVE CŨ - GIỮ NGUYÊN:
     * - Draft: chỉ người tạo nhìn thấy.
     * - Sau khi trình: người liên quan trong các field workflow nhìn thấy.
     */
    var draftCreatedByCondition =
        '((status="dmms_created" OR status="kttc_created") AND created.by="' + user + '")';

    var nonDraftRelatedCondition =
        '((status~="dmms_created" AND status~="kttc_created") AND (' +
        relatedUserConditions.join(" OR ") +
        '))';

    var visibilityConditions = [
        draftCreatedByCondition,
        nonDraftRelatedCondition
    ];

    /*
     * LOGIC BỔ SUNG:
     * Chỉ hai role approval_dmms / approval_kttc được mở rộng visibility
     * trong đúng Data Permission của mình, không ảnh hưởng các role cũ.
     *
     * TỐI ƯU:
     * Resolve Data Permission leadership đúng MỘT LẦN rồi dùng lại cho cả:
     * - leadershipVisibilityClause;
     * - dataScopeUnits gửi xuống NextJS.
     */
    var leadership = getHTKTPrepaymentLeadershipAccess(rightsArray);
    var hasLeadership =
        leadership.isApprovalDmms ||
        leadership.isApprovalKttc;

    var leadershipDataPermission =
        hasLeadership ?
        resolveHTKTPrepaymentLeadershipDataPermission(
            dataPermission,
            currentLv1
        ) :
        normalizeHTKTDataPermission(dataPermission);

    var leadershipVisibilityClause =
        buildHTKTPrepaymentLeadershipVisibilityClause(
            safeCurrentUser,
            rightsArray,
            leadershipDataPermission
        );

    /*
     * Code cu BK - giu lai de doi chieu:
     * if (leadershipVisibilityClause) {
     *     visibilityConditions.push(leadershipVisibilityClause);
     * }
     *
     * Truoc day chi khi co dong thoi approval_dmms + approval_kttc moi thay
     * TOAN BO phieu trong Data Permission.
     */
    /*
     * Code cu:
     * var hasCombinedLeadership =
     *     leadership.isApprovalDmms &&
     *     leadership.isApprovalKttc;
     * if (leadershipVisibilityClause) {
     *     visibilityConditions = hasCombinedLeadership ?
     *         [leadershipVisibilityClause] :
     *         visibilityConditions.concat([leadershipVisibilityClause]);
     * }
     */
    // truong them
    if (hasLeadership) {
        visibilityConditions = leadershipVisibilityClause ?
            [leadershipVisibilityClause] :
            ["(1=0)"];
    }

    result.defaultFilter = "(" + visibilityConditions.join(" OR ") + ")";
    result.defaultFilter = normalizeHTKTQueryForRest(result.defaultFilter);

    if (hasLeadership) {
        /*
         * Code cu:
         * result.dataScope =
         *     "Logic cu + lanh dao DMMS/KTTC duoc nhin som ho so trong pham vi Data Permission";
         */
        // truong them
        result.dataScope =
            "Lanh dao DMMS hoac KTTC xem toan bo ho so theo unit.lv1 trong Data Permission";
        result.dataScopeCode =
            "HTKT_PREPAYMENT_DRAFT_AWARE_RELATED_USER_WITH_LEADERSHIP";
        /*
         * Code cu:
         * result.dataScopeField =
         *     "status+created.by+related.users+initial.role+data.permission";
         */
        // truong them
        result.dataScopeField = "unit.lv1";
        if (leadershipDataPermission.entityCode === "1010098") {
            result.dataScopeField = "entity.code";
        }
        /*
         * Đồng bộ metadata gửi xuống NextJS với đúng scope lãnh đạo:
         * - Chi nhánh: đúng LV1 hiện tại của user.
         * - TSC: toàn bộ PS ACTIVE thuộc entity.code = 1010098.
         *
         * Reuse leadershipDataPermission đã resolve phía trên, không query lại
         * esdDMentity lần thứ hai.
         */
        result.dataScopeUnits =
            leadershipDataPermission.scope === "QT_PQDL_01" ?
            [safeCurrentUser] :
            leadershipDataPermission.unit;
    } else {
        // Metadata cũ giữ nguyên cho toàn bộ user không thuộc 2 role lãnh đạo.
        result.dataScope = "Tao moi chi nguoi tao xem; sau khi trinh thi nguoi lien quan xem";
        result.dataScopeCode = "HTKT_PREPAYMENT_DRAFT_AWARE_RELATED_USER";
        result.dataScopeField = "status+created.by+related.users";
        result.dataScopeUnits = [safeCurrentUser];
    }

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
 * HẬU KIỂM / LÃNH ĐẠO - lấy toàn bộ PS code ACTIVE thuộc một entity.code.
 *
 * entity.code là tiêu chí nghiệp vụ xác định miền.
 * Không lọc gần đúng theo prefix PS.
 */
function getHTKTActivePsCodesByEntityCode(entityCode) {
    var safeEntityCode = String(entityCode == null ? "" : entityCode).trim();
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
 * 2. QT_PQDL_04 + entity.code khác 1010098:
 *    - Hậu kiểm Chi nhánh/đơn vị.
 *    - Chỉ xem đúng LV1 của currentUser.
 *
 * 3. QT_PQDL_04 + entity.code = 1010098:
 *    - Hậu kiểm Trụ sở chính.
 *    - Xem toàn bộ PS ACTIVE thuộc entity.code = 1010098.
 *
 * Không suy luận miền TSC theo prefix 0999....
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

    /*
     * LV1 đã được readHTKTContactInfo() đọc một lần và truyền xuống initData.
     * Không lookup lại contacts.
     */
    var safeLv1 = String(
        contactInfo && contactInfo.lv1 != null ? contactInfo.lv1 : ""
    ).trim();

    if (!safeLv1) {
        return result;
    }

    var HEAD_OFFICE_ENTITY_CODE = "1010098";

    /*
     * Xác định miền theo entity.code, KHÔNG suy luận theo prefix 0999....
     *
     * - entity.code = 1010098 => Trụ sở chính.
     * - entity.code khác / không map => xử lý như scope LV1 thông thường.
     *
     * Chỉ xét mapping ACTIVE trong getHTKTActiveEntityCodeByPsCode().
     */
    var currentEntityCode =
        getHTKTActiveEntityCodeByPsCode(
            safeLv1
        );

    if (currentEntityCode !== HEAD_OFFICE_ENTITY_CODE) {
        // CASE 2 - Hậu kiểm Chi nhánh/đơn vị: chỉ đúng LV1 của currentUser.
        // NextJS áp dataScopeUnits sau khi nhận initData, giống Thanh toán.
        result.defaultFilter = "true";

        result.dataScope =
            "Khoi/CN/DVSN - Hau kiem";
        result.dataScopeCode =
            "QT_PQDL_04";
        result.dataScopeField =
            "unit.lv1";
        result.dataScopeUnits =
            [safeLv1];

        return result;
    }

    // CASE 3 - Hậu kiểm Trụ sở chính: entity.code = 1010098.
    result.defaultFilter = 'entity.code="1010098"';

    result.dataScope =
        "Tru so chinh - Hau kiem";
    result.dataScopeCode =
        "QT_PQDL_04";
    result.dataScopeField =
        "entity.code";
    result.dataScopeUnits =
        [HEAD_OFFICE_ENTITY_CODE];

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
        positionName: "",
        // truong them
        contactName: "",
        contactId: ""
    };

    var contactFile = null;

    try {
        contactFile = new SCFile("contacts", SCFILE_READONLY);
        /*
         * Code cu BK:
         * var rcContact = contactFile.doSelect(
         *     'contact.name="' + qHTKT(currentUser) + '"'
         * );
         */
        // truong them
        var safeCurrentUser = String(
            currentUser == null ? "" : currentUser
        ).trim();
        var rcContact = contactFile.doSelect(
            'contact.name="' + qHTKT(safeCurrentUser) + '"'
        );

        /*
         * ESS/API co the tra username o lowercase trong khi contacts luu
         * canonical case. Resolve lai case-insensitive de khong lam mat lv1
         * cua Hau kiem/lanh dao trong External action.
         */
        if (rcContact != RC_SUCCESS && safeCurrentUser) {
            rcContact = contactFile.doSelect(
                'tolower(contact.name)="' +
                qHTKT(safeCurrentUser.toLowerCase()) +
                '"'
            );
        }

        if (rcContact == RC_SUCCESS) {
            // truong them
            result.contactName = contactFile["contact.name"] || "";
            result.contactId = contactFile["contact.id"] || "";

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

/*
 * Code cu BK - giu lai de doi chieu:
 * function getHTKTRightsArray() {
 *     var rightsArray = [];
 *     try {
 *         rightsArray = vars['$G.rights'] ?
 *             vars['$G.rights'].toArray().map(function(r) {
 *                 return String(r == null ? "" : r).trim();
 *             }) : [];
 *     } catch (eRights) {
 *         rightsArray = [];
 *     }
 *     return uniqueHTKTArray(rightsArray);
 * }
 */
// truong them
function getHTKTRightsArray(currentUser) {
    var rightsArray = [];
    var seenRights = {};

    function mergeRights(source) {
        var normalizedRights = uniqueHTKTArray(source);

        for (var i = 0; i < normalizedRights.length; i++) {
            var rightId = normalizedRights[i];

            if (!seenRights[rightId]) {
                seenRights[rightId] = true;
                rightsArray.push(rightId);
            }
        }
    }

    function mergeRightsByIdentity(identity) {
        var safeIdentity = String(identity == null ? "" : identity).trim();

        if (!safeIdentity) {
            return;
        }

        try {
            mergeRights(
                lib.ESD_PERMS_RIGHTS.permsRight(safeIdentity) || []
            );
        } catch (ePermsRightIdentity) {}
    }

    /*
     * Custom action truyền business user đã được ESS server action xác thực.
     * Luôn đọc rights của user này, không dùng $G.rights của technical API user.
     */
    var explicitUser = String(currentUser || "").trim();
    if (explicitUser) {
        var sessionContact = String(
            vars["$lo.contact.name"] ||
            (vars.$lo_operator ? vars.$lo_operator["contact.name"] : "") ||
            ""
        ).trim();

        /*
         * Neu External action van mang dung business session thi $G.rights la
         * nguon nhanh nhat. Chi merge khi identity trung khop de khong lay
         * nham quyen cua technical user.
         */
        try {
            if (
                sessionContact &&
                sessionContact.toLowerCase() === explicitUser.toLowerCase() &&
                vars["$G.rights"]
            ) {
                mergeRights(vars["$G.rights"]);
            }
        } catch (eSessionBusinessRights) {}

        /* Thu identity caller truoc, sau do resolve canonical contact/id. */
        mergeRightsByIdentity(explicitUser);

        var contactFile = null;

        try {
            contactFile = new SCFile("contacts", SCFILE_READONLY);
            contactFile.setFields(["contact.id", "contact.name"]);

            var rcContact = contactFile.doSelect(
                'contact.name="' + qHTKT(explicitUser) + '"'
            );

            if (rcContact != RC_SUCCESS) {
                rcContact = contactFile.doSelect(
                    'tolower(contact.name)="' +
                    qHTKT(explicitUser.toLowerCase()) +
                    '"'
                );
            }

            if (rcContact == RC_SUCCESS) {
                var canonicalContactName = String(
                    contactFile["contact.name"] || ""
                ).trim();
                var resolvedContactId = String(
                    contactFile["contact.id"] || ""
                ).trim();

                mergeRightsByIdentity(canonicalContactName);

                if (
                    resolvedContactId &&
                    resolvedContactId !== canonicalContactName
                ) {
                    mergeRightsByIdentity(resolvedContactId);
                }
            }
        } catch (eResolveRightsContact) {
            /* Fail-closed: chi giu cac rights da resolve duoc. */
        } finally {
            if (contactFile) {
                try { contactFile.doClose(); } catch (eCloseRightsContact) {}
            }
        }

        return rightsArray;
    }

    try {
        mergeRights(vars['$G.rights'] || []);
    } catch (eRights) {
        rightsArray = rightsArray;
    }

    /*
     * Custom API chạy ở request riêng có thể chưa có $G.rights như renderList.
     * Khi đó đọc lại Functional Rights theo đúng business user hiện tại.
     */
    if (rightsArray.length === 0) {
        var identity = String(
            currentUser || vars["$lo.contact.name"] || ""
        ).trim();

        if (identity) {
            try {
                mergeRightsByIdentity(identity);
            } catch (ePermsRight) {
                rightsArray = rightsArray;
            }
        }
    }

    return rightsArray;
}

/*
 * Code cu BK - giu lai de doi chieu:
 * function getHTKTDataPermission(currentUser, subModule) {
 *     var dataPermission = { scope: "", unit: [] };
 *     try {
 *         dataPermission =
 *             lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(
 *                 currentUser,
 *                 subModule
 *             ) || dataPermission;
 *     } catch (eDP) {
 *         dataPermission = { scope: "", unit: [] };
 *     }
 *     return normalizeHTKTDataPermission(dataPermission);
 * }
 */
// truong them
function getHTKTDataPermission(currentUser, subModule) {
    var fallbackPermission = {
        scope: "",
        unit: []
    };
    var resolvedPermission = null;
    var resolvedIdentity = "";

    function getRawScope(dataPermission) {
        return String(
            dataPermission &&
            (
                dataPermission.scope ||
                dataPermission.dataScopeList ||
                dataPermission["permission.scope"]
            ) ||
            ""
        ).trim();
    }

    function getScopeRank(scope) {
        if (scope === "QT_PQDL_06") return 6;
        if (scope === "QT_PQDL_04") return 4;
        if (scope === "QT_PQDL_03") return 3;
        if (scope === "QT_PQDL_02") return 2;
        if (scope === "QT_PQDL_01") return 1;
        return 0;
    }

    function getRawUnitCount(dataPermission) {
        if (!dataPermission) return 0;

        return uniqueHTKTArray(
            dataPermission.unit ||
            dataPermission.arrUnitRights ||
            dataPermission.units || []
        ).length;
    }

    function tryDataPermissionIdentity(identity) {
        var safeIdentity = String(identity == null ? "" : identity).trim();

        if (!safeIdentity) {
            return;
        }

        try {
            var candidate =
                lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(
                    safeIdentity,
                    subModule
                ) || null;

            /*
             * Khong normalize ngay tai day. normalizeHTKTDataPermission()
             * mac dinh scope rong thanh QT_PQDL_01, lam mat kha nang thu lai
             * bang canonical contact.name/contact.id trong External action.
             */
            var candidateScope = getRawScope(candidate);
            var currentScope = getRawScope(resolvedPermission);

            if (
                candidateScope &&
                (
                    !resolvedPermission ||
                    getScopeRank(candidateScope) > getScopeRank(currentScope) ||
                    (
                        candidateScope === currentScope &&
                        getRawUnitCount(candidate) >
                        getRawUnitCount(resolvedPermission)
                    )
                )
            ) {
                resolvedPermission = candidate;
                resolvedIdentity = safeIdentity;
            }
        } catch (eDataPermissionIdentity) {}
    }

    var explicitUser = String(currentUser == null ? "" : currentUser).trim();
    tryDataPermissionIdentity(explicitUser);

    /*
     * permsRight() va getUnitByDataPermissions() co the dung identity khac
     * nhau tuy cau hinh SM. Neu caller truyen contact.name ma Data Permission
     * luu theo contact.id (hoac nguoc lai), resolve contact mot lan va thu ca
     * hai identity truoc khi fail-closed.
     */
    if (explicitUser) {
        var contactFile = null;

        try {
            contactFile = new SCFile("contacts", SCFILE_READONLY);
            contactFile.setFields(["contact.id", "contact.name"]);

            var rcContact = contactFile.doSelect(
                'contact.name="' + qHTKT(explicitUser) + '"'
            );

            if (rcContact != RC_SUCCESS) {
                rcContact = contactFile.doSelect(
                    'tolower(contact.name)="' +
                    qHTKT(explicitUser.toLowerCase()) +
                    '"'
                );
            }

            if (rcContact == RC_SUCCESS) {
                var canonicalContactName = String(
                    contactFile["contact.name"] || ""
                ).trim();
                var resolvedContactId = String(
                    contactFile["contact.id"] || ""
                ).trim();

                tryDataPermissionIdentity(canonicalContactName);
                tryDataPermissionIdentity(resolvedContactId);
            }
        } catch (eResolveDataPermissionContact) {
            /* Fail-closed o fallbackPermission ben duoi. */
        } finally {
            if (contactFile) {
                try { contactFile.doClose(); } catch (eCloseDataPermissionContact) {}
            }
        }
    }

    var normalizedPermission = normalizeHTKTDataPermission(
        resolvedPermission || fallbackPermission
    );

    normalizedPermission.resolvedIdentity = resolvedIdentity;
    normalizedPermission.wasResolved = resolvedPermission != null;

    return normalizedPermission;
}

// truong them
/**
 * Tái sử dụng contact đã đọc bởi readHTKTContactInfo().
 * Mục tiêu: mỗi request chỉ query contacts một lần, nhưng vẫn thử đủ
 * currentUser / canonical contact.name / contact.id như logic phía trên.
 */
function getHTKTIdentityCandidates(currentUser, contactInfo) {
    return uniqueHTKTArray([
        String(currentUser == null ? "" : currentUser).trim(),
        String(
            contactInfo && contactInfo.contactName != null ?
            contactInfo.contactName : ""
        ).trim(),
        String(
            contactInfo && contactInfo.contactId != null ?
            contactInfo.contactId : ""
        ).trim()
    ]);
}

// truong them
function getHTKTRightsArrayWithContactInfo(currentUser, contactInfo) {
    var rightsArray = [];
    var seenRights = {};
    var identities = getHTKTIdentityCandidates(currentUser, contactInfo);
    var explicitUser = String(currentUser == null ? "" : currentUser).trim();
    var sessionContact = String(
        vars["$lo.contact.name"] ||
        (vars.$lo_operator ? vars.$lo_operator["contact.name"] : "") ||
        ""
    ).trim();

    function mergeRights(source) {
        var normalizedRights = uniqueHTKTArray(source);

        for (var i = 0; i < normalizedRights.length; i++) {
            var rightId = normalizedRights[i];

            if (!seenRights[rightId]) {
                seenRights[rightId] = true;
                rightsArray.push(rightId);
            }
        }
    }

    try {
        if (
            sessionContact &&
            explicitUser &&
            sessionContact.toLowerCase() === explicitUser.toLowerCase() &&
            vars["$G.rights"]
        ) {
            mergeRights(vars["$G.rights"]);
        }
    } catch (eSessionRightsOptimized) {}

    for (var j = 0; j < identities.length; j++) {
        try {
            mergeRights(
                lib.ESD_PERMS_RIGHTS.permsRight(identities[j]) || []
            );
        } catch (eIdentityRightsOptimized) {}
    }

    return rightsArray;
}

// truong them
function getHTKTDataPermissionWithContactInfo(currentUser, subModule, contactInfo) {
    var fallbackPermission = { scope: "", unit: [] };
    var resolvedPermission = null;
    var resolvedIdentity = "";
    var identities = getHTKTIdentityCandidates(currentUser, contactInfo);

    function getRawScope(dataPermission) {
        return String(
            dataPermission &&
            (
                dataPermission.scope ||
                dataPermission.dataScopeList ||
                dataPermission["permission.scope"]
            ) ||
            ""
        ).trim();
    }

    function getScopeRank(scope) {
        if (scope === "QT_PQDL_06") return 6;
        if (scope === "QT_PQDL_04") return 4;
        if (scope === "QT_PQDL_03") return 3;
        if (scope === "QT_PQDL_02") return 2;
        if (scope === "QT_PQDL_01") return 1;
        return 0;
    }

    function getUnitCount(dataPermission) {
        if (!dataPermission) return 0;

        return uniqueHTKTArray(
            dataPermission.unit ||
            dataPermission.arrUnitRights ||
            dataPermission.units || []
        ).length;
    }

    for (var i = 0; i < identities.length; i++) {
        try {
            var candidate =
                lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(
                    identities[i],
                    subModule
                ) || null;
            var candidateScope = getRawScope(candidate);
            var currentScope = getRawScope(resolvedPermission);

            if (
                candidateScope &&
                (
                    !resolvedPermission ||
                    getScopeRank(candidateScope) > getScopeRank(currentScope) ||
                    (
                        candidateScope === currentScope &&
                        getUnitCount(candidate) > getUnitCount(resolvedPermission)
                    )
                )
            ) {
                resolvedPermission = candidate;
                resolvedIdentity = identities[i];
            }
        } catch (eIdentityDataPermissionOptimized) {}
    }

    var normalizedPermission = normalizeHTKTDataPermission(
        resolvedPermission || fallbackPermission
    );

    normalizedPermission.resolvedIdentity = resolvedIdentity;
    normalizedPermission.wasResolved = resolvedPermission != null;

    return normalizedPermission;
}

// truong them
function parseHTKTPrepaymentApiInput(input) {
    var raw = input && input.queryString ? String(input.queryString) : "";
    if (!raw) return {};

    try {
        return JSON.parse(raw) || {};
    } catch (eParse) {
        return {};
    }
}

// truong them
function getHTKTPrepaymentOptionScope(currentUser, forcePostAuditRole) {
    /*
     * Code cu:
     * var rightsArray = getHTKTRightsArray(currentUser);
     * var contactInfo = readHTKTContactInfo(currentUser);
     * var dataPermission = getHTKTDataPermission(currentUser, "00401");
     */
    // truong them
    var contactInfo = readHTKTContactInfo(currentUser);
    var rightsArray = getHTKTRightsArrayWithContactInfo(
        currentUser,
        contactInfo
    );
    var dataPermission = getHTKTDataPermissionWithContactInfo(
        currentUser,
        "00401",
        contactInfo
    );
    /*
     * External action co the khong mang $G.rights cua HTML Viewer.
     * forcePostAuditRole chi khoi phuc nhanh Hau kiem da duoc renderList/Next
     * xac dinh; Data Permission va LV1 van duoc SM resolve lai ben duoi.
     */
    // truong them
    var postAuditRole =
        isHTKTPostAuditRole(rightsArray) ||
        forcePostAuditRole === true;
    var hasAuthenticatedUser =
        String(currentUser == null ? "" : currentUser).trim() !== "";
    var hasInvoiceView =
        rightsArray.indexOf("0040040001000001") >= 0 ||
        rightsArray.indexOf("0040040001000004") >= 0;
    var hasPrepaymentView =
        rightsArray.indexOf("0040040002000001") >= 0 ||
        rightsArray.indexOf("0040040002000009") >= 0;
    var scopeInfo;

    if (postAuditRole) {
        scopeInfo = buildHTKTPrepaymentPostAuditLv1Filter(
            currentUser,
            true,
            contactInfo,
            dataPermission
        );
    } else {
        /*
         * External API context khong co day du $G.rights nhu renderList().
         * ESS server action da xac thuc currentUser; scope thuong van fail-safe
         * theo chinh created.by va workflow actor cua user nay.
         *
         * Quyen mo rong leadership/hau kiem van bat buoc right chuyen biet va
         * duoc xu ly o cac nhanh rieng, khong duoc mo chi bang authentication.
         */
        scopeInfo = buildHTKTPrepaymentCreatedByFilter(
            currentUser,
            hasAuthenticatedUser,
            rightsArray,
            dataPermission,
            contactInfo.lv1
        );
    }

    scopeInfo.rightsCount = rightsArray.length;
    scopeInfo.hasInvoiceView = hasInvoiceView;
    scopeInfo.hasPrepaymentView = hasPrepaymentView;
    scopeInfo.scopeAuthorizedBy = "ess-authenticated-workflow-user";
    scopeInfo.isPostAuditRole = postAuditRole;
    scopeInfo.dataPermissionScope = String(dataPermission.scope || "");
    scopeInfo.dataPermissionUnitCount = dataPermission.unit ? dataPermission.unit.length : 0;
    scopeInfo.dataPermissionResolvedIdentity = String(
        dataPermission.resolvedIdentity || ""
    );
    scopeInfo.dataPermissionWasResolved = dataPermission.wasResolved === true;
    scopeInfo.contactLv1 = String(contactInfo.lv1 || "");

    return scopeInfo;
}

// truong them
function getHTKTPrepaymentCurrentExecutor(record) {
    var status = String(record.status || "").trim().toLowerCase();
    var phase = String(record["current.phase"] || "").trim();
    var initialRole = String(record["initial.role"] || "").trim().toLowerCase();
    var createdBy = String(record["created.by"] || "").trim();
    var checkerKttc = String(record["user.checker.kttc"] || "").trim();
    var checkerDmms = String(record["user.checker.dmms"] || "").trim();
    var approverDmms = String(record["user.approver.dmms"] || "").trim();
    var approverKttc = String(record["user.approver.kttc"] || "").trim();
    var checkerFinal = String(record["user.checker.final"] || "").trim();
    var approverFinal = String(record["user.approver.final"] || "").trim();

    if (
        status === "dmms_created" ||
        status === "kttc_created" ||
        status === "initialized" ||
        status === "request_edit"
    ) return createdBy;

    if (status === "approved") {
        return approverFinal || approverKttc || approverDmms || createdBy;
    }
    if (status === "accounted" || status === "cancelled") return "";
    if (phase === "start" || phase === "initial_dmms") return createdBy;
    if (phase === "initial_kttc") {
        return initialRole === "kttc" ? createdBy : checkerKttc;
    }
    if (phase === "check_dmms") return checkerDmms;
    if (phase === "approval_dmms") return approverDmms;
    if (phase === "approval_kttc") return approverKttc;
    if (phase === "check_final") return checkerFinal;
    if (phase === "approval_final") return approverFinal;
    return "";
}

// truong them
function sortHTKTFilterOptions(options) {
    options.sort(function(left, right) {
        var leftText = String(left.label || "").toLowerCase();
        var rightText = String(right.label || "").toLowerCase();
        if (leftText < rightText) return -1;
        if (leftText > rightText) return 1;
        return 0;
    });
    return options;
}

// Compact action phải tự áp scope sau khi renderList chuyển defaultFilter
// Hậu kiểm QT_PQDL_04 thành "true". Scope này được SM resolve lại theo user.
function buildHTKTPrepaymentCompactQuery(scopeInfo) {
    var scopeCode = String(scopeInfo && scopeInfo.dataScopeCode || "").trim();
    var scopeField = String(scopeInfo && scopeInfo.dataScopeField || "").trim();

    if (scopeCode === "QT_PQDL_04" && scopeField === "unit.lv1") {
        var scopeUnits = uniqueHTKTArray(
            scopeInfo && scopeInfo.dataScopeUnits || []
        );
        if (!scopeUnits.length) return "(1=0)";

        var conditions = [];
        for (var i = 0; i < scopeUnits.length; i++) {
            conditions.push('unit.lv1="' + qHTKT(scopeUnits[i]) + '"');
        }
        return "(" + conditions.join(" OR ") + ")";
    }

    return String(scopeInfo && scopeInfo.defaultFilter || "(1=0)").trim();
}

/**
 * Action compact cho dropdown màn Danh sách Tạm ứng.
 * Khử trùng ngay trong SM, không trả hàng nghìn record view=expand về NextJS.
 */
// truong them
function getPrepaymentListFilterOptions(input) {
    var startedAt = new Date().getTime();
    var payload = parseHTKTPrepaymentApiInput(input);
    var suppliedUser = String(payload.currentUser || "").trim();
    var sessionUser = String(vars["$lo.contact.name"] || "").trim();

    /*
     * External API chạy bằng technical/session user nên $lo.contact.name có
     * thể khác business user của iframe. currentUser trong payload đã được
     * Next server action xác thực bằng ESS token trước khi gọi action này.
     * SM vẫn tự dựng lại Functional Rights + Data Permission của business user.
     */
    var currentUser = suppliedUser || sessionUser;

    if (!currentUser) {
        return { success: false, error: "Khong xac dinh duoc business user hien tai." };
    }

    var scopeInfo = getHTKTPrepaymentOptionScope(
        currentUser,
        payload.isPostAuditRole === true
    );
    var scopeQuery = buildHTKTPrepaymentCompactQuery(scopeInfo);
    var prepaymentFile = null;
    var departmentSeen = {};
    var lv1Seen = {};
    var lv1Codes = [];
    var includeLv1Options = scopeInfo.isPostAuditRole === true && scopeInfo.dataScopeCode === "QT_PQDL_06";
    var executorSeen = {};
    var executorOptions = [];
    var departmentCodes = [];
    var scannedRows = 0;
    var firstRowProbe = null;

    try {
        prepaymentFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
        /*
         * SCFile.doSelect() nhan dieu kien SM, khong nhan cau SQL SELECT.
         * Compact scan doc department + cac field workflow can thiet de dung
         * day du option Nguoi dang xu ly ngay trong SM.
         */
        // truong them: moi role deu nhan day du current executor trong workflow.
        var projectionFields = [
            "department",
            "id",
            "status",
            "current.phase",
            "initial.role",
            "created.by",
            "user.checker.kttc",
            "user.checker.dmms",
            "user.approver.dmms",
            "user.approver.kttc",
            "user.checker.final",
            "user.approver.final"
        ];
        if (includeLv1Options) projectionFields.push("unit.lv1");

        prepaymentFile.setFields(projectionFields);

        var rc = prepaymentFile.doSelect(scopeQuery);

        if (rc != RC_SUCCESS && scopeQuery !== "(1=0)") {
            return {
                success: false,
                error:
                    "Compact projection khong tra ve ban ghi. ReturnCode=" +
                    String(rc)
            };
        }

        while (rc == RC_SUCCESS) {
            scannedRows++;

            if (!firstRowProbe) {
                firstRowProbe = {
                    idByAlias: String(prepaymentFile["id"] || ""),
                    idByIndex: "",
                    statusByAlias: "",
                    statusByIndex: "",
                    departmentByAlias: String(prepaymentFile["department"] || ""),
                    departmentByIndex: "",
                    resolvedDepartment: String(prepaymentFile["department"] || "")
                };
            }

            /*
             * SCFile phải đọc field theo đúng tên dbdict. Dùng bracket access
             * để tránh engine SM coi department là property của JS wrapper.
             */
            var rawDepartment = prepaymentFile["department"];
            var department = String(
                rawDepartment == null ? "" : rawDepartment
            ).trim();
            if (department && !departmentSeen[department]) {
                departmentSeen[department] = true;
                departmentCodes.push(department);
            }
            if (includeLv1Options) {
                var lv1 = String(prepaymentFile["unit.lv1"] || "").trim();
                if (lv1 && !lv1Seen[lv1]) {
                    lv1Seen[lv1] = true;
                    lv1Codes.push(lv1);
                }
            }

            var currentExecutor = getHTKTPrepaymentCurrentExecutor(
                prepaymentFile
            );

            var executorKey = currentExecutor.toLowerCase();

            if (currentExecutor && !executorSeen[executorKey]) {
                executorSeen[executorKey] = true;
                executorOptions.push({
                    label: currentExecutor,
                    value: currentExecutor
                });
            }
            rc = prepaymentFile.getNext();
        }
    } catch (eRead) {
        return {
            success: false,
            error: "Khong doc duoc filter options Tam ung: " + eRead.toString()
        };
    } finally {
        if (prepaymentFile) {
            try { prepaymentFile.doClose(); } catch (eClosePrepayment) {}
        }
    }

    /* Lookup ten tat ca department bang mot query, tranh N+1 SCFile. */
    var departmentNameByCode = {};
    var unitFile = null;

    var lookupCodes = uniqueHTKTArray(departmentCodes.concat(lv1Codes));
    if (lookupCodes.length > 0) {
        var unitConditions = [];

        for (var i = 0; i < lookupCodes.length; i++) {
            unitConditions.push(
                'unit.id="' + qHTKT(lookupCodes[i]) + '"'
            );
        }

        try {
            unitFile = new SCFile("esdQTorgUnit", SCFILE_READONLY);
            unitFile.setFields(["unit.id", "unit.name"]);
            var unitQuery = "(" + unitConditions.join(" OR ") + ")";
            var rcUnit = unitFile.doSelect(unitQuery);

            while (rcUnit == RC_SUCCESS) {
                var resolvedDepartmentCode = String(
                    unitFile["unit.id"] || ""
                ).trim();
                var resolvedDepartmentName = String(
                    unitFile["unit.name"] || ""
                ).trim();

                if (resolvedDepartmentCode && resolvedDepartmentName) {
                    departmentNameByCode[resolvedDepartmentCode] =
                        resolvedDepartmentName;
                }

                rcUnit = unitFile.getNext();
            }
        } catch (eUnit) {
            departmentNameByCode = {};
        } finally {
            if (unitFile) {
                try { unitFile.doClose(); } catch (eCloseUnit) {}
            }
        }
    }

    var departmentOptions = [];
    for (var j = 0; j < departmentCodes.length; j++) {
        var departmentCode = departmentCodes[j];
        var departmentName = departmentNameByCode[departmentCode] || "";

        departmentOptions.push({
            label: departmentName || departmentCode,
            value: departmentCode
        });
    }
    var unitLv1Options = [];
    for (var lv1Index = 0; lv1Index < lv1Codes.length; lv1Index++) {
        var lv1Code = lv1Codes[lv1Index];
        unitLv1Options.push({
            label: departmentNameByCode[lv1Code] || lv1Code,
            value: lv1Code
        });
    }

    sortHTKTFilterOptions(executorOptions);
    sortHTKTFilterOptions(departmentOptions);
    sortHTKTFilterOptions(unitLv1Options);
    executorOptions.unshift({ label: "Tat ca Nguoi thuc hien", value: "ALL" });
    departmentOptions.unshift({ label: "Tat ca Phong ban/TT", value: "ALL" });

    return {
        success: true,
        data: {
            executorOptions: executorOptions,
            departmentOptions: departmentOptions,
            unitLv1Options: unitLv1Options
        },
        diagnostics: {
            queryMode: "sm-compact-projection",
            scannedRows: scannedRows,
            executorCount: executorOptions.length - 1,
            departmentCount: departmentOptions.length - 1,
            dataScopeCode: String(scopeInfo.dataScopeCode || ""),
            rightsCount: Number(scopeInfo.rightsCount || 0),
            allWorkflowExecutors: true,
            hasInvoiceView: scopeInfo.hasInvoiceView === true,
            hasPrepaymentView: scopeInfo.hasPrepaymentView === true,
            scopeAuthorizedBy: String(scopeInfo.scopeAuthorizedBy || ""),
            isPostAuditRole: scopeInfo.isPostAuditRole === true,
            dataPermissionScope: String(scopeInfo.dataPermissionScope || ""),
            dataPermissionUnitCount: Number(scopeInfo.dataPermissionUnitCount || 0),
            dataPermissionResolvedIdentity: String(
                scopeInfo.dataPermissionResolvedIdentity || ""
            ),
            dataPermissionWasResolved: scopeInfo.dataPermissionWasResolved === true,
            contactLv1: String(scopeInfo.contactLv1 || ""),
            firstRowProbe: firstRowProbe,
            totalMs: new Date().getTime() - startedAt
        }
    };
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
    /*
     * Code cu:
     * var dataPermission = getHTKTDataPermission(
     *     currentUser,
     *     DATA_PERMISSION_SUB_MODULE
     * );
     */
    // truong them
    var dataPermission = getHTKTDataPermissionWithContactInfo(
        currentUser,
        DATA_PERMISSION_SUB_MODULE,
        contactInfo
    );

    /*
     * HẬU KIỂM:
     * - Nhận diện DUY NHẤT bằng right 0040040002000010.
     * - Không suy luận từ 0009 / quyền Hóa đơn.
     * - Không thay initialRole, không tham gia logic xử lý workflow DMMS/KTTC.
     *
     * Scope dữ liệu Hậu kiểm:
     * - QT_PQDL_06: toàn hệ thống.
     * - QT_PQDL_04 + entity.code != 1010098: đúng Chi nhánh/LV1.
     * - QT_PQDL_04 + entity.code = 1010098: toàn Trụ sở chính.
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
        /*
         * User thường: giữ nguyên 100% logic phân quyền danh sách đã UAT.
         * Hai role lãnh đạo approval_dmms / approval_kttc:
         * bổ sung early visibility theo đúng Data Permission.
         */
        dataFilterInfo = buildHTKTPrepaymentCreatedByFilter(
            currentUser,
            hasView,
            rightsArray,
            dataPermission,
            contactInfo.lv1
        );
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

            // Metadata bổ sung cho 2 role lãnh đạo; không thay đổi permission cũ.
            leadershipAccess: getHTKTPrepaymentLeadershipAccess(rightsArray),
            // truong them: giu ket qua nhan dien right 0040040002000010
            // cho request compact chay tach khoi HTML Viewer session.
            isPostAuditRole: isPostAuditRole,

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


function renderTabApprovalInfomation(endpoint, input, extraData) {
    return getTabThongTinPheDuyet(endpoint, input, extraData);
}

// tab ho so dinh kem
//function renderTabAttachment(endpoint, input, extraData) {
//    var currentRecord = extraData;
//    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
//        if (vars.$L_file) {
//            currentRecord = {
//                "id": vars.$L_file["id"],
//                "currentPhase": vars.$L_file["current.phase"],
//                "initialRole": vars.$L_file["initial.role"],
//                "userCheckerKttc": vars.$L_file["user.checker.kttc"],
//                "userCheckerDmms": vars.$L_file["user.checker.dmms"],
//
//                "userApproverKttc": vars.$L_file["user.approver.kttc"],
//                "userApproverDmms": vars.$L_file["user.approver.dmms"],
//                "userCheckerFinal": vars.$L_file["user.checker.final"],
//                "userApproverFinal": vars.$L_file["user.approver.final"],
//                "createdBy": vars.$L_file["created.by"],
//
//                "currentUser": vars['$lo.contact.name'],
//                "status": vars.$L_file["status"]
//
//            };
//        }
//    }
//
//    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('TamUngMuaSam/TabHoSoDinhKem', '', currentRecord)
//}

// tab ho so dinh kem
function renderTabAttachment(endpoint, input, extraData) {
    var currentRecord = extraData;
    if (!currentRecord || (Array.isArray(currentRecord) && currentRecord.length === 0) || (typeof currentRecord === 'object' && Object.keys(currentRecord).length === 0)) {
        if (vars.$L_file) {
            var prepaymentId = vars.$L_file["id"];
            var contractId = vars.$L_file["contract.id"];

            // Query bảng esdHTKTprepayment để lấy contract.id nếu chưa có
            if (!contractId && prepaymentId) {
                var prepFile = new SCFile("esdHTKTprepayment");
                var sqlPrep = "id=\"" + prepaymentId + "\"";
                var rcPrep = prepFile.doSelect(sqlPrep);

                if (rcPrep == RC_SUCCESS) {
                    contractId = prepFile["contract.id"];
                }
            }

            currentRecord = {
                "id": vars.$L_file["id"],
                "contractId": contractId,
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

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS('TamUngMuaSam/TabHoSoDinhKem', '', currentRecord);
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
//    "esdHTKTvendorSite": [
//        { field: 'vendor.id', name: 'Mã NCC', width: '20%' }, 
//        { field: 'ogl.site.code', name: 'Site NCC (OGL)', width: '15%' }, 
//        { field: 'ogl.entity', name: 'Mã đơn vị', width: '15%' }, 
//        { field: 'debit.account', name: 'Tài khoản ghi nợ (OGL)', width: '25%' }, 
//        { field: 'credit.account', name: 'Tài khoản ghi có (OGL)', width: '25%' } 
//    ]
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
//function renderSiteNCCOGLCategory() {
//    return renderCategoryList('esdHTKTvendorSite');
//}
function renderSiteNCCOGLCategory() {
    // 1. Cấu hình cột hiển thị
    var configTable = [
        { field: 'supplier.id', name: 'Mã NCC', width: '15%' },
        { field: 'tax.code', name: 'Mã số thuế', width: '15%' },
        { field: 'ogl.site.code', name: 'Site NCC (OGL)', width: '15%' },
        { field: 'ogl.entity', name: 'Mã đơn vị', width: '15%' },
        { field: 'debit.account', name: 'Tài khoản ghi nợ (OGL)', width: '20%' },
        { field: 'credit.account', name: 'Tài khoản ghi có (OGL)', width: '20%' }
    ];
    
    // Bổ sung 'site_query' vào escapeFields để chống lỗi
    var escapeFields = ['vendor_id', 'supplier_id', 'tax_code', 'ogl_site_code', 'ogl_entity', 'debit_account', 'credit_account', 'site_query'];
    var raw_data = [];
    var f = new SCFile('esdHTKTvendorSite', SCFILE_READONLY);
    var rc = f.doSelect(true);

    var vendorCache = {};

    // 2. Lấy dữ liệu
    while (rc == RC_SUCCESS) {
        var rawDebit = f['debit.account'] || "";
        var rawCredit = f['credit.account'] || "";

        var row = {
            vendor_id: f['vendor.id'], 
            ogl_site_code: f['ogl.site.code'],
            ogl_entity: f['ogl.entity'],
            debit_account: rawDebit.split('.').length > 2 ? rawDebit.split('.')[2] : rawDebit,
            credit_account: rawCredit.split('.').length > 2 ? rawCredit.split('.')[2] : rawCredit
        };

        // TẠO QUERY ĐỂ MỞ ĐÚNG BẢN GHI SITE NÀY KHI CLICK
        row.site_query = 'vendor.id="' + row.vendor_id + '" and ogl.site.code="' + row.ogl_site_code + '"';

        // Tra cứu chéo thông tin từ esdHTKTvendor
        if (row.vendor_id) {
            if (vendorCache[row.vendor_id]) {
                row.tax_code = vendorCache[row.vendor_id].taxCode;
                row.supplier_id = vendorCache[row.vendor_id].supplierId;
            } else {
                var vendorFile = new SCFile("esdHTKTvendor", SCFILE_READONLY);
                if (vendorFile.doSelect('id="' + row.vendor_id + '"') === RC_SUCCESS) {
                    var taxCode = vendorFile['vendor.number'] || "";
                    var supplierId = vendorFile['supplier.id'] || "";
                    
                    row.tax_code = taxCode;
                    row.supplier_id = supplierId;
                    
                    vendorCache[row.vendor_id] = { taxCode: taxCode, supplierId: supplierId }; 
                } else {
                    row.tax_code = "";
                    row.supplier_id = "";
                }
                try { vendorFile.doClose(); } catch (e) {}
            }
        } else {
            row.tax_code = "";
            row.supplier_id = "";
        }

        raw_data.push(lib.ESD_Validate_Fields.escapeFields(row, escapeFields));
        rc = f.getNext();
    }
    try { if (f) f.doClose(); } catch (e) {}

    var dynamicColumns = configTable.map(function(item) {
        return {
            data: item.field.replace(/\./g, '_'),
            title: item.name,
            width: item.width
        };
    });

    // 4. Render HTML giao diện
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
            <style>
                a.link-ticket { color: #007bff; text-decoration: underline; cursor: pointer; }
                a.link-ticket:hover { color: #0056b3; }
            </style>
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
                
                // Gọi đích danh Form bạn vừa tạo
                builder.addParam('format', 'esdHTKTvendorSite.g');
                
                var wfUrl = builder.toURL();
                parent.cwc.updateActiveTab(wfUrl);
            }

            function setupLinkClickEvent(selector, fileName, dataAttr) {
                $(document).on('click', selector, function (e) {
                    e.preventDefault(); 
                    var queryString = $(this).data(dataAttr); 
                    if (queryString) {
                        openTaskDetails(fileName, decodeURIComponent(queryString));
                    }
                });
            }

            var raw_data = ${JSON.stringify(raw_data)};
            var columnsConfig = ${JSON.stringify(dynamicColumns)};

            if (columnsConfig.length > 0) {
                columnsConfig[0].render = function (data, type, row, meta) {
                    if (type === "display" && data) {
                        // Gọi site_query đã được tạo từ backend
                        var dataClick = encodeURIComponent(row.site_query);
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
                    sheetName: 'Danh sach Site NCC OGL',
                  }]
                }
              },
            });
            
            const table = new DataTable('#tableID', tableOptions);
            
            setupLinkClickEvent('a.link-ticket', 'esdHTKTvendorSite', 'dm-id');
          </script>
        </body>
        </html>`;
        
    return strVar;
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
    var result = scFile.doSelect(`id = "HDSD_HTKT_Tam_ung" and module = "HTKT" and function = "Tam ung"`);
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
