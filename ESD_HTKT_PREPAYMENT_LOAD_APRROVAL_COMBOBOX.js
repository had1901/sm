function getPrepaymentApprovalFields() {
    return ["user.checker.kttc", "user.checker.dmms", "user.approver.dmms",
        "user.approver.kttc", "user.checker.final", "user.approver.final"
    ];
}

// Gọi ở đầu Rule Set của nút Lưu/Workflow để form SM chọn lại chính record mới nhất.
function syncPrepaymentApprovalFromDatabase(prepayment) {
    var prepaymentId = String(prepayment ? prepayment.id || "" : "").trim();
    if (!prepaymentId) return prepayment;

    if (typeof prepayment.doSelect === "function") {
        var description = prepayment.description;
        var note = prepayment.note;
        if (description != null) description = String(description);
        try {
            var rc = prepayment.doSelect('id="' + escapeSmQueryValue(prepaymentId) + '"');
            var selected = typeof rc === "boolean" ? rc : rc === RC_SUCCESS;
            if (!selected) {
                throw new Error("Không tải lại được phiên bản mới nhất của phiếu tạm ứng " +
                        prepaymentId + ". doSelect=" + String(rc) + " (" + typeof rc + ").");
            }
        } finally {
            prepayment.description = description;
            prepayment.note = note;
        }
        return prepayment;
    }

    var stored = null;
    try {
        stored = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
        var fields = getPrepaymentApprovalFields().concat([
            "require.check.level1", "require.check.level2", "sysmodtime"
        ]);
        stored.setFields(fields);
        if (stored.doSelect('id="' + escapeSmQueryValue(prepaymentId) + '"') !== RC_SUCCESS) {
            throw new Error("Không tải được thông tin phê duyệt đã lưu.");
        }
        for (var i = 0; i < fields.length; i++) prepayment[fields[i]] = stored[fields[i]];
        return prepayment;
    } finally {
        if (stored) stored.doClose();
    }
}

/**
 * Lấy Functional Rights của user dùng riêng cho logic tái phân công.
 *
 * LƯU Ý:
 * - Fail-closed: không đọc được rights => không cấp thêm quyền lãnh đạo.
 * - Không thay đổi quyền xử lý workflow hiện hữu.
 * - RIGHT_APPROVE_1 (0005) đại diện Lãnh đạo ĐMMS / approval_dmms.
 * - RIGHT_APPROVE_2 (0006) đại diện Lãnh đạo KTTC / approval_kttc.
 */
function getPrepaymentReassignmentRoleAccess(currentUser, canonicalContactResolved) {
    var RIGHT_APPROVE_1 = "0040040002000005";
    var RIGHT_APPROVE_2 = "0040040002000006";

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

    /*
     * Nguồn 1 - Functional Rights của chính session SM.
     *
     * Chỉ merge $G.rights khi currentUser đúng là contact.name của session
     * (so sánh không phân biệt hoa/thường), tránh dùng nhầm quyền session
     * cho một user khác.
     */
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
            return {
                isApprovalDmms: rightMap[RIGHT_APPROVE_1] === true,
                isApprovalKttc: rightMap[RIGHT_APPROVE_2] === true
            };
        }
    } catch (eSessionRights) {}

    /*
     * Nguồn 2 - giữ nguyên cách gọi cũ bằng identity nhận từ caller.
     *
     * Ví dụ caller REST có thể truyền "vtb.htkt.126".
     * Nếu môi trường permsRight phân biệt hoa/thường thì nguồn này có thể
     * không trả đủ quyền; vì vậy bên dưới luôn resolve canonical contact.name
     * từ bảng contacts và merge thêm.
     */
    addRightsByIdentity(contactName);

    // The API path already resolved the exact canonical contact.name with an
    // indexed equality query. Its permsRight result is authoritative, so do
    // not resolve the same contact and read the same rights again.
    if (canonicalContactResolved === true) {
        return {
            isApprovalDmms: rightMap[RIGHT_APPROVE_1] === true,
            isApprovalKttc: rightMap[RIGHT_APPROVE_2] === true
        };
    }

    /*
     * Nguồn 3 - resolve canonical contact.name theo truy vấn case-insensitive.
     *
     * Đây là phần quan trọng cho REST/API context:
     * - NextJS có thể gửi currentUser ở lowercase.
     * - contacts lưu contact.name theo canonical case, ví dụ VTB.HTKT.126.
     * - permsRight có thể phân biệt hoa/thường theo identity đầu vào.
     *
     * Vì vậy phải lấy lại chính contact.name đã lưu trong SM rồi gọi permsRight
     * bằng canonical name đó. Vẫn giữ thêm contact.id làm fallback để tương thích
     * với các môi trường ESD_PERMS_RIGHTS khác nhau.
     */
    var contactFile = null;

    try {
        contactFile = new SCFile("contacts", SCFILE_READONLY);
        contactFile.setFields(["contact.name"]);

        var contactRc = contactFile.doSelect(
                'contact.name="' + escapeSmQueryValue(contactName) + '"'
        );
        if (contactRc !== RC_SUCCESS) {
            contactRc = contactFile.doSelect(
                    'tolower(contact.name)="' +
                    escapeSmQueryValue(contactName.toLowerCase()) +
                    '"'
            );
        }

        if (contactRc === RC_SUCCESS) {
            var canonicalContactName = String(
                    contactFile["contact.name"] == null ?
                            "" :
                            contactFile["contact.name"]
            ).trim();

            /*
             * Chỉ chấp nhận khi resolve duy nhất một contact.
             * Fail-closed nếu dữ liệu contacts bị trùng.
             */
            var hasDuplicate = false;
            try {
                hasDuplicate = contactFile.getNext() === RC_SUCCESS;
            } catch (eGetNextContact) {
                hasDuplicate = true;
            }

            if (!hasDuplicate && canonicalContactName) {
                addRightsByIdentity(canonicalContactName);
            }
        }
    } catch (eResolveContact) {
        // Fail-closed: không resolve được canonical contact thì chỉ giữ các nguồn quyền đã merge.
    } finally {
        try {
            if (contactFile) {
                contactFile.doClose();
            }
        } catch (eCloseContact) {}
    }

    print(
            "[PP_APR][ROLE] u=" + contactName +
            " r5=" + String(rightMap[RIGHT_APPROVE_1] === true) +
            " r6=" + String(rightMap[RIGHT_APPROVE_2] === true)
    );

    return {
        isApprovalDmms: rightMap[RIGHT_APPROVE_1] === true,
        isApprovalKttc: rightMap[RIGHT_APPROVE_2] === true
    };
}

