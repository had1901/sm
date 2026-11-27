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

function getPaymentApprovalReadFields() {
    return [
        "id",
        "transaction.type",
        "initial.role",
        "current.phase",
        "status",
        "created.by",
        "unit.lv1",
        "require.check.level1",
        "require.check.level2",
        "user.checker.kttc",
        "user.checker.dmms",
        "user.approver.dmms",
        "user.approver.kttc",
        "user.checker.final",
        "user.approver.final"
    ];
}

function readSmJoinedField(file, aliasName, fallbackField, index) {
    if (!file) return "";
    var value;
    try { value = file[aliasName]; } catch (eAlias) {}
    if ((typeof value === "undefined" || value === null || value === "") && fallbackField) {
        try {
            var fallbackValue = file[fallbackField];
            if (typeof fallbackValue !== "undefined" && fallbackValue !== null && fallbackValue !== "") {
                value = fallbackValue;
            }
        } catch (eFallback) {}
    }
    if ((typeof value === "undefined" || value === null || value === "") && typeof index === "number") {
        try {
            var indexedValue = file[index];
            if (typeof indexedValue !== "undefined" && indexedValue !== null && indexedValue !== "") {
                value = indexedValue;
            }
        } catch (eIndex) {}
    }
    return String(value == null ? "" : value).trim();
}

function buildSmEqualsOrClause(fieldName, values) {
    var parts = [];
    for (var i = 0; values && i < values.length; i++) {
        var val = String(values[i] == null ? "" : values[i]).trim();
        if (val) {
            parts.push(fieldName + '="' + escapeSmQueryValue(val) + '"');
        }
    }
    return parts.length ? "(" + parts.join(" or ") + ")" : "";
}

function resolvePaymentApprovalContactRecord(currentUser, resolvedIdentity) {
    if (resolvedIdentity && resolvedIdentity.contactResolved === true) {
        return {
            found: resolvedIdentity.contactFound === true,
            unique: resolvedIdentity.contactUnique === true,
            contactName: String(resolvedIdentity.contactName || "").trim(),
            lv1: String(resolvedIdentity.lv1 || "").trim()
        };
    }

    var actor = String(currentUser == null ? "" : currentUser).trim();
    var record = {
        found: false,
        unique: false,
        contactName: "",
        lv1: ""
    };

    if (!actor) {
        if (resolvedIdentity) {
            resolvedIdentity.contactResolved = true;
            resolvedIdentity.contactFound = false;
            resolvedIdentity.contactUnique = false;
        }
        return record;
    }

    var contact = null;
    try {
        contact = new SCFile("contacts", SCFILE_READONLY);
        contact.setFields(["contact.name", "lv1.id"]);

        var exactCandidates = uniqueStrings([actor, actor.toUpperCase(), actor.toLowerCase()]);
        var exactClause = buildSmEqualsOrClause("contact.name", exactCandidates);
        var rc = exactClause ? contact.doSelect(exactClause) : RC_NO_MORE;
        if (rc !== RC_SUCCESS) {
            rc = contact.doSelect('tolower(contact.name)="' + escapeSmQueryValue(actor.toLowerCase()) + '"');
        }

        if (rc === RC_SUCCESS) {
            record.found = true;
            var canonicalName = String(contact["contact.name"] == null ? "" : contact["contact.name"]).trim();
            var contactLv1 = normalizeHTKTApprovalUnitCode(contact["lv1.id"]);
            var hasDuplicate = false;
            try {
                hasDuplicate = contact.getNext() === RC_SUCCESS;
            } catch (eGetNext) {
                hasDuplicate = true;
            }
            if (canonicalName && !hasDuplicate) {
                record.unique = true;
                record.contactName = canonicalName;
                record.lv1 = contactLv1;
            }
        }
    } finally {
        try {
            if (contact) contact.doClose();
        } catch (eCloseContact) {}
    }

    if (resolvedIdentity) {
        resolvedIdentity.contactResolved = true;
        resolvedIdentity.contactFound = record.found;
        resolvedIdentity.contactUnique = record.unique;
        if (record.unique) {
            resolvedIdentity.contactName = record.contactName;
            resolvedIdentity.lv1 = record.lv1;
        }
    }

    return record;
}

function queryPaymentApprovalRightsByContacts(contactIds, rightIds) {
    var rightMap = {};
    var safeContacts = uniqueStrings(contactIds);
    var safeRights = uniqueStrings(rightIds);
    if (!safeContacts.length || !safeRights.length) {
        return rightMap;
    }

    var contactClause = buildSmEqualsOrClause("jcpg.contact.id", safeContacts);
    var rightClause = buildSmEqualsOrClause("jrp.rights.id", safeRights);
    if (!contactClause || !rightClause) {
        return rightMap;
    }

    var sql =
            "SELECT jrp.rights.id AS rightId " +
            "FROM esdjoinRightsPermission jrp " +
            "JOIN esdQTpermissionGroup pg ON (jrp.permission.group.id = pg.id) " +
            "JOIN esdjoinContactsPermissionGroup jcpg ON (jcpg.permission.group.id = pg.id) " +
            'WHERE pg.status = "Dang hoat dong" ' +
            "AND (pg.start.date <= tod() OR pg.start.date = NULL) " +
            "AND (pg.end.date >= tod() OR pg.end.date = NULL) " +
            "AND (jcpg.start.date <= tod() OR jcpg.start.date = NULL) " +
            "AND (jcpg.end.date >= tod() OR jcpg.end.date = NULL) " +
            "AND " + contactClause + " " +
            "AND " + rightClause;

    var rightFile = null;
    try {
        rightFile = new SCFile("esdjoinRightsPermission", SCFILE_READONLY);
        var rc = rightFile.doSelect(sql);
        while (rc === RC_SUCCESS) {
            var rightId = readSmJoinedField(rightFile, "rightId", "rights.id", 0);
            if (rightId) {
                rightMap[rightId] = true;
            }
            rc = rightFile.getNext();
        }
    } catch (eRightQuery) {
        return {};
    } finally {
        try {
            if (rightFile) rightFile.doClose();
        } catch (eCloseRightQuery) {}
    }

    return rightMap;
}

// Dự chi và Thanh toán dùng chung entity esdHTKTpayment. Chỉ paymentId
// quyết định bộ functional rights dùng cho tái phân công.
function isDuChiPaymentApprovalRecord(recordOrId) {
    var id = recordOrId && typeof recordOrId === "object" ?
            String(recordOrId.id || "").trim() :
            String(recordOrId || "").trim();
    return /^DC\.[A-Za-z0-9._-]+$/.test(id);
}

function getPaymentApprovalRightPrefix(recordOrId) {
    return isDuChiPaymentApprovalRecord(recordOrId) ? "0040040004" : "0040040003";
}

// Mã nhóm TT/DC có 10 ký tự; mã quyền đầy đủ có 16 ký tự.
// Bổ sung hai số 0 trước đuôi 0003-0008 cho cả hai nhóm.
function getPaymentApprovalRightBase(rightPrefix) {
    var prefix = String(rightPrefix || "0040040003").trim();
    return prefix === "0040040003" || prefix === "0040040004" ? prefix + "00" : prefix;
}

// Dùng cùng cách tải lại bản ghi đang mở như Thanh toán.
// Giữ entry point riêng cho các Rule Set Dự chi đã cấu hình trên SM.
function syncDuChiApprovalFromDatabase(expense) {
    var expenseId = String(expense && expense.id || "").trim();
    if (!isDuChiPaymentApprovalRecord(expenseId)) return expense;
    return syncPaymentApprovalFromDatabase(expense);
}

function isDuChiApprovalRecordConsistent(record) {
    return isDuChiPaymentApprovalRecord(record) &&
        String(record["transaction.type"] || "").trim().toLowerCase() === "dự chi";
}

function isDuChiApprovalCreation(record) {
    var phase = readPaymentApprovalValue(record, "current.phase").toLowerCase();
    var role = readPaymentApprovalValue(record, "initial.role").toLowerCase();
    var status = readPaymentApprovalValue(record, "status").toLowerCase();
    return !phase || phase === "start" ||
        status === "dmms_created" || status === "kttc_created" ||
        status === "tạo mới" || status === "tao moi" ||
        (role === "dmms" && phase === "initial_dmms") ||
        (role === "kttc" && phase === "initial_kttc");
}

