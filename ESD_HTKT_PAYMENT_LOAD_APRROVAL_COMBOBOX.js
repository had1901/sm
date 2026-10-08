/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_LOAD_APRROVAL_COMBOBOX
 * -----------------------------------------------------------------------------
 * Module        : HTKT - Đề nghị thanh toán
 * Version       : 1.0.1
 * Chức năng:
 * - Tải danh sách người duyệt hợp lệ (Reviewer, Approver, Kế toán trưởng, Ban Giám đốc, v.v.).
 * - Áp dụng ma trận phân quyền phê duyệt dựa trên đơn vị người tạo, hạn mức số tiền và quy trình.
 * - Hỗ trợ tải dữ liệu động cho các Combobox chọn người phê duyệt trên giao diện đề nghị thanh toán.
 * -----------------------------------------------------------------------------
 */

function getPaymentApprovalFields() {
    return ["user.checker.kttc", "user.checker.dmms", "user.approver.dmms",
        "user.approver.kttc", "user.checker.final", "user.approver.final"
    ];
}

// Gọi ở đầu Rule Set của nút Lưu/Workflow để form SM chọn lại chính record mới nhất.
function syncPaymentApprovalFromDatabase(payment) {
    var paymentId = String(payment ? payment.id || "" : "").trim();
    if (!paymentId) return payment;

    if (typeof payment.doSelect === "function") {
        var description = payment.description;
        var note = payment.note;
        if (description != null) description = String(description);
        try {
            var rc = payment.doSelect('id="' + escapeSmQueryValue(paymentId) + '"');
            var selected = typeof rc === "boolean" ? rc : rc === RC_SUCCESS;
            if (!selected) {
                throw new Error("Không tải lại được phiên bản mới nhất của phiếu thanh toán " +
                    paymentId + ". doSelect=" + String(rc) + " (" + typeof rc + ").");
            }
        } finally {
            payment.description = description;
            payment.note = note;
        }
        return payment;
    }

    var stored = null;
    try {
        stored = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        var fields = getPaymentApprovalFields().concat([
            "require.check.level1", "require.check.level2", "sysmodtime"
        ]);
        stored.setFields(fields);
        if (stored.doSelect('id="' + escapeSmQueryValue(paymentId) + '"') !== RC_SUCCESS) {
            throw new Error("Không tải được thông tin phê duyệt đã lưu.");
        }
        for (var i = 0; i < fields.length; i++) payment[fields[i]] = stored[fields[i]];
        return payment;
    } finally {
        if (stored) stored.doClose();
    }
}

/**
 * Lấy Functional Rights của user dùng riêng cho logic tái phân công (Thanh toán).
 */
function getPaymentReassignmentRoleAccess(currentUser) {
    var RIGHT_APPROVE_1 = "0040040003000005";
    var RIGHT_APPROVE_2 = "0040040003000006";

    var rightMap = {};
    var contactName = String(currentUser == null ? "" : currentUser).trim();

    if (!contactName) {
        return {
            isApprovalDmms: false,
            isApprovalKttc: false
        };
    }

    function addRights(source) {
        if (!source) return;

        try {
            if (source.toArray) {
                source = source.toArray();
            }
        } catch (eToArray) {}

        if (!source || typeof source.length === "undefined") {
            return;
        }

        for (var i = 0; i < source.length; i++) {
            var rightId = String(source[i] == null ? "" : source[i]).trim();

            if (rightId) {
                rightMap[rightId] = true;
            }
        }
    }

    function addRightsByIdentity(identity) {
        var safeIdentity = String(identity == null ? "" : identity).trim();

        if (
            !safeIdentity ||
            !lib.ESD_PERMS_RIGHTS ||
            !lib.ESD_PERMS_RIGHTS.permsRight
        ) {
            return;
        }

        try {
            addRights(lib.ESD_PERMS_RIGHTS.permsRight(safeIdentity) || []);
        } catch (ePermRights) {}
    }

    try {
        var sessionContact = String(
            vars["$lo.contact.name"] ||
            (vars.$lo_operator ? vars.$lo_operator["contact.name"] : "") ||
            ""
        ).trim();

        if (
            sessionContact &&
            sessionContact.toLowerCase() === contactName.toLowerCase() &&
            vars["$G.rights"]
        ) {
            addRights(vars["$G.rights"]);
        }
    } catch (eSessionRights) {}

    addRightsByIdentity(contactName);

    var contactFile = null;

    try {
        contactFile = new SCFile("contacts", SCFILE_READONLY);
        contactFile.setFields(["contact.id", "contact.name"]);

        var contactRc = contactFile.doSelect(
            'tolower(contact.name)="' +
            escapeSmQueryValue(contactName.toLowerCase()) +
            '"'
        );

        if (contactRc === RC_SUCCESS) {
            var canonicalContactName = String(
                contactFile["contact.name"] == null ?
                "" :
                contactFile["contact.name"]
            ).trim();

            var resolvedContactId = String(
                contactFile["contact.id"] == null ?
                "" :
                contactFile["contact.id"]
            ).trim();

            var hasDuplicate = false;
            try {
                hasDuplicate = contactFile.getNext() === RC_SUCCESS;
            } catch (eGetNextContact) {
                hasDuplicate = true;
            }

            if (!hasDuplicate) {
                if (canonicalContactName) {
                    addRightsByIdentity(canonicalContactName);
                }

                if (
                    resolvedContactId &&
                    resolvedContactId !== canonicalContactName
                ) {
                    addRightsByIdentity(resolvedContactId);
                }
            }
        }
    } catch (eResolveContact) {
    } finally {
        try {
            if (contactFile) {
                contactFile.doClose();
            }
        } catch (eCloseContact) {}
    }

    print(
        "[PAY_APR][ROLE] u=" + contactName +
        " r5=" + String(rightMap[RIGHT_APPROVE_1] === true) +
        " r6=" + String(rightMap[RIGHT_APPROVE_2] === true)
    );

    return {
        isApprovalDmms: rightMap[RIGHT_APPROVE_1] === true,
        isApprovalKttc: rightMap[RIGHT_APPROVE_2] === true
    };
}
function readPaymentApprovalValue(payment, field) {
    var value = payment[field];

    if (
        value == null ||
        String(value).trim() === ""
    ) {
        value = payment[field.replace(/\./g, "_")];
    }

    return String(
        value == null ? "" : value
    ).trim();
}
function getPaymentApprovalAccess(payment, currentUser) {
    var phase = readPaymentApprovalValue(payment, "current.phase").toLowerCase();
    var role = readPaymentApprovalValue(payment, "initial.role").toLowerCase();
    var creator = readPaymentApprovalValue(payment, "created.by").toLowerCase();
    var actor = String(currentUser == null ? "" : currentUser).trim().toLowerCase();
    var checker = readPaymentApprovalValue(payment, "user.checker.kttc").toLowerCase();
    var approverDmms = readPaymentApprovalValue(payment, "user.approver.dmms").toLowerCase();
    var approverKttc = readPaymentApprovalValue(payment, "user.approver.kttc").toLowerCase();
    var status = readPaymentApprovalValue(payment, "status").toLowerCase();
    var isDmmsCreator = !!actor && creator === actor && role === "dmms";

    // Giữ nguyên semantics quyền cũ cho người khởi tạo / KTTC tiếp nhận.
    var legacyClosed = phase === "end" || status === "cancelled";
    var canEditLevel1 =
        !legacyClosed &&
        phase === "initial_dmms" &&
        isDmmsCreator;

    var canEditLevel2 =
        !legacyClosed &&
        phase === "initial_kttc" &&
        !!actor &&
        ((creator === actor && role === "kttc") || checker === actor);

    // Quyền tái phân công của lãnh đạo chỉ áp dụng khi hồ sơ còn trong luồng xử lý.
    var reassignmentClosed =
        phase === "end" ||
        status === "cancelled" ||
        status === "approved" ||
        status === "accounted";

    var leaderAccess = getPaymentReassignmentRoleAccess(currentUser);

    /*
     * Xác định quyền lãnh đạo theo 2 nguồn:
     *
     * 1. Functional Right hiện hành:
     *    - 0040040003000005: Lãnh đạo ĐMMS / approval_dmms
     *    - 0040040003000006: Lãnh đạo KTTC / approval_kttc
     *
     * 2. Actor đang được assign trực tiếp trên chính hồ sơ:
     *    - user.approver.dmms
     *    - user.approver.kttc
     *
     * Việc dùng actor của record làm fallback bảo đảm người đang giữ đúng
     * vai trò phê duyệt trên hồ sơ có thể tái phân công chính role đó, kể cả
     * khi Functional Rights trong context API không được resolve đầy đủ.
     *
     * Không mở thêm quyền cho user không liên quan vì actor phải khớp chính xác
     * contact.name hiện tại với field approver tương ứng trên record.
     */
    var isApprovalDmms =
        leaderAccess.isApprovalDmms === true ||
        (!!actor && actor === approverDmms);

    /*
     * approval_kttc bắt buộc phải được xác định bằng Functional Right
     * 0040040003000006.
     *
     * Không fallback theo user.approver.kttc trên record, vì nghiệp vụ đã chốt:
     * user thuộc role approval_kttc phải có RIGHT_APPROVE_2 (0006).
     */
    var isApprovalKttc =
        leaderAccess.isApprovalKttc === true;

    /*
     * Ma trận tái phân công:
     *
     * 1. Lãnh đạo ĐMMS (approval_dmms), chỉ với luồng initial.role = dmms:
     *    - user.checker.dmms  : Rà soát 1
     *    - user.approver.dmms : Phê duyệt ĐMMS
     *
     * 2. Lãnh đạo KTTC (approval_kttc):
     *    - Với luồng dmms:
     *      + user.checker.kttc  : KTTC tiếp nhận
     *      + user.checker.final : Rà soát 2
     *      + user.approver.kttc : Phê duyệt KTTC
     *    - Với luồng kttc:
     *      + user.checker.final : Rà soát 2
     *      + user.approver.kttc : Phê duyệt KTTC
     *
     * 3. Không mở thêm quyền:
     *    - require.check.level1 / require.check.level2
     *    - user.approver.final
     */
    var canDmmsLeaderReassign =
        !reassignmentClosed &&
        role === "dmms" &&
        isApprovalDmms;

    /*
     * Quyền tái phân công của Lãnh đạo KTTC không phụ thuộc initial.role.
     *
     * Quyền theo từng field vẫn được giới hạn ở fieldAccess phía dưới:
     * - user.checker.kttc chỉ mở thêm với luồng DMMS.
     * - user.approver.kttc và user.checker.final mở cho approval_kttc.
     * - user.approver.final không được mở thêm.
     */
    var canKttcLeaderReassign =
        !reassignmentClosed &&
        isApprovalKttc;

    var fieldAccess = {};

    // Quyền cũ được giữ nguyên.
    fieldAccess["require.check.level1"] = canEditLevel1;
    fieldAccess["require.check.level2"] = canEditLevel2;

    fieldAccess["user.approver.final"] =
        canEditLevel2 ||
        canKttcLeaderReassign;

    // Quyền cũ + quyền tái phân công mới.
    fieldAccess["user.checker.kttc"] =
        canEditLevel1 ||
        (canKttcLeaderReassign && role === "dmms");

    fieldAccess["user.checker.dmms"] =
        canEditLevel1 ||
        canDmmsLeaderReassign;

    fieldAccess["user.approver.dmms"] =
        canEditLevel1 ||
        canDmmsLeaderReassign;

    fieldAccess["user.approver.kttc"] =
        canEditLevel2 ||
        canKttcLeaderReassign;

    fieldAccess["user.checker.final"] =
        canEditLevel2 ||
        canKttcLeaderReassign;

    return {
        isDmmsCreator: isDmmsCreator,

        // FE cũ vẫn dùng.
        showLevel1: role === "dmms",

        showLevel2: role === "kttc" ||
            isApprovalKttc ||
            (
                role === "dmms" &&
            !isDmmsCreator &&
                [
                    "initial_kttc",
                    "check_dmms",
                    "approval_dmms",
                    "approval_kttc",
                    "check_final",
                    "approval_final",
                    "end"
                ].indexOf(phase) >= 0
            ),

        // Quyền cũ.
        canEditLevel1: canEditLevel1,
        canEditLevel2: canEditLevel2,

        // Quyền lãnh đạo.
        isApprovalDmms: isApprovalDmms,
        isApprovalKttc: isApprovalKttc,

        // Cho phép lãnh đạo nhìn dữ liệu sớm.
        canViewEarly:
            (role === "dmms" && (isApprovalDmms || isApprovalKttc)) ||
            (role === "kttc" && isApprovalKttc),

        // Quyền edit theo từng field.
        fieldAccess: fieldAccess
    };
}

