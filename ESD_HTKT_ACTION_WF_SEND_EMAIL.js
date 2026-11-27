 var logger = typeof getLog === 'function' ? getLog("ESD_HTKT_ACTION_WF_SEND_EMAIL") : { info: function(m) {}, error: function(m) {} };

var NEXT_WORKFLOW_PHASE_MAP = {
    "initial_dmms": "initial_kttc",
    "initial_kttc": "check_dmms",
    "check_dmms": "approval_dmms",
    "approval_dmms": "approval_kttc",
    "approval_kttc": "check_final",
    "check_final": "approval_final"
};


var RULE_SET_MAIL = {

    S6_MAIL_01_01: "ESD_HTKT_SENDEMAIL_S6_MAIL_01_01", // Trình phiếu
    S6_MAIL_01_02: "ESD_HTKT_SENDEMAIL_S6_MAIL_01_02", // Yêu cầu chính sửa
    S6_MAIL_01_04: "ESD_HTKT_SENDEMAIL_S6_MAIL_01_04", // Xóa
    S6_MAIL_01_05: "ESD_HTKT_SENDEMAIL_S6_MAIL_01_05", // Kết quả hạch toán (đã gộp 01_03, 01_05, 01_06)
    S6_MAIL_01_07: "ESD_HTKT_SENDEMAIL_S6_MAIL_01_07", // Tái phân công cán bộ
    S6_MAIL_01_08: "ESD_HTKT_SENDEMAIL_S6_MAIL_01_08", // Kết quả hạch toán dự chi

    S6_MAIL_02_01: "ESD_HTKT_SENDEMAIL_S6_MAIL_02_01", // Lỗi hạch toán đã được xử lý
    S6_MAIL_02_02: "ESD_HTKT_SENDEMAIL_S6_MAIL_02_02", // Yêu cầu duyệt kết quả xử lý lỗi hạch toá  
    S6_MAIL_02_03: "ESD_HTKT_SENDEMAIL_S6_MAIL_02_03", // Kết quả xử lý lỗi hạch toán bị từ chối
    S6_MAIL_02_04: "ESD_HTKT_SENDEMAIL_S6_MAIL_02_04", // Xử lý lỗi hạch toán thất bại tại Kênh

    S6_MAIL_03_01: "ESD_HTKT_SENDEMAIL_S6_MAIL_03_01", // Kết quả kiểm tra hóa đơn

    S6_MAIL_04_01: "ESD_HTKT_SENDEMAIL_S6_MAIL_04_01"  // Cảnh báo vượt quá 90% thời hạn SLA (S6-SLA-01)
};


function getPhaseReceiver(record) {
    var current_phase = record["current.phase"];
    switch (current_phase) {
        case "initial_kttc":
            return record["user.checker.kttc"];
        case "check_dmms":
            return record["user.checker.dmms"];
        case "approval_dmms":
            return record["user.approver.dmms"];
        case "approval_kttc":
            return record["user.approver.kttc"];
        case "check_final":
            return record["user.checker.final"];
        case "approval_final":
            return record["user.approver.final"];
        default:
            return null;
    }
}

function getPhaseByUserOwnerPhase(record, contactName) {
    if (record["initial.role"] == "dmms" && contactName == record["created.by"]) {
        return "initial_dmms";
    } else if (record["initial.role"] == "kttc" && contactName == record["created.by"]) {
        return "initial_kttc";
    }

    switch (contactName) {
        case record["user.checker.kttc"]:
            return "initial_kttc";
        case record["user.checker.dmms"]:
            return "check_dmms";
        case record["user.approver.dmms"]:
            return "approval_dmms";
        case record["user.approver.kttc"]:
            return "approval_kttc";
        case record["user.checker.final"]:
            return "check_final";
        case record["user.approver.final"]:
            return "approval_final";
        default:
            return null;
    }
}

var getCommonName = lib.ESD_Utils.getCommonName;
var callRuleSet = lib.ESD_Utils.callRuleSet;
var isCountTicket = lib.ESD_Utils.isCountTicket;
var getFieldsContactsByRightsAndFilter = lib.ESD_PERMS_RIGHTS.getFieldsContactsByRightsAndFilter;
// ===== SEND MAIL =====
function formatISODate(isoString) {
    if (!isoString || isoString === "Không xác định") return "Không xác định";

    try {
        var date = new Date(isoString);
        if (isNaN(date.getTime())) return isoString; // Trả về nguyên bản nếu không parse được

        var day = String(date.getDate()).padStart(2, '0');
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var year = date.getFullYear();

        var hours = String(date.getHours()).padStart(2, '0');
        var minutes = String(date.getMinutes()).padStart(2, '0');
        var seconds = String(date.getSeconds()).padStart(2, '0');

        return day + "/" + month + "/" + year + " " + hours + ":" + minutes + ":" + seconds;
    } catch (e) {
        return isoString;
    }
}
function formatDateOnly(isoString) {
    return formatOnlyDate(isoString);
}

function formatOnlyDate(isoString) {
    if (!isoString || isoString === "Không xác định") return "Không xác định";

    try {
        var date = new Date(isoString);
        if (isNaN(date.getTime())) return isoString; // Trả về nguyên bản nếu không parse được

        var day = String(date.getDate()).padStart(2, '0');
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var year = date.getFullYear();

        return day + "/" + month + "/" + year;
    } catch (e) {
        return isoString;
    }
}

function cleanGlobalVariable() {
    vars["$G.mail.receiver"] = null;
    vars["$G.mail.receiver.name"] = null;

    vars["$G.mail.sender"] = null;
    vars["$G.mail.sender.name"] = null;
    vars["$G.mail.sender.contactname"] = null;
    vars["$G.mail.sender.position"] = null;

    vars["$G.mail.sla.user.display"] = null;
    vars["$G.mail.sla.phase"] = null;
    vars["$G.mail.sla.phase.name"] = null;
    vars["$G.mail.sla.expire.time"] = null;
    vars["$G.mail.ticket.id"] = null;
}

/**
 * Số ngày từ hiện tại đến ngày đích.
 * > 0: còn X ngày
 * = 0: hôm nay
 * < 0: đã quá hạn
 */
function getDaysUntil(targetDate) {
    if (!targetDate) return null;

    var today = new Date();
    var target = new Date(targetDate);

    // bỏ phần giờ phút giây để tránh lệch ngày
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);

    return Math.floor(
            (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );
}

function getDaysBetween(from, to) {
    if (!from || !to) return null;

    var fromDate = new Date(from);
    var toDate = new Date(to);

    fromDate.setHours(0, 0, 0, 0);
    toDate.setHours(0, 0, 0, 0);

    return Math.floor(
            (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24)
    );
}
/**
 * Kiểm tra còn trong thời gian nhắc hạn.
 */
function isReminderDue(targetDate, reminderDays) {
    var daysUntil = getDaysUntil(targetDate);
    if (daysUntil === null) {
        return false;
    }
    reminderDays = parseInt(reminderDays, 10) || 0;
    return daysUntil >= 0 && daysUntil <= reminderDays;
}

function escapeEmailHtml(value) {
    if (value == null || value === "") return "";
    return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
}