function isDuChiApprovalFieldCompleted(phase, field) {
    var order = {
        start: 0, initial_dmms: 10, initial_kttc: 20, check_dmms: 30,
        approval_dmms: 40, approval_kttc: 50, check_final: 60,
        approval_final: 70, end: 80
    };
    var fieldPhase = {
        "user.checker.kttc": 20, "user.checker.dmms": 30,
        "user.approver.dmms": 40, "user.approver.kttc": 50,
        "user.checker.final": 60, "user.approver.final": 70
    };
    var current = order[String(phase || "").trim().toLowerCase()];
    return typeof current === "number" && current > fieldPhase[field];
}

function getDuChiApprovalAccess(payment, currentUser, resolvedIdentity, accessOptions) {
    var phase = readPaymentApprovalValue(payment, "current.phase").toLowerCase();
    var role = readPaymentApprovalValue(payment, "initial.role").toLowerCase();
    var status = readPaymentApprovalValue(payment, "status").toLowerCase();
    var actor = String(currentUser || "").trim().toLowerCase();
    var creator = readPaymentApprovalValue(payment, "created.by").toLowerCase();
    var checkerKttc = readPaymentApprovalValue(payment, "user.checker.kttc").toLowerCase();
    var isDmmsCreator = !!actor && actor === creator && role === "dmms";
    var legacyClosed = phase === "end" || status === "cancelled";
    var canEditLevel1 = !legacyClosed && phase === "initial_dmms" && isDmmsCreator;
    var canEditLevel2 = !legacyClosed && phase === "initial_kttc" && !!actor &&
        ((actor === creator && role === "kttc") || actor === checkerKttc);
    var closed = legacyClosed || status === "approved" || status === "accounted";
    var creationPhase = isDuChiApprovalCreation(payment);
    var targetField = accessOptions && accessOptions.targetField ? String(accessOptions.targetField).trim() : "";
    var forFieldOnly = !!(accessOptions && accessOptions.forFieldOnly === true && targetField);
    var rightBase = getPaymentApprovalRightBase("0040040004");
    var requiredLeaderRights = null;
    var needLeaderCheck = true;

    if (forFieldOnly) {
        if (closed || creationPhase) {
            needLeaderCheck = false;
        } else if (targetField === "require.check.level1" || targetField === "require.check.level2") {
            needLeaderCheck = false;
        } else if (targetField === "user.checker.dmms" || targetField === "user.approver.dmms") {
            if (canEditLevel1 || role !== "dmms") {
                needLeaderCheck = false;
            } else {
                requiredLeaderRights = [rightBase + "0005"];
            }
        } else if (targetField === "user.checker.kttc") {
            if (canEditLevel1 || role !== "dmms") {
                needLeaderCheck = false;
            } else {
                requiredLeaderRights = [rightBase + "0006"];
            }
        } else if (targetField === "user.approver.kttc" || targetField === "user.checker.final" || targetField === "user.approver.final") {
            if (canEditLevel2) {
                needLeaderCheck = false;
            } else {
                requiredLeaderRights = [rightBase + "0006"];
            }
        }
    }

    var leader = needLeaderCheck ?
        getPaymentReassignmentRoleAccess(currentUser, resolvedIdentity, "0040040004", requiredLeaderRights) :
        { isApprovalDmms: false, isApprovalKttc: false };
    // Không fallback theo người được assign: quyền TT hoặc actor trên hồ sơ
    // không tự cấp quyền tái phân công DC.
    var isApprovalDmms = leader.isApprovalDmms === true;
    var isApprovalKttc = leader.isApprovalKttc === true;
    var canDmmsReassign = !closed && !creationPhase && isApprovalDmms;
    var canKttcReassign = !closed && !creationPhase && isApprovalKttc;
    var fieldAccess = {
        "require.check.level1": canEditLevel1,
        "require.check.level2": canEditLevel2,
        "user.checker.kttc": canEditLevel1 || (canKttcReassign && role === "dmms"),
        "user.checker.dmms": canEditLevel1 || (canDmmsReassign && role === "dmms"),
        "user.approver.dmms": canEditLevel1 || (canDmmsReassign && role === "dmms"),
        "user.approver.kttc": canEditLevel2 || canKttcReassign,
        "user.checker.final": canEditLevel2 || canKttcReassign,
        "user.approver.final": canEditLevel2 || canKttcReassign
    };
    return {
        isDmmsCreator: isDmmsCreator,
        showLevel1: role === "dmms",
        showLevel2: role === "kttc" || isApprovalKttc ||
            (role === "dmms" && !isDmmsCreator &&
                ["initial_kttc", "check_dmms", "approval_dmms", "approval_kttc",
                    "check_final", "approval_final", "end"].indexOf(phase) >= 0),
        canEditLevel1: canEditLevel1,
        canEditLevel2: canEditLevel2,
        isApprovalDmms: isApprovalDmms,
        isApprovalKttc: isApprovalKttc,
        leaderChecked: needLeaderCheck && !requiredLeaderRights,
        leaderRights: {
            isApprovalDmms: isApprovalDmms,
            isApprovalKttc: isApprovalKttc
        },
        canViewEarly: isApprovalDmms || isApprovalKttc,
        fieldAccess: fieldAccess
    };
}

// Gọi ở đầu Rule Set của nút Lưu/Workflow để form SM chọn lại chính record mới nhất.
function syncPaymentApprovalFromDatabase(payment) {
    var paymentId = String(payment ? payment.id || "" : "").trim();
    if (!paymentId) return payment;

    if (typeof payment.doSelect === "function") {
        var description = payment.description;
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
 * Lấy Functional Rights của user dùng riêng cho logic tái phân công (Thanh toán / Dự chi).
 */
function getPaymentReassignmentRoleAccess(currentUser, resolvedIdentity, rightPrefix, requiredRightIds) {
    var prefix = getPaymentApprovalRightBase(rightPrefix);
    var RIGHT_APPROVE_1 = prefix + "0005";
    var RIGHT_APPROVE_2 = prefix + "0006";

    var rightMap = {};
    var contactName = String(currentUser == null ? "" : currentUser).trim();

    if (!contactName) {
        return {
            isApprovalDmms: false,
            isApprovalKttc: false
        };
    }

    var targetRights = requiredRightIds && requiredRightIds.length ?
            uniqueStrings(requiredRightIds) :
            [RIGHT_APPROVE_1, RIGHT_APPROVE_2];

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

    var hasSessionRights = false;
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
            hasSessionRights = true;
        }
    } catch (eSessionRights) {}

    var missingRights = [];
    if (!hasSessionRights) {
        for (var rightIndex = 0; rightIndex < targetRights.length; rightIndex++) {
            if (rightMap[targetRights[rightIndex]] !== true) {
                missingRights.push(targetRights[rightIndex]);
            }
        }
    }

    if (missingRights.length) {
        var identitiesToQuery = [contactName];
        try {
            var contactRecord = resolvePaymentApprovalContactRecord(contactName, resolvedIdentity);
            if (contactRecord.unique && contactRecord.contactName && contactRecord.contactName !== contactName) {
                identitiesToQuery.push(contactRecord.contactName);
            }
        } catch (eResolveContact) {}

        var queriedRightMap = queryPaymentApprovalRightsByContacts(identitiesToQuery, missingRights);
        for (var queriedKey in queriedRightMap) {
            if (queriedRightMap.hasOwnProperty(queriedKey) && queriedRightMap[queriedKey] === true) {
                rightMap[queriedKey] = true;
            }
        }
    }

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
function getPaymentApprovalAccess(payment, currentUser, resolvedIdentity, rightPrefix, accessOptions) {
    if (isDuChiPaymentApprovalRecord(payment)) {
        return getDuChiApprovalAccess(payment, currentUser, resolvedIdentity, accessOptions);
    }
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

    // Không tái phân công ở bước tạo mới.
    var isPaymentCreationPhase =
            !phase ||
            phase === "start" ||
            (role === "dmms" && phase === "initial_dmms") ||
            (role === "kttc" && phase === "initial_kttc");

    var effectiveRightPrefix = rightPrefix || getPaymentApprovalRightPrefix(payment);
    var effectiveRightBase = getPaymentApprovalRightBase(effectiveRightPrefix);
    var targetField = accessOptions && accessOptions.targetField ? String(accessOptions.targetField).trim() : "";
    var forFieldOnly = !!(accessOptions && accessOptions.forFieldOnly === true && targetField);
    var requiredLeaderRights = null;
    var needLeaderCheck = true;

    if (forFieldOnly) {
        if (reassignmentClosed || isPaymentCreationPhase) {
            needLeaderCheck = false;
        } else if (targetField === "require.check.level1" || targetField === "require.check.level2") {
            needLeaderCheck = false;
        } else if (targetField === "user.checker.dmms" || targetField === "user.approver.dmms") {
            if (canEditLevel1 || role !== "dmms" || (!!actor && actor === approverDmms)) {
                needLeaderCheck = false;
            } else {
                requiredLeaderRights = [effectiveRightBase + "0005"];
            }
        } else if (targetField === "user.checker.kttc") {
            if (canEditLevel1 || role !== "dmms" || (!!actor && actor === approverKttc)) {
                needLeaderCheck = false;
            } else {
                requiredLeaderRights = [effectiveRightBase + "0006"];
            }
        } else if (targetField === "user.approver.kttc" || targetField === "user.checker.final" || targetField === "user.approver.final") {
            if (canEditLevel2 || (!!actor && actor === approverKttc)) {
                needLeaderCheck = false;
            } else {
                requiredLeaderRights = [effectiveRightBase + "0006"];
            }
        }
    }

    var leaderAccess = needLeaderCheck ?
            getPaymentReassignmentRoleAccess(
                    currentUser,
                    resolvedIdentity,
                    effectiveRightPrefix,
                    requiredLeaderRights
            ) :
            { isApprovalDmms: false, isApprovalKttc: false };

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
    /*
     * Tái phân công: ai có Functional Right Phê duyệt ĐMMS (0005) / Phê duyệt
     * KTTC (0006) đều được tái phân công, kể cả khi không nằm trong luồng phiếu
     * (được chọn lại chính mình). Người đang được gán trên phiếu cũng được.
     */
    var isReassignerDmms = leaderAccess.isApprovalDmms === true ||
            (!!actor && actor === approverDmms);
    var isReassignerKttc = leaderAccess.isApprovalKttc === true ||
            (!!actor && actor === approverKttc);

    var canDmmsLeaderReassign =
            !reassignmentClosed &&
            !isPaymentCreationPhase &&
            role === "dmms" &&
            isReassignerDmms;

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
            !isPaymentCreationPhase &&
            isReassignerKttc;

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
        leaderChecked: needLeaderCheck && !requiredLeaderRights,
        leaderRights: {
            isApprovalDmms: leaderAccess.isApprovalDmms === true,
            isApprovalKttc: leaderAccess.isApprovalKttc === true
        },

        // Cho phép lãnh đạo nhìn dữ liệu sớm.
        canViewEarly:
                (role === "dmms" && (isApprovalDmms || isApprovalKttc)) ||
                (role === "kttc" && isApprovalKttc),

        // Quyền edit theo từng field.
        fieldAccess: fieldAccess
    };
}