function resolvePaymentApprovalContactId(currentUser) {
    var actor = String(currentUser || "").trim().toLowerCase();
    var contact = null;
    try {
        contact = new SCFile("contacts", SCFILE_READONLY);
        contact.setFields(["contact.name"]);
        if (!actor || contact.doSelect('tolower(contact.name)="' + escapeSmQueryValue(actor) + '"') !== RC_SUCCESS) {
            throw new Error("Không tìm thấy contact của user đăng nhập để kiểm tra phân quyền dữ liệu.");
        }
        var contactId = String(contact["contact.name"] || "").trim();
        if (!contactId || contact.getNext() === RC_SUCCESS) {
            throw new Error("Không xác định được duy nhất contact của user đăng nhập.");
        }
        return contactId;
    } finally {
        if (contact) contact.doClose();
    }
}

function getPaymentApprovalInitData(payment, currentUser) {
    var fields = getPaymentApprovalFields();
    var values = {};
    var selectedOptions = {};
    var conditions = [];
    var seen = {};
    for (var i = 0; i < fields.length; i++) {
        var id = String(payment[fields[i]] || "").trim();
        values[fields[i]] = id;
        if (id && !seen[id]) {
            seen[id] = true;
            conditions.push('contact.name="' + escapeSmQueryValue(id) + '"');
            selectedOptions[id] = { value: id, label: id };
        }
    }
    var contacts = null;
    try {
        if (conditions.length) {
            contacts = new SCFile("contacts", SCFILE_READONLY);
            contacts.setFields(["contact.name", "full.name", "position"]);
            var rc = contacts.doSelect("(" + conditions.join(" or ") + ")");
            while (rc === RC_SUCCESS) {
                var contactId = String(contacts["contact.name"] || "");
                var fullName = String(contacts["full.name"] || contactId);
                var position = String(contacts.position || "");
                selectedOptions[contactId] = { value: contactId, label: fullName + (position ? " - " + position : "") };
                rc = contacts.getNext();
            }
        }
    } finally {
        if (contacts) contacts.doClose();
    }
    values["require.check.level1"] = String(payment["require.check.level1"]) === "true";
    values["require.check.level2"] = String(payment["require.check.level2"]) === "true";
    return {
        paymentId: String(payment.id || ""),
        currentUser: currentUser,
        initialRole: String(payment["initial.role"] || ""),
        currentPhase: String(payment["current.phase"] || payment.current_phase || ""),
        createdBy: String(payment["created.by"] || ""),
        status: String(payment.status || ""),
        approvalValues: values,
        approvalSelectedOptions: selectedOptions,
        approvalAccess: getPaymentApprovalAccess(payment, currentUser)
    };
}

