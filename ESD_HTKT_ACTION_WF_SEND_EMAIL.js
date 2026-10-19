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
    S6_MAIL_01_03: "ESD_HTKT_SENDEMAIL_S6_MAIL_01_03", // Hoàn thành
    S6_MAIL_01_04: "ESD_HTKT_SENDEMAIL_S6_MAIL_01_04", // Xóa
    S6_MAIL_01_05: "ESD_HTKT_SENDEMAIL_S6_MAIL_01_05", // Hạch toán thành công
    S6_MAIL_01_06: "ESD_HTKT_SENDEMAIL_S6_MAIL_01_06", // Hạch toán lỗi
    S6_MAIL_01_07: "ESD_HTKT_SENDEMAIL_S6_MAIL_01_07", // Tái phân công cán bộ
    S6_MAIL_01_08: "ESD_HTKT_SENDEMAIL_S6_MAIL_01_08", // Kết quả hạch toán dự chi

    S6_MAIL_02_01: "ESD_HTKT_SENDEMAIL_S6_MAIL_02_01", // Lỗi hạch toán đã được xử lý
    S6_MAIL_02_02: "ESD_HTKT_SENDEMAIL_S6_MAIL_02_02", // Yêu cầu duyệt kết quả xử lý lỗi hạch toán
    S6_MAIL_02_03: "ESD_HTKT_SENDEMAIL_S6_MAIL_02_03", // Kết quả xử lý lỗi hạch toán bị từ chối

    S6_MAIL_03_01: "ESD_HTKT_SENDEMAIL_S6_MAIL_03_01"  // Kết quả kiểm tra hóa đơn
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
    if (record["initial_role"] == "dmms" && contactName == record["created.by"]) {
        return "initial_dmms";
    } else if (record["initial_role"] == "kttc" && contactName == record["created.by"]) {
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
    contactName = contactName || record.created_by;
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
    try {
        callRuleSet(record, ruleset_name);
    } catch (emailError) {
    }
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
    var createdBy = String(record["created.by"] || record.created_by || "").trim();
    var returnReason = String(record["return.reason"] || record.return_reason || vars["$return.reason"] || "").trim();

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
    //Gửi mail khi đã hoàn thành phê duyệt
    // Step 1: Gửi cho người tạo (có thể là KTTC hoặc DMMS)

    var receiver = getContactInfo(record["created.by"]);
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
        if (record["status"] == "approved") {
            sendEmailAction(record, RULE_SET_MAIL.S6_MAIL_01_03);
        }
    } catch (emailError) {
    }
    ///////
    vars["$G.mail.receiver"] = null;
    vars["$G.mail.receiver.name"] = null;
    //Step 2: nếu tạo bởi DMMS thì gửi thêm cho cả KTTC (người tạo đã được gửi ở Step 1);
    if (record["initial_role"] == "dmms") {
        receiver = getContactInfo(record["user.checker.kttc"]);
        vars["$G.mail.receiver"] = [receiver.email];
        vars["$G.mail.receiver.name"] = receiver.fullName || "";
        //sender vẫn giữ như ở trên
        /////MAIL/////
        try {
            if (record["status"] == "approved") {
                sendEmailAction(record, RULE_SET_MAIL.S6_MAIL_01_03);
            }
        } catch (emailError) {
        }
        ///////

    }
    //Step 3: clear
    ///////
    cleanGlobalVariable();


}