function resolvePaymentApprovalContactId(currentUser, resolvedIdentity) {
    var actor = String(currentUser || "").trim();
    if (!actor) {
        throw new Error("Không tìm thấy contact của user đăng nhập để kiểm tra phân quyền dữ liệu.");
    }
    var record = resolvePaymentApprovalContactRecord(actor, resolvedIdentity);
    if (!record.found) {
        throw new Error("Không tìm thấy contact của user đăng nhập để kiểm tra phân quyền dữ liệu.");
    }
    if (!record.unique || !record.contactName) {
        throw new Error("Không xác định được duy nhất contact của user đăng nhập.");
    }
    return record.contactName;
}

function getPaymentApprovalInitData(payment, currentUser, rightPrefix, isFromHK, precomputedAccess, resolvedIdentity) {
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
    var approvalAccess = precomputedAccess || getPaymentApprovalAccess(
            payment, currentUser, resolvedIdentity || null, rightPrefix || getPaymentApprovalRightPrefix(payment)
    );
    if (isFromHK === true) {
        approvalAccess.canEditLevel1 = false;
        approvalAccess.canEditLevel2 = false;
        for (var accessField in approvalAccess.fieldAccess) {
            if (approvalAccess.fieldAccess.hasOwnProperty(accessField)) {
                approvalAccess.fieldAccess[accessField] = false;
            }
        }
    }
    return {
        paymentId: String(payment.id || ""),
        currentUser: currentUser,
        initialRole: String(payment["initial.role"] || ""),
        currentPhase: String(payment["current.phase"] || payment.current_phase || ""),
        createdBy: String(payment["created.by"] || ""),
        status: String(payment.status || ""),
        isFromHK: isFromHK === true,
        approvalValues: values,
        approvalSelectedOptions: selectedOptions,
        approvalAccess: approvalAccess
    };
}