function getPaymentApprovalData(details) {
    details = details || {};

    var paymentId = String(details.paymentId || "").trim();
    var currentUser = String(details.currentUser || "").trim();
    var payment = null;

    try {
        if (!paymentId || !currentUser) {
            throw new Error("Thông tin tải dữ liệu phê duyệt không hợp lệ.");
        }

        payment = new SCFile(
            "esdHTKTpayment",
            SCFILE_READONLY
        );

        if (
            payment.doSelect(
                'id="' + escapeSmQueryValue(paymentId) + '"'
            ) !== RC_SUCCESS
        ) {
            throw new Error("Không tìm thấy phiếu thanh toán.");
        }

        return {
            success: true,
            data: getPaymentApprovalInitData(
                payment,
                currentUser
            )
        };

    } catch (error) {
        return {
            success: false,
            message: error && error.message ?
                error.message :
                String(error)
        };

    } finally {
        if (payment) {
            try {
                payment.doClose();
            } catch (eClose) {}
        }
    }
}

function paymentApprovalFieldEditable(payment, currentUser, field) {
    var access = getPaymentApprovalAccess(payment, currentUser);

    if (access.fieldAccess && typeof access.fieldAccess[field] !== "undefined") {
        return access.fieldAccess[field] === true;
    }

    var level1 = ["require.check.level1", "user.checker.kttc", "user.checker.dmms", "user.approver.dmms"];
    var level2 = ["require.check.level2", "user.approver.kttc", "user.checker.final", "user.approver.final"];
    return (access.canEditLevel1 && level1.indexOf(field) >= 0) ||
        (access.canEditLevel2 && level2.indexOf(field) >= 0);
}

function getPaymentApprovalOptions(details) {
    return runPaymentApprovalApi(details, false);
}

function validateDuplicatePaymentApprovalUser(payment, currentField, newValue) {
    var safeField = String(currentField == null ? "" : currentField).trim();
    var safeValue = String(newValue == null ? "" : newValue).trim();

    if (!safeField || !safeValue) {
        return;
    }

    var fields = getPaymentApprovalFields();
    var normalizedValue = safeValue.toLowerCase();

    var fieldLabels = {
        "user.checker.kttc": "KTTC tiếp nhận",
        "user.checker.dmms": "Rà soát ĐMMS (Rà soát 1)",
        "user.approver.dmms": "Phê duyệt ĐMMS",
        "user.approver.kttc": "Phê duyệt KTTC",
        "user.checker.final": "Rà soát KTTC (Rà soát 2)",
        "user.approver.final": "Cấp có thẩm quyền"
    };

    for (var i = 0; i < fields.length; i++) {
        var otherField = fields[i];

        if (otherField === safeField) {
            continue;
        }

        var otherValue = readPaymentApprovalValue(payment, otherField);

        if (
            otherValue &&
            otherValue.toLowerCase() === normalizedValue
        ) {
            throw new Error(
                'Cán bộ "' +
                safeValue +
                '" đã được phân công tại bước "' +
                (fieldLabels[otherField] || otherField) +
                '". Không được phân công cùng một cán bộ cho nhiều bước xử lý.'
            );
        }
    }
}

function createPaymentReassignmentHistory(paymentId, field, oldValue, newValue, reason, currentUser) {
    var payment = null;

    try {
        var safePaymentId = String(paymentId == null ? "" : paymentId).trim();
        var safeField = String(field == null ? "" : field).trim();
        var safeOldValue = String(oldValue == null ? "" : oldValue).trim();
        var safeNewValue = String(newValue == null ? "" : newValue).trim();
        var safeReason = String(reason == null ? "" : reason).trim();
        var safeCurrentUser = String(currentUser == null ? "" : currentUser).trim();

        if (
            !safePaymentId ||
            !safeField ||
            !safeOldValue ||
            !safeNewValue ||
            safeOldValue === safeNewValue ||
            !safeCurrentUser
        ) {
            return;
        }

        var fieldLabels = {
            "user.checker.kttc": "KTTC tiếp nhận",
            "user.checker.dmms": "Rà soát ĐMMS (Rà soát 1)",
            "user.approver.dmms": "Phê duyệt ĐMMS",
            "user.approver.kttc": "Phê duyệt KTTC",
            "user.checker.final": "Rà soát KTTC (Rà soát 2)",
            "user.approver.final": "Cấp có thẩm quyền"
        };

        if (!fieldLabels[safeField]) {
            return;
        }

        var leadership = getPaymentReassignmentRoleAccess(safeCurrentUser);

        if (
            !leadership ||
            (
                leadership.isApprovalDmms !== true &&
                leadership.isApprovalKttc !== true
            )
        ) {
            return;
        }

        payment = new SCFile("esdHTKTpayment", SCFILE_READONLY);
        payment.setFields(["id", "initial.role"]);

        if (
            payment.doSelect(
                'id="' + escapeSmQueryValue(safePaymentId) + '"'
            ) !== RC_SUCCESS
        ) {
            return;
        }

        var initialRole = String(
            payment["initial.role"] == null ?
            "" :
            payment["initial.role"]
        ).trim().toLowerCase();

        var canWriteReassignmentHistory = false;

        if (
            leadership.isApprovalDmms === true &&
            initialRole === "dmms" &&
            (
                safeField === "user.checker.dmms" ||
                safeField === "user.approver.dmms"
            )
        ) {
            canWriteReassignmentHistory = true;
        }

        if (
            leadership.isApprovalKttc === true &&
            (
                safeField === "user.approver.kttc" ||
                safeField === "user.checker.final" ||
                safeField === "user.approver.final" ||
                (
                    initialRole === "dmms" &&
                    safeField === "user.checker.kttc"
                )
            )
        ) {
            canWriteReassignmentHistory = true;
        }

        if (!canWriteReassignmentHistory) {
            return;
        }

        var activityDescription =
            'Tái phân công Đề nghị Thanh toán: Mã đề nghị: "' + safePaymentId + '"' +
            '\nVai trò: "' + fieldLabels[safeField] + '"' +
            '\nTừ: "' + safeOldValue + '"' +
            '\nĐến: "' + safeNewValue + '"' +
            (safeReason ? '\nLý do: "' + safeReason + '"' : "");

        lib.ESD_Utils.createActivity(
            "activityHTKTpayment",
            activityDescription,
            safePaymentId,
            "Tái phân công",
            safeCurrentUser
        );
    } catch (e) {
        print(
            "[PAY_APR][REASSIGN_HISTORY] Không thể ghi activity: " +
            String(e && e.message ? e.message : e)
        );
    } finally {
        try {
            if (payment) {
                payment.doClose();
            }
        } catch (eClosePayment) {}
    }
}

function savePaymentApprovalField(details) {
    return runPaymentApprovalApi(details, true);
}