function sendEmailCancelled(record) {
    var recordId = record["id"] || record.id;
    if (!recordId) return;

    // 1. Kiểm tra điều kiện status và return.reason
    var returnReason = record["return.reason"] || record.return_reason;
    if (record["status"] != "cancelled" || returnReason === null || returnReason === undefined) {
        return;
    }

    // 2. Xác định bảng activity dựa vào tiền tố của mã phiếu (TT hoặc TU)
    var activityTable = "";
    if (recordId.indexOf("TT") === 0) {
        activityTable = "activityHTKTpayment";
    } else if (recordId.indexOf("TU") === 0) {
        activityTable = "activityHTKTprepayment";
    }

    // Lấy thông tin người gửi chung một lần
    var currentUser = String(vars.$lo_operator["contact.name"] || vars["$lo.contact.name"] || "").trim();
    var sender = getContactInfo(currentUser);
    var createdBy = String(record["created.by"] || record.created_by || "").trim();
    var initialRole = String(record["initial.role"] || record["initial_role"] || record.initial_role || "").trim().toLowerCase();

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

                    if (actType.indexOf("rà soát 1") !== -1 || actType.indexOf("ra soat 1") !== -1 || actDesc.indexOf("rà soát 1") !== -1 || actDesc.indexOf("check_dmms") !== -1) {
                        participatedRoles["dmms_checker"] = true;
                        participatedRoles["kttc_checker"] = true;
                    } else if (actType.indexOf("rà soát 2") !== -1 || actType.indexOf("ra soat 2") !== -1 || actDesc.indexOf("rà soát 2") !== -1 || actDesc.indexOf("check_final") !== -1) {
                        participatedRoles["final_checker"] = true;
                        participatedRoles["kttc_approver"] = true;
                        participatedRoles["dmms_approver"] = true;
                        participatedRoles["dmms_checker"] = true;
                        participatedRoles["kttc_checker"] = true;
                    } else if (actType.indexOf("phê duyệt") !== -1 || actType.indexOf("phe duyet") !== -1) {
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
                    } else if (actType.indexOf("trình phê duyệt") !== -1 || actType.indexOf("trinh phe duyet") !== -1) {
                        if (op && op !== createdBy) {
                            participatedRoles["kttc_checker"] = true;
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

//hach toan thanh cong S6_MAIL_01_05
function sendEmailAccountingCompleted(accountingRecord) { // record la ban ghi esdHTKTaccountingInformation
    //Step0: lay phieu
    var ticketRecord = null;
    var ticket_id = accountingRecord["prepayment.id"];
    if (ticket_id && ticket_id.startsWith("TT")) {
        ticketRecord = new SCFile("esdHTKTpayment", SCFILE_READONLY);
    } else if (ticket_id && ticket_id.startsWith("TU")) {
        ticketRecord = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
    }
    var createdBy = null;
    var userCheckerKttc = null;
    var initialRole = null;
    try {
        var rc = ticketRecord.doSelect('id="' + accountingRecord["prepayment.id"] + '"');
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
    //Gửi mail
    // Step 1: Gửi cho người tạo (có thể là KTTC hoặc DMMS)
    var receiver = getContactInfo(createdBy);
    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = receiver.fullName || "";
    /////MAIL/////
    try {
        sendEmailAction(accountingRecord, RULE_SET_MAIL.S6_MAIL_01_05);
    } catch (emailError) {
    }
    ///////
    ////clear nguoi nhan/////
    vars["$G.mail.receiver"] = null;
    vars["$G.mail.receiver.name"] = null;
    //Step 2: nếu tạo bởi DMMS thì gửi thêm cho cả KTTC (người tạo đã được gửi ở Step 1);
    if (initialRole == "dmms") {
        receiver = getContactInfo(userCheckerKttc);
        vars["$G.mail.receiver"] = [receiver.email];
        vars["$G.mail.receiver.name"] = receiver.fullName || "";
        /////MAIL/////
        try {
            sendEmailAction(accountingRecord, RULE_SET_MAIL.S6_MAIL_01_05);
        } catch (emailError) {
        }
        ///////
    }
    //Step 3: clear
    ////clear nguoi nhan/////
    vars["$G.mail.receiver"] = null;
    vars["$G.mail.receiver.name"] = null;
}

//Hach toan that bai S6_MAIL_01_06
function sendEmailAccountingError(accountingRecord) { // record la ban ghi esdHTKTaccountingInformation
    //Step0: lay phieu
    var ticketRecord = null;
    var ticket_id = accountingRecord["prepayment.id"];
    if (ticket_id && ticket_id.startsWith("TT")) {
        ticketRecord = new SCFile("esdHTKTpayment", SCFILE_READONLY);
    } else if (ticket_id && ticket_id.startsWith("TU")) {
        ticketRecord = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
    }
    var createdBy = null;
    var userCheckerKttc = null;
    var initialRole = null;
    try {
        var rc = ticketRecord.doSelect('id="' + accountingRecord["prepayment.id"] + '"');
        if (rc == RC_SUCCESS) {
            createdBy = ticketRecord["created.by"];
            initialRole = ticketRecord["initial.role"];
            if (initialRole == "kttc") {
                userCheckerKttc = ticketRecord["created.by"];
            } else {
                userCheckerKttc = ticketRecord["user.checker.kttc"];
            }
        }
    } finally {
        if (ticketRecord) {
            ticketRecord.doClose();
        }
    }
    //Gửi mail
    // Step 1: Gửi cho cán bộ KTTC
    var receiver = getContactInfo(userCheckerKttc);
    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = receiver.fullName || "";
    /////MAIL/////
    try {
        sendEmailAction(accountingRecord, RULE_SET_MAIL.S6_MAIL_01_06);

    } catch (emailError) {
    }
    //Step 2: clear
    ////clear nguoi nhan/////
    vars["$G.mail.receiver"] = null;
    vars["$G.mail.receiver.name"] = null;
}

//Loi hach toan da duoc xu ly S6_MAIL_02_01
function sendAccountingErrorResolvedEmail(oldAccountingRecord, accountingRecord, processer) { // record la ban ghi esdHTKTaccountingInformation
    var processer_fullname = null;
    var operatorFile = new SCFile("operator", SCFILE_READONLY);
    try {
//      var rc = operatorFile.doSelect('name="' + processer + '"');
        var rc = operatorFile.doSelect("name=\"" + processer + "\"");
        if (rc == RC_SUCCESS) {
            processer_fullname = operatorFile.full_name||operatorFile['full.name']||operatorFile['contact.id']||operatorFile['contact_id']||"";
        } else {
            if (operatorFile) {
                operatorFile.doClose();
            }
            return;
        }
    } finally {
        if (operatorFile) {
            operatorFile.doClose();
        }
    }
//    ================================
    //Step0: lay phieu
    var ticketRecord = null;
    var metadata = {
        oldResponse: oldAccountingRecord['oldResponse'],
        oldMessage: oldAccountingRecord['oldMessage'],
        oldCheckedTime: oldAccountingRecord['oldCheckedTime'],
        processTime: accountingRecord['checked.time']
    }
    vars["$G.mail.metadata"] = JSON.stringify(metadata);
    var ticket_id = accountingRecord["prepayment.id"];
    if (ticket_id && ticket_id.startsWith("TT")) {
        ticketRecord = new SCFile("esdHTKTpayment", SCFILE_READONLY);
    } else if (ticket_id && ticket_id.startsWith("TU")) {
        ticketRecord = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
    }
    var createdBy = null;
    var userCheckerKttc = null;
    var initialRole = null;
    try {
        var rc = ticketRecord.doSelect('id="' + accountingRecord["prepayment.id"] + '"');
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
    //Gửi mail
    // Step 1: Gửi cho người tạo (có thể là KTTC hoặc DMMS)
    var receiver = getContactInfo(createdBy);
    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = receiver.fullName || "";

    vars["$G.mail.sender.name"] = processer_fullname|| "";
//    }
    /////MAIL/////
    try {
        sendEmailAction(accountingRecord, RULE_SET_MAIL.S6_MAIL_02_01);
    } catch (emailError) {
    }
    ///////
    ////clear nguoi nhan/////
    vars["$G.mail.receiver"] = null;
    vars["$G.mail.receiver.name"] = null;
    //Step 2: nếu tạo bởi DMMS thì gửi thêm cho cả KTTC (người tạo đã được gửi ở Step 1);
    if (initialRole == "dmms") {
        receiver = getContactInfo(userCheckerKttc);
        vars["$G.mail.receiver"] = [receiver.email];
        vars["$G.mail.receiver.name"] = receiver.fullName || "";
        /////MAIL/////
        try {
            sendEmailAction(accountingRecord, RULE_SET_MAIL.S6_MAIL_02_01);
        } catch (emailError) {
        }
        ///////
    }
    //Step 3: clear
    ////clear nguoi nhan/////
    vars["$G.mail.receiver"] = null;
    vars["$G.mail.receiver.name"] = null;
    vars["$G.mail.sender"] = null;
    vars["$G.mail.sender.name"] = null;
    vars["$G.mail.metadata"] = null;
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



/////////////////trigger script////////
function onAccountingInfoSavedTrigger(oldRec, newRec) { // trigger table esdHTKTaccountingInformation
    if (!oldRec || !newRec) {
        return;
    }
    var oldPrepaymentId = oldRec['prepayment.id'] || oldRec['prepayment_id'];
    var prepaymentId = newRec['prepayment.id'] || newRec['prepayment_id'];
    if (oldPrepaymentId != prepaymentId) return;

    var upperPrepaymentId = String(prepaymentId || "").toUpperCase();
    var isExpense = upperPrepaymentId.startsWith("DC");

    // ==================== DỰ CHI (DC): CHẠY VÀO KÊNH RIÊNG ====================
    if (isExpense) {
        sendExpenseAccountingNotification(oldRec, newRec);
        return;
    }

    // ==================== THANH TOÁN (TT) & TẠM ỨNG (TU): GỬI MAIL S6 ====================
    if ((oldRec['status'] == "NEW" || oldRec['status'] == "CREATED") && newRec['status'] == "COMPLETED") {
        sendEmailAccountingCompleted(newRec); // S6_MAIL_01_05
    }
    if ((oldRec['status'] == "NEW" || oldRec['status'] == "CREATED") && newRec['status'] == "ERROR") {
        sendEmailAccountingError(newRec); // S6_MAIL_01_06
    }

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
    var ticket_id = accountingRecord["prepayment.id"] || accountingRecord["prepayment_id"] || accountingRecord["payment.id"];
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
                initialRole = ticketRecord["initial.role"] || ticketRecord["initial_role"];
            }
        }

        if (!createdBy && accountingRecord["created.by"]) {
            createdBy = accountingRecord["created.by"];
        }

        var recordToSend = ticketRecord || accountingRecord;

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
        cleanGlobalVariable();
    }
}

/**
 * Xử lý thông báo kết quả hạch toán cho phân hệ Dự chi (DC) qua kênh riêng S6_MAIL_01_08
 * @param {SCFile|object} oldRec
 * @param {SCFile|object} newRec
 */
function sendExpenseAccountingNotification(oldRec, newRec) {
    print("sendExpenseAccountingNotification newRec", newRec);
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

        // Nếu có oldRec và trạng thái không đổi thì không xử lý
        if (oldStatus && oldStatus === newStatus) {
            return;
        }

        // Nếu trạng thái mới của bản ghi hiện tại vẫn đang ở trạng thái chờ thì chắc chắn chưa hoàn tất
        if (isPendingAccountingStatus(newStatus)) {
            return;
        }

        // Nếu có oldRec và trạng thái cũ không phải là trạng thái chờ/đang xử lý thì bỏ qua
        if (oldStatus && !isPendingAccountingStatus(oldStatus) && oldStatus !== "PROCESSING") {
            return;
        }

        var ticketId = String(newRec['prepayment.id'] || newRec['prepayment_id'] || newRec['payment.id'] || newRec['payment_id'] || "").trim();
        if (!ticketId) {
            return;
        }

        // Kiểm tra query trong bảng esdHTKTaccountingInformation:
        // Đảm bảo nếu tất cả các bản ghi accounting gắn với phiếu dự chi hiện tại
        // không còn bản ghi nào ở trạng thái NEW, CREATED, INQUEUE thì mới thực hiện call S6_MAIL_01_08.
        var currentRecId = String(newRec['id'] || "").trim();
        var currentRequestId = String(newRec['request.id'] || "").trim();
        var currentInternalRefId = String(newRec['internal.ref.id'] || "").trim();

        var hasPending = false;
        var aiFile = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);

        try {
            var safeTicketId = escapeSmQueryValue(ticketId);
            var query = 'prepayment.id="' + safeTicketId + '"';
            var rc = aiFile.doSelect(query);
            if (rc !== RC_SUCCESS) {
                query = 'payment.id="' + safeTicketId + '"';
                rc = aiFile.doSelect(query);
            }

            while (rc === RC_SUCCESS) {
                var rowId = String(aiFile['id'] || "").trim();
                var rowRequestId = String(aiFile['request.id'] || "").trim();
                var rowInternalRefId = String(aiFile['internal.ref.id'] || "").trim();

                var isCurrent = (currentRecId && rowId && currentRecId === rowId) ||
                                (currentRequestId && rowRequestId && currentRequestId === rowRequestId) ||
                                (currentInternalRefId && rowInternalRefId && currentInternalRefId === rowInternalRefId);

                // Nếu là bản ghi đang cập nhật thì dùng newStatus, ngược lại lấy status từ DB
                var rowStatus = isCurrent ? newStatus : String(aiFile['status'] || "").toUpperCase().trim();

                if (isPendingAccountingStatus(rowStatus)) {
                    hasPending = true;
                    break;
                }

                rc = aiFile.getNext();
            }
        } catch (eQuery) {
            hasPending = true;
        } finally {
            if (aiFile) {
                try { aiFile.doClose(); } catch (eCl) {}
            }
        }

        // Nếu vẫn còn bản ghi accounting ở trạng thái NEW, CREATED, INQUEUE thì chưa gửi mail
        if (hasPending) {
            return;
        }

        // Tất cả bản ghi accounting gắn với dự chi hiện tại đã kết thúc (không còn NEW, CREATED, INQUEUE)
        // Thực hiện call S6_MAIL_01_08
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
    var newAssignee = reassignRecord["new.assignee"] || reassignRecord["assignee"] || reassignRecord["new_assignee"];

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