function getPrepaymentApprovalAccess(prepayment, currentUser, canonicalContactResolved, menuContext) {
    var phase = readPrepaymentApprovalValue(prepayment, "current.phase").toLowerCase();
    var role = readPrepaymentApprovalValue(prepayment, "initial.role").toLowerCase();
    var creator = readPrepaymentApprovalValue(prepayment, "created.by").toLowerCase();
    var actor = String(currentUser == null ? "" : currentUser).trim().toLowerCase();
    var checker = readPrepaymentApprovalValue(prepayment, "user.checker.kttc").toLowerCase();
    var approverDmms = readPrepaymentApprovalValue(prepayment, "user.approver.dmms").toLowerCase();
    var approverKttc = readPrepaymentApprovalValue(prepayment, "user.approver.kttc").toLowerCase();
    var status = readPrepaymentApprovalValue(prepayment, "status").toLowerCase();
    var isDmmsCreator = !!actor && creator === actor && role === "dmms";

    // Giữ nguyên semantics quyền cũ cho người khởi tạo / KTTC tiếp nhận.
    var legacyClosed = phase === "end" || status === "cancelled";
    var canEditLevel1 = !legacyClosed && phase === "initial_dmms" && isDmmsCreator;
    var canEditLevel2 = !legacyClosed && phase === "initial_kttc" && !!actor &&
            ((creator === actor && role === "kttc") || checker === actor);

    // Quyền tái phân công của lãnh đạo chỉ áp dụng khi hồ sơ còn trong luồng xử lý.
    var reassignmentClosed =
            phase === "end" ||
            status === "cancelled" ||
            status === "approved" ||
            status === "accounted";

    /*
     * Trạng thái tạo mới phụ thuộc vào luồng ban đầu của phiếu:
     * - Luồng DMMS: chỉ initial_dmms là tạo mới.
     * - Luồng KTTC: chỉ initial_kttc là tạo mới.
     *
     * Vì vậy phiếu luồng DMMS đã chuyển sang initial_kttc để KTTC tiếp nhận
     * vẫn được phép tái phân công approval_dmms/checker.dmms.
     */
    var isPrepaymentCreationPhase =
            !phase ||
            phase === "start" ||
            (role === "dmms" && phase === "initial_dmms") ||
            (role === "kttc" && phase === "initial_kttc");

    var leaderAccess = getPrepaymentReassignmentRoleAccess(
            currentUser,
            canonicalContactResolved
    );

    /*
     * Xác định quyền lãnh đạo theo 2 nguồn:
     *
     * 1. Functional Right hiện hành:
     *    - 0040040002000005: Lãnh đạo ĐMMS / approval_dmms
     *    - 0040040002000006: Lãnh đạo KTTC / approval_kttc
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
     * approval_kttc được xác định bằng Functional Right 0040040002000006.
     * Đồng thời cho phép chính user đang giữ user.approver.kttc tái phân công
     * role của mình trong context API không resolve đủ Functional Right.
     */
    var isApprovalKttc =
            leaderAccess.isApprovalKttc === true ||
            (!!actor && actor === approverKttc);

    /*
     * Ma trận tái phân công mới:
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
    var canDmmsLeaderReassign = !reassignmentClosed &&
            !isPrepaymentCreationPhase &&
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
    var canKttcLeaderReassign = !reassignmentClosed &&
            !isPrepaymentCreationPhase &&
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

    // Chỉ menu hậu kiểm khóa tab. User có quyền hậu kiểm vẫn dùng menu thường
    // theo đúng quyền sửa/phase hiện hữu, kể cả user initial_kttc.
    var normalizedMenuContext = String(menuContext || "").trim().toLowerCase();
    var isPostAuditOperator = normalizedMenuContext === "post_audit";
    if (isPostAuditOperator) {
        canEditLevel1 = false;
        canEditLevel2 = false;
        canDmmsLeaderReassign = false;
        canKttcLeaderReassign = false;
        for (var postAuditField in fieldAccess) {
            if (Object.prototype.hasOwnProperty.call(fieldAccess, postAuditField)) {
                fieldAccess[postAuditField] = false;
            }
        }
    }

    //print(
    //    "[PP_APR][ACCESS] u=" + currentUser +
    //    " phase=" + phase +
    //    " role=" + role +
    //    " status=" + status +
    //    " dmms=" + String(isApprovalDmms) +
    //    " kttc=" + String(isApprovalKttc) +
    //    " closed=" + String(reassignmentClosed) +
    //    " dmmsReassign=" + String(canDmmsLeaderReassign) +
    //    " kttcReassign=" + String(canKttcLeaderReassign) +
    //    " checkerDmms=" + String(fieldAccess["user.checker.dmms"]) +
    //    " approverDmms=" + String(fieldAccess["user.approver.dmms"]) +
    //    " approverKttc=" + String(fieldAccess["user.approver.kttc"]) +
    //    " checkerFinal=" + String(fieldAccess["user.checker.final"])
    //);
    return {
        isDmmsCreator: isDmmsCreator,

        // FE cũ vẫn có thể dùng hai cờ này.
        showLevel1: role === "dmms",
        showLevel2: role === "kttc" ||
                isApprovalKttc ||
                (role === "dmms" && !isDmmsCreator && ["initial_kttc", "check_dmms", "approval_dmms", "approval_kttc", "check_final", "approval_final", "end"].indexOf(phase) >= 0),

        // Giữ nguyên cờ legacy để không ảnh hưởng FE/code đang golive.
        canEditLevel1: canEditLevel1,
        canEditLevel2: canEditLevel2,

        // Cờ role mới phục vụ FE và debug.
        isApprovalDmms: isApprovalDmms,
        isApprovalKttc: isApprovalKttc,

        /*
         * Lãnh đạo có quyền approval được xem phiếu độc lập với
         * initial.role/current.phase của phiếu.
         * Phạm vi đơn vị dữ liệu vẫn do Data Permission kiểm soát ở lớp list.
         */
        canViewEarly: isApprovalDmms || isApprovalKttc,

        // Quyền edit chuẩn theo từng field.
        fieldAccess: fieldAccess
    };
}