function runPaymentApprovalApi(details, save) {
    details = details || {};
    var payment = null;
    try {
        var paymentId = String(details.paymentId || "").trim();
        var currentUser = String(details.currentUser || "").trim();
        var field = String(details.field || "").trim();
        var fields = getPaymentApprovalFields();
        var isCheckbox = field === "require.check.level1" || field === "require.check.level2";
        if (!paymentId || !currentUser || (fields.indexOf(field) < 0 && !(save && isCheckbox))) {
            throw new Error("Thông tin phê duyệt không hợp lệ.");
        }
        payment = save ? new SCFile("esdHTKTpayment") : new SCFile("esdHTKTpayment", SCFILE_READONLY);
        if (payment.doSelect('id="' + escapeSmQueryValue(paymentId) + '"') !== RC_SUCCESS) {
            throw new Error("Không tìm thấy phiếu thanh toán.");
        }
        var apiAccess = getPaymentApprovalAccess(payment, currentUser);
        var apiEditable =
            apiAccess &&
            apiAccess.fieldAccess &&
            apiAccess.fieldAccess[field] === true;

        print(
            "[PAY_APR][API] u=" + currentUser +
            " field=" + field +
            " kttc=" + String(apiAccess && apiAccess.isApprovalKttc === true) +
            " editable=" + String(apiEditable)
        );

        if (!apiEditable) {
            return {
                success: false,
                code: "PAYMENT_APPROVAL_FORBIDDEN",
                message: "Bạn không có quyền sửa thông tin phê duyệt tại bước hiện tại.",
                accessContext: {
                    paymentId: paymentId,
                    field: field,
                    currentUser: currentUser,
                    createdBy: readPaymentApprovalValue(payment, "created.by"),
                    initialRole: readPaymentApprovalValue(payment, "initial.role"),
                    currentPhase: readPaymentApprovalValue(payment, "current.phase"),
                    status: readPaymentApprovalValue(payment, "status"),
                    userCheckerKttc: readPaymentApprovalValue(payment, "user.checker.kttc")
                }
            };
        }
        if ((field === "user.checker.dmms" && String(payment["require.check.level1"]) !== "true") ||
            (field === "user.checker.final" && String(payment["require.check.level2"]) !== "true")) {
            throw new Error("Chưa bật yêu cầu rà soát tương ứng.");
        }
        var value = isCheckbox ? details.value : String(details.value == null ? "" : details.value).trim();
        if (isCheckbox && typeof value !== "boolean") throw new Error("Giá trị checkbox không hợp lệ.");
        var page = Math.max(1, Math.floor(Number(details.page) || 1));
        var pageSize = Math.max(1, Math.min(100, Math.floor(Number(details.pageSize) || 10)));
        var result;
        if (!save || (!isCheckbox && value)) {
            var permissionContactId = resolvePaymentApprovalContactId(currentUser);
            var loaded = loadPaymentApprovalComboBoxesInternal(payment, field, {
                currentUser: permissionContactId,
                page: save ? 1 : page,
                pageSize: save ? 1 : pageSize,
                keyword: save ? "" : String(details.keyword || "").trim(),
                selectedId: save ? value : ""
            });
            if (!loaded.success) {
                return {
                    success: false,
                    code: loaded.currentUserScope && !loaded.currentUserScope.canAccessTargetLv1 ?
                        "PAYMENT_APPROVAL_SCOPE_DENIED" : "PAYMENT_APPROVAL_OPTIONS_FAILED",
                    message: loaded.message || "Không tải được danh sách cán bộ.",
                    scopeContext: {
                        tokenUser: currentUser,
                        contactId: permissionContactId,
                        targetLv1: loaded.targetLv1,
                        targetLv1Source: loaded.targetLv1Source,
                        permission: loaded.currentUserScope
                    }
                };
            }
            result = loaded[loaded.configs[0].key];
            if (save && result.ids.indexOf(value) < 0) throw new Error("Cán bộ đã chọn không còn hợp lệ theo quyền và đơn vị.");
        }
        if (!save) {
            var items = [];
            for (var i = 0; i < result.ids.length; i++) items.push({ value: result.ids[i], label: result.names[i] });
            return { success: true, data: { items: items, page: page, pageSize: pageSize, hasMore: result.hasMore === true } };
        }

        if (!isCheckbox) {
            validateDuplicatePaymentApprovalUser(
                payment,
                field,
                value
            );
        }

        var previousApprovalValue = isCheckbox ?
            "" :
            readPaymentApprovalValue(payment, field);

        payment[field] = value;
        if (isCheckbox && !value) {
            payment[field === "require.check.level1" ? "user.checker.dmms" : "user.checker.final"] = "";
        }
        var savedData = getPaymentApprovalInitData(payment, currentUser);
        if (payment.doUpdate() !== RC_SUCCESS) throw new Error("Không lưu được thông tin phê duyệt.");

        if (!isCheckbox) {
            createPaymentReassignmentHistory(
                paymentId,
                field,
                previousApprovalValue,
                value,
                details.reason,
                currentUser
            );
        }

        return { success: true, data: savedData };
    } catch (error) {
        return { success: false, message: String(error.message || error) };
    } finally {
        if (payment) payment.doClose();
    }
}

function getPaymentRoleByRights(contactId) {
    var RIGHT_VIEW_INVOICE = "0040040001000001";
    var RIGHT_VIEW_PAYMENT = "0040040003000001";
    var RIGHT_CREATE_PAYMENT = "0040040003000002";
    var RIGHT_ACCOUNTING_INPUT = "0040040003000003";
    var rights = [];

    contactId = String(contactId == null ? "" : contactId).trim();

    if (!contactId) {
        return "";
    }

    try {
        rights = lib.ESD_PERMS_RIGHTS.permsRight(contactId) || [];

        if (rights.toArray) {
            rights = rights.toArray();
        }
    } catch (e) {
        return "";
    }

    if (!rights || typeof rights.length === "undefined") {
        return "";
    }

    var rightMap = {};

    for (var i = 0; i < rights.length; i++) {
        var rightId = String(rights[i] == null ? "" : rights[i]).trim();

        if (rightId) {
            rightMap[rightId] = true;
        }
    }

    var canCreatePayment =
        rightMap[RIGHT_VIEW_INVOICE] &&
        rightMap[RIGHT_VIEW_PAYMENT] &&
        rightMap[RIGHT_CREATE_PAYMENT];

    if (!canCreatePayment) {
        return "";
    }

    return rightMap[RIGHT_ACCOUNTING_INPUT] ? "kttc" : "dmms";
}

function normalizeHTKTApprovalUnitCode(code) {
    var s = String(code == null ? "" : code).trim();
    if (!s) return "";

    s = s.replace(/\.0$/, "");
    if (/^[0-9]+$/.test(s) && s.length === 8) {
        s = "0" + s;
    }

    return s;
}

function getHTKTApprovalActiveEntityCodeByPsCode(psCode) {
    var safePsCode = normalizeHTKTApprovalUnitCode(psCode);
    var entityFile = null;
    var entityCodes = [];
    var seen = {};

    if (!safePsCode) return "";

    try {
        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
        entityFile.setFields(["entity.code", "ps.code", "status"]);

        var rc = entityFile.doSelect(
            'ps.code="' + escapeSmQueryValue(safePsCode) + '" and status="ACTIVE"'
        );

        while (rc === RC_SUCCESS) {
            var entityCode = String(entityFile["entity.code"] || "").trim();
            if (entityCode && !seen[entityCode]) {
                seen[entityCode] = true;
                entityCodes.push(entityCode);
            }
            rc = entityFile.getNext();
        }
    } catch (e) {
        return "";
    } finally {
        try { if (entityFile) entityFile.doClose(); } catch (closeError) {}
    }

    return entityCodes.length === 1 ? entityCodes[0] : "";
}

function getHTKTApprovalActivePsCodesByEntityCode(entityCode, psPrefix) {
    var safeEntityCode = String(entityCode == null ? "" : entityCode).trim();
    var safePrefix = String(psPrefix == null ? "" : psPrefix).trim();
    var result = [];
    var seen = {};
    var entityFile = null;

    if (!safeEntityCode) return result;

    try {
        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
        entityFile.setFields(["entity.code", "ps.code", "status"]);

        var rc = entityFile.doSelect(
            'entity.code="' + escapeSmQueryValue(safeEntityCode) + '" and status="ACTIVE"'
        );

        while (rc === RC_SUCCESS) {
            var psCode = normalizeHTKTApprovalUnitCode(entityFile["ps.code"]);

            if (
                psCode &&
                (!safePrefix || psCode.indexOf(safePrefix) === 0) &&
                !seen[psCode]
            ) {
                seen[psCode] = true;
                result.push(psCode);
            }

            rc = entityFile.getNext();
        }
    } catch (e) {
        return [];
    } finally {
        try { if (entityFile) entityFile.doClose(); } catch (closeError) {}
    }

    return result;
}