function canReadDuChiPostAuditApproval(payment, currentUser) {
    try {
        var expenseView = lib.ESD_HTKT_EXPENSE_VIEW;
        var rights = lib.ESD_PERMS_RIGHTS.permsRight(currentUser) || [];
        if (rights.toArray) rights = rights.toArray();
        if (rights.indexOf("0040040005000001") < 0) return false;
        var contact = expenseView.htktExpenseView_readContact(currentUser);
        var permission = expenseView.htktExpenseView_getDataPermission(currentUser);
        var scope = expenseView.htktExpenseView_buildPostAuditFilter(contact, permission);
        if (scope.dataScopeCode === "QT_PQDL_06") return true;
        if (scope.dataScopeCode !== "QT_PQDL_04" ||
                !scope.defaultFilter || scope.defaultFilter === "(1=0)") return false;
        var scopedPayment = null;
        try {
            scopedPayment = new SCFile("esdHTKTpayment", SCFILE_READONLY);
            return scopedPayment.doSelect(
                    'id="' + escapeSmQueryValue(payment.id) + '" and (' +
                    scope.defaultFilter + ')'
            ) === RC_SUCCESS;
        } finally {
            if (scopedPayment) scopedPayment.doClose();
        }
    } catch (ePostAuditScope) {
        return false;
    }
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
        payment.setFields(getPaymentApprovalReadFields());

        if (
                payment.doSelect(
                        'id="' + escapeSmQueryValue(paymentId) + '"'
                ) !== RC_SUCCESS
        ) {
            throw new Error("Không tìm thấy phiếu thanh toán.");
        }
        if (isDuChiPaymentApprovalRecord(paymentId) && !isDuChiApprovalRecordConsistent(payment)) {
            throw new Error("Mã phiếu và loại giao dịch Dự chi không khớp.");
        }
        var isDuChiPostAudit = isDuChiPaymentApprovalRecord(paymentId) &&
            details.isFromHK === true;
        if (isDuChiPostAudit && !canReadDuChiPostAuditApproval(payment, currentUser)) {
            return { success: false, code: "PAYMENT_APPROVAL_SCOPE_DENIED",
                message: "Bạn không có quyền dữ liệu đối với hồ sơ Dự chi." };
        }
        var resolvedIdentity = {};
        var precomputedAccess = null;
        if (isDuChiPaymentApprovalRecord(paymentId) && !isDuChiPostAudit) {
            var actor = currentUser.toLowerCase();
            var relatedFields = ["created.by"].concat(getPaymentApprovalFields());
            var related = false;
            for (var relatedIndex = 0; relatedIndex < relatedFields.length; relatedIndex++) {
                if (readPaymentApprovalValue(payment, relatedFields[relatedIndex]).toLowerCase() === actor) {
                    related = true;
                    break;
                }
            }
            if (!related) {
                var dcAccess = getDuChiApprovalAccess(payment, currentUser, resolvedIdentity);
                precomputedAccess = dcAccess;
                if (!dcAccess.canViewEarly) {
                    return { success: false, code: "PAYMENT_APPROVAL_FORBIDDEN",
                        message: "Bạn không có quyền xem thông tin phê duyệt Dự chi." };
                }
                var scopeField = dcAccess.isApprovalKttc ?
                        "user.approver.kttc" : "user.approver.dmms";
                var permissionContactId = resolvePaymentApprovalContactId(currentUser, resolvedIdentity);
                var scopeResult = loadPaymentApprovalComboBoxesInternal(payment, scopeField, {
                    currentUser: permissionContactId,
                    currentUserLv1: resolvedIdentity.lv1 || "",
                    page: 1, pageSize: 1, keyword: "",
                    rightPrefix: "0040040004", scopeOnly: true
                });
                if (!scopeResult.success || !scopeResult.currentUserScope ||
                        !scopeResult.currentUserScope.canAccessTargetLv1) {
                    return { success: false, code: "PAYMENT_APPROVAL_SCOPE_DENIED",
                        message: "Bạn không có quyền dữ liệu đối với hồ sơ Dự chi." };
                }
            }
        }

        return {
            success: true,
            data: getPaymentApprovalInitData(
                    payment,
                    currentUser,
                    "",
                    details.isFromHK === true,
                    precomputedAccess,
                    resolvedIdentity
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
    var access = getPaymentApprovalAccess(
            payment,
            currentUser,
            null,
            getPaymentApprovalRightPrefix(payment)
    );

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

function createPaymentReassignmentHistory(paymentId, field, oldValue, newValue, reason, currentUser, precomputedLeadership, paymentRecord) {
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

        var leadership = precomputedLeadership || getPaymentReassignmentRoleAccess(
                safeCurrentUser,
                null,
                getPaymentApprovalRightPrefix(safePaymentId)
        );

        if (
                !leadership ||
                (
                        leadership.isApprovalDmms !== true &&
                        leadership.isApprovalKttc !== true
                )
        ) {
            return;
        }

        var initialRole = "";
        var transactionType = "";
        if (paymentRecord) {
            initialRole = readPaymentApprovalValue(paymentRecord, "initial.role").toLowerCase();
            transactionType = readPaymentApprovalValue(paymentRecord, "transaction.type").toLowerCase();
        } else {
            payment = new SCFile("esdHTKTpayment", SCFILE_READONLY);
            payment.setFields(["id", "initial.role", "transaction.type"]);

            if (
                    payment.doSelect(
                            'id="' + escapeSmQueryValue(safePaymentId) + '"'
                    ) !== RC_SUCCESS
            ) {
                return;
            }

            initialRole = String(
                    payment["initial.role"] == null ?
                            "" :
                            payment["initial.role"]
            ).trim().toLowerCase();
            transactionType = String(payment["transaction.type"] || "").trim().toLowerCase();
        }

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

        var isExpense = transactionType
                ? transactionType === "dự chi"
                : safePaymentId.toUpperCase().indexOf("DC") === 0;

        var activityDescription =
                'Tái phân công ' + (isExpense ? 'Đề nghị Dự chi' : 'Đề nghị Thanh toán') + ': Mã đề nghị: "' + safePaymentId + '"' +
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

        // Gửi email thông báo tái phân công cho cán bộ mới
        try {
            if (lib.ESD_HTKT_ACTION_WF_SEND_EMAIL && lib.ESD_HTKT_ACTION_WF_SEND_EMAIL.sendEmailReassignOfficer) {
                var opUser = safeCurrentUser || (vars.$lo_operator ? (vars.$lo_operator["contact.name"] || vars.$lo_operator["name"]) : "") || vars["$lo.contact.name"] || "";
                lib.ESD_HTKT_ACTION_WF_SEND_EMAIL.sendEmailReassignOfficer({
                    id: safePaymentId,
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

function snapshotPaymentForSla(payment) {
    var names = [
        "id", "transaction.type", "initial.role", "current.phase", "status",
        "created.by", "current.executor", "require.check.level1", "require.check.level2",
        "user.checker.kttc", "user.checker.dmms", "user.approver.dmms",
        "user.approver.kttc", "user.checker.final", "user.approver.final",
        "sysmodcount", "sysmodtime", "sysmoduser"
    ];
    var result = {}, i;
    for (i = 0; i < names.length; i++) result[names[i]] = payment[names[i]];
    return result;
}

function notifySlaPaymentReassigned(beforeRecord, payment) {
    try {
        var afterRecord = snapshotPaymentForSla(payment);
        // sysmodtime trên SCFile ngay sau doUpdate không đáng tin (có thể lệch múi giờ)
        // => bỏ để engine dùng giờ server làm mốc REASSIGN.
        afterRecord["sysmodtime"] = null;
        var result = lib.ESD_HTKT_SLA_ENGINE.onWorkflowChanged(beforeRecord, afterRecord);
        print("[PAY_APR][SLA_REASSIGN] SUCCESS | id=" + String(afterRecord.id || "") +
                " | result=" + JSON.stringify(result));
        return true;
    } catch (error) {
        // payment.doUpdate() đã commit; không báo save thất bại và khiến client gửi lại.
        print("[PAY_APR][SLA_REASSIGN] ERROR | id=" + String(beforeRecord.id || "") +
                " | message=" + String(error && error.message ? error.message : error));
        return false;
    }
}

function savePaymentApprovalField(details) {
    return runPaymentApprovalApi(details, true);
}

function runPaymentApprovalApi(details, save) {
    details = details || {};
    var payment = null;
    var timingStart = save ? 0 : new Date().getTime();
    var timingRecord = 0;
    var timingAccess = 0;
    var timingIdentity = 0;
    var timingOptions = 0;
    try {
        if (save && details.isFromHK === true) {
            return { success: false, code: "PAYMENT_APPROVAL_FORBIDDEN",
                message: "Không thể sửa thông tin phê duyệt từ menu Hậu kiểm." };
        }
        var paymentId = String(details.paymentId || "").trim();
        if (save && isDuChiPaymentApprovalRecord(paymentId) &&
                typeof vars !== "undefined" &&
                String(vars["$G.HTKT_DUCHI_MENU_CONTEXT"] || "").trim().toLowerCase() === "post_audit") {
            return { success: false, code: "PAYMENT_APPROVAL_FORBIDDEN",
                message: "Không thể sửa thông tin phê duyệt Dự chi từ menu Hậu kiểm." };
        }
        var currentUser = String(details.currentUser || "").trim();
        var field = String(details.field || "").trim();
        var fields = getPaymentApprovalFields();
        var isCheckbox = field === "require.check.level1" || field === "require.check.level2";
        if (!paymentId || !currentUser || (fields.indexOf(field) < 0 && !(save && isCheckbox))) {
            throw new Error("Thông tin phê duyệt không hợp lệ.");
        }
        payment = save ? new SCFile("esdHTKTpayment") : new SCFile("esdHTKTpayment", SCFILE_READONLY);
        if (!save) {
            payment.setFields(getPaymentApprovalReadFields());
        }
        if (payment.doSelect('id="' + escapeSmQueryValue(paymentId) + '"') !== RC_SUCCESS) {
            throw new Error("Không tìm thấy phiếu thanh toán.");
        }
        var isDuChi = isDuChiPaymentApprovalRecord(paymentId);
        if (isDuChi && !isDuChiApprovalRecordConsistent(payment)) {
            throw new Error("Mã phiếu và loại giao dịch Dự chi không khớp.");
        }
        if (timingStart) timingRecord = new Date().getTime();
        var resolvedIdentity = {};
        var rightPrefix = getPaymentApprovalRightPrefix(paymentId);
        var apiAccess = getPaymentApprovalAccess(
                payment,
                currentUser,
                resolvedIdentity,
                rightPrefix,
                (!save || isCheckbox) ? { targetField: field, forFieldOnly: true } : null
        );
        if (timingStart) timingAccess = new Date().getTime();
        var apiEditable =
                apiAccess &&
                apiAccess.fieldAccess &&
                apiAccess.fieldAccess[field] === true;
        if (isDuChi && !isCheckbox &&
                isDuChiApprovalFieldCompleted(readPaymentApprovalValue(payment, "current.phase"), field)) {
            apiEditable = false;
        }

        print(
                "[PAY_APR][API] u=" + currentUser +
                " field=" + field +
                " prefix=" + rightPrefix +
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
            var permissionContactId = resolvePaymentApprovalContactId(currentUser, resolvedIdentity);
            if (timingStart) timingIdentity = new Date().getTime();
            var loaded = save ? validatePaymentApprovalAssignee(payment, field, value, {
                currentUser: permissionContactId,
                currentUserLv1: resolvedIdentity.lv1 || "",
                page: 1,
                pageSize: 1,
                keyword: "",
                rightPrefix: rightPrefix
            }) : loadPaymentApprovalComboBoxesInternal(payment, field, {
                currentUser: permissionContactId,
                currentUserLv1: resolvedIdentity.lv1 || "",
                page: page,
                pageSize: pageSize,
                keyword: String(details.keyword || "").trim(),
                selectedId: "",
                rightPrefix: rightPrefix
            });
            if (timingStart) timingOptions = new Date().getTime();
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
            validateDuplicatePaymentApprovalUser(
                    payment,
                    field,
                    value
            );
        }

        var previousApprovalValue = isCheckbox ?
                "" :
                readPaymentApprovalValue(payment, field);
        // KTTC tiếp nhận được chọn lại người xử lý cho các bước KTTC tại
        // initial_kttc, kể cả hồ sơ do ĐMMS khởi tạo đã có giá trị dự kiến.
        // Áp dụng cho cả Thanh toán (giống Tạm ứng) và Dự chi.
        var initialKttcSelection = apiAccess.canEditLevel2 === true &&
                readPaymentApprovalValue(payment, "current.phase").toLowerCase() === "initial_kttc" &&
                (field === "user.approver.kttc" || field === "user.checker.final" ||
                        field === "user.approver.final");

        // Thanh toán already passed its own field-access checks above. Dự chi
        // additionally passes its existing leadership/reason checks below.
        var isSlaReassignment = !isDuChi && !isCheckbox && !!previousApprovalValue &&
                previousApprovalValue !== value && !initialKttcSelection;

        var precomputedLeaderRights = apiAccess && apiAccess.leaderChecked === true && apiAccess.leaderRights ?
                apiAccess.leaderRights : null;

        if (isDuChi && !isCheckbox && previousApprovalValue &&
                previousApprovalValue !== value && !isDuChiApprovalCreation(payment) &&
                !initialKttcSelection) {
            var dcRights = precomputedLeaderRights || getPaymentReassignmentRoleAccess(currentUser, resolvedIdentity, "0040040004");
            precomputedLeaderRights = dcRights;
            var dmmsField = field === "user.checker.dmms" || field === "user.approver.dmms";
            var kttcField = field === "user.checker.kttc" ||
                    field === "user.approver.kttc" ||
                    field === "user.checker.final" ||
                    field === "user.approver.final";
            var dcRole = readPaymentApprovalValue(payment, "initial.role").toLowerCase();
            var permitted = (dmmsField && dcRole === "dmms" && dcRights.isApprovalDmms === true) ||
                    (kttcField && dcRights.isApprovalKttc === true);
            if (!permitted) {
                return { success: false, code: "PAYMENT_APPROVAL_FORBIDDEN",
                    message: "Bạn không có quyền tái phân công Dự chi." };
            }
            var dcReason = String(details.reason || "").trim();
            if (!dcReason || dcReason.length > 60) {
                return { success: false, code: "PAYMENT_APPROVAL_REASON_REQUIRED",
                    message: "Vui lòng nhập lý do tái phân công tối đa 60 ký tự." };
            }
            isSlaReassignment = true;
        }

        var slaBeforeRecord = isSlaReassignment ? snapshotPaymentForSla(payment) : null;
        payment[field] = value;
        var clearedField = "";
        if (isCheckbox && !value) {
            clearedField = field === "require.check.level1" ? "user.checker.dmms" : "user.checker.final";
            payment[clearedField] = "";
        }
        if (payment.doUpdate() !== RC_SUCCESS) throw new Error("Không lưu được thông tin phê duyệt.");

        var slaUpdated = true;
        if (isSlaReassignment) slaUpdated = notifySlaPaymentReassigned(slaBeforeRecord, payment);

        if (!isCheckbox && !initialKttcSelection) {
            createPaymentReassignmentHistory(
                    paymentId,
                    field,
                    previousApprovalValue,
                    value,
                    details.reason,
                    currentUser,
                    precomputedLeaderRights,
                    payment
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
        try {
            if (timingStart) {
                var timingEnd = new Date().getTime();
                print(
                        "[PAY_APR][TIMING] field=" + String(details.field || "") +
                        " record=" + (timingRecord ? timingRecord - timingStart : -1) +
                        " access=" + (timingRecord && timingAccess ? timingAccess - timingRecord : -1) +
                        " identity=" + (timingAccess && timingIdentity ? timingIdentity - timingAccess : -1) +
                        " options=" + (timingIdentity && timingOptions ? timingOptions - timingIdentity : -1) +
                        " total=" + (timingEnd - timingStart) + "ms"
                );
            }
        } catch (timingError) {}
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

    var entityFile = null;
    var targetEntityCodes = [];
    var seenTargetEntities = {};
    var headOfficePsCodes = [];
    var seenPsCodes = {};

    try {
        entityFile = new SCFile("esdDMentity", SCFILE_READONLY);
        entityFile.setFields(["entity.code", "ps.code"]);

        var rc = entityFile.doSelect(
                '(ps.code="' + escapeSmQueryValue(normalizedLv1) +
                '" or entity.code="' + HEAD_OFFICE_OGL_SEG1 +
                '") and status="ACTIVE"'
        );

        while (rc === RC_SUCCESS) {
            var rowEntityCode = String(entityFile["entity.code"] || "").trim();
            var rowPsCode = normalizeHTKTApprovalUnitCode(entityFile["ps.code"]);

            if (rowPsCode === normalizedLv1 && rowEntityCode && !seenTargetEntities[rowEntityCode]) {
                seenTargetEntities[rowEntityCode] = true;
                targetEntityCodes.push(rowEntityCode);
            }

            if (
                    rowEntityCode === HEAD_OFFICE_OGL_SEG1 &&
                    rowPsCode &&
                    rowPsCode.indexOf(HEAD_OFFICE_PS_PREFIX) === 0 &&
                    !seenPsCodes[rowPsCode]
            ) {
                seenPsCodes[rowPsCode] = true;
                headOfficePsCodes.push(rowPsCode);
            }

            rc = entityFile.getNext();
        }
    } catch (e) {
        return result;
    } finally {
        try { if (entityFile) entityFile.doClose(); } catch (closeError) {}
    }

    if (targetEntityCodes.length !== 1 || targetEntityCodes[0] !== HEAD_OFFICE_OGL_SEG1) {
        return result;
    }

    if (!headOfficePsCodes.length || headOfficePsCodes.indexOf(normalizedLv1) < 0) {
        return result;
    }

    result.valid = true;
    result.type = "HEAD_OFFICE";
    result.entityCode = HEAD_OFFICE_OGL_SEG1;
    result.allowedLv1List = headOfficePsCodes;
    return result;
}

function readHTKTUserDataPermissionWithUnits(contactId, subModuleId) {
    var safeContact = String(contactId == null ? "" : contactId).trim();
    var safeSubModule = String(subModuleId == null ? "" : subModuleId).trim();
    var out = {
        scope: "",
        permId: "",
        units: []
    };

    if (!safeContact || !safeSubModule) return out;

    var dpFile = null;
    try {
        dpFile = new SCFile("esdQTdataPermissions", SCFILE_READONLY);
        dpFile.setFields(["id", "permission.scope"]);
        var rc = dpFile.doSelect(
                'contact.id="' + escapeSmQueryValue(safeContact) +
                '" and sub.module="' + escapeSmQueryValue(safeSubModule) + '"'
        );
        if (rc !== RC_SUCCESS) return out;

        out.scope = String(dpFile["permission.scope"] == null ? "" : dpFile["permission.scope"]).trim();
        out.permId = String(dpFile["id"] == null ? "" : dpFile["id"]).trim();
    } finally {
        try { if (dpFile) dpFile.doClose(); } catch (eCloseDp) {}
    }

    if (!out.permId || out.scope === "QT_PQDL_01" || out.scope === "QT_PQDL_06") {
        return out;
    }

    var joinFile = null;
    var seenUnits = {};
    try {
        joinFile = new SCFile("esdjoinDatapermissionUnits", SCFILE_READONLY);
        var sql =
                "SELECT dpu.unit.id AS unitId, u.lv1.id AS unitLv1, u.level AS unitLevel, u.parent.id AS unitParent " +
                "FROM esdjoinDatapermissionUnits dpu " +
                "LEFT JOIN esdQTorgUnit u ON (dpu.unit.id = u.unit.id) " +
                'WHERE dpu.status = "Dang hoat dong" ' +
                'AND dpu.data.permission.id = "' + escapeSmQueryValue(out.permId) + '"';
        var rcJoin = joinFile.doSelect(sql);
        while (rcJoin === RC_SUCCESS) {
            var rawUnitId = readSmJoinedField(joinFile, "unitId", "unit.id", 0);
            var normalizedUnitId = normalizeHTKTApprovalUnitCode(rawUnitId);
            if (normalizedUnitId && !seenUnits[normalizedUnitId]) {
                seenUnits[normalizedUnitId] = true;
                out.units.push({
                    rawUnitId: rawUnitId,
                    unitId: normalizedUnitId,
                    unitLv1: normalizeHTKTApprovalUnitCode(readSmJoinedField(joinFile, "unitLv1", "lv1.id", 1)),
                    unitLevel: readSmJoinedField(joinFile, "unitLevel", "level", 2),
                    unitParent: normalizeHTKTApprovalUnitCode(readSmJoinedField(joinFile, "unitParent", "parent.id", 3))
                });
            }
            rcJoin = joinFile.getNext();
        }
    } finally {
        try { if (joinFile) joinFile.doClose(); } catch (eCloseJoin) {}
    }

    return out;
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

function listContactsWithDetailsByRightsAndLv1(rightIds, targetLv1, subModuleId, resolvedDomain, keyword) {
    var emptyResult = {
        ids: [],
        detailsById: {},
        timings: { rightsJoinMs: 0, dpUnitsMs: 0 }
    };
    var normalizedRights = uniqueStrings(rightIds || []);
    var domain = resolvedDomain || resolveHTKTApprovalDataDomain(targetLv1);
    var allowedLv1List = uniqueStrings(domain.allowedLv1List || []);
    if (!domain.valid || !allowedLv1List.length || !normalizedRights.length) {
        return emptyResult;
    }

    var safeSubModule = String(subModuleId || "00401").trim();
    var normalizedKeyword = String(keyword == null ? "" : keyword).trim().toLowerCase();
    var rightClause = buildSmEqualsOrClause("jrp.rights.id", normalizedRights);
    if (!rightClause) return emptyResult;

    var allowedLv1Map = {};
    for (var allowedIndex = 0; allowedIndex < allowedLv1List.length; allowedIndex++) {
        var normalizedAllowedLv1 = normalizeHTKTApprovalUnitCode(allowedLv1List[allowedIndex]);
        if (normalizedAllowedLv1) allowedLv1Map[normalizedAllowedLv1] = true;
    }

    var candidateIds = [];
    var seenCandidates = {};
    var keywordRejected = {};
    var contactDetails = {};
    var acceptedContacts = {};
    var pendingPermissionIds = [];
    var seenPermissionIds = {};
    var contactByPermissionId = {};

    var BATCH_SIZE = 100;
    var rightsJoinStart = new Date().getTime();

    // Đẩy lọc lv1.id, functional rights và esdQTdataPermissions xuống DB trong 1 câu JOIN,
    // đồng thời lấy luôn full.name + position để loại bỏ hoàn toàn bước đọc lại bảng contacts.
    for (var lv1Offset = 0; lv1Offset < allowedLv1List.length; lv1Offset += BATCH_SIZE) {
        var lv1Batch = allowedLv1List.slice(lv1Offset, lv1Offset + BATCH_SIZE);
        var lv1Clause = buildSmEqualsOrClause("c.lv1.id", lv1Batch);
        if (!lv1Clause) continue;

        var joinFile = null;
        try {
            joinFile = new SCFile("contacts", SCFILE_READONLY);
            var sql =
                    "SELECT c.contact.name AS contactName, " +
                    "c.full.name AS fullName, " +
                    "c.position AS contactPosition, " +
                    "dp.id AS permId, " +
                    "dp.permission.scope AS permScope " +
                    "FROM contacts c " +
                    "JOIN esdjoinContactsPermissionGroup jcpg ON (jcpg.contact.id = c.contact.name) " +
                    "JOIN esdQTpermissionGroup pg ON (pg.id = jcpg.permission.group.id) " +
                    "JOIN esdjoinRightsPermission jrp ON (jrp.permission.group.id = pg.id) " +
                    "JOIN esdQTdataPermissions dp ON (dp.contact.id = c.contact.name) " +
                    'WHERE c.status = "Dang hoat dong" ' +
                    "AND " + lv1Clause + " " +
                    'AND pg.status = "Dang hoat dong" ' +
                    "AND (pg.start.date <= tod() OR pg.start.date = NULL) " +
                    "AND (pg.end.date >= tod() OR pg.end.date = NULL) " +
                    "AND (jcpg.start.date <= tod() OR jcpg.start.date = NULL) " +
                    "AND (jcpg.end.date >= tod() OR jcpg.end.date = NULL) " +
                    "AND " + rightClause + " " +
                    'AND dp.sub.module = "' + escapeSmQueryValue(safeSubModule) + '" ' +
                    'AND dp.permission.scope ~= "QT_PQDL_01"';

            var joinRc = joinFile.doSelect(sql);
            while (joinRc === RC_SUCCESS) {
                var contactId = readSmJoinedField(joinFile, "contactName", "contact.name", 0);
                var fullName = readSmJoinedField(joinFile, "fullName", "full.name", 1);
                var position = readSmJoinedField(joinFile, "contactPosition", "position", 2);
                var permId = readSmJoinedField(joinFile, "permId", "id", 3);
                var permScope = readSmJoinedField(joinFile, "permScope", "permission.scope", 4);

                if (contactId) {
                    if (!seenCandidates[contactId]) {
                        seenCandidates[contactId] = true;
                        candidateIds.push(contactId);
                        contactDetails[contactId] = {
                            id: contactId,
                            fullName: fullName,
                            position: position
                        };

                        if (normalizedKeyword) {
                            var displayText = (contactId + " " + (fullName || contactId) + (position ? " - " + position : "")).toLowerCase();
                            var rawText = (contactId + " " + fullName + " " + position).toLowerCase();
                            if (displayText.indexOf(normalizedKeyword) < 0 && rawText.indexOf(normalizedKeyword) < 0) {
                                keywordRejected[contactId] = true;
                            }
                        }
                    }

                    if (!keywordRejected[contactId] && permId && permScope !== "QT_PQDL_01") {
                        if (permScope === "QT_PQDL_06") {
                            if (domain.type === "HEAD_OFFICE") {
                                acceptedContacts[contactId] = true;
                            }
                        } else if (!seenPermissionIds[permId]) {
                            seenPermissionIds[permId] = true;
                            pendingPermissionIds.push(permId);
                            contactByPermissionId[permId] = contactId;
                        }
                    }
                }

                joinRc = joinFile.getNext();
            }
        } finally {
            try { if (joinFile) joinFile.doClose(); } catch (joinCloseError) {}
        }
    }

    var rightsJoinMs = new Date().getTime() - rightsJoinStart;

    var permissionIds = [];
    for (var pIndex = 0; pIndex < pendingPermissionIds.length; pIndex++) {
        var pendingPermId = pendingPermissionIds[pIndex];
        var ownerContactId = contactByPermissionId[pendingPermId];
        if (ownerContactId && !acceptedContacts[ownerContactId]) {
            permissionIds.push(pendingPermId);
        }
    }

    var dpUnitsStart = new Date().getTime();

    // Chỉ đọc unit của các permission chưa được chấp nhận qua QT_PQDL_06,
    // LEFT JOIN esdQTorgUnit ngay trong DB để lấy lv1.id trong 1 lượt.
    if (permissionIds.length) {
        var fallbackRows = [];
        var fallbackUnitIds = [];
        var seenFallbackUnits = {};

        for (var offset = 0; offset < permissionIds.length; offset += BATCH_SIZE) {
            var permissionBatch = permissionIds.slice(offset, offset + BATCH_SIZE);
            var permClause = buildSmEqualsOrClause("dpu.data.permission.id", permissionBatch);
            if (!permClause) continue;

            var unitFile = null;
            try {
                unitFile = new SCFile("esdjoinDatapermissionUnits", SCFILE_READONLY);
                var unitSql =
                        "SELECT dpu.data.permission.id AS permId, dpu.unit.id AS unitId, u.lv1.id AS unitLv1 " +
                        "FROM esdjoinDatapermissionUnits dpu " +
                        "LEFT JOIN esdQTorgUnit u ON (dpu.unit.id = u.unit.id) " +
                        'WHERE dpu.status = "Dang hoat dong" ' +
                        "AND " + permClause;
                var unitRc = unitFile.doSelect(unitSql);

                while (unitRc === RC_SUCCESS) {
                    var mappedPermissionId = readSmJoinedField(unitFile, "permId", "data.permission.id", 0);
                    var rawUnitId = readSmJoinedField(unitFile, "unitId", "unit.id", 1);
                    var mappedUnitId = normalizeHTKTApprovalUnitCode(rawUnitId);
                    var mappedUnitLv1 = normalizeHTKTApprovalUnitCode(readSmJoinedField(unitFile, "unitLv1", "lv1.id", 2));
                    var mappedContactId = contactByPermissionId[mappedPermissionId];

                    if (mappedContactId && !acceptedContacts[mappedContactId] && mappedUnitId) {
                        if (allowedLv1Map[mappedUnitId] || (mappedUnitLv1 && allowedLv1Map[mappedUnitLv1])) {
                            acceptedContacts[mappedContactId] = true;
                        } else if (!mappedUnitLv1 && rawUnitId !== mappedUnitId) {
                            fallbackRows.push({ contactId: mappedContactId, unitId: mappedUnitId });
                            if (!seenFallbackUnits[mappedUnitId]) {
                                seenFallbackUnits[mappedUnitId] = true;
                                fallbackUnitIds.push(mappedUnitId);
                            }
                        }
                    }
                    unitRc = unitFile.getNext();
                }
            } finally {
                try { if (unitFile) unitFile.doClose(); } catch (unitCloseError) {}
            }
        }

        if (fallbackUnitIds.length) {
            var unitLv1Map = {};
            for (var unitOffset = 0; unitOffset < fallbackUnitIds.length; unitOffset += BATCH_SIZE) {
                var unitBatch = fallbackUnitIds.slice(unitOffset, unitOffset + BATCH_SIZE);
                var orgClause = buildSmEqualsOrClause("unit.id", unitBatch);
                if (!orgClause) continue;

                var orgFile = null;
                try {
                    orgFile = new SCFile("esdQTorgUnit", SCFILE_READONLY);
                    orgFile.setFields(["unit.id", "lv1.id"]);
                    var orgRc = orgFile.doSelect(orgClause);
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

            for (var fbIndex = 0; fbIndex < fallbackRows.length; fbIndex++) {
                var fbRow = fallbackRows[fbIndex];
                var fbLv1 = unitLv1Map[fbRow.unitId];
                if (fbLv1 && allowedLv1Map[fbLv1]) {
                    acceptedContacts[fbRow.contactId] = true;
                }
            }
        }
    }

    var dpUnitsMs = new Date().getTime() - dpUnitsStart;

    var resultIds = [];
    var acceptedDetails = {};
    for (var resultIndex = 0; resultIndex < candidateIds.length; resultIndex++) {
        var resultContactId = candidateIds[resultIndex];
        if (resultContactId && acceptedContacts[resultContactId]) {
            resultIds.push(resultContactId);
            acceptedDetails[resultContactId] = contactDetails[resultContactId];
        }
    }

    return {
        ids: resultIds,
        detailsById: acceptedDetails,
        timings: {
            rightsJoinMs: rightsJoinMs,
            dpUnitsMs: dpUnitsMs
        }
    };
}

function listContactsByRightsAndLv1(rightIds, targetLv1, subModuleId, resolvedDomain, keyword) {
    return listContactsWithDetailsByRightsAndLv1(
            rightIds, targetLv1, subModuleId, resolvedDomain, keyword
    ).ids;
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

// Save chỉ xác thực đúng một người, không dựng toàn bộ dữ liệu combobox.
function validatePaymentApprovalAssignee(paymentFile, requestedField, selectedId, apiOptions) {
    apiOptions = apiOptions || {};
    apiOptions.validationOnly = true;
    apiOptions.selectedId = String(selectedId == null ? "" : selectedId).trim();
    return loadPaymentApprovalComboBoxesInternal(paymentFile, requestedField, apiOptions);
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

    var rightPrefix = String(apiOptions && apiOptions.rightPrefix || "").trim() ||
            getPaymentApprovalRightPrefix(paymentFile);
    var rightBase = getPaymentApprovalRightBase(rightPrefix);
    var RIGHT_ACCOUNTING_INPUT = rightBase + "0003";
    var RIGHT_CHECK_1 = rightBase + "0004";
    var RIGHT_APPROVE_1 = rightBase + "0005";
    var RIGHT_APPROVE_2 = rightBase + "0006";
    var RIGHT_CHECK_2 = rightBase + "0007";
    var RIGHT_APPROVE_3 = rightBase + "0008";

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

    resolvedTargetDomain = resolveHTKTApprovalDataDomain(output.targetLv1);
    if (!resolvedTargetDomain.valid) {
        clearAllComboBoxes(configs);
        output.success = false;
        output.message = "Không xác định được miền dữ liệu của hồ sơ thanh toán.";
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

    var currentUserScope = getUserScopeContext(currentUser, output.targetLv1, resolvedTargetDomain);

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

    // Chỉ dùng cho kiểm tra quyền xem sớm của Dự chi. Không cần tải candidate.
    if (apiOptions && apiOptions.scopeOnly) return output;

    // Nhánh save chỉ kiểm tra cán bộ được chọn, không tải toàn bộ candidate/label/phân trang.
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
            var allowedLv1List = uniqueStrings(domain.allowedLv1List || []);
            if (!domain.valid || !allowedLv1List.length) {
                validation.message = "Không xác định được miền dữ liệu hợp lệ của hồ sơ.";
                return validation;
            }
            var safeRights = normalizeArray(config.seedRights);
            if (!safeRights.length) {
                validation.message = "Không xác định được quyền phê duyệt cần kiểm tra.";
                return validation;
            }

            var rightClause = buildSmEqualsOrClause("jrp.rights.id", safeRights);
            var permissionIds = [];
            var seenPermIds = {};
            var matchedAny = false;
            var BATCH_SIZE = 100;

            for (var lv1Offset = 0; lv1Offset < allowedLv1List.length; lv1Offset += BATCH_SIZE) {
                var lv1Batch = allowedLv1List.slice(lv1Offset, lv1Offset + BATCH_SIZE);
                var lv1Clause = buildSmEqualsOrClause("c.lv1.id", lv1Batch);
                if (!lv1Clause) continue;

                var candidateFile = null;
                try {
                    candidateFile = new SCFile("contacts", SCFILE_READONLY);
                    var candidateSql =
                            "SELECT dp.id AS permId, dp.permission.scope AS permScope " +
                            "FROM contacts c " +
                            "JOIN esdjoinContactsPermissionGroup jcpg ON (jcpg.contact.id = c.contact.name) " +
                            "JOIN esdQTpermissionGroup pg ON (pg.id = jcpg.permission.group.id) " +
                            "JOIN esdjoinRightsPermission jrp ON (jrp.permission.group.id = pg.id) " +
                            "JOIN esdQTdataPermissions dp ON (dp.contact.id = c.contact.name) " +
                            'WHERE c.contact.name = "' + escapeSmQueryValue(normalizedSelectedId) + '" ' +
                            'AND c.status = "Dang hoat dong" ' +
                            "AND " + lv1Clause + " " +
                            'AND pg.status = "Dang hoat dong" ' +
                            "AND (pg.start.date <= tod() OR pg.start.date = NULL) " +
                            "AND (pg.end.date >= tod() OR pg.end.date = NULL) " +
                            "AND (jcpg.start.date <= tod() OR jcpg.start.date = NULL) " +
                            "AND (jcpg.end.date >= tod() OR jcpg.end.date = NULL) " +
                            "AND " + rightClause + " " +
                            'AND dp.sub.module = "' + escapeSmQueryValue(HTKT_SUB_MODULE) + '" ' +
                            'AND dp.permission.scope ~= "QT_PQDL_01"';
                    var candidateRc = candidateFile.doSelect(candidateSql);
                    while (candidateRc === RC_SUCCESS) {
                        matchedAny = true;
                        var permissionId = readSmJoinedField(candidateFile, "permId", "id", 0);
                        var scope = readSmJoinedField(candidateFile, "permScope", "permission.scope", 1);
                        if (scope === "QT_PQDL_06" && domain.type === "HEAD_OFFICE") {
                            validation.valid = true;
                            validation.message = "Cán bộ hợp lệ.";
                            return validation;
                        }
                        if (permissionId && scope !== "QT_PQDL_01" && scope !== "QT_PQDL_06" && !seenPermIds[permissionId]) {
                            seenPermIds[permissionId] = true;
                            permissionIds.push(permissionId);
                        }
                        candidateRc = candidateFile.getNext();
                    }
                } finally {
                    try { if (candidateFile) candidateFile.doClose(); } catch (candidateCloseError) {}
                }

                if (matchedAny) break;
            }

            if (!matchedAny) {
                validation.message = "Cán bộ không có đúng quyền hoặc không thuộc miền của hồ sơ.";
                return validation;
            }

            if (!permissionIds.length) {
                validation.message = "Cán bộ không có phân quyền dữ liệu phù hợp.";
                return validation;
            }

            var allowedLv1Map = {};
            for (var allowedIndex = 0; allowedIndex < allowedLv1List.length; allowedIndex++) {
                var allowedLv1 = normalizeUnitCode(allowedLv1List[allowedIndex]);
                if (allowedLv1) allowedLv1Map[allowedLv1] = true;
            }

            for (var offset = 0; offset < permissionIds.length; offset += BATCH_SIZE) {
                var permissionBatch = permissionIds.slice(offset, offset + BATCH_SIZE);
                var permClause = buildSmEqualsOrClause("dpu.data.permission.id", permissionBatch);
                if (!permClause) continue;

                var unitFile = null;
                try {
                    unitFile = new SCFile("esdjoinDatapermissionUnits", SCFILE_READONLY);
                    var unitSql =
                            "SELECT dpu.unit.id AS unitId, u.lv1.id AS unitLv1, u.level AS unitLevel, u.parent.id AS unitParent " +
                            "FROM esdjoinDatapermissionUnits dpu " +
                            "LEFT JOIN esdQTorgUnit u ON (dpu.unit.id = u.unit.id) " +
                            'WHERE dpu.status = "Dang hoat dong" ' +
                            "AND " + permClause;
                    var unitRc = unitFile.doSelect(unitSql);
                    while (unitRc === RC_SUCCESS) {
                        var rawUnitId = readSmJoinedField(unitFile, "unitId", "unit.id", 0);
                        var unitId = normalizeUnitCode(rawUnitId);
                        if (unitId) {
                            var unitLv1 = "";
                            if (allowedLv1Map[unitId]) {
                                unitLv1 = unitId;
                            } else {
                                var joinedLevel = readSmJoinedField(unitFile, "unitLevel", "level", 2);
                                var joinedLv1 = normalizeUnitCode(readSmJoinedField(unitFile, "unitLv1", "lv1.id", 1));
                                var joinedParent = normalizeUnitCode(readSmJoinedField(unitFile, "unitParent", "parent.id", 3));
                                if (joinedLevel && isLevel1(joinedLevel)) {
                                    unitLv1 = unitId;
                                } else if (joinedLv1) {
                                    unitLv1 = joinedLv1;
                                } else if (joinedParent) {
                                    unitLv1 = resolveLv1FromUnit(joinedParent);
                                } else if (rawUnitId !== unitId) {
                                    unitLv1 = resolveLv1FromUnit(unitId);
                                } else {
                                    unitLv1 = unitId;
                                }
                            }
                            if (unitLv1 && allowedLv1Map[unitLv1]) {
                                validation.valid = true;
                                validation.message = "Cán bộ hợp lệ.";
                                return validation;
                            }
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
            var candidateStartedAt = apiOptions && !apiOptions.selectedId ? new Date().getTime() : 0;
            if (selectedOnly) {
                selectedId = normalizeValue(safeFileGet(file, [config.saveField]));
                contactIds = { ids: selectedId ? [selectedId] : [], detailsById: null, poolCount: 0, rejectedCount: 0 };
            } else {
                contactIds = getContactsForRoleInLv1(config, targetLv1);
            }
            var candidateFinishedAt = candidateStartedAt ? new Date().getTime() : 0;

            result.debug.poolCount = contactIds.poolCount;
            result.debug.rejectedCount = contactIds.rejectedCount;

            var comboData;
            if (apiOptions) {
                comboData = contactIds.detailsById ?
                        buildContactPageFromDetails(contactIds.ids, contactIds.detailsById, apiOptions) :
                        readContactPage(contactIds.ids, apiOptions);
            } else {
                comboData = contactIds.detailsById ?
                        buildContactDataFromDetails(contactIds.ids, contactIds.detailsById) :
                        readContactData(contactIds.ids, selectedOnly);
            }
            if (candidateStartedAt) {
                try {
                    var stepTimings = contactIds.timings || {};
                    print(
                            "[PAY_APR][LIST_TIMING] field=" + config.saveField +
                            " candidates=" + (candidateFinishedAt - candidateStartedAt) + "ms" +
                            " labels=" + (new Date().getTime() - candidateFinishedAt) + "ms" +
                            " pool=" + contactIds.ids.length +
                            " rightsJoin=" + (typeof stepTimings.rightsJoinMs === "number" ? stepTimings.rightsJoinMs : -1) + "ms" +
                            " dpUnits=" + (typeof stepTimings.dpUnitsMs === "number" ? stepTimings.dpUnitsMs : -1) + "ms"
                    );
                } catch (timingError) {}
            }
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
        var loaded = listContactsWithDetailsByRightsAndLv1(
                config.seedRights,
                targetLv1,
                HTKT_SUB_MODULE,
                resolvedTargetDomain,
                apiOptions ? apiOptions.keyword : ""
        );
        var ids = normalizeArray(loaded.ids);
        return {
            ids: ids,
            detailsById: loaded.detailsById || {},
            timings: loaded.timings || {},
            poolCount: ids.length,
            rejectedCount: 0
        };
    }

    function formatContactDisplay(contactId, fullName, position) {
        var safeName = normalizeValue(fullName) || contactId;
        var safePosition = normalizeValue(position);
        return safeName + (safePosition ? " - " + safePosition : "");
    }

    function buildContactPageFromDetails(contactIds, detailsById, options) {
        var ids = normalizeArray(contactIds).sort();
        if (options.selectedId) {
            ids = ids.indexOf(options.selectedId) >= 0 ? [options.selectedId] : [];
        }
        var result = { ids: [], names: [], hasMore: false };
        var skip = (options.page - 1) * options.pageSize;
        var matched = 0;
        var keyword = normalizeValue(options.keyword).toLowerCase();
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            var detail = detailsById[id] || { id: id, fullName: "", position: "" };
            var display = formatContactDisplay(id, detail.fullName, detail.position);
            var rawText = (id + " " + normalizeValue(detail.fullName) + " " + normalizeValue(detail.position)).toLowerCase();
            if (
                    !keyword ||
                    (id + " " + display).toLowerCase().indexOf(keyword) >= 0 ||
                    rawText.indexOf(keyword) >= 0
            ) {
                if (matched++ >= skip) {
                    if (result.ids.length === options.pageSize) {
                        result.hasMore = true;
                        return result;
                    }
                    result.ids.push(id);
                    result.names.push(display);
                }
            }
        }
        return result;
    }

    function buildContactDataFromDetails(contactIds, detailsById) {
        var ids = normalizeArray(contactIds);
        var rows = [];
        for (var i = 0; i < ids.length; i++) {
            var id = ids[i];
            var detail = detailsById[id] || { id: id, fullName: "", position: "" };
            rows.push({
                id: id,
                display: formatContactDisplay(id, detail.fullName, detail.position)
            });
        }
        rows.sort(function(a, b) {
            var da = normalizeValue(a.display).toLowerCase();
            var db = normalizeValue(b.display).toLowerCase();
            if (da < db) return -1;
            if (da > db) return 1;
            return 0;
        });
        var data = { ids: [], names: [] };
        for (var j = 0; j < rows.length; j++) {
            data.ids.push(rows[j].id);
            data.names.push(rows[j].display);
        }
        return data;
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
            dp = readHTKTUserDataPermissionWithUnits(contactId, HTKT_SUB_MODULE);
        } catch (e) {
            result.message = String(e.message || e);
            return result;
        }

        result.scope = normalizeValue(dp && dp.scope ? dp.scope : "");

        if (!result.scope) {
            result.scope = "QT_PQDL_01";
        }

        var unitEntries = dp && dp.units ? dp.units : [];
        for (var uIndex = 0; uIndex < unitEntries.length; uIndex++) {
            result.rawUnits.push(unitEntries[uIndex].unitId);
        }

        var allowedLv1Map = {};
        for (var allowedIndex = 0; allowedIndex < targetDomain.allowedLv1List.length; allowedIndex++) {
            var allowedLv1 = normalizeUnitCode(targetDomain.allowedLv1List[allowedIndex]);
            if (allowedLv1) allowedLv1Map[allowedLv1] = true;
        }

        if (result.scope === "QT_PQDL_06") {
            if (targetDomain.type === "HEAD_OFFICE") {
                var currentUserLv1 = (apiOptions && apiOptions.currentUser === contactId && apiOptions.currentUserLv1) ?
                        normalizeUnitCode(apiOptions.currentUserLv1) :
                        normalizeUnitCode(getHTKTApprovalContactLv1(contactId));

                var isHeadOfficeUser = false;
                if (currentUserLv1) {
                    if (currentUserLv1 === targetLv1) {
                        isHeadOfficeUser = true;
                    } else if (allowedLv1Map[currentUserLv1]) {
                        isHeadOfficeUser = getHTKTApprovalActiveEntityCodeByPsCode(currentUserLv1) === "1010098";
                    }
                }

                if (isHeadOfficeUser) {
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

        if (unitEntries.length === 0) {
            result.canAccessTargetLv1 = false;
            result.message = "User có scope đơn vị nhưng không có unit phân quyền dữ liệu.";
            return result;
        }

        var resolvedLv1Map = {};

        for (var i = 0; i < unitEntries.length; i++) {
            var unitEntry = unitEntries[i];
            var rawUnit = unitEntry.unitId;
            var currentLv1 = "";

            if (allowedLv1Map[rawUnit]) {
                currentLv1 = rawUnit;
            } else if (unitEntry.unitLevel && isLevel1(unitEntry.unitLevel)) {
                currentLv1 = rawUnit;
            } else if (unitEntry.unitLv1) {
                currentLv1 = unitEntry.unitLv1;
            } else if (unitEntry.unitParent) {
                currentLv1 = resolveLv1FromUnit(unitEntry.unitParent);
            } else if (unitEntry.rawUnitId !== rawUnit) {
                currentLv1 = resolveLv1FromUnit(rawUnit);
            } else {
                currentLv1 = rawUnit;
            }

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
            f.setFields(["id", "unit.id", "unit.name", "level", "status", "parent.id", "org.unit", "lv1.id"]);
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