function readPrepaymentApprovalValue(prepayment, field) {
    var value = prepayment[field];
    if (value == null || String(value).trim() === "") value = prepayment[field.replace(/\./g, "_")];
    return String(value == null ? "" : value).trim();
}

function resolvePrepaymentApprovalContactId(currentUser) {
    var actor = String(currentUser || "").trim();
    var contact = null;
    try {
        contact = new SCFile("contacts", SCFILE_READONLY);
        contact.setFields(["contact.name"]);
        var rc = actor ? contact.doSelect('contact.name="' + escapeSmQueryValue(actor) + '"') : -1;
        if (rc !== RC_SUCCESS && actor) {
            rc = contact.doSelect('tolower(contact.name)="' + escapeSmQueryValue(actor.toLowerCase()) + '"');
        }
        if (rc !== RC_SUCCESS) {
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

function getPrepaymentApprovalInitData(prepayment, currentUser, menuContext) {
    var fields = getPrepaymentApprovalFields();
    var values = {};
    var selectedOptions = {};
    var conditions = [];
    var seen = {};
    for (var i = 0; i < fields.length; i++) {
        var id = String(prepayment[fields[i]] || "").trim();
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
    values["require.check.level1"] = String(prepayment["require.check.level1"]) === "true";
    values["require.check.level2"] = String(prepayment["require.check.level2"]) === "true";
    return {
        prepaymentId: String(prepayment.id || ""),
        currentUser: currentUser,
        initialRole: String(prepayment["initial.role"] || ""),
        currentPhase: String(prepayment["current.phase"] || prepayment.current_phase || ""),
        createdBy: String(prepayment["created.by"] || ""),
        status: String(prepayment.status || ""),
        menuContext: String(menuContext || "create").trim().toLowerCase(),
        isFromHK: String(menuContext || "").trim().toLowerCase() === "post_audit",
        approvalValues: values,
        approvalSelectedOptions: selectedOptions,
        approvalAccess: getPrepaymentApprovalAccess(prepayment, currentUser, false, menuContext)
    };
}


/**
 * Đọc lại toàn bộ dữ liệu tab Thông tin phê duyệt từ DB.
 *
 * Dùng cho NextJS refresh lại approvalValues / approvalAccess sau khi
 * người dùng thao tác workflow bên SM rồi quay lại iframe.
 *
 * Chỉ đọc dữ liệu, không ghi DB.
 */
function getPrepaymentApprovalData(details) {
    details = details || {};

    var prepaymentId = String(details.prepaymentId || "").trim();
    var currentUser = String(details.currentUser || "").trim();
    var menuContext = String(details.menuContext || "create").trim().toLowerCase();
    var prepayment = null;

    try {
        if (!prepaymentId || !currentUser) {
            throw new Error("Thông tin tải dữ liệu phê duyệt không hợp lệ.");
        }

        prepayment = new SCFile(
                "esdHTKTprepayment",
                SCFILE_READONLY
        );
        prepayment.setFields(getPrepaymentApprovalFields().concat([
            "id",
            "require.check.level1",
            "require.check.level2",
            "initial.role",
            "current.phase",
            "created.by",
            "status"
        ]));

        if (
                prepayment.doSelect(
                        'id="' + escapeSmQueryValue(prepaymentId) + '"'
                ) !== RC_SUCCESS
        ) {
            throw new Error("Không tìm thấy phiếu tạm ứng.");
        }

        return {
            success: true,
            data: getPrepaymentApprovalInitData(
                    prepayment,
                    currentUser,
                    menuContext
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
        if (prepayment) {
            try {
                prepayment.doClose();
            } catch (eClose) {}
        }
    }
}

function prepaymentApprovalFieldEditable(prepayment, currentUser, field) {
    var access = getPrepaymentApprovalAccess(prepayment, currentUser);

    // Logic mới ưu tiên quyền chi tiết theo field.
    // Fallback phía dưới giữ tương thích nếu access object của bản cũ được dùng ở đâu đó.
    if (access.fieldAccess && typeof access.fieldAccess[field] !== "undefined") {
        return access.fieldAccess[field] === true;
    }

    var level1 = ["require.check.level1", "user.checker.kttc", "user.checker.dmms", "user.approver.dmms"];
    var level2 = ["require.check.level2", "user.approver.kttc", "user.checker.final", "user.approver.final"];
    return (access.canEditLevel1 && level1.indexOf(field) >= 0) ||
            (access.canEditLevel2 && level2.indexOf(field) >= 0);
}

function getPrepaymentApprovalOptions(details) {
    return runPrepaymentApprovalApi(details, false);
}


/**
 * Validate không cho cùng một cán bộ được phân công ở nhiều combobox
 * với các vai trò xử lý khác nhau trên cùng một Đề nghị Tạm ứng.
 *
 * Quy tắc:
 * - Chỉ áp dụng cho 6 field cán bộ phê duyệt.
 * - Bỏ qua chính field đang thay đổi.
 * - Không phân biệt hoa/thường khi so sánh contact.name.
 * - Giá trị rỗng không bị coi là trùng.
 * - Chỉ validate trước khi lưu, không thay đổi logic load candidate / quyền / workflow.
 */
function validateDuplicatePrepaymentApprovalUser(prepayment, currentField, newValue) {
    var safeField = String(currentField == null ? "" : currentField).trim();
    var safeValue = String(newValue == null ? "" : newValue).trim();

    if (!safeField || !safeValue) {
        return;
    }

    var fields = getPrepaymentApprovalFields();
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

        var otherValue = readPrepaymentApprovalValue(prepayment, otherField);

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


/**
 * Ghi lịch sử tái phân công cán bộ phê duyệt.
 *
 * Chỉ ghi khi:
 * - field là một trong các field cán bộ phê duyệt;
 * - giá trị cũ và mới đều có dữ liệu;
 * - giá trị thực sự thay đổi.
 *
 * Lưu ý:
 * - Không ghi khi phân công lần đầu từ rỗng -> có giá trị.
 * - Không ghi cho checkbox require.check.level1 / require.check.level2.
 * - Lỗi ghi activity không được làm rollback việc tái phân công đã lưu thành công.
 */
function createPrepaymentReassignmentHistory(prepaymentId, field, oldValue, newValue, reason, currentUser) {
    var prepayment = null;

    try {
        var safePrepaymentId = String(prepaymentId == null ? "" : prepaymentId).trim();
        var safeField = String(field == null ? "" : field).trim();
        var safeOldValue = String(oldValue == null ? "" : oldValue).trim();
        var safeNewValue = String(newValue == null ? "" : newValue).trim();
        var safeReason = String(reason == null ? "" : reason).trim();
        var safeCurrentUser = String(currentUser == null ? "" : currentUser).trim();

        print("[PP_APR][REASSIGN] Bắt đầu kiểm tra tái phân công phiếu: " + safePrepaymentId + " | field: " + safeField + " | " + safeOldValue + " -> " + safeNewValue + " | user: " + safeCurrentUser);

        if (
                !safePrepaymentId ||
                !safeField ||
                !safeOldValue ||
                !safeNewValue ||
                safeOldValue === safeNewValue ||
                !safeCurrentUser
        ) {
            print("[PP_APR][REASSIGN] Bỏ qua tái phân công: dữ liệu không hợp lệ hoặc giá trị không đổi.");
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
            print("[PP_APR][REASSIGN] Bỏ qua: trường " + safeField + " không thuộc vai trò tái phân công.");
            return;
        }

        var leadership = getPrepaymentReassignmentRoleAccess(safeCurrentUser);

        prepayment = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
        prepayment.setFields([
                "id",
                "initial.role",
                "user.approver.dmms",
                "user.approver.kttc"
        ]);

        if (
                prepayment.doSelect(
                        'id="' + escapeSmQueryValue(safePrepaymentId) + '"'
                ) !== RC_SUCCESS
        ) {
            print("[PP_APR][REASSIGN] Không tìm thấy phiếu " + safePrepaymentId + " trong esdHTKTprepayment.");
            return;
        }

        var initialRole = String(
                prepayment["initial.role"] == null ?
                        "" :
                        prepayment["initial.role"]
        ).trim().toLowerCase();

        var currentApprovalDmms = String(
                prepayment["user.approver.dmms"] == null ?
                        "" :
                        prepayment["user.approver.dmms"]
        ).trim().toLowerCase();
        var canActAsApprovalDmms =
                leadership.isApprovalDmms === true ||
                (!!safeCurrentUser &&
                        safeCurrentUser.toLowerCase() === currentApprovalDmms);

        var currentApprovalKttc = String(
                prepayment["user.approver.kttc"] == null ?
                        "" :
                        prepayment["user.approver.kttc"]
        ).trim().toLowerCase();
        var canActAsApprovalKttc =
                leadership.isApprovalKttc === true ||
                (!!safeCurrentUser &&
                        safeCurrentUser.toLowerCase() === currentApprovalKttc);

        if (
                !leadership ||
                (
                        !canActAsApprovalDmms &&
                        !canActAsApprovalKttc
                )
        ) {
            print("[PP_APR][REASSIGN] Bỏ qua: User " + safeCurrentUser + " không có quyền lãnh đạo ĐMMS/KTTC.");
            return;
        }

        var canWriteReassignmentHistory = false;

        if (
                canActAsApprovalDmms &&
                initialRole === "dmms" &&
                (
                        safeField === "user.checker.dmms" ||
                        safeField === "user.approver.dmms"
                )
        ) {
            canWriteReassignmentHistory = true;
        }

        if (
                canActAsApprovalKttc &&
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
            print("[PP_APR][REASSIGN] Bỏ qua: không đủ điều kiện phân quyền tái phân công cho " + safeField + " (initialRole=" + initialRole + ").");
            return;
        }

        var activityDescription =
                'Tái phân công Đề nghị Tạm ứng: Mã đề nghị: "' + safePrepaymentId + '"' +
                '\nVai trò: "' + fieldLabels[safeField] + '"' +
                '\nTừ: "' + safeOldValue + '"' +
                '\nĐến: "' + safeNewValue + '"' +
                (safeReason ? '\nLý do: "' + safeReason + '"' : "");

        print("[PP_APR][REASSIGN] Đang ghi activity lịch sử tái phân công...");
        lib.ESD_Utils.createActivity(
                "activityHTKTprepayment",
                activityDescription,
                safePrepaymentId,
                "Tái phân công",
                safeCurrentUser
        );
        print("[PP_APR][REASSIGN] Đã ghi activity thành công.");

        // Gửi email thông báo tái phân công cho cán bộ mới
        try {
            if (lib.ESD_HTKT_ACTION_WF_SEND_EMAIL && lib.ESD_HTKT_ACTION_WF_SEND_EMAIL.sendEmailReassignOfficer) {
                var opUser = safeCurrentUser || (vars.$lo_operator ? (vars.$lo_operator["contact.name"] || vars.$lo_operator["name"]) : "") || vars["$lo.contact.name"] || "";
                lib.ESD_HTKT_ACTION_WF_SEND_EMAIL.sendEmailReassignOfficer({
                    id: safePrepaymentId,
                    "new.assignee": safeNewValue,
                    "old.assignee": safeOldValue,
                    field: safeField,
                    role: fieldLabels[safeField],
                    reason: safeReason,
                    operator: opUser
                });
            }
        } catch (eMail) {
        }
    } catch (e) {
        print(
                "[PP_APR][REASSIGN_HISTORY] Lỗi xử lý tái phân công: " +
                String(e && e.message ? e.message : e)
        );
    } finally {
        try {
            if (prepayment) {
                prepayment.doClose();
            }
        } catch (eClosePrepayment) {}
    }
}

function savePrepaymentApprovalField(details) {
    return runPrepaymentApprovalApi(details, true);
}

function runPrepaymentApprovalApi(details, save) {
    details = details || {};
    var prepayment = null;
    try {
        var prepaymentId = String(details.prepaymentId || "").trim();
        var currentUser = String(details.currentUser || "").trim();
        var menuContext = String(details.menuContext || "create").trim().toLowerCase();
        var field = String(details.field || "").trim();
        var fields = getPrepaymentApprovalFields();
        var isCheckbox = field === "require.check.level1" || field === "require.check.level2";
        if (!prepaymentId || !currentUser || (fields.indexOf(field) < 0 && !(save && isCheckbox))) {
            throw new Error("Thông tin phê duyệt không hợp lệ.");
        }
        prepayment = save ? new SCFile("esdHTKTprepayment") : new SCFile("esdHTKTprepayment", SCFILE_READONLY);
        if (!save) {
            prepayment.setFields(fields.concat([
                "id",
                "require.check.level1",
                "require.check.level2",
                "initial.role",
                "current.phase",
                "created.by",
                "status",
                "unit.lv1",
                "unit.id"
            ]));
        }
        if (prepayment.doSelect('id="' + escapeSmQueryValue(prepaymentId) + '"') !== RC_SUCCESS) {
            throw new Error("Không tìm thấy phiếu tạm ứng.");
        }
        var permissionContactId = resolvePrepaymentApprovalContactId(currentUser);
        var apiAccess = getPrepaymentApprovalAccess(
                prepayment,
                permissionContactId,
                true,
                menuContext
        );
        var apiEditable =
                apiAccess &&
                apiAccess.fieldAccess &&
                apiAccess.fieldAccess[field] === true;

        print(
                "[PP_APR][API] u=" + currentUser +
                " field=" + field +
                " kttc=" + String(apiAccess && apiAccess.isApprovalKttc === true) +
                " editable=" + String(apiEditable)
        );

        if (!apiEditable) {
            return {
                success: false,
                code: "PREPAYMENT_APPROVAL_FORBIDDEN",
                message: "Bạn không có quyền sửa thông tin phê duyệt tại bước hiện tại.",
                accessContext: {
                    prepaymentId: prepaymentId,
                    field: field,
                    currentUser: currentUser,
                    createdBy: readPrepaymentApprovalValue(prepayment, "created.by"),
                    initialRole: readPrepaymentApprovalValue(prepayment, "initial.role"),
                    currentPhase: readPrepaymentApprovalValue(prepayment, "current.phase"),
                    status: readPrepaymentApprovalValue(prepayment, "status"),
                    userCheckerKttc: readPrepaymentApprovalValue(prepayment, "user.checker.kttc")
                }
            };
        }
        if ((field === "user.checker.dmms" && String(prepayment["require.check.level1"]) !== "true") ||
                (field === "user.checker.final" && String(prepayment["require.check.level2"]) !== "true")) {
            throw new Error("Chưa bật yêu cầu rà soát tương ứng.");
        }
        var value = isCheckbox ? details.value : String(details.value == null ? "" : details.value).trim();
        if (isCheckbox && typeof value !== "boolean") throw new Error("Giá trị checkbox không hợp lệ.");
        var page = Math.max(1, Math.floor(Number(details.page) || 1));
        var pageSize = Math.max(1, Math.min(100, Math.floor(Number(details.pageSize) || 10)));
        var result;
        if (!save || (!isCheckbox && value)) {
            var loaded = save ? validatePrepaymentApprovalAssignee(prepayment, field, value, {
                currentUser: permissionContactId,
                page: 1,
                pageSize: 1,
                keyword: ""
            }) : loadPrepaymentApprovalComboBoxesInternal(prepayment, field, {
                currentUser: permissionContactId,
                page: page,
                pageSize: pageSize,
                keyword: String(details.keyword || "").trim(),
                selectedId: ""
            });
            if (!loaded.success) {
                return {
                    success: false,
                    code: loaded.currentUserScope && !loaded.currentUserScope.canAccessTargetLv1 ?
                            "PREPAYMENT_APPROVAL_SCOPE_DENIED" : "PREPAYMENT_APPROVAL_OPTIONS_FAILED",
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
            if (save) {
                if (!loaded.valid) throw new Error("Cán bộ đã chọn không còn hợp lệ theo quyền và đơn vị.");
            } else {
                if (!loaded.configs.length) throw new Error("Không tìm thấy cấu hình trường phê duyệt.");
                result = loaded[loaded.configs[0].key];
            }
        }
        if (!save) {
            var items = [];
            for (var i = 0; i < result.ids.length; i++) items.push({ value: result.ids[i], label: result.names[i] });
            return { success: true, data: { items: items, page: page, pageSize: pageSize, hasMore: result.hasMore === true } };
        }

        if (!isCheckbox) {
            validateDuplicatePrepaymentApprovalUser(
                    prepayment,
                    field,
                    value
            );
        }

        var previousApprovalValue = isCheckbox ?
                "" :
                readPrepaymentApprovalValue(prepayment, field);
        // KTTC đang tiếp nhận/chọn người xử lý ở initial_kttc là thiết lập ban đầu,
        // kể cả khi đổi một giá trị dự kiến đã lưu trước đó.
        var initialKttcSelection = apiAccess.canEditLevel2 === true &&
                readPrepaymentApprovalValue(prepayment, "current.phase").toLowerCase() === "initial_kttc" &&
                (field === "user.approver.kttc" || field === "user.checker.final" ||
                        field === "user.approver.final");

        var isSlaReassignment = !isCheckbox && !!previousApprovalValue &&
                previousApprovalValue !== value && !initialKttcSelection;
        var slaBeforeRecord = isSlaReassignment ? lib.ESD_HTKT_SLA_ENGINE.snapshot(prepayment) : null;
        prepayment[field] = value;
        var clearedField = "";
        if (isCheckbox && !value) {
            clearedField = field === "require.check.level1" ? "user.checker.dmms" : "user.checker.final";
            prepayment[clearedField] = "";
        }
        if (prepayment.doUpdate() !== RC_SUCCESS) throw new Error("Không lưu được thông tin phê duyệt.");

        var slaUpdated = true;
        if (isSlaReassignment) {
            try {
                // Snapshot bỏ sysmod*: sysmodtime trên SCFile ngay sau doUpdate không đáng tin
                // (có thể lệch múi giờ) => engine dùng giờ server làm mốc REASSIGN.
                lib.ESD_HTKT_SLA_ENGINE.onWorkflowChanged(slaBeforeRecord,
                        lib.ESD_HTKT_SLA_ENGINE.snapshot(prepayment));
            } catch (slaError) {
                // The document is committed; report SLA failure separately.
                slaUpdated = false;
                print("[PP_APR][SLA_REASSIGN] ERROR | id=" + prepaymentId +
                    " | message=" + String(slaError && slaError.message ? slaError.message : slaError));
            }
        }

        if (!isCheckbox && !initialKttcSelection) {
            createPrepaymentReassignmentHistory(
                    prepaymentId,
                    field,
                    previousApprovalValue,
                    value,
                    details.reason,
                    currentUser
            );
        }

        return {
            success: true,
            data: {
                field: field,
                value: value,
                clearedField: clearedField,
                slaUpdated: slaUpdated
            }
        };
    } catch (error) {
        return { success: false, message: String(error.message || error) };
    } finally {
        if (prepayment) prepayment.doClose();
    }
}

function getPrepaymentRoleByRights(contactId) {
    var RIGHT_VIEW_INVOICE = "0040040001000001";
    var RIGHT_VIEW_PREPAYMENT = "0040040002000001";
    var RIGHT_CREATE_PREPAYMENT = "0040040002000002";
    var RIGHT_ACCOUNTING_INPUT = "0040040002000003";
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

    var canCreatePrepayment =
            rightMap[RIGHT_VIEW_INVOICE] &&
            rightMap[RIGHT_VIEW_PREPAYMENT] &&
            rightMap[RIGHT_CREATE_PREPAYMENT];

    if (!canCreatePrepayment) {
        return "";
    }

    return rightMap[RIGHT_ACCOUNTING_INPUT] ? "kttc" : "dmms";
}

/**
 * Phân miền dữ liệu cho combobox phê duyệt Tạm ứng.
 *
 * - Chi nhánh: target LV1 không bắt đầu 0999 -> chỉ đúng LV1 đó.
 * - Trụ sở chính: target LV1 bắt đầu 0999, phải map ACTIVE trong esdDMentity
 *   sang entity.code = 1010098 -> toàn bộ PS ACTIVE 0999* cùng entity là một miền.
 * - Mapping không hợp lệ -> fail-closed (không trả candidate).
 */
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

    // Chi nhánh: giữ nguyên exact LV1 như logic cũ.
    if (normalizedLv1.indexOf(HEAD_OFFICE_PS_PREFIX) !== 0) {
        result.valid = true;
        result.type = "BRANCH";
        result.allowedLv1List = [normalizedLv1];
        return result;
    }

    // Trụ sở chính: bắt buộc PS 0999* map ACTIVE duy nhất sang 1010098.
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

    // Target hiện tại phải nằm trong chính tập PS Trụ sở chính đã resolve.
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

function listContactsByRightsAndLv1(rightIds, targetLv1, subModuleId, resolvedDomain, keyword) {
    var normalizedRights = rightIds || [];
    var domain = resolvedDomain || resolveHTKTApprovalDataDomain(targetLv1);
    var allowedLv1List = domain.allowedLv1List || [];
    if (!domain.valid || !allowedLv1List.length || !normalizedRights.length) {
        return [];
    }

    if (!lib.ESD_PERMS_RIGHTS || !lib.ESD_PERMS_RIGHTS.listContactsByRightsAndFilter) {
        return [];
    }

    // Functional Right + vị trí tổ chức phải nằm trong miền của hồ sơ.
    var contacts = lib.ESD_PERMS_RIGHTS.listContactsByRightsAndFilter(
            normalizedRights, { "lv1.id": allowedLv1List }
    ) || [];

    if (contacts.toArray) contacts = contacts.toArray();
    if (!contacts.length) return [];

    var normalizedKeyword = String(keyword == null ? "" : keyword).trim().toLowerCase();
    if (normalizedKeyword) {
        var keywordMatches = [];
        for (var keywordOffset = 0; keywordOffset < contacts.length; keywordOffset += 100) {
            var keywordConditions = [];
            var keywordBatch = contacts.slice(keywordOffset, keywordOffset + 100);
            for (var keywordIndex = 0; keywordIndex < keywordBatch.length; keywordIndex++) {
                keywordConditions.push(
                        'contact.name="' + escapeSmQueryValue(keywordBatch[keywordIndex]) + '"'
                );
            }

            var keywordFile = null;
            try {
                keywordFile = new SCFile("contacts", SCFILE_READONLY);
                keywordFile.setFields(["contact.name", "full.name", "position", "status"]);
                var keywordRc = keywordFile.doSelect("(" + keywordConditions.join(" or ") + ")");
                while (keywordRc === RC_SUCCESS) {
                    var keywordContactId = String(keywordFile["contact.name"] || "").trim();
                    var keywordStatus = String(keywordFile["status"] || "").trim();
                    var keywordText = (
                            keywordContactId + " " +
                            String(keywordFile["full.name"] || "") + " " +
                            String(keywordFile["position"] || "")
                    ).toLowerCase();
                    if (
                            keywordContactId &&
                            (!keywordStatus || keywordStatus === "Dang hoat dong") &&
                            keywordText.indexOf(normalizedKeyword) >= 0
                    ) {
                        keywordMatches.push(keywordContactId);
                    }
                    keywordRc = keywordFile.getNext();
                }
            } finally {
                try { if (keywordFile) keywordFile.doClose(); } catch (keywordCloseError) {}
            }
        }
        contacts = uniqueStrings(keywordMatches);
        if (!contacts.length) return [];
    }

    var permissionIds = [];
    var contactByPermissionId = {};
    var acceptedContacts = {};

    var BATCH_SIZE = 100;
    for (var contactOffset = 0; contactOffset < contacts.length; contactOffset += BATCH_SIZE) {
        var contactConditions = [];
        var contactBatch = contacts.slice(contactOffset, contactOffset + BATCH_SIZE);
        for (var contactIndex = 0; contactIndex < contactBatch.length; contactIndex++) {
            contactConditions.push(
                    'contact.id="' + escapeSmQueryValue(contactBatch[contactIndex]) + '"'
            );
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
                        if (domain.type === "HEAD_OFFICE") acceptedContacts[contactId] = true;
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
    }

    permissionIds = uniqueStrings(permissionIds);

    // Chỉ đọc các unit thực sự được gán cho permission của candidate. Cách cũ
    // quét toàn bộ cây đơn vị của LV1 rồi tạo một câu OR rất dài ở mỗi lần mở list.
    if (permissionIds.length) {
        var allowedLv1Map = {};
        var permissionUnitRows = [];
        var unresolvedUnitIds = [];
        var seenUnitIds = {};
        var unitLv1Map = {};

        for (var allowedIndex = 0; allowedIndex < allowedLv1List.length; allowedIndex++) {
            var normalizedAllowedLv1 = normalizeHTKTApprovalUnitCode(allowedLv1List[allowedIndex]);
            if (normalizedAllowedLv1) allowedLv1Map[normalizedAllowedLv1] = true;
        }

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
                        "(" + permissionConditions.join(" or ") + ') and status="Dang hoat dong"'
                );

                while (unitRc === RC_SUCCESS) {
                    var mappedPermissionId = String(
                            unitFile["data.permission.id"] || unitFile.data_permission_id || ""
                    ).trim();
                    var mappedUnitId = normalizeHTKTApprovalUnitCode(unitFile["unit.id"]);
                    if (mappedPermissionId && mappedUnitId) {
                        permissionUnitRows.push({ permissionId: mappedPermissionId, unitId: mappedUnitId });
                        if (allowedLv1Map[mappedUnitId]) {
                            unitLv1Map[mappedUnitId] = mappedUnitId;
                        } else if (!seenUnitIds[mappedUnitId]) {
                            seenUnitIds[mappedUnitId] = true;
                            unresolvedUnitIds.push(mappedUnitId);
                        }
                    }
                    unitRc = unitFile.getNext();
                }
            } finally {
                try { if (unitFile) unitFile.doClose(); } catch (unitCloseError) {}
            }
        }

        for (var unitOffset = 0; unitOffset < unresolvedUnitIds.length; unitOffset += BATCH_SIZE) {
            var orgConditions = [];
            var unitBatch = unresolvedUnitIds.slice(unitOffset, unitOffset + BATCH_SIZE);
            for (var unitIndex = 0; unitIndex < unitBatch.length; unitIndex++) {
                orgConditions.push('unit.id="' + escapeSmQueryValue(unitBatch[unitIndex]) + '"');
            }

            var orgFile = null;
            try {
                orgFile = new SCFile("esdQTorgUnit", SCFILE_READONLY);
                orgFile.setFields(["unit.id", "lv1.id"]);
                var orgRc = orgFile.doSelect("(" + orgConditions.join(" or ") + ")");
                while (orgRc === RC_SUCCESS) {
                    var orgUnitId = normalizeHTKTApprovalUnitCode(orgFile["unit.id"]);
                    var orgLv1Id = normalizeHTKTApprovalUnitCode(orgFile["lv1.id"]);
                    if (orgUnitId && orgLv1Id) unitLv1Map[orgUnitId] = orgLv1Id;
                    orgRc = orgFile.getNext();
                }
            } finally {
                try { if (orgFile) orgFile.doClose(); } catch (orgCloseError) {}
            }
        }

        for (var rowIndex = 0; rowIndex < permissionUnitRows.length; rowIndex++) {
            var permissionUnit = permissionUnitRows[rowIndex];
            var mappedLv1 = unitLv1Map[permissionUnit.unitId];
            if (mappedLv1 && allowedLv1Map[mappedLv1]) {
                var mappedContactId = contactByPermissionId[permissionUnit.permissionId];
                if (mappedContactId) acceptedContacts[mappedContactId] = true;
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

function loadPrepaymentApprovalComboBoxes(prepaymentFile) {
    return loadPrepaymentApprovalComboBoxesInternal(prepaymentFile, "");
}

// Save chỉ xác thực đúng một người, không dựng dữ liệu combobox.
function validatePrepaymentApprovalAssignee(prepaymentFile, requestedField, selectedId, apiOptions) {
    apiOptions = apiOptions || {};
    apiOptions.validationOnly = true;
    apiOptions.selectedId = String(selectedId == null ? "" : selectedId).trim();
    return loadPrepaymentApprovalComboBoxesInternal(prepaymentFile, requestedField, apiOptions);
}

function loadPrepaymentDmmsCheckerComboBox(prepaymentFile) {
    return loadPrepaymentApprovalComboBoxesInternal(prepaymentFile, "user.checker.dmms");
}

function loadPrepaymentFinalCheckerComboBox(prepaymentFile) {
    return loadPrepaymentApprovalComboBoxesInternal(prepaymentFile, "user.checker.final");
}

function loadPrepaymentApprovalComboBoxesInternal(prepaymentFile, requestedField, apiOptions) {
    var HTKT_SUB_MODULE = "00401";
    var ALLOW_GLOBAL_SCOPE_IN_COMBO = false;

    var RIGHT_ACCOUNTING_INPUT = "0040040002000003";
    var RIGHT_CHECK_1 = "0040040002000004";
    var RIGHT_APPROVE_1 = "0040040002000005";
    var RIGHT_APPROVE_2 = "0040040002000006";
    var RIGHT_CHECK_2 = "0040040002000007";
    var RIGHT_APPROVE_3 = "0040040002000008"; // Phê duyệt đề nghị tạm ứng cấp 3

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
    var resolvedTargetDomain = null;

    if (requestedField) {
        var requestedConfigs = [];
        for (var requestedIndex = 0; requestedIndex < configs.length; requestedIndex++) {
            if (configs[requestedIndex].saveField === requestedField) {
                requestedConfigs.push(configs[requestedIndex]);
            }
        }
        configs = requestedConfigs;
    }

    var file = prepaymentFile || vars["$L.file"];
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

    var targetInfo = getPrepaymentTargetLv1(file);

    output.targetLv1 = targetInfo.lv1;
    output.targetLv1Source = targetInfo.source;

    if (!output.targetLv1) {
        clearAllComboBoxes(configs);
        output.success = false;
        output.message = "Không xác định được lv1 của hồ sơ tạm ứng.";
        return output;
    }

    resolvedTargetDomain = resolveHTKTApprovalDataDomain(output.targetLv1);
    if (!resolvedTargetDomain.valid) {
        clearAllComboBoxes(configs);
        output.success = false;
        output.message = "Không xác định được miền dữ liệu của hồ sơ tạm ứng.";
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

    var currentUserScope = getUserScopeContext(
            currentUser,
            output.targetLv1,
            resolvedTargetDomain
    );

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

    // Nhánh save dừng ở validator riêng, không tải candidate/label/phân trang.
    if (apiOptions && apiOptions.validationOnly) {
        if (configs.length !== 1) {
            output.success = false;
            output.valid = false;
            output.message = "Không tìm thấy cấu hình trường phê duyệt.";
            return output;
        }
        return validateSelectedAssignee(configs[0], output.targetLv1, apiOptions.selectedId);
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

    function validateSelectedAssignee(config, targetLv1, selectedId) {
        var validation = {
            success: true,
            valid: false,
            message: "",
            currentUserScope: currentUserScope,
            targetLv1: output.targetLv1,
            targetLv1Source: output.targetLv1Source
        };
        var normalizedSelectedId = normalizeValue(selectedId);
        if (!normalizedSelectedId) {
            validation.message = "Thiếu cán bộ cần kiểm tra.";
            return validation;
        }

        try {
            var domain = resolvedTargetDomain || resolveHTKTApprovalDataDomain(targetLv1);
            var allowedLv1List = domain.allowedLv1List || [];
            if (!domain.valid || !allowedLv1List.length) {
                validation.message = "Không xác định được miền dữ liệu hợp lệ của hồ sơ.";
                return validation;
            }
            if (!lib.ESD_PERMS_RIGHTS || !lib.ESD_PERMS_RIGHTS.listContactsByRightsAndFilter) {
                validation.message = "Không tải được thư viện phân quyền.";
                return validation;
            }

            var matchedContacts = lib.ESD_PERMS_RIGHTS.listContactsByRightsAndFilter(
                    config.seedRights,
                    {
                        "lv1.id": allowedLv1List,
                        "contact.name": [normalizedSelectedId]
                    }
            ) || [];
            if (matchedContacts.toArray) matchedContacts = matchedContacts.toArray();
            if (normalizeArray(matchedContacts).indexOf(normalizedSelectedId) < 0) {
                validation.message = "Cán bộ không có đúng quyền hoặc không thuộc miền của hồ sơ.";
                return validation;
            }

            var permissionIds = [];
            var permissionFile = null;
            try {
                permissionFile = new SCFile("esdQTdataPermissions", SCFILE_READONLY);
                permissionFile.setFields(["id", "permission.scope"]);
                var permissionRc = permissionFile.doSelect(
                        'contact.id="' + escapeQueryValue(normalizedSelectedId) + '"' +
                        ' and sub.module="' + escapeQueryValue(HTKT_SUB_MODULE) + '"' +
                        ' and permission.scope~="QT_PQDL_01"'
                );
                while (permissionRc === RC_SUCCESS) {
                    var permissionId = normalizeValue(permissionFile["id"]);
                    var scope = normalizeValue(permissionFile["permission.scope"]);
                    if (scope === "QT_PQDL_06" && domain.type === "HEAD_OFFICE") {
                        validation.valid = true;
                        validation.message = "Cán bộ hợp lệ.";
                        return validation;
                    }
                    if (permissionId && scope !== "QT_PQDL_01" && scope !== "QT_PQDL_06") {
                        permissionIds.push(permissionId);
                    }
                    permissionRc = permissionFile.getNext();
                }
            } finally {
                try { if (permissionFile) permissionFile.doClose(); } catch (permissionCloseError) {}
            }

            permissionIds = normalizeArray(permissionIds);
            if (!permissionIds.length) {
                validation.message = "Cán bộ không có phân quyền dữ liệu phù hợp.";
                return validation;
            }

            var allowedLv1Map = {};
            for (var allowedIndex = 0; allowedIndex < allowedLv1List.length; allowedIndex++) {
                var allowedLv1 = normalizeUnitCode(allowedLv1List[allowedIndex]);
                if (allowedLv1) allowedLv1Map[allowedLv1] = true;
            }

            var BATCH_SIZE = 100;
            for (var offset = 0; offset < permissionIds.length; offset += BATCH_SIZE) {
                var permissionConditions = [];
                var permissionBatch = permissionIds.slice(offset, offset + BATCH_SIZE);
                for (var permissionIndex = 0; permissionIndex < permissionBatch.length; permissionIndex++) {
                    permissionConditions.push(
                            'data.permission.id="' + escapeQueryValue(permissionBatch[permissionIndex]) + '"'
                    );
                }

                var unitFile = null;
                try {
                    unitFile = new SCFile("esdjoinDatapermissionUnits", SCFILE_READONLY);
                    unitFile.setFields(["unit.id", "status"]);
                    var unitRc = unitFile.doSelect(
                            "(" + permissionConditions.join(" or ") + ') and status="Dang hoat dong"'
                    );
                    while (unitRc === RC_SUCCESS) {
                        var unitId = normalizeUnitCode(unitFile["unit.id"]);
                        var unitLv1 = allowedLv1Map[unitId] ? unitId : resolveLv1FromUnit(unitId);
                        if (unitLv1 && allowedLv1Map[unitLv1]) {
                            validation.valid = true;
                            validation.message = "Cán bộ hợp lệ.";
                            return validation;
                        }
                        unitRc = unitFile.getNext();
                    }
                } finally {
                    try { if (unitFile) unitFile.doClose(); } catch (unitCloseError) {}
                }
            }

            validation.message = "Cán bộ không có unit phân quyền trong miền của hồ sơ.";
            return validation;
        } catch (e) {
            validation.success = false;
            validation.message = String(e.message || e);
            return validation;
        }
    }

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
        var ids = normalizeArray(listContactsByRightsAndLv1(
                config.seedRights,
                targetLv1,
                HTKT_SUB_MODULE,
                resolvedTargetDomain,
                apiOptions ? apiOptions.keyword : ""
        ));
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

    function getUserScopeContext(contactId, targetLv1, resolvedDomain) {
        var normalizedContactId = normalizeValue(contactId);
        var normalizedTargetLv1 = normalizeUnitCode(targetLv1);
        var cacheKey = normalizedContactId + "|" + normalizedTargetLv1;

        if (!userScopeCache.hasOwnProperty(cacheKey)) {
            userScopeCache[cacheKey] = buildUserScopeContext(
                    normalizedContactId,
                    normalizedTargetLv1,
                    resolvedDomain
            );
        }

        return userScopeCache[cacheKey];
    }

    function buildUserScopeContext(contactId, targetLv1, resolvedDomain) {
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

        var targetDomain = resolvedDomain || resolveHTKTApprovalDataDomain(targetLv1);
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
            /*
             * Nghiệp vụ Trụ sở chính:
             * - target phải thuộc miền HEAD_OFFICE (0999* + ACTIVE entity 1010098),
             * - current user cũng phải thuộc chính miền Trụ sở chính,
             * - khi đó được thao tác trên toàn bộ PS 0999* cùng entity.
             *
             * Với target Chi nhánh, giữ nguyên cơ chế cũ ALLOW_GLOBAL_SCOPE_IN_COMBO.
             */
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

            // Chi nhánh: exact LV1. Trụ sở chính: bất kỳ LV1 nào trong cùng miền 0999*/1010098.
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

    function getPrepaymentTargetLv1(file) {
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

    function safeStringify(obj) {
        try {
            return JSON.stringify(obj);
        } catch (e) {
            return String(obj);
        }
    }
}