function escapeSMQuery(value) {
    if (value == null) return "";
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatEmailNumber(value) {
    if (value == null || value === "") return "";
    var num = parseFloat(String(value).replace(/,/g, ""));
    if (isNaN(num)) return escapeEmailHtml(value);
    var parts = String(num).split(".");
    var integer = parts[0];
    var decimal = parts[1];
    integer = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return decimal ? integer + "." + decimal : integer;
}
//===============================================SEND MAIL=========================================================


function escapeSmQueryValue(value) {
    return String(value == null ? "" : value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getContactInfo(contactName) {
    if (!contactName) {
        return null;
    }
    var rawName = String(contactName).trim();
    if (!rawName) return null;

    var safeName = escapeSmQueryValue(rawName);
    var f = new SCFile("contacts", SCFILE_READONLY);
    try {
        // 1. Tìm theo contact.name trong bảng contacts (nguyên bản, toUpper, toLower)
        var rc = f.doSelect('contact.name="' + safeName + '"');
        if (rc != RC_SUCCESS) {
            rc = f.doSelect('contact.name="' + escapeSmQueryValue(rawName.toUpperCase()) + '"');
        }
        if (rc != RC_SUCCESS) {
            rc = f.doSelect('tolower(contact.name)="' + escapeSmQueryValue(rawName.toLowerCase()) + '"');
        }

        // 2. Tìm theo operator.id trong bảng contacts
        if (rc != RC_SUCCESS) {
            rc = f.doSelect('operator.id="' + safeName + '"');
        }
        if (rc != RC_SUCCESS) {
            rc = f.doSelect('tolower(operator.id)="' + escapeSmQueryValue(rawName.toLowerCase()) + '"');
        }

        if (rc == RC_SUCCESS) {
            return {
                contactName: f["contact.name"] || rawName,
                fullName: f["full.name"] || f["contact.name"] || rawName,
                email: f["email"] || "",
                position: f["position"] || "",
                lv1Id: f["lv1.id"] || "",
                lv2Id: f["lv2.id"] || ""
            };
        }
    } catch (eContacts) {
    } finally {
        if (f) {
            try { f.doClose(); } catch (eCl) {}
        }
    }

    // 3. Fallback: Tìm trong bảng operator (tài khoản đăng nhập hệ thống)
    var op = new SCFile("operator", SCFILE_READONLY);
    try {
        var opRc = op.doSelect('name="' + safeName + '"');
        if (opRc != RC_SUCCESS) {
            opRc = op.doSelect('tolower(name)="' + escapeSmQueryValue(rawName.toLowerCase()) + '"');
        }
        if (opRc != RC_SUCCESS) {
            opRc = op.doSelect('name="' + escapeSmQueryValue(rawName.toUpperCase()) + '"');
        }

        if (opRc == RC_SUCCESS) {
            var opContactName = op["contact.name"] || "";
            var opFullName = op["full.name"] || op["name"] || rawName;
            var opEmail = op["email"] || "";

            // Nếu operator có liên kết contact.name khác, thử lấy thông tin phòng ban từ contact đó
            if (opContactName && opContactName !== rawName) {
                var linkedContact = getContactInfo(opContactName);
                if (linkedContact) {
                    return {
                        contactName: linkedContact.contactName || opContactName,
                        fullName: linkedContact.fullName || opFullName,
                        email: linkedContact.email || opEmail,
                        position: linkedContact.position || "",
                        lv1Id: linkedContact.lv1Id || "",
                        lv2Id: linkedContact.lv2Id || ""
                    };
                }
            }

            return {
                contactName: rawName,
                fullName: opFullName,
                email: opEmail,
                position: "",
                lv1Id: "",
                lv2Id: ""
            };
        }
    } catch (eOp) {
    } finally {
        if (op) {
            try { op.doClose(); } catch (eClOp) {}
        }
    }

    return null;
}

function getUnitInfo(lvId) {
    if (!lvId) {
        return "Không xác định";
    }
    var f = new SCFile("esdDMentity", SCFILE_READONLY);
    try {
        var rc = f.doSelect('ps.code="' + lvId + '"');
        if (rc != RC_SUCCESS) {
            return null;
        }
        return f["branch.name"];
    } finally {
        if (f) {
            f.doClose();
        }
    }
}


function sendEmailToUsers(record, ruleSetName, contacts) {
    if (!record || !ruleSetName || !contacts) {
        return false;
    }
    if (!Array.isArray(contacts)) {
        contacts = [contacts];
    }
    // remove null + duplicate contact
    contacts = Array.from(
            new Set(contacts.filter(function(contact) { return contact; }))
    );
    if (!contacts.length) {
        return false;
    }
    var sentEmails = {};
    var success = false;
    for (var i = 0; i < contacts.length; i++) {
        var info = getContactInfo(contacts[i]);
        if (!info || !info.email) {
            continue;
        }
        // tránh 2 contact dùng chung email
        if (sentEmails[info.email]) {
            continue;
        }
        sentEmails[info.email] = true;
        try {
            vars["$G.mail.receiver"] = [info.email];
            vars["$G.mail.receiver.name"] = info.fullName || "";
            callRuleSet(record, ruleSetName);
            success = true;
        } finally {
            cleanGlobalVariable();
        }
    }
    return success;
}

//--------------------------
function sendEmailToContact(record, ruleSetName, contactName, senderContacts) {
    contactName = contactName || record["created.by"];
    if (!record || !ruleSetName || !contactName) {
        return false;
    }
    var query = 'contact.name="' + contactName + '"';
    var email = getCommonName("contacts", query, "email");
    if (!email) {
        return false;
    }
    try {
        var sender = getContactInfo(senderContacts);
        vars["$G.mail.sender"] = [sender.email];
        vars["$G.mail.sender.name"] = sender.fullName || "";

        vars["$G.mail.receiver"] = [email];
        vars["$G.mail.receiver.name"] = getCommonName("contacts", query, "full.name");
        callRuleSet(record, ruleSetName);
        return true;
    } finally {
        cleanGlobalVariable();
    }
}

function sendEmailAction(record, ruleset_name) {
    return callRuleSet(record, ruleset_name);
}

function sendEmailPaymentRequestAction(record) {
    var receiver = getContactInfo(getPhaseReceiver(record));
    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = receiver.fullName || "";
    var currentUser = String(vars.$lo_operator["contact.name"] || vars["$lo.contact.name"] || "");
    var sender = getContactInfo(currentUser);
    vars["$G.mail.sender"] = [sender.email];
    vars["$G.mail.sender.name"] = sender.fullName || "";
    vars["$G.mail.sender.contactname"] = sender.contactName || "";
    vars["$G.mail.sender.position"] = sender.position || "";
    /////MAIL/////
    try {
        if (record["status"] != "request_edit" && record["status"] != "cancelled" && record["status"] != "approved") {
            sendEmailAction(record, RULE_SET_MAIL.S6_MAIL_01_01); // mail theo luong
        }
    } catch (emailError) {
    }
    ///////
    cleanGlobalVariable();
}

function sendEmailRequestEdit(record) {
    if (!record) return;

    var ticketId = String(record.id || record["id"] || "").trim();
    var createdBy = String(record["created.by"] || "").trim();
    var returnReason = String(record["return.reason"] || vars["$return.reason"] || "").trim();

    // 1. Xác định người nhận (Người tạo phiếu)
    var receiver = getContactInfo(createdBy);
    if (!receiver || !receiver.email) {
        return;
    }

    // 2. Xác định người gửi (Người yêu cầu chỉnh sửa)
    var currentUser = String(
            (vars.$lo_operator ? (vars.$lo_operator["contact.name"] || vars.$lo_operator["name"]) : "") ||
            vars["$lo.contact.name"] ||
            system.user.name ||
            ""
    ).trim();
    var sender = getContactInfo(currentUser);

    var senderFullName = (sender && sender.fullName) ? sender.fullName : currentUser;
    var senderEmail = (sender && sender.email) ? sender.email : "";
    var senderContactName = (sender && sender.contactName) ? sender.contactName : currentUser;
    var senderPosition = (sender && sender.position) ? sender.position : "";

    // 3. Xác định loại phiếu (object_type) và viết hoa chữ cái đầu (obj_upper_first_letter)
    var upperId = ticketId.toUpperCase();
    var isPrepayment = upperId.indexOf("TU") === 0;
    var isReserve = upperId.indexOf("DC") === 0;

    // object_type: dùng trong câu: "Phiếu {object_type}", "Phiếu đề nghị {object_type}"
    var objectType = isPrepayment ? "tạm ứng" : (isReserve ? "dự chi" : "thanh toán");
    // obj_upper_first_letter: dùng trong ô Loại phiếu, viết hoa chữ cái đầu ("Thanh toán", "Tạm ứng", "Dự chi")
    var objUpperFirstLetter = isPrepayment ? "Tạm ứng" : (isReserve ? "Dự chi" : "Thanh toán");

    // 4. Số tiền, tiền tệ, ngày tạo, đơn vị đề xuất
    var rawAmount = 0;
    if (isPrepayment) {
        rawAmount = record["amount"] != null ? record["amount"] : (record["total.amount.paid"] != null ? record["total.amount.paid"] : 0);
    } else {
        rawAmount = record["total.amount.paid"] != null ? record["total.amount.paid"] : (record["amount"] != null ? record["amount"] : 0);
    }
    var formattedAmount = rawAmount != null ? rawAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".") : "0";
    var currency = record.currency || record["currency"] || "VND";

    var rawCreatedDate = record["created.at"] || record["created.date"] || "";
    var createdDate = rawCreatedDate ? formatOnlyDate(rawCreatedDate) : formatOnlyDate(system.functions.tod());
    var requestDate = formatOnlyDate(system.functions.tod());

    var creatorUnitName = "Không xác định";
    if (receiver) {
        var lv1 = receiver.lv1Id ? getUnitInfo(receiver.lv1Id) : null;
        var lv2 = receiver.lv2Id ? getUnitInfo(receiver.lv2Id) : null;
        if (lv1 && lv2) {
            creatorUnitName = lv1 + " - " + lv2;
        } else if (lv1) {
            creatorUnitName = lv1;
        } else if (lv2) {
            creatorUnitName = lv2;
        }
    }

    var systemUrl = (lib.urlCreator && typeof lib.urlCreator.getRelativeURL === "function") ? lib.urlCreator.getRelativeURL() : "#";
    if (!systemUrl || systemUrl === "http://null" || systemUrl === "null") {
        systemUrl = "#";
    }

    // 5. Gán biến toàn cục phục vụ Mail Template binding
    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = receiver.fullName || createdBy;
    vars["$G.mail.name_receiver"] = receiver.fullName || createdBy;

    vars["$G.mail.sender"] = senderEmail ? [senderEmail] : [];
    vars["$G.mail.sender.name"] = senderFullName;
    vars["$G.mail.sender.contactname"] = senderContactName;
    vars["$G.mail.sender.position"] = senderPosition;
    vars["$G.mail.return.reason"] = returnReason;

    vars["$G.mail.ticket_id"] = ticketId;
    vars["$G.mail.object_type"] = objectType;
    vars["$G.mail.obj_upper_first_letter"] = objUpperFirstLetter;
    vars["$G.mail.amount"] = formattedAmount;
    vars["$G.mail.currency"] = currency;
    vars["$G.mail.creator_unit_name"] = creatorUnitName;
    vars["$G.mail.creator_full_name"] = receiver.fullName || createdBy;
    vars["$G.mail.created_date"] = createdDate;
    vars["$G.mail.sender_name"] = senderFullName;
    vars["$G.mail.sender_position"] = senderPosition;
    vars["$G.mail.request_date"] = requestDate;
    vars["$G.mail.system_url"] = systemUrl;

    // Gán trực tiếp tên biến không có tiền tố để tương thích mọi cơ chế parse template
    vars["$ticket_id"] = ticketId;
    vars["$object_type"] = objectType;
    vars["$obj_upper_first_letter"] = objUpperFirstLetter;
    vars["$name_receiver"] = receiver.fullName || createdBy;
    vars["$creator_full_name"] = receiver.fullName || createdBy;
    vars["$creator_unit_name"] = creatorUnitName;
    vars["$created_date"] = createdDate;
    vars["$amount"] = formattedAmount;
    vars["$currency"] = currency;
    vars["$sender_name"] = senderFullName;
    vars["$sender_position"] = senderPosition;
    vars["$request_date"] = requestDate;
    vars["$return_reason"] = returnReason;
    vars["$system_url"] = systemUrl;

    var metadata = {
        ticketId: ticketId,
        objectType: objectType,
        objUpperFirstLetter: objUpperFirstLetter,
        createdBy: createdBy,
        creatorFullName: receiver.fullName || createdBy,
        creatorUnitName: creatorUnitName,
        createdDate: createdDate,
        amount: formattedAmount,
        currency: currency,
        sender: currentUser,
        senderFullName: senderFullName,
        senderPosition: senderPosition,
        returnReason: returnReason,
        requestDate: requestDate,
        systemUrl: systemUrl
    };
    vars["$G.mail.metadata"] = JSON.stringify(metadata);

    try {
        sendEmailAction(record, RULE_SET_MAIL.S6_MAIL_01_02);
    } catch (emailError) {
    } finally {
        vars["$G.mail.return.reason"] = null;
        vars["$G.mail.metadata"] = null;
        vars["$G.mail.ticket_id"] = null;
        vars["$G.mail.object_type"] = null;
        vars["$G.mail.obj_upper_first_letter"] = null;
        vars["$G.mail.amount"] = null;
        vars["$G.mail.currency"] = null;
        vars["$G.mail.creator_unit_name"] = null;
        vars["$G.mail.creator_full_name"] = null;
        vars["$G.mail.created_date"] = null;
        vars["$G.mail.sender_name"] = null;
        vars["$G.mail.sender_position"] = null;
        vars["$G.mail.request_date"] = null;
        vars["$G.mail.system_url"] = null;
        vars["$ticket_id"] = null;
        vars["$object_type"] = null;
        vars["$obj_upper_first_letter"] = null;
        vars["$name_receiver"] = null;
        vars["$creator_full_name"] = null;
        vars["$creator_unit_name"] = null;
        vars["$created_date"] = null;
        vars["$amount"] = null;
        vars["$currency"] = null;
        vars["$sender_name"] = null;
        vars["$sender_position"] = null;
        vars["$request_date"] = null;
        vars["$return_reason"] = null;
        vars["$system_url"] = null;
        cleanGlobalVariable();
    }
}


function sendEmailCompleted(record) {
    // Ghi chú: Mail 01_03 đã được gộp vào Mail 01_05 (thông báo kết quả hạch toán)
    // Do đó không còn gửi mail riêng lẻ tại bước hoàn thành phê duyệt nữa.
    return;
}

function sendEmailCancelled(record) {
    var recordId = record["id"] || record.id;
    if (!recordId) return;

    // 1. Kiểm tra điều kiện status và return.reason
    var returnReason = record["return.reason"];
    if (record["status"] != "cancelled" || returnReason === null || returnReason === undefined) {
        return;
    }

    // 2. Xác định bảng activity dựa vào tiền tố của mã phiếu (TT, DC hoặc TU)
    var activityTable = "";
    if (recordId.indexOf("TT") === 0 || recordId.indexOf("DC") === 0) {
        activityTable = "activityHTKTpayment";
    } else if (recordId.indexOf("TU") === 0) {
        activityTable = "activityHTKTprepayment";
    }

    // Lấy thông tin người gửi chung một lần
    var currentUser = String(vars.$lo_operator["contact.name"] || vars["$lo.contact.name"] || "").trim();
    var sender = getContactInfo(currentUser);
    var createdBy = String(record["created.by"] || "").trim();
    var initialRole = String(record["initial.role"] || "").trim().toLowerCase();

    // 3. Quét toàn bộ activity của phiếu để xác định các bước/vai trò đã tham gia
    var participatedRoles = {
        "kttc_checker": false,
        "dmms_checker": false,
        "dmms_approver": false,
        "kttc_approver": false,
        "final_checker": false,
        "final_approver": false
    };

    var hasSubmittedActivity = false;
    var approvalCount = 0;

    if (activityTable) {
        var activityFile = new SCFile(activityTable, SCFILE_READONLY);
        try {
            var rc = activityFile.doSelect('number="' + recordId + '"');
            while (rc === RC_SUCCESS) {
                var actType = String(activityFile["type"] || "").trim().toLowerCase();
                var actDesc = String(activityFile["description"] || "").trim().toLowerCase();
                var op = String(activityFile["operator"] || "").trim();

                // Bỏ qua activity Thêm mới hoặc Xóa
                if (actType !== "thêm mới" && actType !== "them moi" && actType !== "tạo mới" && actType !== "tao moi" && actType !== "xóa" && actType !== "xoa") {
                    hasSubmittedActivity = true;

                    // Đối chiếu trực tiếp người thực hiện với người đang được phân công.
                    // Cách này giữ đủ người nhận khi tên activity không khớp các nhãn chuẩn bên dưới.
                    if (op && op === record["user.checker.kttc"]) participatedRoles["kttc_checker"] = true;
                    if (op && op === record["user.checker.dmms"]) participatedRoles["dmms_checker"] = true;
                    if (op && op === record["user.approver.dmms"]) participatedRoles["dmms_approver"] = true;
                    if (op && op === record["user.approver.kttc"]) participatedRoles["kttc_approver"] = true;
                    if (op && op === record["user.checker.final"]) participatedRoles["final_checker"] = true;
                    if (op && op === record["user.approver.final"]) participatedRoles["final_approver"] = true;

                    if (actType.indexOf("rà soát 1") !== -1 || actType.indexOf("ra soat 1") !== -1 || actDesc.indexOf("rà soát 1") !== -1 || actDesc.indexOf("check_dmms") !== -1) {
                        participatedRoles["dmms_checker"] = true;
                        participatedRoles["kttc_checker"] = true;
                    } else if (actType.indexOf("rà soát 2") !== -1 || actType.indexOf("ra soat 2") !== -1 || actDesc.indexOf("rà soát 2") !== -1 || actDesc.indexOf("check_final") !== -1) {
                        participatedRoles["final_checker"] = true;
                        participatedRoles["kttc_approver"] = true;
                        participatedRoles["dmms_approver"] = true;
                        participatedRoles["dmms_checker"] = true;
                        participatedRoles["kttc_checker"] = true;
                    } else if (actType.indexOf("trình phê duyệt") !== -1 || actType.indexOf("trinh phe duyet") !== -1 || actDesc.indexOf("trình phê duyệt") !== -1 || actDesc.indexOf("trinh phe duyet") !== -1) {
                        if (op && op !== createdBy) {
                            participatedRoles["kttc_checker"] = true;
                        }
                    } else if (actType.indexOf("phê duyệt") !== -1 || actType.indexOf("phe duyet") !== -1 || actDesc.indexOf("phê duyệt") !== -1 || actDesc.indexOf("phe duyet") !== -1) {
                        approvalCount++;
                        if (initialRole === "kttc") {
                            if (approvalCount >= 1) participatedRoles["kttc_approver"] = true;
                            if (approvalCount >= 2) participatedRoles["final_approver"] = true;
                        } else {
                            if (approvalCount >= 1) {
                                participatedRoles["dmms_approver"] = true;
                                participatedRoles["dmms_checker"] = true;
                                participatedRoles["kttc_checker"] = true;
                            }
                            if (approvalCount >= 2) participatedRoles["kttc_approver"] = true;
                            if (approvalCount >= 3) participatedRoles["final_approver"] = true;
                        }
                    } else if (actType.indexOf("yêu cầu chỉnh sửa") !== -1 || actType.indexOf("yeu cau chinh sua") !== -1) {
                        // Nhận diện vai trò của người trả lại
                        if (op === record["user.checker.kttc"]) {
                            participatedRoles["kttc_checker"] = true;
                        } else if (op === record["user.checker.dmms"]) {
                            participatedRoles["dmms_checker"] = true;
                            participatedRoles["kttc_checker"] = true;
                        } else if (op === record["user.approver.dmms"]) {
                            participatedRoles["dmms_approver"] = true;
                            participatedRoles["dmms_checker"] = true;
                            participatedRoles["kttc_checker"] = true;
                        } else if (op === record["user.approver.kttc"]) {
                            participatedRoles["kttc_approver"] = true;
                            participatedRoles["dmms_approver"] = true;
                            participatedRoles["dmms_checker"] = true;
                            participatedRoles["kttc_checker"] = true;
                        } else if (op === record["user.checker.final"]) {
                            participatedRoles["final_checker"] = true;
                            participatedRoles["kttc_approver"] = true;
                            participatedRoles["dmms_approver"] = true;
                            participatedRoles["dmms_checker"] = true;
                            participatedRoles["kttc_checker"] = true;
                        } else if (op === record["user.approver.final"]) {
                            participatedRoles["final_approver"] = true;
                            participatedRoles["final_checker"] = true;
                            participatedRoles["kttc_approver"] = true;
                            participatedRoles["dmms_approver"] = true;
                            participatedRoles["dmms_checker"] = true;
                            participatedRoles["kttc_checker"] = true;
                        } else {
                            // Mặc định ít nhất bước tiếp nhận đã tham gia
                            participatedRoles["kttc_checker"] = true;
                        }
                    }
                }
                rc = activityFile.getNext();
            }
        } catch (e) {
        } finally {
            if (activityFile) {
                activityFile.doClose();
            }
        }
    }

    // 4. Nếu phiếu do ĐMMS tạo đã từng được trình duyệt -> KTTC tiếp nhận luôn được tính là đã tham gia
    if (initialRole !== "kttc" && (hasSubmittedActivity || returnReason)) {
        participatedRoles["kttc_checker"] = true;
    }

    // 5. Tập hợp danh sách người nhận HIỆN TẠI (Người được phân công mới) theo các vai trò đã tham gia
    // Nếu bị tái phân công thì gửi cho người mới trên record, không gửi cho người cũ đã hết nhiệm vụ
    var uniqueReceivers = {};

    if (participatedRoles["kttc_checker"] && record["user.checker.kttc"]) {
        uniqueReceivers[record["user.checker.kttc"]] = true;
    }
    if (participatedRoles["dmms_checker"] && record["user.checker.dmms"]) {
        uniqueReceivers[record["user.checker.dmms"]] = true;
    }
    if (participatedRoles["dmms_approver"] && record["user.approver.dmms"]) {
        uniqueReceivers[record["user.approver.dmms"]] = true;
    }
    if (participatedRoles["kttc_approver"] && record["user.approver.kttc"]) {
        uniqueReceivers[record["user.approver.kttc"]] = true;
    }
    if (participatedRoles["final_checker"] && record["user.checker.final"]) {
        uniqueReceivers[record["user.checker.final"]] = true;
    }
    if (participatedRoles["final_approver"] && record["user.approver.final"]) {
        uniqueReceivers[record["user.approver.final"]] = true;
    }

    // 6. Loại trừ người tạo phiếu (created.by) và người đang thực hiện thao tác xóa (currentUser)
    if (createdBy && uniqueReceivers[createdBy]) {
        delete uniqueReceivers[createdBy];
    }
    if (currentUser && uniqueReceivers[currentUser]) {
        delete uniqueReceivers[currentUser];
    }

    // 7. Tiến hành gửi mail cho từng user duy nhất trong danh sách
    for (var contactName in uniqueReceivers) {
        if (uniqueReceivers.hasOwnProperty(contactName)) {
            var receiver = getContactInfo(contactName);
            // Kiểm tra xem receiver có email hợp lệ không
            if (receiver && receiver.email) {
                try {
                    vars["$G.mail.receiver"] = [receiver.email];
                    vars["$G.mail.receiver.name"] = receiver.fullName || "";

                    if (sender) {
                        vars["$G.mail.sender"] = [sender.email];
                        vars["$G.mail.sender.name"] = sender.fullName || "";
                        vars["$G.mail.sender.contactname"] = sender.contactName || "";
                        vars["$G.mail.sender.position"] = sender.position || "";
                    }

                    /////MAIL/////
                    sendEmailAction(record, RULE_SET_MAIL.S6_MAIL_01_04);
                } catch (emailError) {
                } finally {
                    cleanGlobalVariable();
                }
                ///////
            }
        }
    }

    cleanGlobalVariable();
}
///////////////////MAIL hach toan////////////////////////////////////

///////////////////MAIL hach toan (S6_MAIL_01_05 - Da gop 01_03, 01_05, 01_06)///////////////////

function hasOglErrorHandling(targetTicketId) {
    if (!targetTicketId) return false;
    var safeId = escapeSmQueryValue(targetTicketId);

    // Chỉ coi là OGL đã từng có lỗi và được xử lý nếu có bản ghi lịch sử thử lại của kênh AP hoặc GL.
    // Tuyệt đối KHÔNG kiểm tra bảng esdHTKTaccountingErrorHandling chung, vì khi Core lỗi thì bảng đó cũng sinh bản ghi cho Core!
    var itemFile = null;
    try {
        itemFile = new SCFile("esdHTKTaccountingErrorHandlingItem", SCFILE_READONLY);
        itemFile.setFields(["id", "type"]);
        var qI = 'payment.id="' + safeId + '" and (type="AP" or type="GL" or null(type) or type~="CORE")';
        if (itemFile.doSelect(qI) === RC_SUCCESS) {
            return true;
        }
    } catch (eI) {
    } finally {
        if (itemFile) {
            try { itemFile.doClose(); } catch (eClI) {}
        }
    }
    return false;
}

// Thong bao ket qua hach toan S6_MAIL_01_05 (Gop tu 01_03, 01_05, 01_06)
function sendEmailAccounting0105(ticketId, options) {
    if (!ticketId) return;
    options = options || {};

    var ticketRecord = null;
    var upperTicketId = String(ticketId).toUpperCase().trim();
    var isPayment = upperTicketId.startsWith("TT") || upperTicketId.startsWith("DC");
    var ticketTable = isPayment ? "esdHTKTpayment" : "esdHTKTprepayment";

    try {
        ticketRecord = new SCFile(ticketTable, SCFILE_READONLY);
        if (ticketRecord.doSelect('id="' + escapeSmQueryValue(ticketId) + '"') !== RC_SUCCESS) {
            ticketRecord.doClose();
            var fallbackTable = isPayment ? "esdHTKTprepayment" : "esdHTKTpayment";
            ticketRecord = new SCFile(fallbackTable, SCFILE_READONLY);
            if (ticketRecord.doSelect('id="' + escapeSmQueryValue(ticketId) + '"') !== RC_SUCCESS) {
                ticketRecord = null;
            }
        }
    } catch (eTicket) {
        ticketRecord = null;
    }

    var createdBy = ticketRecord ? (ticketRecord["created.by"] || "") : "";
    var userCheckerKttc = ticketRecord ? (ticketRecord["user.checker.kttc"] || "") : "";
    var initialRole = ticketRecord ? String(ticketRecord["initial.role"] || "").toLowerCase() : "";

    var objectType = upperTicketId.startsWith("TU") ? "tạm ứng" : (upperTicketId.startsWith("DC") ? "dự chi" : "thanh toán");
    var ticketTypeDisplay = upperTicketId.startsWith("TU") ? "Đề nghị tạm ứng" : (upperTicketId.startsWith("DC") ? "Đề nghị dự chi" : "Đề nghị thanh toán");

    var rawAmount = null;
    if (ticketRecord) {
        if (upperTicketId.startsWith("TU")) {
            rawAmount = ticketRecord["amount"] != null ? ticketRecord["amount"] : ticketRecord["total.amount.paid"];
        } else {
            rawAmount = ticketRecord["total.amount.paid"] != null ? ticketRecord["total.amount.paid"] : ticketRecord["amount"];
        }
    }
    var formattedAmount = formatEmailNumber(rawAmount);
    var currency = (ticketRecord && ticketRecord["currency"]) ? ticketRecord["currency"] : "VND";

    var creator = createdBy ? getContactInfo(createdBy) : null;
    var creatorFullName = (creator && creator.fullName) ? creator.fullName : createdBy;

    var creatorUnitName = "";
    var lv1 = creator && creator.lv1Id ? getUnitInfo(creator.lv1Id) : null;
    var lv2 = creator && creator.lv2Id ? getUnitInfo(creator.lv2Id) : null;
    if (lv1 && lv2) {
        creatorUnitName = lv1 + " - " + lv2;
    } else if (lv1) {
        creatorUnitName = lv1;
    } else if (lv2) {
        creatorUnitName = lv2;
    } else if (ticketRecord) {
        creatorUnitName = ticketRecord["unit.lv2.name"] || ticketRecord["unit.lv1.name"] || ticketRecord["department.name"] || ticketRecord["unit.name"] || "";
    }

    var rawCreatedAt = ticketRecord ? (ticketRecord["created.at"] || ticketRecord["created.date"]) : "";
    var createdDate = formatOnlyDate(rawCreatedAt) || formatOnlyDate(system.functions.tod());
    var completedDatetime = formatISODate(system.functions.tod());

    var systemUrl = (lib.urlCreator && typeof lib.urlCreator.getRelativeURL === "function") ? lib.urlCreator.getRelativeURL() : "#";
    if (!systemUrl || systemUrl === "http://null" || systemUrl === "null") {
        systemUrl = "https://ten-ung-dung.com/quan-ly-tai-san";
    }

    // Xử lý danh sách bút toán
    var oglEntries = options.oglEntries || [];
    var coreEntries = options.coreEntries || [];

    var oglTotal = oglEntries.length;
    var oglSuccess = 0;
    var oglFailed = 0;
    var oglInvoices = [];
    var oglErrorItems = [];

    for (var o = 0; o < oglEntries.length; o++) {
        var oe = oglEntries[o];
        if (oe.checkedTime) {
            completedDatetime = formatISODate(oe.checkedTime);
        }
        if (oe.status === "COMPLETED" || oe.status === "SUCCESS") {
            oglSuccess++;
            var invNum = oe.apCode || oe.paymentNumber;
            if (invNum && oglInvoices.indexOf(invNum) === -1) {
                oglInvoices.push(invNum);
            }
        } else if (oe.status === "ERROR" || oe.status === "FAILED") {
            oglFailed++;
            var oePayload = null;
            try { oePayload = JSON.parse(oe.data); } catch (eParse) {}
            var oeEntryType = "Standard";
            var oeInvType = oePayload && oePayload.invoiceType ? String(oePayload.invoiceType).toUpperCase() : "";
            if (oe.type === "GL") {
                oeEntryType = "GL";
            } else if (oeInvType === "PREPAYMENT" || oe.subType === "TAM_UNG" || oe.subType === "PREPAYMENT") {
                oeEntryType = "Prepayment";
            } else if (oeInvType === "STANDARD" || oe.subType === "THANH_TOAN" || oe.subType === "STANDARD") {
                oeEntryType = "Standard";
            }

            var oeDesc = (oePayload && (oePayload.description || oePayload.transactionDesc)) || "";
            if (!oeDesc && oePayload && oePayload.invoiceLineList && oePayload.invoiceLineList[0]) {
                oeDesc = oePayload.invoiceLineList[0].lineDesc || "";
            }
            if (!oeDesc && oe.batchName) {
                oeDesc = oe.batchName;
            }
            if (!oeDesc && ticketRecord) {
                oeDesc = ticketRecord["description"] || ticketRecord["name"] || "";
            }

            oglErrorItems.push({
                entryType: oeEntryType,
                content: oeDesc,
                amount: oe.amount,
                currency: oe.currency || currency,
                message: oe.message || "Lỗi hạch toán OGL"
            });
        }
    }
    var oglInvoiceNumbers = oglInvoices.join("; ");

    var coreTotal = coreEntries.length;
    var coreSuccess = 0;
    var coreFailed = 0;
    var coreRefs = [];
    var coreErrorItems = [];

    for (var c = 0; c < coreEntries.length; c++) {
        var ce = coreEntries[c];
        if (ce.checkedTime) {
            completedDatetime = formatISODate(ce.checkedTime);
        }
        if (ce.status === "COMPLETED" || ce.status === "SUCCESS") {
            coreSuccess++;
            var hRef = ce.hostResNum;
            if (!hRef && ce.data) {
                try {
                    var cd = JSON.parse(ce.data);
                    hRef = cd.data ? (cd.data.trnRefNum || cd.data.chanRefNum) : "";
                } catch (eCref) {}
            }
            if (hRef && coreRefs.indexOf(hRef) === -1) {
                coreRefs.push(hRef);
            }
        } else if (ce.status === "ERROR" || ce.status === "FAILED") {
            coreFailed++;
            var cePayload = null;
            try { cePayload = JSON.parse(ce.data); } catch (eParseC) {}
            var ceAcct = "";
            if (cePayload && cePayload.data) {
                if (cePayload.data.depAcctIdTo && cePayload.data.depAcctIdTo.acctId) {
                    ceAcct = cePayload.data.depAcctIdTo.acctId;
                } else if (cePayload.data.toAcctId) {
                    ceAcct = cePayload.data.toAcctId;
                }
            }
            var ceRef = ce.hostResNum || ce.refId || ce.requestId || "";
            coreErrorItems.push({
                beneficiaryAccount: ceAcct,
                refNum: ceRef,
                amount: ce.amount,
                currency: ce.currency || currency,
                message: ce.message || "Lỗi hạch toán Core"
            });
        }
    }
    var coreHostRefs = coreRefs.join("; ");

    // Xác định cờ hiển thị kênh
    var showOgl = options.showOgl !== false;
    var showCore = options.showCore === true;
    var channelsText = options.channelsText || (showOgl && showCore ? "kênh OGL và kênh Core" : (showCore ? "kênh Core" : "kênh OGL"));

    // [Bảng 1] nếu OGL có lỗi
    var tableErrorOgl = "";
    if (oglFailed > 0 && oglErrorItems.length > 0) {
        tableErrorOgl = '<div style="margin-top:12px;margin-bottom:16px;">' +
                '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #d9e3ea;font-size:13px;">' +
                '<thead>' +
                '<tr style="background:#F3F7FA;">' +
                '<th style="padding:8px 10px;border:1px solid #d9e3ea;text-align:center;font-weight:bold;color:#062A46;" width="5%">STT</th>' +
                '<th style="padding:8px 10px;border:1px solid #d9e3ea;text-align:left;font-weight:bold;color:#062A46;" width="20%">Loại bút toán</th>' +
                '<th style="padding:8px 10px;border:1px solid #d9e3ea;text-align:left;font-weight:bold;color:#062A46;" width="25%">Số hóa đơn</th>' +
                '<th style="padding:8px 10px;border:1px solid #d9e3ea;text-align:right;font-weight:bold;color:#062A46;" width="15%">Số tiền</th>' +
                '<th style="padding:8px 10px;border:1px solid #d9e3ea;text-align:center;font-weight:bold;color:#062A46;" width="10%">Loại tiền</th>' +
                '<th style="padding:8px 10px;border:1px solid #d9e3ea;text-align:left;font-weight:bold;color:#062A46;" width="25%">Nội dung lỗi</th>' +
                '</tr>' +
                '</thead>' +
                '<tbody>';

        for (var oi = 0; oi < oglErrorItems.length; oi++) {
            var oErr = oglErrorItems[oi];
            tableErrorOgl += '<tr>' +
                    '<td style="padding:8px 10px;border:1px solid #d9e3ea;text-align:center;">' + (oi + 1) + '</td>' +
                    '<td style="padding:8px 10px;border:1px solid #d9e3ea;">' + escapeEmailHtml(oErr.entryType) + '</td>' +
                    '<td style="padding:8px 10px;border:1px solid #d9e3ea;">' + escapeEmailHtml(oErr.content) + '</td>' +
                    '<td style="padding:8px 10px;border:1px solid #d9e3ea;text-align:right;color:#EA580C;font-weight:bold;">' + escapeEmailHtml(formatEmailNumber(oErr.amount)) + '</td>' +
                    '<td style="padding:8px 10px;border:1px solid #d9e3ea;text-align:center;">' + escapeEmailHtml(oErr.currency) + '</td>' +
                    '<td style="padding:8px 10px;border:1px solid #d9e3ea;color:#D7194A;">' + escapeEmailHtml(oErr.message) + '</td>' +
                    '</tr>';
        }
        tableErrorOgl += '</tbody></table></div>';
    }

    // [Bảng 2] nếu CORE có lỗi
    var tableErrorCore = "";
    if (coreFailed > 0 && coreErrorItems.length > 0) {
        tableErrorCore = '<div style="margin-top:12px;margin-bottom:16px;">' +
                '<table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #d9e3ea;font-size:13px;">' +
                '<thead>' +
                '<tr style="background:#F3F7FA;">' +
                '<th style="padding:8px 10px;border:1px solid #d9e3ea;text-align:center;font-weight:bold;color:#062A46;" width="5%">STT</th>' +
                '<th style="padding:8px 10px;border:1px solid #d9e3ea;text-align:left;font-weight:bold;color:#062A46;" width="25%">Tài khoản thụ hưởng</th>' +
                '<th style="padding:8px 10px;border:1px solid #d9e3ea;text-align:left;font-weight:bold;color:#062A46;" width="20%">Mã tham chiếu</th>' +
                '<th style="padding:8px 10px;border:1px solid #d9e3ea;text-align:right;font-weight:bold;color:#062A46;" width="18%">Số tiền</th>' +
                '<th style="padding:8px 10px;border:1px solid #d9e3ea;text-align:center;font-weight:bold;color:#062A46;" width="10%">Loại tiền</th>' +
                '<th style="padding:8px 10px;border:1px solid #d9e3ea;text-align:left;font-weight:bold;color:#062A46;" width="22%">Nội dung lỗi</th>' +
                '</tr>' +
                '</thead>' +
                '<tbody>';

        for (var ci = 0; ci < coreErrorItems.length; ci++) {
            var cErr = coreErrorItems[ci];
            tableErrorCore += '<tr>' +
                    '<td style="padding:8px 10px;border:1px solid #d9e3ea;text-align:center;">' + (ci + 1) + '</td>' +
                    '<td style="padding:8px 10px;border:1px solid #d9e3ea;">' + escapeEmailHtml(cErr.beneficiaryAccount) + '</td>' +
                    '<td style="padding:8px 10px;border:1px solid #d9e3ea;">' + escapeEmailHtml(cErr.refNum) + '</td>' +
                    '<td style="padding:8px 10px;border:1px solid #d9e3ea;text-align:right;color:#EA580C;font-weight:bold;">' + escapeEmailHtml(formatEmailNumber(cErr.amount)) + '</td>' +
                    '<td style="padding:8px 10px;border:1px solid #d9e3ea;text-align:center;">' + escapeEmailHtml(cErr.currency) + '</td>' +
                    '<td style="padding:8px 10px;border:1px solid #d9e3ea;color:#D7194A;">' + escapeEmailHtml(cErr.message) + '</td>' +
                    '</tr>';
        }
        tableErrorCore += '</tbody></table></div>';
    }

    // Kết quả HTML
    var resultsHtml = "";
    if (showOgl) {
        var oglInvText = oglInvoiceNumbers ? (' Số Invoice: <strong>' + escapeEmailHtml(oglInvoiceNumbers) + '</strong>') : "";
        var oglFailedStyle = oglFailed > 0 ? "color:#D7194A;font-weight:bold;" : "color:#062A46;font-weight:bold;";
        resultsHtml += '<div style="margin-bottom:18px;">' +
                '<div style="font-weight:bold;color:#062A46;margin-bottom:8px;">Tại kênh OGL</div>' +
                '<ul style="margin:0 0 10px 0;padding-left:20px;line-height:1.8;color:#062A46;">' +
                '<li>Thành công: <strong>' + oglSuccess + '/' + oglTotal + '</strong> bút toán.' + oglInvText + '</li>' +
                '<li>Thất bại/Lỗi: <strong style="' + oglFailedStyle + '">' + oglFailed + '/' + oglTotal + '</strong> bút toán.</li>' +
                '</ul>' +
                tableErrorOgl +
                '</div>';
    }

    if (showCore) {
        var coreRefText = coreHostRefs ? (' Số tham chiếu: <strong>' + escapeEmailHtml(coreHostRefs) + '</strong>') : "";
        var coreErrDetailLabel = coreFailed > 0 ? " Chi tiết lỗi:" : "";
        var coreFailedStyle = coreFailed > 0 ? "color:#D7194A;font-weight:bold;" : "color:#062A46;font-weight:bold;";
        resultsHtml += '<div style="margin-bottom:18px;">' +
                '<div style="font-weight:bold;color:#062A46;margin-bottom:8px;">Tại kênh Core</div>' +
                '<ul style="margin:0 0 10px 0;padding-left:20px;line-height:1.8;color:#062A46;">' +
                '<li>Thành công: <strong>' + coreSuccess + '/' + coreTotal + '</strong> bút toán.' + coreRefText + '</li>' +
                '<li>Thất bại/Lỗi: <strong style="' + coreFailedStyle + '">' + coreFailed + '/' + coreTotal + '</strong> bút toán.' + coreErrDetailLabel + '</li>' +
                '</ul>' +
                tableErrorCore +
                '</div>';
    }

    // Gán biến toàn cục
    vars["$G.mail.ticket_id"] = ticketId;
    vars["$G.mail.ticket_type_display"] = ticketTypeDisplay;
    vars["$G.mail.ticket_name"] = ticketRecord ? (ticketRecord["name"] || ("Phiếu đề nghị " + objectType + " " + ticketId)) : ("Phiếu đề nghị " + objectType + " " + ticketId);
    vars["$G.mail.creator_unit_name"] = creatorUnitName;
    vars["$G.mail.creator_full_name"] = creatorFullName;
    vars["$G.mail.created_date"] = createdDate;
    vars["$G.mail.amount"] = formattedAmount;
    vars["$G.mail.currency"] = currency;
    vars["$G.mail.completed_datetime"] = completedDatetime;
    vars["$G.mail.system_url"] = systemUrl;
    vars["$G.mail.accounting_channels_text"] = channelsText;
    vars["$G.mail.accounting_results_html"] = resultsHtml;

    vars["$G.mail.ogl_success_count"] = oglSuccess;
    vars["$G.mail.ogl_failed_count"] = oglFailed;
    vars["$G.mail.ogl_total_count"] = oglTotal;
    vars["$G.mail.ogl_invoice_numbers"] = oglInvoiceNumbers;
    vars["$G.mail.table_error_ogl"] = tableErrorOgl;

    vars["$G.mail.core_success_count"] = coreSuccess;
    vars["$G.mail.core_failed_count"] = coreFailed;
    vars["$G.mail.core_total_count"] = coreTotal;
    vars["$G.mail.core_host_refs"] = coreHostRefs;
    vars["$G.mail.table_error_core"] = tableErrorCore;

    // Tìm accountingRecord để gọi RuleSet (RuleSet ESD_HTKT_SENDEMAIL_S6_MAIL_01_05 có thể gắn với esdHTKTaccountingInformation hoặc esdHTKTpayment)
    var accountingRecord = options.accountingRecord || null;
    var aiLookup = null;
    if (!accountingRecord && ticketId) {
        try {
            aiLookup = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
            var safeTId = escapeSmQueryValue(ticketId);
            if (aiLookup.doSelect('prepayment.id="' + safeTId + '"') === RC_SUCCESS) {
                accountingRecord = aiLookup;
            }
        } catch (eAi) {}
    }

    var recordToSend = accountingRecord || ticketRecord || { id: ticketId };

    var executeSendAction0105 = function(ruleSet) {
        var sent = false;
        // 1. Thử gọi với accountingRecord (RuleSet S6_MAIL_01_05 trên bảng esdHTKTaccountingInformation)
        if (accountingRecord) {
            try {
                callRuleSet(accountingRecord, ruleSet);
                sent = true;
            } catch (eAcc) {}
        }
        // 2. Thử gọi với ticketRecord (nếu RuleSet được cấu hình trên esdHTKTpayment/prepayment)
        if (!sent && ticketRecord) {
            try {
                callRuleSet(ticketRecord, ruleSet);
                sent = true;
            } catch (eTick) {}
        }
        // 3. Fallback
        if (!sent && recordToSend) {
            try {
                callRuleSet(recordToSend, ruleSet);
            } catch (eRec) {}
        }
    };

    try {
        // 1. Gửi cho người tạo phiếu
        if (createdBy) {
            var receiver = getContactInfo(createdBy);
            if (receiver && receiver.email) {
                vars["$G.mail.receiver"] = [receiver.email];
                vars["$G.mail.receiver.name"] = receiver.fullName || createdBy;
                executeSendAction0105(RULE_SET_MAIL.S6_MAIL_01_05);
                vars["$G.mail.receiver"] = null;
                vars["$G.mail.receiver.name"] = null;
            }
        }

        // 2. Nếu phiếu do DMMS khởi tạo thì gửi thêm cho KTTC tiếp nhận/kiểm tra
        if (initialRole === "dmms" && userCheckerKttc && userCheckerKttc !== createdBy) {
            var kttcReceiver = getContactInfo(userCheckerKttc);
            if (kttcReceiver && kttcReceiver.email) {
                vars["$G.mail.receiver"] = [kttcReceiver.email];
                vars["$G.mail.receiver.name"] = kttcReceiver.fullName || userCheckerKttc;
                executeSendAction0105(RULE_SET_MAIL.S6_MAIL_01_05);
                vars["$G.mail.receiver"] = null;
                vars["$G.mail.receiver.name"] = null;
            }
        }
    } finally {
        if (ticketRecord) {
            try { ticketRecord.doClose(); } catch (eClTicket) {}
        }
        if (aiLookup) {
            try { aiLookup.doClose(); } catch (eClAi) {}
        }
        vars["$G.mail.ticket_id"] = null;
        vars["$G.mail.ticket_type_display"] = null;
        vars["$G.mail.ticket_name"] = null;
        vars["$G.mail.creator_unit_name"] = null;
        vars["$G.mail.creator_full_name"] = null;
        vars["$G.mail.created_date"] = null;
        vars["$G.mail.amount"] = null;
        vars["$G.mail.currency"] = null;
        vars["$G.mail.completed_datetime"] = null;
        vars["$G.mail.system_url"] = null;
        vars["$G.mail.accounting_channels_text"] = null;
        vars["$G.mail.accounting_results_html"] = null;
        vars["$G.mail.ogl_success_count"] = null;
        vars["$G.mail.ogl_failed_count"] = null;
        vars["$G.mail.ogl_total_count"] = null;
        vars["$G.mail.ogl_invoice_numbers"] = null;
        vars["$G.mail.table_error_ogl"] = null;
        vars["$G.mail.core_success_count"] = null;
        vars["$G.mail.core_failed_count"] = null;
        vars["$G.mail.core_total_count"] = null;
        vars["$G.mail.core_host_refs"] = null;
        vars["$G.mail.table_error_core"] = null;
        cleanGlobalVariable();
    }
}

function processAccountingNotification0105(targetTicketId, oldRec, newRec) {
    var oldStatus = String(oldRec ? (oldRec['status'] || "") : "").toUpperCase().trim();
    var newStatus = String(newRec ? (newRec['status'] || "") : "").toUpperCase().trim();
    var currentType = String(newRec ? (newRec['type'] || "") : "").toUpperCase().trim();
    var isCurrentCore = (currentType === "CORE");
    var currentRequestId = String(newRec ? (newRec['request.id'] || "") : "").trim();
    var currentTransactionId = String(newRec ? (newRec['transaction.id'] || "") : "").trim();

    // 1. Quét toàn bộ danh sách bút toán hạch toán của phiếu
    var aiFile = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
    var oglEntries = [];
    var coreEntries = [];

    try {
        var safeId = escapeSmQueryValue(targetTicketId);
        var q = 'prepayment.id="' + safeId + '"';
        var rc = aiFile.doSelect(q);

        while (rc === RC_SUCCESS) {
            var rowReqId = String(aiFile['request.id'] || "").trim();
            var rowTransId = String(aiFile['transaction.id'] || "").trim();
            var isCurrent = (currentRequestId && rowReqId && currentRequestId === rowReqId) ||
                    (currentTransactionId && rowTransId && currentTransactionId === rowTransId);
            var rowStatus = isCurrent ? newStatus : String(aiFile['status'] || "").toUpperCase().trim();
            var rowType = String(aiFile['type'] || "").toUpperCase().trim();

            var entry = {
                requestId: rowReqId,
                transactionId: rowTransId,
                type: rowType,
                subType: String(aiFile['sub.type'] || "").trim(),
                status: rowStatus,
                amount: aiFile['amount'],
                currency: aiFile['currency'],
                apCode: isCurrent ? (newRec['ap.code'] || aiFile['ap.code']) : aiFile['ap.code'],
                batchName: isCurrent ? (newRec['batch.name'] || aiFile['batch.name']) : aiFile['batch.name'],
                paymentNumber: isCurrent ? (newRec['payment.number'] || aiFile['payment.number']) : aiFile['payment.number'],
                hostResNum: isCurrent ? (newRec['host.res.num'] || aiFile['host.res.num']) : aiFile['host.res.num'],
                refId: isCurrent ? (newRec['ref.id'] || aiFile['ref.id']) : aiFile['ref.id'],
                message: isCurrent ? (newRec['message'] || aiFile['message']) : aiFile['message'],
                response: isCurrent ? (newRec['response'] || aiFile['response']) : aiFile['response'],
                data: isCurrent ? (newRec['data'] || aiFile['data']) : aiFile['data'],
                checkedTime: isCurrent ? (newRec['checked.time'] || aiFile['checked.time']) : aiFile['checked.time']
            };

            if (rowType === "CORE") {
                coreEntries.push(entry);
            } else {
                oglEntries.push(entry);
            }
            rc = aiFile.getNext();
        }
    } catch (eQuery) {
        return;
    } finally {
        if (aiFile) {
            try { aiFile.doClose(); } catch (eCl) {}
        }
    }

    // 2. Thống kê trạng thái OGL và CORE
    var oglTotal = oglEntries.length;
    var oglSuccess = 0;
    var oglFailed = 0;
    var oglPending = 0;
    var otherOglFailed = 0;

    for (var i = 0; i < oglEntries.length; i++) {
        var st = oglEntries[i].status;
        var isCurOgl = (currentRequestId && oglEntries[i].requestId === currentRequestId);
        if (st === "COMPLETED" || st === "SUCCESS") {
            oglSuccess++;
        } else if (st === "ERROR" || st === "FAILED") {
            oglFailed++;
            if (!isCurOgl) {
                otherOglFailed++;
            }
        } else if (isOglWaitingStatus(st)) {
            oglPending++;
        }
    }

    var coreTotal = coreEntries.length;
    var coreSuccess = 0;
    var coreFailed = 0;
    var corePending = 0;

    for (var j = 0; j < coreEntries.length; j++) {
        var cst = coreEntries[j].status;
        if (cst === "COMPLETED" || cst === "SUCCESS") {
            coreSuccess++;
        } else if (cst === "ERROR" || cst === "FAILED") {
            coreFailed++;
        } else if (isOglWaitingStatus(cst)) {
            corePending++;
        }
    }

    var hadOglError = hasOglErrorHandling(targetTicketId);

    // =========================================================================
    // 3. LOGIC GỬI MAIL 01_05:
    // - Nếu OGL lỗi: gửi mail luôn (ngay lần đầu tiên phát sinh lỗi OGL)
    // - Nếu OGL không lỗi: chờ CORE chạy xong mới thực hiện gửi mail
    // - Case OGL lỗi, CORE chỉ chạy khi xử lý lỗi xong => lúc này gửi mail nhưng chỉ thông báo về kênh Core
    // =========================================================================

    // TH1: OGL có bút toán phát sinh lỗi (ví dụ AP lỗi hoặc GL lỗi)
    if (oglFailed > 0) {
        // Đợi tất cả bút toán OGL trong queue (cả AP và GL) chạy xong để có kết quả đầy đủ
        if (oglPending > 0) {
            return; // Tiếp tục đợi bút toán OGL còn lại trong queue hoàn tất
        }

        // Toàn bộ OGL đã hoàn tất và có lỗi (oglPending === 0 && oglFailed > 0)
        // Chỉ gửi đúng 1 lần khi một bút toán OGL chuyển sang kết quả từ trạng thái chờ
        if (!isCurrentCore && (newStatus === "ERROR" || newStatus === "COMPLETED") && isOglWaitingStatus(oldStatus)) {
            sendEmailAccounting0105(targetTicketId, {
                oglEntries: oglEntries,
                coreEntries: coreEntries,
                showOgl: true,
                showCore: false,
                channelsText: "kênh OGL",
                accountingRecord: newRec
            });
        }
        return;
    }

    // TH2: OGL không có lỗi (oglFailed === 0)
    if (oglFailed === 0) {
        // Nếu OGL vẫn còn bút toán đang chờ xử lý -> chưa làm gì, tiếp tục đợi
        if (oglPending > 0) {
            return;
        }

        // OGL đã hoàn thành toàn bộ (oglPending === 0 && oglFailed === 0)
        // Kiểm tra phiếu có bút toán CORE hay không:
        if (coreTotal > 0) {
            // Có CORE -> Chờ CORE chạy xong mới thực hiện gửi mail!
            if (corePending > 0) {
                return; // Tiếp tục chờ CORE chạy xong
            }

            // CORE đã hoàn tất toàn bộ các bút toán!
            // Kích hoạt gửi mail khi bản ghi hiện tại là bản ghi CORE vừa hoàn thành
            if (isCurrentCore && (newStatus === "COMPLETED" || newStatus === "ERROR") && isOglWaitingStatus(oldStatus)) {
                if (hadOglError) {
                    // Case OGL lỗi, CORE chỉ chạy khi xử lý lỗi xong => lúc này gửi mail nhưng chỉ thông báo về kênh Core
                    sendEmailAccounting0105(targetTicketId, {
                        oglEntries: oglEntries,
                        coreEntries: coreEntries,
                        showOgl: false,
                        showCore: true,
                        channelsText: "kênh Core",
                        accountingRecord: newRec
                    });
                } else {
                    // Luồng chuẩn không có lỗi: thông báo cả 2 kênh OGL và Core
                    sendEmailAccounting0105(targetTicketId, {
                        oglEntries: oglEntries,
                        coreEntries: coreEntries,
                        showOgl: true,
                        showCore: true,
                        channelsText: "kênh OGL và kênh Core",
                        accountingRecord: newRec
                    });
                }
            }
        } else {
            // Phiếu không có bút toán CORE (chỉ hạch toán OGL):
            // Gửi mail khi bút toán OGL cuối cùng hoàn tất thành công
            if (!isCurrentCore && newStatus === "COMPLETED" && isOglWaitingStatus(oldStatus)) {
                sendEmailAccounting0105(targetTicketId, {
                    oglEntries: oglEntries,
                    coreEntries: [],
                    showOgl: true,
                    showCore: false,
                    channelsText: "kênh OGL",
                    accountingRecord: newRec
                });
            }
        }
    }
}




//Loi hach toan da duoc xu ly S6_MAIL_02_01
function sendAccountingErrorResolvedEmail(oldAccountingRecord, accountingRecord, processer) { // record la ban ghi esdHTKTaccountingInformation
    if (!accountingRecord) {
        return;
    }

    var processerInfo = getContactInfo(processer);
    var processerFullName = processerInfo ? processerInfo.fullName : String(processer || "");
    //Step0: lay phieu
    var ticketRecord = null;
    oldAccountingRecord = oldAccountingRecord || {};
    var metadata = {
        oldResponse: oldAccountingRecord['oldResponse'] || oldAccountingRecord['response'] || "",
        oldMessage: oldAccountingRecord['oldMessage'] || oldAccountingRecord['message'] || "",
        oldCheckedTime: oldAccountingRecord['oldCheckedTime'] || oldAccountingRecord['checked.time'] || "",
        processTime: accountingRecord['checked.time']
    };
    vars["$G.mail.metadata"] = JSON.stringify(metadata);
    var ticket_id = accountingRecord["prepayment.id"] || accountingRecord["payment.id"];
    if (ticket_id && (ticket_id.startsWith("TT") || ticket_id.startsWith("DC"))) {
        ticketRecord = new SCFile("esdHTKTpayment", SCFILE_READONLY);
    } else if (ticket_id && ticket_id.startsWith("TU")) {
        ticketRecord = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
    }
    var createdBy = null;
    var userCheckerKttc = null;
    var initialRole = null;
    try {
        var rc = ticketRecord ? ticketRecord.doSelect('id="' + escapeSmQueryValue(ticket_id) + '"') : RC_ERROR;
        if (rc == RC_SUCCESS) {
            createdBy = ticketRecord["created.by"];
            userCheckerKttc = ticketRecord["user.checker.kttc"];
            initialRole = ticketRecord["initial.role"];
        }
    } finally {
        if (ticketRecord) {
            ticketRecord.doClose();
        }
    }

    // Dữ liệu trên phiếu là nguồn chính; bản ghi hạch toán là nguồn dự phòng.
    createdBy = createdBy || accountingRecord["created.by"];
    userCheckerKttc = userCheckerKttc || accountingRecord["user.checker.kttc"];
    initialRole = String(initialRole || accountingRecord["initial.role"] || "").toLowerCase();

    var receivers = {};
    if (createdBy) receivers[String(createdBy)] = true;
    if (initialRole === "dmms" && userCheckerKttc) receivers[String(userCheckerKttc)] = true;

    try {
        vars["$G.mail.sender.name"] = processerFullName || "";
        for (var contactName in receivers) {
            if (!receivers.hasOwnProperty(contactName)) continue;
            var receiver = getContactInfo(contactName);
            if (!receiver || !receiver.email) continue;

            vars["$G.mail.receiver"] = [receiver.email];
            vars["$G.mail.receiver.name"] = receiver.fullName || contactName;
            try {
                sendEmailAction(accountingRecord, RULE_SET_MAIL.S6_MAIL_02_01);
            } catch (emailError) {
            }
            vars["$G.mail.receiver"] = null;
            vars["$G.mail.receiver.name"] = null;
        }
    } finally {
        vars["$G.mail.receiver"] = null;
        vars["$G.mail.receiver.name"] = null;
        vars["$G.mail.sender"] = null;
        vars["$G.mail.sender.name"] = null;
        vars["$G.mail.metadata"] = null;
    }
}

// S6_MAIL_02_02: Yeu cau duyet ket qua xu ly loi hach toan
function sendAccountingApprovalRequestEmail(accountingRecord, approverContactName, declarerFullName, metadataObj) {
    var ticketId = (accountingRecord && (accountingRecord["prepayment.id"] || accountingRecord["request.id"])) || "";

    if (!accountingRecord) {
        return;
    }

    var receiver = getContactInfo(approverContactName);
    if (!receiver || !receiver.email) {
        return;
    }

    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = receiver.fullName || approverContactName;
    vars["$G.mail.sender.name"] = declarerFullName || "";
    if (metadataObj) {
        vars["$G.mail.metadata"] = JSON.stringify(metadataObj);
    }

    try {
        sendEmailAction(accountingRecord, RULE_SET_MAIL.S6_MAIL_02_02);
    } catch (emailError) {
    } finally {
        vars["$G.mail.receiver"] = null;
        vars["$G.mail.receiver.name"] = null;
        vars["$G.mail.sender.name"] = null;
        vars["$G.mail.metadata"] = null;
    }
}

// S6_MAIL_02_03: Ket qua xu ly loi hach toan bi tu choi
function sendAccountingRejectedEmail(accountingRecord, declarerContactName, leaderFullName, metadataObj) {
    // Ho tro ca truong hop goi 5 tham so cu: (accountingRecord, declarerContactName, rejectReason, leaderFullName, metadataObj)
    if (arguments.length >= 5) {
        leaderFullName = arguments[3];
        metadataObj = arguments[4];
    }

    var ticketId = (accountingRecord && (accountingRecord["prepayment.id"] || accountingRecord["request.id"])) || "";

    if (!accountingRecord) {
        return;
    }

    var targetDeclarer = String(declarerContactName || "").trim();
    var receiver = getContactInfo(targetDeclarer);

    // Fallback 1: Nếu chưa tìm được người nhận qua declarerContactName, tìm từ phiếu cha
    if ((!receiver || !receiver.email) && ticketId) {
        var parentTicket = null;
        try {
            var tbl = ticketId.toUpperCase().indexOf("TT") === 0 ? "esdHTKTpayment" : "esdHTKTprepayment";
            parentTicket = new SCFile(tbl, SCFILE_READONLY);
            if (parentTicket.doSelect('id="' + escapeSmQueryValue(ticketId) + '"') === RC_SUCCESS) {
                var fallbackContact = String(parentTicket["user.checker.kttc"] || parentTicket["created.by"] || "").trim();
                if (fallbackContact) {
                    receiver = getContactInfo(fallbackContact);
                    if (receiver && receiver.email) {
                        targetDeclarer = fallbackContact;
                    }
                }
            }
        } catch (eTicketFallback) {}
        finally {
            if (parentTicket) parentTicket.doClose();
        }
    }

    if (!receiver || !receiver.email) {
        return;
    }

    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = receiver.fullName || targetDeclarer;
    vars["$G.mail.sender.name"] = leaderFullName || "Lãnh đạo phòng KTTC";

    if (!metadataObj) {
        var recType = String(accountingRecord["type"] || "").toUpperCase();
        var declareResultStr = "";
        if (recType === "CORE") {
            var hRes = String(accountingRecord["host.res.num"] || accountingRecord["transaction.id"] || "").trim();
            declareResultStr = hRes ? ("Mã GD: " + hRes) : "";
        } else {
            var pParts = [];
            if (accountingRecord["batch.name"]) pParts.push("Batch: " + accountingRecord["batch.name"]);
            if (accountingRecord["ap.code"]) pParts.push("Số Invoice: " + accountingRecord["ap.code"]);
            if (accountingRecord["payment.number"]) pParts.push("Số Payment: " + accountingRecord["payment.number"]);
            declareResultStr = pParts.join(" | ");
        }
        if (accountingRecord["note"]) {
            declareResultStr += (declareResultStr ? " (Ghi chú: " : "Ghi chú: ") + accountingRecord["note"] + (declareResultStr ? ")" : "");
        }

        metadataObj = {
            oldCheckedTime: accountingRecord["checked.time"] || "",
            oldMessage: accountingRecord["message"] || "",
            oldResponse: accountingRecord["response"] || "",
            declareResult: declareResultStr
        };
    }

    vars["$G.mail.metadata"] = JSON.stringify(metadataObj);

    try {
        sendEmailAction(accountingRecord, RULE_SET_MAIL.S6_MAIL_02_03);
    } catch (emailError) {
    } finally {
        vars["$G.mail.receiver"] = null;
        vars["$G.mail.receiver.name"] = null;
        vars["$G.mail.sender.name"] = null;
        vars["$G.mail.metadata"] = null;
    }
}

/**
 * Kiem tra xem mot username co phai la tai khoan he thong / tien trinh nen hay khong
 */
function isSystemUser(userName) {
    if (!userName) return true;
    var u = String(userName).trim().toLowerCase();
    if (!u) return true;
    if (u === "system" || u === "falcon" || u === "falconuser" ||
        u === "background" || u === "intadmin" || u === "sysadmin" ||
        u === "csep" || u === "csep-admin" || u === "csep_admin" ||
        u === "admin" || u === "administrator" || u === "smadmin" ||
        u === "email" || u === "mailman" || u === "sa" || u === "root" ||
        u === "he thong" || u === "hệ thống") {
        return true;
    }
    if (u.indexOf("system") !== -1 || u.indexOf("falcon") !== -1 ||
        u.indexOf("background") !== -1 || u.indexOf("csep") !== -1 ||
        u.indexOf("admin") !== -1 ||
        u.indexOf("hệ thống") !== -1 || u.indexOf("he thong") !== -1) {
        return true;
    }
    return false;
}

/**
 * Quet lich su xu ly loi hach toan / lich su thu lai cua phieu de lay chinh xac nguoi da sua / thu lai giao dich
 * (Tranh truong hop bi lay thanh SYSTEM/Falcon khi chay qua tien trinh nen / tich hop Kenh).
 */
function getAccountingErrorModifierFromHistory(ticketId, accountingRecord) {
    var safeTicketId = String(ticketId || (accountingRecord ? (accountingRecord["prepayment.id"] || accountingRecord["payment.id"]) : "") || "").trim();
    var safeRequestId = String((accountingRecord ? accountingRecord["request.id"] : "") || "").trim();
    if (!safeTicketId && !safeRequestId) {
        return "";
    }

    var candidateUser = "";

    // 1. Quet bang activityHTKTaccountingErrorHandling (lich su man hinh Xu ly loi hach toan)
    var actRec = null;
    try {
        actRec = new SCFile("activityHTKTaccountingErrorHandling", SCFILE_READONLY);
        actRec.setOrderBy(["datestamp"], [SCFILE_DSC]);

        var queryParts = [];
        if (safeTicketId) {
            queryParts.push('number="' + escapeSmQueryValue(safeTicketId) + '"');
            queryParts.push('thenumber="' + escapeSmQueryValue(safeTicketId) + '"');
        }
        if (safeRequestId && safeRequestId !== safeTicketId) {
            queryParts.push('number="' + escapeSmQueryValue(safeRequestId) + '"');
            queryParts.push('thenumber="' + escapeSmQueryValue(safeRequestId) + '"');
        }

        // Tra cuu them handling.id neu co ban ghi trong esdHTKTaccountingErrorHandling
        var handlingRec = null;
        try {
            handlingRec = new SCFile("esdHTKTaccountingErrorHandling", SCFILE_READONLY);
            handlingRec.setFields(["id"]);
            var hRc = handlingRec.doSelect('request.id="' + escapeSmQueryValue(safeTicketId) + '" or payment.id="' + escapeSmQueryValue(safeTicketId) + '" or prepayment.id="' + escapeSmQueryValue(safeTicketId) + '"');
            if (hRc === RC_SUCCESS) {
                var handlingId = String(handlingRec["id"] || "").trim();
                if (handlingId && handlingId !== safeTicketId) {
                    queryParts.push('number="' + escapeSmQueryValue(handlingId) + '"');
                    queryParts.push('thenumber="' + escapeSmQueryValue(handlingId) + '"');
                }
            }
        } catch (eH) {
        } finally {
            if (handlingRec) {
                try { handlingRec.doClose(); } catch (eClH) {}
            }
        }

        var actQuery = "(" + queryParts.join(" or ") + ")";
        if (actRec.doSelect(actQuery) === RC_SUCCESS) {
            do {
                var aType = String(actRec["type"] || "").trim();
                var aDesc = String(actRec["description"] || "");
                var aOp = String(actRec["operator"] || actRec["sysmoduser"] || "").trim();

                if (aOp && !isSystemUser(aOp)) {
                    // Uu tien cao nhat: Thao tac "Thu lai"
                    if (aType === "Thử lại" || aDesc.indexOf("Thử lại") !== -1 || aDesc.indexOf("thu lai") !== -1) {
                        candidateUser = aOp;
                        break;
                    }
                    // Uu tien nhi: Thao tac "Khai bao ket qua" hoac "Sua"
                    if (aType === "Khai báo kết quả" || aType.indexOf("Khai báo") !== -1 || aType.indexOf("Sửa") !== -1) {
                        if (!candidateUser) candidateUser = aOp;
                    }
                    // Ghi nhan thao tac gan nhat cua nguoi dung thuc
                    if (!candidateUser) {
                        candidateUser = aOp;
                    }
                }
            } while (actRec.getNext() === RC_SUCCESS);
        }
    } catch (eAct) {
    } finally {
        if (actRec) {
            try { actRec.doClose(); } catch (eClAct) {}
        }
    }

    if (candidateUser && !isSystemUser(candidateUser)) {
        return candidateUser;
    }

    // 2. Quet bang Activity cua phieu goc (activityHTKTpayment hoac activityHTKTprepayment)
    var parentActivityTable = "";
    var upperTicket = safeTicketId.toUpperCase();
    if (upperTicket.indexOf("TT") === 0 || upperTicket.indexOf("DC") === 0) {
        parentActivityTable = "activityHTKTpayment";
    } else if (upperTicket.indexOf("TU") === 0) {
        parentActivityTable = "activityHTKTprepayment";
    }

    if (parentActivityTable && safeTicketId) {
        var parentAct = null;
        try {
            parentAct = new SCFile(parentActivityTable, SCFILE_READONLY);
            parentAct.setOrderBy(["datestamp"], [SCFILE_DSC]);
            var pQuery = 'number="' + escapeSmQueryValue(safeTicketId) + '" or thenumber="' + escapeSmQueryValue(safeTicketId) + '"';
            if (parentAct.doSelect(pQuery) === RC_SUCCESS) {
                do {
                    var pType = String(parentAct["type"] || "").trim();
                    var pDesc = String(parentAct["description"] || "");
                    var pOp = String(parentAct["operator"] || parentAct["sysmoduser"] || "").trim();

                    if (pOp && !isSystemUser(pOp)) {
                        if (pType === "Thử lại" || pDesc.indexOf("Thử lại") !== -1) {
                            candidateUser = pOp;
                            break;
                        }
                        if (pType === "Khai báo kết quả" || pType.indexOf("Khai báo") !== -1) {
                            if (!candidateUser) candidateUser = pOp;
                        }
                    }
                } while (parentAct.getNext() === RC_SUCCESS);
            }
        } catch (ePAct) {
        } finally {
            if (parentAct) {
                try { parentAct.doClose(); } catch (eClPAct) {}
            }
        }
    }

    if (candidateUser && !isSystemUser(candidateUser)) {
        return candidateUser;
    }

    // 3. Quet bang esdHTKTaccountingErrorHandlingItem (lich su thu lai cua tung but toan)
    if (safeTicketId || safeRequestId) {
        var itemRec = null;
        try {
            itemRec = new SCFile("esdHTKTaccountingErrorHandlingItem", SCFILE_READONLY);
            itemRec.setOrderBy(["retry.count"], [SCFILE_DSC]);
            var itemQ = [];
            if (safeTicketId) itemQ.push('payment.id="' + escapeSmQueryValue(safeTicketId) + '"');
            if (safeRequestId) itemQ.push('request.id="' + escapeSmQueryValue(safeRequestId) + '"');
            if (itemRec.doSelect(itemQ.join(" or ")) === RC_SUCCESS) {
                do {
                    var itemUser = String(itemRec["sysmoduser"] || itemRec["operator"] || itemRec["created.by"] || "").trim();
                    if (itemUser && !isSystemUser(itemUser)) {
                        candidateUser = itemUser;
                        break;
                    }
                } while (itemRec.getNext() === RC_SUCCESS);
            }
        } catch (eItem) {
        } finally {
            if (itemRec) {
                try { itemRec.doClose(); } catch (eClItem) {}
            }
        }
    }

    if (candidateUser && !isSystemUser(candidateUser)) {
        return candidateUser;
    }

    // 4. Quet bang esdHTKTaccountingErrorHandling (can bo phu trach / phe duyet ket qua xu ly loi)
    if (safeTicketId) {
        var errHandling = null;
        try {
            errHandling = new SCFile("esdHTKTaccountingErrorHandling", SCFILE_READONLY);
            var errQ = 'request.id="' + escapeSmQueryValue(safeTicketId) + '" or payment.id="' + escapeSmQueryValue(safeTicketId) + '"';
            if (errHandling.doSelect(errQ) === RC_SUCCESS) {
                var hUser = String(errHandling["user.approver.kttc"] || errHandling["sysmoduser"] || errHandling["updated.by"] || "").trim();
                if (hUser && !isSystemUser(hUser)) {
                    candidateUser = hUser;
                }
            }
        } catch (eErr) {
        } finally {
            if (errHandling) {
                try { errHandling.doClose(); } catch (eClErr) {}
            }
        }
    }

    // 5. Fallback tra cuu truc tiep tu phieu goc (Can bo KTTC tham dinh / Nguoi tao KTTC)
    if (safeTicketId && (!candidateUser || isSystemUser(candidateUser))) {
        var ticketFile = null;
        try {
            var tblName = (upperTicket.indexOf("TT") === 0 || upperTicket.indexOf("DC") === 0) ? "esdHTKTpayment" : "esdHTKTprepayment";
            ticketFile = new SCFile(tblName, SCFILE_READONLY);
            if (ticketFile.doSelect('id="' + escapeSmQueryValue(safeTicketId) + '"') === RC_SUCCESS) {
                var iRole = String(ticketFile["initial.role"] || "").trim().toLowerCase();
                var uChecker = String(ticketFile["user.checker.kttc"] || "").trim();
                var uCreator = String(ticketFile["created.by"] || "").trim();
                if (iRole === "kttc") {
                    if (uCreator && !isSystemUser(uCreator)) candidateUser = uCreator;
                    else if (uChecker && !isSystemUser(uChecker)) candidateUser = uChecker;
                } else {
                    if (uChecker && !isSystemUser(uChecker)) candidateUser = uChecker;
                    else if (uCreator && !isSystemUser(uCreator)) candidateUser = uCreator;
                }
            }
        } catch (eTicketFile) {
        } finally {
            if (ticketFile) {
                try { ticketFile.doClose(); } catch (eClTf) {}
            }
        }
    }

    return (!isSystemUser(candidateUser)) ? candidateUser : "";
}

// S6_MAIL_02_04: Xu ly loi hach toan that bai tai Kenh
function sendAccountingErrorFailedEmail(accountingRecord, receiverContactName) {
    if (!accountingRecord) {
        return;
    }

    var ticket_id = String(accountingRecord["prepayment.id"] || accountingRecord["payment.id"] || "").trim();
    var ticketRecord = null;
    if (ticket_id.startsWith("TT") || ticket_id.startsWith("DC")) {
        ticketRecord = new SCFile("esdHTKTpayment", SCFILE_READONLY);
    } else if (ticket_id.startsWith("TU")) {
        ticketRecord = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
    }

    var userCheckerKttc = (!isSystemUser(receiverContactName)) ? receiverContactName : null;
    var createdBy = null;
    var initialRole = null;

    // Uu tien 1: Quet lich su xu ly loi / thu lai de lay dung nguoi sua (tranh SYSTEM khi but toan thu lai loi)
    if (!userCheckerKttc) {
        var modifierFromHistory = getAccountingErrorModifierFromHistory(ticket_id, accountingRecord);
        if (modifierFromHistory && !isSystemUser(modifierFromHistory)) {
            userCheckerKttc = modifierFromHistory;
        }
    }

    // Uu tien 2: Tra cuu thong tin tu phieu goc
    try {
        if (ticketRecord && ticket_id) {
            var rc = ticketRecord.doSelect('id="' + escapeSmQueryValue(ticket_id) + '"');
            if (rc == RC_SUCCESS) {
                createdBy = ticketRecord["created.by"];
                initialRole = ticketRecord["initial.role"];
                if (!userCheckerKttc) {
                    if (initialRole == "kttc" && !isSystemUser(createdBy)) {
                        userCheckerKttc = createdBy;
                    } else if (!isSystemUser(ticketRecord["user.checker.kttc"])) {
                        userCheckerKttc = ticketRecord["user.checker.kttc"];
                    } else if (!isSystemUser(createdBy)) {
                        userCheckerKttc = createdBy;
                    }
                }
            }
        }
    } catch (eTicket) {
    } finally {
        if (ticketRecord) {
            try { ticketRecord.doClose(); } catch (eCl) {}
        }
    }

    // Uu tien 3: Fallback tu ban ghi hach toan
    if (!userCheckerKttc || isSystemUser(userCheckerKttc)) {
        if (!isSystemUser(accountingRecord["user.checker.kttc"])) {
            userCheckerKttc = accountingRecord["user.checker.kttc"];
        } else if (!isSystemUser(createdBy)) {
            userCheckerKttc = createdBy;
        } else if (!isSystemUser(accountingRecord["created.by"])) {
            userCheckerKttc = accountingRecord["created.by"];
        }
    }

    if (!userCheckerKttc || isSystemUser(userCheckerKttc)) {
        return;
    }

    var receiver = getContactInfo(userCheckerKttc);
    if (!receiver || !receiver.email) {
        return;
    }

    try {
        vars["$G.mail.receiver"] = [receiver.email];
        vars["$G.mail.receiver.name"] = receiver.fullName || userCheckerKttc;
        sendEmailAction(accountingRecord, RULE_SET_MAIL.S6_MAIL_02_04);
    } catch (emailError) {
    } finally {
        vars["$G.mail.receiver"] = null;
        vars["$G.mail.receiver.name"] = null;
    }
}


//Kiem tra hoa don S6_MAIL_03_01
function sendEmailInvoiceCheckResult(invoiceRecord) { // record la ban ghi esdHTKTaccountingInformation
    var receiver = getContactInfo(invoiceRecord["created.by"]);
    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = receiver.fullName || "";
    /////MAIL/////
    try {
        sendEmailAction(invoiceRecord, RULE_SET_MAIL.S6_MAIL_03_01);
    } catch (emailError) {
    }
}

// =============================================================================
// S6-SLA-01 (ESD_HTKT_MAIL_04_01): CẢNH BÁO TIẾN ĐỘ SLA (ĐÃ VƯỢT QUÁ 90%)
// Áp dụng dùng chung cho cả Thanh toán (TT), Tạm ứng (TU) và Dự chi (DC)
// Ghi chú: Nhóm mail 04_01 - 04_03 đã được gộp thành 1 loại mail duy nhất theo template mới.
// =============================================================================

var SLA_PHASE_DISPLAY_MAP = {
    "initial_dmms": "Khởi tạo ĐMMS",
    "initial_kttc": "KTTC tiếp nhận",
    "check_dmms": "Rà soát ĐMMS",
    "approval_dmms": "Phê duyệt ĐMMS",
    "approval_kttc": "Phê duyệt KTTC",
    "check_final": "Rà soát KTTC",
    "approval_final": "Cấp có thẩm quyền",
    "dmms_initiated": "Chờ KTTC xử lý",
    "kttc_checked": "Chờ phê duyệt",
    "dmms_checked": "Chờ phê duyệt",
    "dmms_approved": "Chờ phê duyệt",
    "kttc_approved": "Chờ phê duyệt",
    "checked": "Chờ phê duyệt",
    "approved": "Đã phê duyệt",
    "accounted": "Đã hạch toán"
};

function getSlaResponsibleContact(record) {
    if (!record) return "";
    var phase = record["current.phase"] || "";
    switch (phase) {
        case "initial_dmms":
            return record["created.by"] || "";
        case "initial_kttc":
            return record["user.checker.kttc"] || "";
        case "check_dmms":
            return record["user.checker.dmms"] || "";
        case "approval_dmms":
            return record["user.approver.dmms"] || "";
        case "approval_kttc":
            return record["user.approver.kttc"] || "";
        case "check_final":
            return record["user.checker.final"] || "";
        case "approval_final":
            return record["user.approver.final"] || "";
        default:
            return record["user.approver.kttc"] || record["assignee.name"] || record["created.by"] || "";
    }
}

function getSlaPhaseDisplayName(phaseCode) {
    if (!phaseCode) return "Phê duyệt KTTC";
    return SLA_PHASE_DISPLAY_MAP[phaseCode] || phaseCode;
}

/**
 * Hàm điều phối gửi email cảnh báo SLA (S6-SLA-01 - Đã vượt quá 90%).
 * @param {SCFile|string} ticketRecordOrId - Bản ghi phiếu hoặc mã phiếu (TT, TU, DC)
 * @param {string} [slaRuleType] - Loại cảnh báo hoặc RuleSet name (mặc định S6_MAIL_04_01)
 * @param {string} [customContactName] - Mã contact cán bộ chịu SLA chỉ định (nếu bỏ trống sẽ tự động lấy theo phase)
 * @param {Date|string} [customExpireTime] - Thời gian hết hạn SLA chỉ định (nếu bỏ trống sẽ tự động lấy từ phiếu)
 */
function sendEmailSlaNotification(ticketRecordOrId, slaRuleType, customContactName, customExpireTime) {
    if (!ticketRecordOrId) {
        return false;
    }

    var ticketId = "";
    var primaryFile = null;
    var openedFile = null;

    if (typeof ticketRecordOrId === "string") {
        ticketId = ticketRecordOrId.trim();
    } else if (ticketRecordOrId) {
        ticketId = String(ticketRecordOrId["id"] || ticketRecordOrId["ticket.id"] || ticketRecordOrId["prepayment.id"] || ticketRecordOrId["payment.id"] || "").trim();
        // SLA Job đọc dữ liệu qua store.get(), kết quả là plain object chứ không
        // phải SCFile. RAD Rule.sendHTMLEmail cần record SCFile hợp lệ, vì vậy chỉ
        // tái sử dụng record khi đối tượng thực sự có API của SCFile; plain object
        // sẽ được truy vấn lại từ DB ở bước bên dưới.
        if (typeof ticketRecordOrId.doSelect === "function" || typeof ticketRecordOrId.getNext === "function") {
            primaryFile = ticketRecordOrId;
        }
    }

    // Nếu chưa có SCFile đầy đủ thông tin phiếu thì truy vấn 1 lần duy nhất từ DB
    if (!primaryFile && ticketId) {
        var upperId = ticketId.toUpperCase();
        var isPaymentOrExpense = upperId.indexOf("TT") === 0 || upperId.indexOf("DC") === 0;
        var tblName = isPaymentOrExpense ? "esdHTKTpayment" : "esdHTKTprepayment";
        try {
            var f = new SCFile(tblName, SCFILE_READONLY);
            if (f.doSelect('id="' + escapeSmQueryValue(ticketId) + '"') === RC_SUCCESS) {
                openedFile = f;
                primaryFile = f;
            } else {
                try { f.doClose(); } catch (eCl1) {}
                // Fallback tra cứu bảng còn lại phòng trường hợp cấu hình mã khác
                var fallbackTbl = isPaymentOrExpense ? "esdHTKTprepayment" : "esdHTKTpayment";
                var fFallback = new SCFile(fallbackTbl, SCFILE_READONLY);
                if (fFallback.doSelect('id="' + escapeSmQueryValue(ticketId) + '"') === RC_SUCCESS) {
                    openedFile = fFallback;
                    primaryFile = fFallback;
                } else {
                    try { fFallback.doClose(); } catch (eCl2) {}
                }
            }
        } catch (eQuery) {
            // logger.error("[SLA EMAIL] Lỗi truy vấn phiếu " + ticketId + ": " + eQuery);
        }
    }
    if (!primaryFile) {
        return false;
    }

    var currentPhase = primaryFile["current.phase"] || "";

    // 1. Xác định Cán bộ chịu trách nhiệm SLA
    var targetContact = String(customContactName || "").trim();
    if (!targetContact && primaryFile) {
        targetContact = getSlaResponsibleContact(primaryFile);
    }

    var receiver = getContactInfo(targetContact);
    if (!receiver || !receiver.email) {
        if (openedFile) {
            try { openedFile.doClose(); } catch (eCloseErr) {}
        }
        return false;
    }

    // 2. Định dạng thông tin Người vi phạm: [Phòng/Ban - Chức danh - Mã NV - Họ tên]
    var fullName = receiver.fullName || targetContact;
    var contactName = receiver.contactName || targetContact;
    var dept = receiver.lv2Id || receiver.lv1Id || "HTKT";
    var position = receiver.position || "CBNV";

    var userDisplay = "";
    if (fullName.indexOf(" - ") > -1) {
        userDisplay = fullName;
    } else {
        userDisplay = dept + " - " + position + " - " + contactName + " - " + fullName;
    }

    var phaseDisplayName = getSlaPhaseDisplayName(currentPhase);

    // 3. Xác định RuleSet cần gọi (theo template S6-SLA-01, nhóm 04_01 - 04_03 gộp thành 1 loại duy nhất)
    var ruleSetName = (slaRuleType && slaRuleType.indexOf("ESD_HTKT_") === 0) ? slaRuleType : RULE_SET_MAIL.S6_MAIL_04_01;

    // 4. Gán biến toàn cục phục vụ Template (không cần query trong template expression)
    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = fullName;
    vars["$G.mail.sla.user.display"] = userDisplay;
    vars["$G.mail.sla.phase"] = currentPhase;
    vars["$G.mail.sla.phase.name"] = phaseDisplayName;
    if (ticketId) {
        vars["$G.mail.ticket.id"] = ticketId;
    }

    var expireTime = "";
    if (customExpireTime) {
        expireTime = formatISODate(customExpireTime);
    } else if (primaryFile) {
        var rawExp = primaryFile["sla.expire.time"] || primaryFile["sla.expiration"] || primaryFile["sla.deadline"] || primaryFile["next.breach"] || primaryFile["expiration.time"] || primaryFile["due.date"] || "";
        if (rawExp) {
            expireTime = formatISODate(rawExp);
        }
    }
    vars["$G.mail.sla.expire.time"] = expireTime;

    var recordToSend = primaryFile || ticketRecordOrId;

    // 5. Thực hiện gửi mail
    try {
        var sendResult = sendEmailAction(recordToSend, ruleSetName);
        if (sendResult === false) {
            throw new Error("RuleSet " + ruleSetName + " trả về false");
        }
        return true;
    } catch (emailErr) {
        var emailErrorDetail = emailErr && emailErr.stack ? emailErr.stack : emailErr;
        return false;
    } finally {
        cleanGlobalVariable();
        if (openedFile) {
            try { openedFile.doClose(); } catch (eClFinally) {}
        }
    }
}

/**
 * Gửi email cảnh báo thời hạn SLA (S6-SLA-01 - Đã vượt quá 90%)
 */
function sendEmailSla(ticketRecordOrId, customContactName, customExpireTime) {
    logger.info('sendEmailSla ticketRecordOrId: ' + ticketRecordOrId);
        logger.info('sendEmailSla customContactName: ' + customContactName);
        logger.info('sendEmailSla customExpireTime: ' + customExpireTime);
    
    return sendEmailSlaNotification(ticketRecordOrId, RULE_SET_MAIL.S6_MAIL_04_01, customContactName, customExpireTime);
}

// Alias tương thích ngược
var sendEmailSla90 = sendEmailSla;
var sendEmailSla70 = sendEmailSla;
var sendEmailSlaOverdue = sendEmailSla;
var sendEmailSlaBreached = sendEmailSla;



/////////////////trigger script////////
function onAccountingInfoSavedTrigger(oldRec, newRec) { // trigger table esdHTKTaccountingInformation
    if (!oldRec || !newRec) {
        return;
    }
    var oldStatus = String(oldRec['status'] || "").toUpperCase().trim();
    var newStatus = String(newRec['status'] || "").toUpperCase().trim();
    if (shouldSkipOglAccountingNotification(oldStatus, newStatus, oldRec, newRec)) {
        return;
    }
    var oldPrepaymentId = oldRec['prepayment.id'] || oldRec['payment.id'];
    var prepaymentId = newRec['prepayment.id'] || newRec['payment.id'];
    if (oldPrepaymentId && prepaymentId && oldPrepaymentId != prepaymentId) return;

    var targetTicketId = prepaymentId || oldPrepaymentId || "";
    var upperPrepaymentId = String(targetTicketId).toUpperCase();
    var isExpense = upperPrepaymentId.startsWith("DC");

    // ==================== DỰ CHI (DC): CHẠY VÀO KÊNH RIÊNG ====================
    if (isExpense) {
        sendExpenseAccountingNotification(oldRec, newRec);
        return;
    }

    // ==================== THANH TOÁN (TT) & TẠM ỨNG (TU): GỬI MAIL S6 ====================
    var requestId = String(newRec['request.id'] || oldRec['request.id'] || "").trim();
    var isRetryOrErrorHandling = isAccountingRetryOrResolved(targetTicketId, requestId, oldStatus, oldRec, newRec);

    // Case 1: GIAO DỊCH XỬ LÝ LỖI HẠCH TOÁN (bởi Cán bộ KTTC)
    if (isRetryOrErrorHandling) {
        if (newStatus === "COMPLETED") {
            // Xử lý lỗi THÀNH CÔNG -> Gửi S6_MAIL_02_01 cho Người tạo phiếu
            var oldAccObj = {
                oldResponse: oldRec['response'] || oldRec['oldResponse'] || "",
                oldMessage: oldRec['message'] || oldRec['oldMessage'] || "",
                oldCheckedTime: oldRec['checked.time'] || oldRec['oldCheckedTime'] || ""
            };
            var processer = String(newRec['updated.by'] || vars['$lo.contact.name'] || system.user.name || "").trim();
            if (isSystemUser(processer)) {
                var retryProcesser = getAccountingErrorModifierFromHistory(targetTicketId, newRec);
                if (retryProcesser && !isSystemUser(retryProcesser)) {
                    processer = retryProcesser;
                }
            }
            sendAccountingErrorResolvedEmail(oldAccObj, newRec, processer);
            return;
        } else if (newStatus === "ERROR") {
            // Xử lý lỗi THẤT BẠI -> Gửi S6_MAIL_02_04 cho Cán bộ KTTC (quét lịch sử lấy chính xác người sửa)
            var errorModifier = getAccountingErrorModifierFromHistory(targetTicketId, newRec);
            sendAccountingErrorFailedEmail(newRec, errorModifier);
            return;
        }
    }

    // Case 2: HẠCH TOÁN LẦN ĐẦU (chưa từng xử lý lỗi)
    // - Dù thành công hay lỗi, đều đi vào phân luồng gửi mail 01_05 mới (gộp 01_03, 01_05, 01_06)
    // - Tuyệt đối KHÔNG gửi mail 02_01 hay 02_04 tại đây!
    processAccountingNotification0105(targetTicketId, oldRec, newRec);
}

/**
 * Kiểm tra xem giao dịch hạch toán này là giao dịch được thử lại (đã từng lỗi) hay là hạch toán lần đầu.
 * Theo quy tắc:
 * - Giao dịch đã từng lỗi (được thử lại) sẽ có bản ghi trong bảng esdHTKTaccountingErrorHandling hoặc esdHTKTaccountingErrorHandlingItem.
 * - Giao dịch thành công ngay từ đầu (không lỗi) sẽ KHÔNG CÓ bản ghi trong 2 bảng trên.
 */
function isAccountingRetryOrResolved(prepaymentId, requestId, oldStatus, oldRec, newRec) {
    var upperOldStatus = String(oldStatus || "").toUpperCase().trim();

    // 1. Kiểm tra trong bảng esdHTKTaccountingErrorHandlingItem (lịch sử thử lại của giao dịch)
    // Bản ghi trong bảng này CHỈ được sinh ra khi CB KTTC nhấn "Thử lại" tại màn hình Xử lý lỗi.
    if (prepaymentId && requestId) {
        var itemFile = null;
        try {
            itemFile = new SCFile("esdHTKTaccountingErrorHandlingItem", SCFILE_READONLY);
            itemFile.setFields(["id"]);
            var itemQuery = 'payment.id="' + escapeSmQueryValue(prepaymentId) + '" and request.id="' + escapeSmQueryValue(requestId) + '"';
            if (itemFile.doSelect(itemQuery) === RC_SUCCESS) {
                return true;
            }
        } catch (eItem) {
        } finally {
            if (itemFile) {
                try { itemFile.doClose(); } catch (eClItem) {}
            }
        }
    }

    // 2. QUAN TRỌNG: Nếu trạng thái trước đó là trạng thái chờ (NEW, CREATED, IN_QUEUE, PROCESSING hoặc rỗng)
    // và không có trong bảng lịch sử thử lại ở trên -> CHẮC CHẮN là bút toán đang chạy lần đầu theo queue,
    // tuyệt đối KHÔNG PHẢI là xử lý lỗi / thử lại!
    if (isOglWaitingStatus(upperOldStatus) || !upperOldStatus) {
        return false;
    }

    // 3. Trạng thái trước khi cập nhật là ERROR -> Chắc chắn là giao dịch lỗi được thử lại
    if (upperOldStatus === "ERROR") {
        return true;
    }

    // 4. Trạng thái trước khi cập nhật là PENDING_APPROVAL -> Khai báo thủ công được phê duyệt
    if (isManualAccountingStatus(upperOldStatus)) {
        return true;
    }

    return false;
}

function isOglWaitingStatus(status) {
    if (!status) return true;
    var s = String(status).toUpperCase().trim();
    return s === "" || s === "NEW" || s === "CREATED" || s === "INQUEUE" || s === "IN_QUEUE" || s === "PROCESSING";
}

function isManualAccountingStatus(status) {
    var s = String(status || "").toUpperCase().trim();
    return s === "PENDING_APPROVAL" || s === "PENDING_APPROVAL_MANUAL";
}

function isOglResultStatus(status) {
    var s = String(status || "").toUpperCase().trim();
    return s === "COMPLETED" || s === "ERROR";
}

function shouldSkipOglAccountingNotification(oldStatus, newStatus, oldRec, newRec) {
    var oStatus = String(oldStatus || "").toUpperCase().trim();
    var nStatus = String(newStatus || "").toUpperCase().trim();

    // 1. Bỏ qua các trạng thái phê duyệt thủ công (đã được xử lý riêng trong hàm nghiệp vụ)
    if (isManualAccountingStatus(oStatus) || isManualAccountingStatus(nStatus)) {
        return true;
    }

    // 2. Trạng thái mới phải là trạng thái có kết quả (COMPLETED hoặc ERROR)
    if (!isOglResultStatus(nStatus)) {
        return true;
    }

    // 3. Nếu là thử lại lỗi thất bại (cũ là ERROR, mới vẫn là ERROR nhưng có cập nhật checked.time/response/message)
    if (oStatus === "ERROR" && nStatus === "ERROR") {
        if (oldRec && newRec && (oldRec['checked.time'] !== newRec['checked.time'] || oldRec['response'] !== newRec['response'] || oldRec['message'] !== newRec['message'])) {
            return false; // Cho phép đi tiếp để gửi thông báo thử lại lỗi thất bại
        }
        return true;
    }

    // 4. Không có sự thay đổi trạng thái
    if (oStatus === nStatus) {
        return true;
    }

    // 5. Nếu trạng thái cũ không phải trạng thái chờ và cũng không phải ERROR -> Bỏ qua
    if (!isOglWaitingStatus(oStatus) && oStatus !== "ERROR") {
        return true;
    }

    return false;
}

/**
 * Kiểm tra trạng thái hạch toán có phải là trạng thái đang chờ xử lý hay không.
 * Các trạng thái chờ bao gồm: NEW, CREATED, INQUEUE (và IN_QUEUE).
 * @param {string} status
 * @returns {boolean}
 */
function isPendingAccountingStatus(status) {
    if (!status) return false;
    var s = String(status).toUpperCase().trim();
    return s === "NEW" || s === "CREATED" || s === "INQUEUE" || s === "IN_QUEUE";
}

// Kết quả hạch toán dự chi S6_MAIL_01_08
function sendEmailExpenseAccountingResult(accountingRecord) {
    if (!accountingRecord) {
        return;
    }

    var ticketRecord = null;
    var ticket_id = accountingRecord["prepayment.id"] || accountingRecord["payment.id"];
    if (ticket_id) {
        ticketRecord = new SCFile("esdHTKTpayment", SCFILE_READONLY);
    }

    var createdBy = null;
    var userCheckerKttc = null;
    var initialRole = null;

    try {
        if (ticketRecord && ticket_id) {
            var rc = ticketRecord.doSelect('id="' + escapeSmQueryValue(ticket_id) + '"');
            if (rc == RC_SUCCESS) {
                createdBy = ticketRecord["created.by"];
                userCheckerKttc = ticketRecord["user.checker.kttc"];
                initialRole = ticketRecord["initial.role"];
            }
        }

        if (!createdBy && accountingRecord["created.by"]) {
            createdBy = accountingRecord["created.by"];
        }

        var recordToSend = ticketRecord || accountingRecord;

        // Thống kê số lượng bút toán kết quả hạch toán cho phiếu dự chi
        var totalEntries = 0;
        var successEntries = 0;
        var failedEntries = 0;
        var latestCheckedTime = null;

        if (ticket_id) {
            var countAi = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
            try {
                var safeTId = escapeSmQueryValue(ticket_id);
                var qAi = 'prepayment.id="' + safeTId + '"';
                var rcAi = countAi.doSelect(qAi);
                while (rcAi === RC_SUCCESS) {
                    totalEntries++;
                    var st = String(countAi["status"] || "").toUpperCase().trim();
                    if (st === "COMPLETED" || st === "SUCCESS") {
                        successEntries++;
                    } else if (st === "ERROR" || st === "FAILED") {
                        failedEntries++;
                    }
                    if (countAi["checked.time"]) {
                        latestCheckedTime = countAi["checked.time"];
                    }
                    rcAi = countAi.getNext();
                }
            } catch (eCnt) {
            } finally {
                if (countAi) {
                    try { countAi.doClose(); } catch (eClCount) {}
                }
            }
        }

        vars["$G.mail.total_entries"] = totalEntries;
        vars["$G.mail.success_entries"] = successEntries;
        vars["$G.mail.failed_entries"] = failedEntries;
        if (latestCheckedTime) {
            vars["$G.mail.completed_datetime"] = formatISODate(latestCheckedTime);
            vars["$G.mail.process_date"] = formatOnlyDate(latestCheckedTime);
        }

        var executeSendAction = function(record, ruleSet) {
            try {
                callRuleSet(record, ruleSet);
            } catch (errRuleSet) {
                if (accountingRecord && accountingRecord !== record) {
                    try {
                        callRuleSet(accountingRecord, ruleSet);
                    } catch (errFallback) {}
                }
            }
        };

        // Step 1: Gửi cho người tạo (có thể là KTTC hoặc DMMS)
        if (createdBy) {
            var receiver = getContactInfo(createdBy);
            if (receiver && receiver.email) {
                vars["$G.mail.receiver"] = [receiver.email];
                vars["$G.mail.receiver.name"] = receiver.fullName || createdBy;
                /////MAIL/////
                executeSendAction(recordToSend, RULE_SET_MAIL.S6_MAIL_01_08);
                ///////
                vars["$G.mail.receiver"] = null;
                vars["$G.mail.receiver.name"] = null;
            }
        }

        // Step 2: Nếu tạo bởi DMMS thì gửi thêm cho KTTC (người tạo đã được gửi ở Step 1)
        if (String(initialRole).toLowerCase() == "dmms" && userCheckerKttc && userCheckerKttc !== createdBy) {
            var checkerReceiver = getContactInfo(userCheckerKttc);
            if (checkerReceiver && checkerReceiver.email) {
                vars["$G.mail.receiver"] = [checkerReceiver.email];
                vars["$G.mail.receiver.name"] = checkerReceiver.fullName || userCheckerKttc;
                /////MAIL/////
                executeSendAction(recordToSend, RULE_SET_MAIL.S6_MAIL_01_08);
                ///////
                vars["$G.mail.receiver"] = null;
                vars["$G.mail.receiver.name"] = null;
            }
        }
    } finally {
        if (ticketRecord) {
            try { ticketRecord.doClose(); } catch (eCl) {}
        }
        vars["$G.mail.total_entries"] = null;
        vars["$G.mail.success_entries"] = null;
        vars["$G.mail.failed_entries"] = null;
        vars["$G.mail.completed_datetime"] = null;
        vars["$G.mail.process_date"] = null;
        cleanGlobalVariable();
    }
}

/**
 * Xử lý thông báo kết quả hạch toán cho phân hệ Dự chi (DC) qua kênh riêng S6_MAIL_01_08
 * @param {SCFile|object} oldRec
 * @param {SCFile|object} newRec
 */
function sendExpenseAccountingNotification(oldRec, newRec) {
    try {
        if (!newRec && oldRec) {
            newRec = oldRec;
            oldRec = null;
        }
        if (!newRec) {
            return;
        }

        var oldStatus = oldRec ? String(oldRec['status'] || "").toUpperCase().trim() : "";
        var newStatus = String(newRec['status'] || "").toUpperCase().trim();

        // Chỉ xử lý đúng lần bút toán OGL chuyển từ trạng thái chờ sang kết quả.
        if (shouldSkipOglAccountingNotification(oldStatus, newStatus)) {
            return;
        }

        var ticketId = String(newRec['prepayment.id'] || newRec['payment.id'] || (oldRec && (oldRec['prepayment.id'] || oldRec['payment.id'])) || "").trim();
        if (!ticketId) {
            return;
        }

        var currentRequestId = String(newRec['request.id'] || "").trim();
        var currentTransactionId = String(newRec['transaction.id'] || "").trim();
        var hasUnfinishedEntry = false;
        var hasAccountingEntry = false;
        var aiFile = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);

        try {
            var safeTicketId = escapeSmQueryValue(ticketId);
            var query = 'prepayment.id="' + safeTicketId + '"';
            var rc = aiFile.doSelect(query);

            while (rc === RC_SUCCESS) {
                hasAccountingEntry = true;
                var rowRequestId = String(aiFile['request.id'] || "").trim();
                var rowTransactionId = String(aiFile['transaction.id'] || "").trim();
                var isCurrent = (currentRequestId && rowRequestId && currentRequestId === rowRequestId) ||
                        (currentTransactionId && rowTransactionId && currentTransactionId === rowTransactionId);
                var rowStatus = isCurrent ? newStatus : String(aiFile['status'] || "").toUpperCase().trim();

                if (!isOglResultStatus(rowStatus)) {
                    hasUnfinishedEntry = true;
                }

                rc = aiFile.getNext();
            }
        } catch (eQuery) {
        } finally {
            if (aiFile) {
                try { aiFile.doClose(); } catch (eCl) {}
            }
        }

        // Chỉ bút toán cuối cùng hoàn tất mới được gửi mail kết quả của cả phiếu.
        if (!hasAccountingEntry || hasUnfinishedEntry) {
            return;
        }

        // Thực hiện gửi S6_MAIL_01_08
        sendEmailExpenseAccountingResult(newRec);

    } catch (e) {
        // print("[ERROR] sendExpenseAccountingNotification: " + e.toString());
    }
}

function notifyExpenseAccountingSuccess(accountingRecord) {
    // Kênh riêng cho Dự chi khi hạch toán thành công (Webhook / Queue / API riêng)
    // TODO: Triển khai logic gửi thông báo kênh riêng cho Dự chi tại đây
}

function notifyExpenseAccountingError(accountingRecord) {
    // Kênh riêng cho Dự chi khi hạch toán thất bại (Webhook / Queue / API riêng)
    // TODO: Triển khai logic gửi thông báo kênh riêng cho Dự chi tại đây
}

//trigger kiem tra hoa don
function onInvoiceAfterUpdateTrigger(oldRec, newRec) { // trigger table esdHTKTinvoice
    if (!oldRec) {
        return;
    }
    var oldInvoiceId = oldRec['id'];
    var invoiceId = newRec['id'];
    if (oldInvoiceId != invoiceId) return;
    if (oldRec['last.check.date'] != newRec['last.check.date'] && newRec['check.status'] != "CHECKING") {
        sendEmailInvoiceCheckResult(newRec);
    }

}

// Tái phân công cán bộ S6_MAIL_01_07
function sendEmailReassignOfficer(reassignRecord) { // reassignRecord là bản ghi chứa thông tin tái phân công
    var ticketId = (reassignRecord && reassignRecord.id) || "";

    if (!reassignRecord) {
        return;
    }

    // 1. Xác định cán bộ nhận bàn giao mới
    var newAssignee = reassignRecord["new.assignee"] || reassignRecord["assignee"];

    if (!newAssignee) {
        return;
    }

    // 2. Tra cứu email và tên người nhận qua getContactInfo
    var receiver = getContactInfo(newAssignee);
    if (!receiver || !receiver.email) {
        return;
    }

    // 3. Tra cứu họ tên CB phụ trách trước, Người tái phân công & Ngày tái phân công
    var oldAssigneeUser = reassignRecord["old.assignee"] || reassignRecord["previous.assignee"] || "";
    var oldAssigneeFullName = reassignRecord["old.assignee.name"] || reassignRecord["oldAssigneeName"] || "";
    if (!oldAssigneeFullName && oldAssigneeUser) {
        var oldAssigneeInfo = getContactInfo(oldAssigneeUser);
        oldAssigneeFullName = (oldAssigneeInfo && oldAssigneeInfo.fullName) ? oldAssigneeInfo.fullName : oldAssigneeUser;
    }

    var newAssigneeFullName = reassignRecord["new.assignee.name"] || reassignRecord["newAssigneeName"] || (receiver ? receiver.fullName : "") || newAssignee;

    var operatorUser = reassignRecord["operator"] || (vars.$lo_operator ? (vars.$lo_operator["contact.name"] || vars.$lo_operator["name"]) : "") || vars["$lo.contact.name"] || "";
    var operatorFullName = reassignRecord["operator.name"] || reassignRecord["operatorName"] || "";
    if (!operatorFullName && operatorUser) {
        var operatorInfo = getContactInfo(operatorUser);
        operatorFullName = (operatorInfo && operatorInfo.fullName) ? operatorInfo.fullName : operatorUser;
    }

    var reassignDate = reassignRecord["date"] || formatOnlyDate(system.functions.tod());

    // 4. Gán biến toàn cục phục vụ gửi mail và binding vào template
    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = newAssigneeFullName;

    // CB được tái phân công
    vars["$G.mail.new.assignee"] = newAssigneeFullName;
    vars["$G.mail.new.assignee.name"] = newAssigneeFullName;
    vars["$G.mail.new_assignee"] = newAssigneeFullName;

    // CB phụ trách trước
    vars["$G.mail.old.assignee"] = oldAssigneeFullName;
    vars["$G.mail.old.assignee.name"] = oldAssigneeFullName;
    vars["$G.mail.old_assignee"] = oldAssigneeFullName;

    // Người tái phân công
    vars["$G.mail.reassign.operator"] = operatorFullName;
    vars["$G.mail.reassign_operator"] = operatorFullName;
    vars["$G.mail.sender.name"] = operatorFullName;

    // Ngày tái phân công
    vars["$G.mail.reassign.date"] = reassignDate;
    vars["$G.mail.reassign_date"] = reassignDate;

    vars["$G.mail.reassign.reason"] = reassignRecord["reason"] || "";
    vars["$G.mail.reassign.role"] = reassignRecord["role"] || reassignRecord["field"] || "";

    // Đóng gói metadata để template có thể parse an toàn
    var metadata = {
        oldAssignee: oldAssigneeFullName,
        oldAssigneeUser: oldAssigneeUser,
        newAssignee: newAssigneeFullName,
        newAssigneeUser: newAssignee,
        operator: operatorFullName,
        operatorUser: operatorUser,
        reassignDate: reassignDate,
        role: reassignRecord["role"] || reassignRecord["field"] || "",
        reason: reassignRecord["reason"] || ""
    };
    vars["$G.mail.metadata"] = JSON.stringify(metadata);

    // Lấy SCFile thực tế của phiếu để tránh lỗi $RECORD bị null trong template (hỗ trợ cả Thanh toán TT, Dự chi DC và Tạm ứng TU)
    var targetFile = null;
    if (ticketId) {
        try {
            var upperId = ticketId.toUpperCase();
            var isPayment = upperId.indexOf("TT") === 0 || upperId.indexOf("DC") === 0;
            var primaryTbl = isPayment ? "esdHTKTpayment" : "esdHTKTprepayment";
            var tf = new SCFile(primaryTbl, SCFILE_READONLY);
            if (tf.doSelect('id="' + escapeSmQueryValue(ticketId) + '"') === RC_SUCCESS) {
                targetFile = tf;
            } else {
                try { tf.doClose(); } catch (eCl1) {}
                // Fallback tra cứu bảng còn lại phòng trường hợp mã phiếu khác
                var fallbackTbl = isPayment ? "esdHTKTprepayment" : "esdHTKTpayment";
                var tfFallback = new SCFile(fallbackTbl, SCFILE_READONLY);
                if (tfFallback.doSelect('id="' + escapeSmQueryValue(ticketId) + '"') === RC_SUCCESS) {
                    targetFile = tfFallback;
                } else {
                    try { tfFallback.doClose(); } catch (eCl2) {}
                }
            }
        } catch (eTf) {}
    }
    var recordToSend = targetFile || reassignRecord;

    ///// 5. GỬI MAIL /////
    try {
        sendEmailAction(recordToSend, RULE_SET_MAIL.S6_MAIL_01_07);
    } catch (emailError) {
    } finally {
        if (targetFile) {
            try { targetFile.doClose(); } catch (eCloseTf) {}
        }
        // 6. Dọn dẹp biến toàn cục
        vars["$G.mail.receiver"] = null;
        vars["$G.mail.receiver.name"] = null;
        vars["$G.mail.new.assignee"] = null;
        vars["$G.mail.new.assignee.name"] = null;
        vars["$G.mail.new_assignee"] = null;
        vars["$G.mail.old.assignee"] = null;
        vars["$G.mail.old.assignee.name"] = null;
        vars["$G.mail.old_assignee"] = null;
        vars["$G.mail.reassign.operator"] = null;
        vars["$G.mail.reassign_operator"] = null;
        vars["$G.mail.sender.name"] = null;
        vars["$G.mail.reassign.date"] = null;
        vars["$G.mail.reassign_date"] = null;
        vars["$G.mail.reassign.reason"] = null;
        vars["$G.mail.reassign.role"] = null;
        vars["$G.mail.metadata"] = null;
    }
}

///////////////////////////////////////////////////////////////////////////////////////////
function sendEmailToCreatedBy(record, rulesetName, senderContacts) {
    //    sendEmailToContact(record, rulesetName, record["created.by"],senderContacts);
    testSendEmailToContact(record, rulesetName, record["created.by"], senderContacts); // test
}