function resolveHTKTApprovalDataDomain(targetLv1) {
    var HEAD_OFFICE_PS_PREFIX = "0999";
    var HEAD_OFFICE_OGL_SEG1 = "1010098";
    var normalizedLv1 = normalizeHTKTApprovalUnitCode(targetLv1);

    var result = {
        valid: false,
        type: "",
        targetLv1: normalizedLv1,
        entityCode: "",
        allowedLv1List: []
    };

    if (!normalizedLv1) return result;

    if (normalizedLv1.indexOf(HEAD_OFFICE_PS_PREFIX) !== 0) {
        result.valid = true;
        result.type = "BRANCH";
        result.allowedLv1List = [normalizedLv1];
        return result;
    }

    var currentEntityCode = getHTKTApprovalActiveEntityCodeByPsCode(normalizedLv1);
    if (currentEntityCode !== HEAD_OFFICE_OGL_SEG1) {
        return result;
    }

    var headOfficePsCodes = getHTKTApprovalActivePsCodesByEntityCode(
        HEAD_OFFICE_OGL_SEG1,
        HEAD_OFFICE_PS_PREFIX
    );

    if (!headOfficePsCodes.length) {
        return result;
    }

    if (headOfficePsCodes.indexOf(normalizedLv1) < 0) {
        return result;
    }

    result.valid = true;
    result.type = "HEAD_OFFICE";
    result.entityCode = HEAD_OFFICE_OGL_SEG1;
    result.allowedLv1List = uniqueStrings(headOfficePsCodes);
    return result;
}

function getHTKTApprovalContactLv1(contactId) {
    var safeContactId = String(contactId == null ? "" : contactId).trim();
    var contactFile = null;

    if (!safeContactId) return "";

    try {
        contactFile = new SCFile("contacts", SCFILE_READONLY);
        contactFile.setFields(["contact.name", "lv1.id"]);

        var rc = contactFile.doSelect(
            'contact.name="' + escapeSmQueryValue(safeContactId) + '"'
        );

        if (rc !== RC_SUCCESS) return "";
        return normalizeHTKTApprovalUnitCode(contactFile["lv1.id"]);
    } catch (e) {
        return "";
    } finally {
        try { if (contactFile) contactFile.doClose(); } catch (closeError) {}
    }
}

function listContactsByRightsAndLv1(rightIds, targetLv1, subModuleId) {
    var normalizedRights = rightIds || [];
    var domain = resolveHTKTApprovalDataDomain(targetLv1);
    var allowedLv1List = domain.allowedLv1List || [];
    var units = [];
    var seenUnits = {};

    if (!domain.valid || !allowedLv1List.length || !normalizedRights.length) {
        return [];
    }

    function addUnit(unitId) {
        var value = normalizeHTKTApprovalUnitCode(unitId);
        if (value && !seenUnits[value]) {
            seenUnits[value] = true;
            units.push(value);
        }
    }

    for (var lv1Index = 0; lv1Index < allowedLv1List.length; lv1Index++) {
        var allowedLv1 = normalizeHTKTApprovalUnitCode(allowedLv1List[lv1Index]);
        if (!allowedLv1) continue;

        addUnit(allowedLv1);

        var orgFile = null;
        try {
            orgFile = new SCFile("esdQTorgUnit", SCFILE_READONLY);
            orgFile.setFields(["unit.id", "lv1.id"]);

            var orgRc = orgFile.doSelect(
                'unit.id="' + escapeSmQueryValue(allowedLv1) + '" or lv1.id="' +
                escapeSmQueryValue(allowedLv1) + '"'
            );

            while (orgRc === RC_SUCCESS) {
                addUnit(orgFile["unit.id"]);
                orgRc = orgFile.getNext();
            }
        } finally {
            try { if (orgFile) orgFile.doClose(); } catch (closeError) {}
        }
    }

    if (!lib.ESD_PERMS_RIGHTS || !lib.ESD_PERMS_RIGHTS.listContactsByRightsAndFilter) {
        return [];
    }

    var contacts = lib.ESD_PERMS_RIGHTS.listContactsByRightsAndFilter(
        normalizedRights, { "lv1.id": allowedLv1List }
    ) || [];

    if (contacts.toArray) contacts = contacts.toArray();
    if (!contacts.length) return [];

    var contactConditions = [];
    var unitConditions = [];
    var permissionIds = [];
    var contactByPermissionId = {};
    var acceptedContacts = {};

    for (var contactIndex = 0; contactIndex < contacts.length; contactIndex++) {
        contactConditions.push(
            'contact.id="' + escapeSmQueryValue(contacts[contactIndex]) + '"'
        );
    }

    for (var unitIndex = 0; unitIndex < units.length; unitIndex++) {
        unitConditions.push(
            'unit.id="' + escapeSmQueryValue(units[unitIndex]) + '"'
        );
    }

    if (!contactConditions.length || !unitConditions.length) {
        return [];
    }

    var permissionFile = null;
    try {
        permissionFile = new SCFile("esdQTdataPermissions", SCFILE_READONLY);
        permissionFile.setFields(["id", "contact.id", "permission.scope"]);

        var permissionRc = permissionFile.doSelect(
            "(" + contactConditions.join(" or ") + ")" +
            ' and sub.module="' + escapeSmQueryValue(subModuleId || "00401") + '"' +
            ' and permission.scope~="QT_PQDL_01"'
        );

        while (permissionRc === RC_SUCCESS) {
            var permissionId = String(permissionFile["id"] == null ? "" : permissionFile["id"]).trim();
            var contactId = String(permissionFile["contact.id"] == null ? "" : permissionFile["contact.id"]).trim();
            var scope = String(permissionFile["permission.scope"] == null ? "" : permissionFile["permission.scope"]).trim();

            if (permissionId && contactId && scope !== "QT_PQDL_01") {
                if (scope === "QT_PQDL_06") {
                    if (domain.type === "HEAD_OFFICE") {
                        acceptedContacts[contactId] = true;
                    }
                } else {
                    permissionIds.push(permissionId);
                    contactByPermissionId[permissionId] = contactId;
                }
            }

            permissionRc = permissionFile.getNext();
        }
    } finally {
        try { if (permissionFile) permissionFile.doClose(); } catch (permissionCloseError) {}
    }

    permissionIds = uniqueStrings(permissionIds);

    if (permissionIds.length) {
        var BATCH_SIZE = 100;

        for (var offset = 0; offset < permissionIds.length; offset += BATCH_SIZE) {
            var permissionConditions = [];
            var permissionBatch = permissionIds.slice(offset, offset + BATCH_SIZE);

            for (var permissionIndex = 0; permissionIndex < permissionBatch.length; permissionIndex++) {
                permissionConditions.push(
                    'data.permission.id="' + escapeSmQueryValue(permissionBatch[permissionIndex]) + '"'
                );
            }

            var unitFile = null;
            try {
                unitFile = new SCFile("esdjoinDatapermissionUnits", SCFILE_READONLY);
                unitFile.setFields(["data.permission.id", "unit.id", "status"]);

                var unitRc = unitFile.doSelect(
                    "(" + permissionConditions.join(" or ") + ') and status="Dang hoat dong" and (' +
                    unitConditions.join(" or ") + ")"
                );

                while (unitRc === RC_SUCCESS) {
                    var mappedPermissionId = String(
                        unitFile["data.permission.id"] || unitFile.data_permission_id || ""
                    ).trim();

                    var mappedContactId = contactByPermissionId[mappedPermissionId];
                    if (mappedContactId) acceptedContacts[mappedContactId] = true;

                    unitRc = unitFile.getNext();
                }
            } finally {
                try { if (unitFile) unitFile.doClose(); } catch (unitCloseError) {}
            }
        }
    }

    var result = [];
    for (var resultIndex = 0; resultIndex < contacts.length; resultIndex++) {
        var resultContactId = String(contacts[resultIndex] == null ? "" : contacts[resultIndex]).trim();
        if (resultContactId && acceptedContacts[resultContactId]) {
            result.push(resultContactId);
        }
    }

    return uniqueStrings(result);
}

function uniqueStrings(source) {
    var result = [];
    var seen = {};
    for (var i = 0; source && i < source.length; i++) {
        var value = String(source[i] == null ? "" : source[i]).trim();
        if (value && !seen[value]) {
            seen[value] = true;
            result.push(value);
        }
    }
    return result;
}

