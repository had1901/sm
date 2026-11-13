/**
 * Escape giá trị dùng trong SM query.
 */
function escapeSMUserContextValue(value) {
    return String(value == null ? "" : value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

/**
 * Chuẩn hóa một giá trị về chuỗi đã trim.
 */
function normalizeSMUserContextString(value) {
    return String(value == null ? "" : value).trim();
}

/**
 * Đọc thông tin contact theo contact.name.
 */
function readSMUserContactInfo(currentUser) {
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

    var safeCurrentUser = normalizeSMUserContextString(currentUser);

    if (!safeCurrentUser) {
        return result;
    }

    var contactFile = null;

    try {
        contactFile = new SCFile(
            "contacts",
            SCFILE_READONLY
        );

        var rcContact = contactFile.doSelect(
            'contact.name="' +
            escapeSMUserContextValue(safeCurrentUser) +
            '"'
        );

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

            result.lv1 =
                contactFile["lv1.id"] ||
                contactFile.lv1_id ||
                "";

            result.lv2 =
                contactFile["lv2.id"] ||
                contactFile.lv2_id ||
                "";

            result.lv3 =
                contactFile["lv3.id"] ||
                contactFile.lv3_id ||
                "";

            result.orgUnit =
                contactFile["org.unit"] ||
                contactFile.org_unit ||
                "";

            result.position =
                contactFile["position"] ||
                "";
            result.positionName = "";
        }

    } catch (eContact) {
        // Có thể print log ở đây trong lúc UAT debug.

    } finally {

        if (contactFile) {
            try {
                contactFile.doClose();
            } catch (eCloseContact) {
                // Bỏ qua lỗi đóng SCFile.
            }
        }
    }

    return {
        fullName: normalizeSMUserContextString(
            result.fullName
        ),
        branchCode: normalizeSMUserContextString(
            result.branchCode
        ),
        lv1: normalizeSMUserContextString(
            result.lv1
        ),
        lv2: normalizeSMUserContextString(
            result.lv2
        ),
        lv3: normalizeSMUserContextString(
            result.lv3
        ),
        orgUnit: normalizeSMUserContextString(
            result.orgUnit
        ),
        position: normalizeSMUserContextString(
            result.position
        ),
        positionName: normalizeSMUserContextString(
            result.positionName
        )
    };
}

/**
 * Khởi tạo context user chuẩn để truyền từ SM sang NextJS.
 * - currentUser: vars['$lo.contact.name']
 * - operatorName: system.user.name
 * - thông tin đơn vị: bảng contacts
 */
function getNextJsUserInitData() {
    var currentUser = normalizeSMUserContextString(
        vars['$lo.contact.name']
    );

    var operatorName = normalizeSMUserContextString(
        system.user.name
    );

    var contactInfo = readSMUserContactInfo(currentUser);

    return {
        user: currentUser,
        currentUser: currentUser,
        contactId: currentUser,

        /**
         * Thông tin bổ sung.
         */
        operatorName: operatorName,
        fullName: contactInfo.fullName,
        branchCode: contactInfo.branchCode,

        /**
         * Thông tin đơn vị của user.
         */
        unit: {
            lv1: contactInfo.lv1,
            lv2: contactInfo.lv2,
            lv3: contactInfo.lv3,
            orgUnit: contactInfo.orgUnit,
            position: contactInfo.position,
            positionName: contactInfo.positionName
        }
    };
}

/**
 * Các field context không cho phép màn hình nghiệp vụ ghi đè.
 * - Tránh extraData vô tình thay currentUser.
 * - Giữ dữ liệu user nhất quán giữa các màn hình.
 */
function isSMUserContextReservedKey(key) {
    return (
        key === "user" ||
        key === "currentUser" ||
        key === "contactId" ||
        key === "operatorName" ||
        key === "fullName" ||
        key === "branchCode" ||
        key === "unit"
    );
}

/**
 * Ghép context user với dữ liệu riêng của từng màn hình.
 * currentUserContext là optional.
 * Nếu đã lấy context trước đó thì truyền vào để tránh đọc contacts lần hai.
 */
function buildNextJsInitData(
    extraData,
    currentUserContext
) {
    var result =
        currentUserContext &&
        typeof currentUserContext === "object"
            ? currentUserContext
            : getNextJsUserInitData();

    var initData = {
        user: normalizeSMUserContextString(result.user),
        currentUser: normalizeSMUserContextString(
            result.currentUser
        ),
        contactId: normalizeSMUserContextString(
            result.contactId
        ),
        operatorName: normalizeSMUserContextString(
            result.operatorName
        ),
        fullName: normalizeSMUserContextString(
            result.fullName
        ),
        branchCode: normalizeSMUserContextString(
            result.branchCode
        ),
        unit: result.unit || {
            lv1: "",
            lv2: "",
            lv3: "",
            orgUnit: "",
            position: "",
            positionName: ""
        }
    };

    if (
        extraData &&
        typeof extraData === "object"
    ) {
        for (var key in extraData) {
            if (
                Object.prototype.hasOwnProperty.call(
                    extraData,
                    key
                ) &&
                !isSMUserContextReservedKey(key)
            ) {
                initData[key] = extraData[key];
            }
        }
    }

    return initData;
}

/**
 * Wrapper gọi renderPageNextJS và tự động thêm context user.
 *
 * currentUserContext là optional.
 * Nên truyền vào nếu màn hình đã gọi getNextJsUserInitData().
 */
function renderPageNextJSWithUserContext(
    endpoint,
    input,
    extraData,
    currentUserContext
) {
    var initData = buildNextJsInitData(
        extraData,
        currentUserContext
    );

    return lib.ESD_Addon_Nextjs_V1.renderPageNextJS(
        endpoint,
        input || "",
        initData
    );
}