function escapeSmQueryValue(value) {
    return String(value == null ? "" : value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

function loadPaymentApprovalComboBoxes(paymentFile) {
    return loadPaymentApprovalComboBoxesInternal(paymentFile, "");
}

function loadPaymentDmmsCheckerComboBox(paymentFile) {
    return loadPaymentApprovalComboBoxesInternal(paymentFile, "user.checker.dmms");
}

function loadPaymentFinalCheckerComboBox(paymentFile) {
    return loadPaymentApprovalComboBoxesInternal(paymentFile, "user.checker.final");
}

function loadPaymentApprovalComboBoxesInternal(paymentFile, requestedField, apiOptions) {
    var HTKT_SUB_MODULE = "00401";
    var ALLOW_GLOBAL_SCOPE_IN_COMBO = false;

    var RIGHT_ACCOUNTING_INPUT = "0040040003000003";
    var RIGHT_CHECK_1 = "0040040003000004";
    var RIGHT_APPROVE_1 = "0040040003000005";
    var RIGHT_APPROVE_2 = "0040040003000006";
    var RIGHT_CHECK_2 = "0040040003000007";
    var RIGHT_APPROVE_3 = "0040040003000008";

    var configs = [{
            key: "kttc",
            label: "KTTC tiếp nhận",
            saveField: "user.checker.kttc",
            seedRights: [RIGHT_ACCOUNTING_INPUT],
            valueList: "$L.kttc.ids",
            displayList: "$L.kttc.names"
        },
        {
            key: "dmmsRs1",
            label: "DMMS rà soát 1",
            saveField: "user.checker.dmms",
            seedRights: [RIGHT_CHECK_1],
            valueList: "$L.dmms.ids",
            displayList: "$L.dmms.rs1"
        },
        {
            key: "dmmsApproval1",
            label: "DMMS phê duyệt cấp 1",
            saveField: "user.approver.dmms",
            seedRights: [RIGHT_APPROVE_1],
            valueList: "$L.dmms.approval1.ids",
            displayList: "$L.dmms.approval1"
        },
        {
            key: "kttcApprove2",
            label: "KTTC phê duyệt cấp 2",
            saveField: "user.approver.kttc",
            seedRights: [RIGHT_APPROVE_2],
            valueList: "$L.kttc.approve2.ids",
            displayList: "$L.kttc.approve2"
        },
        {
            key: "kttcCheck2",
            label: "KTTC rà soát 2",
            saveField: "user.checker.final",
            seedRights: [RIGHT_CHECK_2],
            valueList: "$L.kttc.check2.ids",
            displayList: "$L.kttc.check2"
        },
        {
            key: "approveAll",
            label: "Phê duyệt cấp có thẩm quyền",
            saveField: "user.approver.final",
            seedRights: [RIGHT_APPROVE_3],
            valueList: "$L.approve.all.ids",
            displayList: "$L.approve.all"
        }
    ];

    var output = {
        success: true,
        message: "",
        currentUser: "",
        currentUserScope: null,
        targetLv1: "",
        targetLv1Source: "",
        configs: []
    };

    var userScopeCache = {};
    var contactDataCache = {};
    var orgUnitCache = {};

    if (requestedField) {
        var requestedConfigs = [];
        for (var requestedIndex = 0; requestedIndex < configs.length; requestedIndex++) {
            if (configs[requestedIndex].saveField === requestedField) {
                requestedConfigs.push(configs[requestedIndex]);
            }
        }
        configs = requestedConfigs;
    }

    var file = paymentFile || vars["$L.file"];
    var phase = normalizeValue(safeFileGet(file, ["current.phase"]));
    var loadDmmsGroup = phase === "initial_dmms" || phase === "approval_dmms";
    var loadKttcGroup = phase === "initial_kttc" || phase === "approval_kttc";
    var candidateConfigs = [];
    output.phase = phase;
    for (var configIndex = 0; configIndex < configs.length; configIndex++) {
        var phaseConfig = configs[configIndex];
        var dmmsGroup = phaseConfig.saveField === "user.checker.kttc" ||
            (phaseConfig.saveField === "user.checker.dmms" &&
                safeFileGet(file, ["require.check.level1"]) === "true") ||
            phaseConfig.saveField === "user.approver.dmms";
        var kttcGroup = phaseConfig.saveField === "user.approver.kttc" ||
            (phaseConfig.saveField === "user.checker.final" &&
                safeFileGet(file, ["require.check.level2"]) === "true") ||
            phaseConfig.saveField === "user.approver.final";
        phaseConfig.mode = ((dmmsGroup && loadDmmsGroup) || (kttcGroup && loadKttcGroup)) ? "candidates" : "selected";
        if (phase === "approval_kttc" && phaseConfig.saveField === "user.checker.kttc") {
            phaseConfig.mode = "candidates";
        }
        if (requestedField) phaseConfig.mode = "candidates";
        if (phaseConfig.mode === "candidates") candidateConfigs.push(phaseConfig);
    }

    var targetInfo = getPaymentTargetLv1(file);

    output.targetLv1 = targetInfo.lv1;
    output.targetLv1Source = targetInfo.source;

    if (!output.targetLv1) {
        clearAllComboBoxes(configs);
        output.success = false;
        output.message = "Không xác định được lv1 của hồ sơ thanh toán.";
        return output;
    }

    var currentUser = normalizeValue(
        apiOptions ? apiOptions.currentUser : safeVarGet("$lo.contact.name", "")
    );

    output.currentUser = currentUser;

    if (!currentUser) {
        clearAllComboBoxes(configs);
        output.success = false;
        output.message = "Không xác định được user đăng nhập.";
        return output;
    }

    var currentUserScope = getUserScopeContext(currentUser, output.targetLv1);

    output.currentUserScope = currentUserScope;

    if (!currentUserScope.canAccessTargetLv1) {
        clearAllComboBoxes(configs);
        output.success = false;
        output.message =
            "User đăng nhập không có phân quyền dữ liệu " +
            HTKT_SUB_MODULE +
            " trong lv1 của hồ sơ: " +
            output.targetLv1 + (apiOptions ? ". " + currentUserScope.message : "");
        return output;
    }

    for (var i = 0; i < configs.length; i++) {
        var config = configs[i];
        var result = loadOneComboBox(config, output.targetLv1);

        output[config.key] = result;
        output.configs.push({
            key: config.key,
            label: config.label,
            valueList: config.valueList,
            displayList: config.displayList,
            saveField: config.saveField,
            count: result.count,
            mode: result.mode
        });

        if (!result.success) {
            output.success = false;
        }
    }

    output.message = output.success ?
        "Load danh sách combobox thành công." :
        "Có combobox load không thành công.";

    return output;

    function clearAllComboBoxes(configs) {
        if (apiOptions) return;
        for (var i = 0; i < configs.length; i++) {
            vars[configs[i].valueList] = [];
            vars[configs[i].displayList] = [];
        }
    }

    function loadOneComboBox(config, targetLv1) {
        var result = {
            success: false,
            mode: config.mode,
            label: config.label,
            saveField: config.saveField,
            targetLv1: targetLv1,
            count: 0,
            ids: [],
            names: [],
            message: "",
            debug: {
                poolCount: 0,
                passedCount: 0,
                rejectedCount: 0
            }
        };

        if (!apiOptions) {
            vars[config.valueList] = [];
            vars[config.displayList] = [];
        }

        try {
            var selectedOnly = config.mode === "selected";
            var selectedId = "";
            var contactIds;
            if (selectedOnly) {
                selectedId = normalizeValue(safeFileGet(file, [config.saveField]));
                contactIds = { ids: selectedId ? [selectedId] : [], poolCount: 0, rejectedCount: 0 };
            } else {
                contactIds = getContactsForRoleInLv1(config, targetLv1);
            }

            result.debug.poolCount = contactIds.poolCount;
            result.debug.rejectedCount = contactIds.rejectedCount;

            var comboData = apiOptions ?
                readContactPage(contactIds.ids, apiOptions) :
                readContactData(contactIds.ids, selectedOnly);
            if (selectedOnly && selectedId && !comboData.ids.length) {
                comboData = { ids: [selectedId], names: [selectedId] };
            }

            if (comboData.ids.length !== comboData.names.length) {
                throw new Error(
                    config.valueList +
                    " và " +
                    config.displayList +
                    " không cùng số phần tử."
                );
            }

            if (!apiOptions) {
                vars[config.valueList] = comboData.ids;
                vars[config.displayList] = comboData.names;
            }

            result.success = true;
            result.count = comboData.ids.length;
            result.ids = comboData.ids;
            result.names = comboData.names;
            if (apiOptions) result.hasMore = comboData.hasMore;
            result.debug.passedCount = comboData.ids.length;

            result.message = result.count > 0 ?
                "Load danh sách thành công." :
                "Không tìm thấy cán bộ phù hợp.";

        } catch (e) {
            if (!apiOptions) {
                vars[config.valueList] = [];
                vars[config.displayList] = [];
            }

            result.success = false;
            result.message = String(e.message || e);
        }

        return result;
    }

    function getContactsForRoleInLv1(config, targetLv1) {
        var ids = normalizeArray(listContactsByRightsAndLv1(config.seedRights, targetLv1, HTKT_SUB_MODULE));
        return { ids: ids, poolCount: ids.length, rejectedCount: 0 };
    }

    function readContactPage(contactIds, options) {
        var ids = normalizeArray(contactIds).sort();
        if (options.selectedId) {
            ids = ids.indexOf(options.selectedId) >= 0 ? [options.selectedId] : [];
        }
        var result = { ids: [], names: [], hasMore: false };
        var skip = (options.page - 1) * options.pageSize;
        var matched = 0;
        var keyword = normalizeValue(options.keyword).toLowerCase();
        for (var offset = 0; offset < ids.length; offset += 100) {
            var conditions = [];
            var batch = ids.slice(offset, offset + 100);
            for (var i = 0; i < batch.length; i++) {
                conditions.push('contact.name="' + escapeQueryValue(batch[i]) + '"');
            }
            var contactFile = null;
            try {
                contactFile = new SCFile("contacts", SCFILE_READONLY);
                contactFile.setFields(["contact.name", "full.name", "position", "status"]);
                contactFile.setOrderBy(["contact.name"], [SCFILE_ASC]);
                var rc = contactFile.doSelect("(" + conditions.join(" or ") + ")");
                while (rc === RC_SUCCESS) {
                    var id = normalizeValue(contactFile["contact.name"]);
                    var status = normalizeValue(contactFile["status"]);
                    var name = normalizeValue(contactFile["full.name"]) || id;
                    var position = normalizeValue(contactFile["position"]);
                    var display = name + (position ? " - " + position : "");
                    if (id && (!status || status === "Dang hoat dong") &&
                        (!keyword || (id + " " + display).toLowerCase().indexOf(keyword) >= 0)) {
                        if (matched++ >= skip) {
                            if (result.ids.length === options.pageSize) {
                                result.hasMore = true;
                                return result;
                            }
                            result.ids.push(id);
                            result.names.push(display);
                        }
                    }
                    rc = contactFile.getNext();
                }
            } finally {
                if (contactFile) contactFile.doClose();
            }
        }
        return result;
    }

    function getUserScopeContext(contactId, targetLv1) {
        var normalizedContactId = normalizeValue(contactId);
        var normalizedTargetLv1 = normalizeUnitCode(targetLv1);
        var cacheKey = normalizedContactId + "|" + normalizedTargetLv1;

        if (!userScopeCache.hasOwnProperty(cacheKey)) {
            userScopeCache[cacheKey] = buildUserScopeContext(
                normalizedContactId,
                normalizedTargetLv1
            );
        }

        return userScopeCache[cacheKey];
    }

    function buildUserScopeContext(contactId, targetLv1) {
        targetLv1 = normalizeUnitCode(targetLv1);

        var result = {
            contactId: contactId,
            targetLv1: targetLv1,
            scope: "",
            rawUnits: [],
            resolvedLv1List: [],
            canAccessTargetLv1: false,
            message: ""
        };

        if (!contactId || !targetLv1) {
            result.message = "Thiếu contactId hoặc targetLv1.";
            return result;
        }

        var targetDomain = resolveHTKTApprovalDataDomain(targetLv1);
        if (!targetDomain.valid) {
            result.message = "Không xác định được miền dữ liệu hợp lệ của lv1 hồ sơ.";
            return result;
        }

        var dp = null;

        try {
            dp = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(
                contactId,
                HTKT_SUB_MODULE
            ) || {};
        } catch (e) {
            result.message = String(e.message || e);
            return result;
        }

        result.scope = normalizeValue(
            dp.scope ||
            dp.dataScopeList ||
            dp["permission.scope"] ||
            ""
        );

        if (!result.scope) {
            result.scope = "QT_PQDL_01";
        }

        result.rawUnits = normalizeArray(
            dp.unit ||
            dp.arrUnitRights ||
            dp.units || []
        );

        if (result.scope === "QT_PQDL_06") {
            if (targetDomain.type === "HEAD_OFFICE") {
                var currentUserLv1 = normalizeUnitCode(getHTKTApprovalContactLv1(contactId));
                var currentUserDomain = resolveHTKTApprovalDataDomain(currentUserLv1);

                if (currentUserDomain.valid && currentUserDomain.type === "HEAD_OFFICE") {
                    result.canAccessTargetLv1 = true;
                    result.resolvedLv1List = targetDomain.allowedLv1List.slice(0);
                    result.message = "User scope toàn hàng thuộc Trụ sở chính, được thao tác trong toàn miền Trụ sở chính.";
                    return result;
                }

                result.canAccessTargetLv1 = false;
                result.message = "User scope toàn hàng không thuộc miền Trụ sở chính của hồ sơ.";
                return result;
            }

            result.canAccessTargetLv1 = ALLOW_GLOBAL_SCOPE_IN_COMBO === true;
            result.message =
                result.canAccessTargetLv1 ?
                "User có scope toàn hàng và hệ thống cho phép dùng toàn hàng." :
                "User có scope toàn hàng nhưng nghiệp vụ đang chặn mở dữ liệu khác lv1.";
            return result;
        }

        if (result.scope === "QT_PQDL_01") {
            result.canAccessTargetLv1 = false;
            result.message = "User chỉ có scope cá nhân, không được load combobox theo lv1.";
            return result;
        }

        if (result.rawUnits.length === 0) {
            result.canAccessTargetLv1 = false;
            result.message = "User có scope đơn vị nhưng không có unit phân quyền dữ liệu.";
            return result;
        }

        var resolvedLv1Map = {};
        var allowedLv1Map = {};

        for (var allowedIndex = 0; allowedIndex < targetDomain.allowedLv1List.length; allowedIndex++) {
            var allowedLv1 = normalizeUnitCode(targetDomain.allowedLv1List[allowedIndex]);
            if (allowedLv1) allowedLv1Map[allowedLv1] = true;
        }

        for (var i = 0; i < result.rawUnits.length; i++) {
            var rawUnit = normalizeUnitCode(result.rawUnits[i]);
            var currentLv1 = rawUnit === targetLv1 ? rawUnit : resolveLv1FromUnit(rawUnit);

            if (currentLv1 && !resolvedLv1Map[currentLv1]) {
                resolvedLv1Map[currentLv1] = true;
                result.resolvedLv1List.push(currentLv1);
            }

            if (currentLv1 && allowedLv1Map[currentLv1]) {
                result.canAccessTargetLv1 = true;
                result.message = targetDomain.type === "HEAD_OFFICE" ?
                    "User có data permission 00401 trong miền Trụ sở chính của hồ sơ." :
                    "User có data permission 00401 trong lv1 của hồ sơ.";
                return result;
            }
        }

        result.canAccessTargetLv1 = false;
        result.message = targetDomain.type === "HEAD_OFFICE" ?
            "User không có data permission 00401 trong miền Trụ sở chính của hồ sơ." :
            "User không có data permission 00401 trùng lv1 của hồ sơ.";

        return result;
    }

    function getPaymentTargetLv1(file) {
        var result = {
            lv1: "",
            source: ""
        };

        var lv1 = normalizeUnitCode(
            safeFileGet(file, [
                "unit.lv1",
                "unit_lv1",
                "lv1.id",
                "lv1_id"
            ])
        );

        if (lv1) {
            result.lv1 = lv1;
            result.source = "$L.file.unit.lv1";
            return result;
        }

        var unitId = normalizeUnitCode(
            safeFileGet(file, [
                "unit.id",
                "unit_id",
                "unit"
            ])
        );

        if (unitId) {
            result.lv1 = resolveLv1FromUnit(unitId);
            result.source = "$L.file.unit.id";
            return result;
        }

        var currentContactLv1 = normalizeUnitCode(
            safeVarGet("$G.contacts.lv1", "")
        );

        if (currentContactLv1) {
            result.lv1 = currentContactLv1;
            result.source = "$G.contacts.lv1";
            return result;
        }

        var currentUnit = normalizeUnitCode(
            safeVarGet("$unit", "")
        );

        if (currentUnit) {
            result.lv1 = resolveLv1FromUnit(currentUnit);
            result.source = "$unit";
            return result;
        }

        return result;
    }

    function resolveLv1FromUnit(unitCode) {
        unitCode = normalizeUnitCode(unitCode);

        if (!unitCode) {
            return "";
        }

        var currentUnit = unitCode;
        var seen = {};
        var maxLoop = 10;

        for (var i = 0; i < maxLoop; i++) {
            if (!currentUnit) {
                return "";
            }

            if (seen[currentUnit]) {
                return "";
            }

            seen[currentUnit] = true;

            var detail = lookupOrgUnit(currentUnit);

            if (!detail.found) {
                return currentUnit;
            }

            if (isLevel1(detail.level)) {
                return detail.unitId;
            }

            if (detail.lv1Id) {
                return detail.lv1Id;
            }

            if (!detail.parentId || detail.parentId === currentUnit) {
                return currentUnit;
            }

            currentUnit = detail.parentId;
        }

        return currentUnit;
    }

    function lookupOrgUnit(unitCode) {
        unitCode = normalizeUnitCode(unitCode);

        var result = {
            found: false,
            recordId: "",
            unitId: unitCode,
            unitName: "",
            level: "",
            status: "",
            parentId: "",
            orgUnit: "",
            lv1Id: ""
        };

        if (!unitCode) {
            return result;
        }

        if (orgUnitCache.hasOwnProperty(unitCode)) {
            return orgUnitCache[unitCode];
        }

        var f = null;

        try {
            f = new SCFile("esdQTorgUnit", SCFILE_READONLY);
            var rc = f.doSelect(
                'unit.id="' + escapeQueryValue(unitCode) + '"'
            );

            if (rc === RC_SUCCESS) {
                result.found = true;
                result.recordId = normalizeValue(f["id"]);
                result.unitId = normalizeUnitCode(f["unit.id"]);
                result.unitName = normalizeValue(f["unit.name"]);
                result.level = normalizeValue(f["level"]);
                result.status = normalizeValue(f["status"]);
                result.parentId = normalizeUnitCode(f["parent.id"]);
                result.orgUnit = normalizeValue(f["org.unit"]);
                result.lv1Id = normalizeUnitCode(f["lv1.id"]);

                if (!result.lv1Id && isLevel1(result.level)) {
                    result.lv1Id = result.unitId;
                }
            }
        } finally {
            try {
                if (f) {
                    f.doClose();
                }
            } catch (eClose) {}
        }

        orgUnitCache[unitCode] = result;
        return result;
    }

    function isLevel1(level) {
        level = normalizeValue(level);
        return level.indexOf("lv1") === 0;
    }

    function readContactData(contactIds, includeInactive) {
        var ids = normalizeArray(contactIds);
        var cacheKey = (includeInactive ? "selected|" : "candidates|") + ids.slice(0).sort().join("|");

        var data = {
            ids: [],
            names: []
        };
        if (ids.length === 0) {
            return data;
        }

        if (contactDataCache.hasOwnProperty(cacheKey)) {
            return {
                ids: contactDataCache[cacheKey].ids.slice(0),
                names: contactDataCache[cacheKey].names.slice(0)
            };
        }

        var conditions = [];

        for (var i = 0; i < ids.length; i++) {
            conditions.push(
                'contact.name="' +
                escapeQueryValue(ids[i]) +
                '"'
            );
        }

        var rows = [];
        var seen = {};
        var contactFile = null;

        try {
            contactFile = new SCFile("contacts", SCFILE_READONLY);

            contactFile.setFields([
                "contact.name",
                "full.name",
                "position",
                "status"
            ]);

            var rc = contactFile.doSelect(
                "(" + conditions.join(" or ") + ")"
            );

            while (rc === RC_SUCCESS) {
                var contactId = normalizeValue(
                    contactFile["contact.name"]
                );

                var status = normalizeValue(
                    contactFile["status"]
                );

                if (
                    contactId &&
                    !seen[contactId] &&
                    (includeInactive || !status || status === "Dang hoat dong")
                ) {
                    seen[contactId] = true;

                    var fullName = normalizeValue(
                        contactFile["full.name"]
                    );

                    var position = normalizeValue(
                        contactFile["position"]
                    );

                    var display = "";

                    if (fullName && position) {
                        display = fullName + " - " + position;
                    } else if (fullName) {
                        display = fullName;
                    } else {
                        display = contactId;
                    }

                    rows.push({
                        id: contactId,
                        display: display
                    });
                }

                rc = contactFile.getNext();
            }
        } finally {
            try {
                if (contactFile) {
                    contactFile.doClose();
                }
            } catch (eClose) {}
        }

        rows.sort(function(a, b) {
            var da = normalizeValue(a.display).toLowerCase();
            var db = normalizeValue(b.display).toLowerCase();

            if (da < db) return -1;
            if (da > db) return 1;
            return 0;
        });

        for (var j = 0; j < rows.length; j++) {
            data.ids.push(rows[j].id);
            data.names.push(rows[j].display);
        }

        contactDataCache[cacheKey] = {
            ids: data.ids.slice(0),
            names: data.names.slice(0)
        };

        return data;
    }

    function normalizeValue(value) {
        return String(value == null ? "" : value).trim();
    }

    function normalizeArray(source) {
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
            var value = normalizeValue(array[i]);

            if (value && !seen[value]) {
                seen[value] = true;
                result.push(value);
            }
        }

        return result;
    }

    function normalizeUnitCode(code) {
        var s = normalizeValue(code);

        if (!s) {
            return "";
        }

        s = s.replace(/\.0$/, "");

        if (/^[0-9]+$/.test(s) && s.length === 8) {
            s = "0" + s;
        }

        return s;
    }

    function escapeQueryValue(value) {
        return normalizeValue(value)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
    }

    function safeFileGet(file, fields) {
        if (!file || !fields) {
            return "";
        }

        for (var i = 0; i < fields.length; i++) {
            try {
                var value = file[fields[i]];

                if (value != null && value !== "") {
                    return String(value).trim();
                }
            } catch (e1) {}

            try {
                var alt = fields[i].replace(/\./g, "_");
                var value2 = file[alt];

                if (value2 != null && value2 !== "") {
                    return String(value2).trim();
                }
            } catch (e2) {}
        }

        return "";
    }

    function safeVarGet(name, defaultValue) {
        try {
            return vars[name] == null ? defaultValue : vars[name];
        } catch (e) {
            return defaultValue;
        }
    }
}