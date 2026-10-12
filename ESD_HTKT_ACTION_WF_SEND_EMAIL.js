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
    var safeName = String(contactName).trim();
    var f = new SCFile("contacts", SCFILE_READONLY);
    try {
        // 1. Tìm nguyên bản trong bảng contacts
        var rc = f.doSelect('contact.name="' + safeName + '"');

        // 2. Nếu không ra, thử dạng CHỮ HOA (chuẩn lưu trữ của contacts: VTB.HTKT.117)
        if (rc != RC_SUCCESS) {
            rc = f.doSelect('contact.name="' + safeName.toUpperCase() + '"');
        }

        // 3. Fallback tìm không phân biệt hoa thường trong contacts
        if (rc != RC_SUCCESS) {
            rc = f.doSelect('tolower(contact.name)="' + safeName.toLowerCase() + '"');
        }

        if (rc != RC_SUCCESS) {
            return null;
        }

        return {
            contactName: f["contact.name"],
            fullName: f["full.name"],
            email: f["email"],
            position: f["position"],
            lv1Id: f["lv1.id"],
            lv2Id: f["lv2.id"]
        };
    } finally {
        if (f) {
            f.doClose();
        }
    }
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
        print(
                "[MAIL] Send email error: " +
                emailError
        );
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
        print(
                "[MAIL] Send email error: " +
                emailError
        );
    }
    ///////
    cleanGlobalVariable();
}

function sendEmailRequestEdit(record) {
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
        if (record["status"] == "request_edit") {
            sendEmailAction(record, RULE_SET_MAIL.S6_MAIL_01_02);
        }
    } catch (emailError) {
        print(
                "[MAIL] Send email error: " +
                emailError
        );
    }
    ///////
    cleanGlobalVariable();
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
        print(
                "[MAIL] Send email error: " +
                emailError
        );
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
            print(
                    "[MAIL] Send email error: " +
                    emailError
            );
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
            print("[MAIL] Query activity error: " + e);
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
                    print(
                            "[MAIL] Send email error for " + receiver.email + ": " + emailError
                    );
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
        print(
                "[MAIL] Send email error: " +
                emailError
        );
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
            print(
                    "[MAIL] Send email error: " +
                    emailError
            );
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
        print(
                "[MAIL] Send email error: " +
                emailError
        );
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
        print(
                "[MAIL] Send email error: " +
                emailError
        );
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
            print(
                    "[MAIL] Send email error: " +
                    emailError
            );
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
    print("[MAIL][S6_MAIL_02_02] Bắt đầu xử lý gửi email Yêu cầu duyệt kết quả xử lý lỗi hạch toán cho phiếu: " + ticketId);
    print("[MAIL][S6_MAIL_02_02] Cán bộ duyệt: " + approverContactName + " | Người khai báo: " + declarerFullName);

    if (!accountingRecord) {
        print("[MAIL][S6_MAIL_02_02] LỖI: accountingRecord rỗng, hủy gửi email.");
        return;
    }

    var receiver = getContactInfo(approverContactName);
    if (!receiver || !receiver.email) {
        print("[MAIL][S6_MAIL_02_02] LỖI: Không tìm thấy email của người duyệt: " + approverContactName);
        return;
    }

    print("[MAIL][S6_MAIL_02_02] Tìm thấy email người nhận: " + receiver.email + " (" + (receiver.fullName || approverContactName) + ")");

    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = receiver.fullName || approverContactName;
    vars["$G.mail.sender.name"] = declarerFullName || "";
    if (metadataObj) {
        vars["$G.mail.metadata"] = JSON.stringify(metadataObj);
    }

    try {
        print("[MAIL][S6_MAIL_02_02] Đang gọi RuleSet: " + RULE_SET_MAIL.S6_MAIL_02_02);
        sendEmailAction(accountingRecord, RULE_SET_MAIL.S6_MAIL_02_02);
        print("[MAIL][S6_MAIL_02_02] Hoàn tất gọi gửi email cho người duyệt: " + receiver.email);
    } catch (emailError) {
        print("[MAIL][S6_MAIL_02_02] LỖI ngoại lệ khi gửi mail: " + emailError);
    } finally {
        vars["$G.mail.receiver"] = null;
        vars["$G.mail.receiver.name"] = null;
        vars["$G.mail.sender.name"] = null;
        vars["$G.mail.metadata"] = null;
        print("[MAIL][S6_MAIL_02_02] Đã dọn dẹp các biến toàn cục $G.mail.*");
    }
}

// S6_MAIL_02_03: Ket qua xu ly loi hach toan bi tu choi
function sendAccountingRejectedEmail(accountingRecord, declarerContactName, rejectReason, leaderFullName, metadataObj) {
    var ticketId = (accountingRecord && (accountingRecord["prepayment.id"] || accountingRecord["request.id"])) || "";
    print("[MAIL][S6_MAIL_02_03] Bắt đầu xử lý gửi email Từ chối kết quả xử lý lỗi hạch toán cho phiếu: " + ticketId);
    print("[MAIL][S6_MAIL_02_03] Cán bộ khai báo (người nhận): " + declarerContactName + " | Lãnh đạo từ chối: " + leaderFullName + " | Lý do: " + rejectReason);

    if (!accountingRecord) {
        print("[MAIL][S6_MAIL_02_03] LỖI: accountingRecord rỗng, hủy gửi email.");
        return;
    }

    var targetDeclarer = String(declarerContactName || "").trim();
    var receiver = getContactInfo(targetDeclarer);

    // Fallback 1: Nếu chưa tìm được người nhận qua declarerContactName, tìm từ phiếu cha
    if ((!receiver || !receiver.email) && ticketId) {
        var parentTicket = null;
        try {
            var tbl = ticketId.toUpperCase().startsWith("TT") ? "esdHTKTpayment" : "esdHTKTprepayment";
            parentTicket = new SCFile(tbl, SCFILE_READONLY);
            if (parentTicket.doSelect('id="' + escapeSmQueryValue(ticketId) + '"') === RC_SUCCESS) {
                var fallbackContact = String(parentTicket["user.checker.kttc"] || parentTicket["created.by"] || "").trim();
                if (fallbackContact) {
                    print("[MAIL][S6_MAIL_02_03] Fallback tìm thấy người nhận từ phiếu cha: " + fallbackContact);
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
        print("[MAIL][S6_MAIL_02_03] LỖI: Không tìm thấy email của CB KTTC: " + targetDeclarer);
        return;
    }

    print("[MAIL][S6_MAIL_02_03] Tìm thấy email người nhận: " + receiver.email + " (" + (receiver.fullName || targetDeclarer) + ")");

    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = receiver.fullName || targetDeclarer;
    vars["$G.mail.sender.name"] = leaderFullName || "Lãnh đạo phòng KTTC";
    vars["$G.mail.reject.reason"] = rejectReason || "Không có lý do cụ thể.";

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
            declareResult: declareResultStr,
            rejectReason: rejectReason || "Không có lý do cụ thể."
        };
    }

    vars["$G.mail.metadata"] = JSON.stringify(metadataObj);

    try {
        print("[MAIL][S6_MAIL_02_03] Đang gọi RuleSet: " + RULE_SET_MAIL.S6_MAIL_02_03);
        sendEmailAction(accountingRecord, RULE_SET_MAIL.S6_MAIL_02_03);
        print("[MAIL][S6_MAIL_02_03] Hoàn tất gọi gửi email từ chối cho: " + receiver.email);
    } catch (emailError) {
        print("[MAIL][S6_MAIL_02_03] LỖI ngoại lệ khi gửi mail: " + emailError);
    } finally {
        vars["$G.mail.receiver"] = null;
        vars["$G.mail.receiver.name"] = null;
        vars["$G.mail.sender.name"] = null;
        vars["$G.mail.reject.reason"] = null;
        vars["$G.mail.metadata"] = null;
        print("[MAIL][S6_MAIL_02_03] Đã dọn dẹp các biến toàn cục $G.mail.*");
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
        print(
                "[MAIL] Send email error: " +
                emailError
        );
    }
}



/////////////////trigger script////////
function onAccountingInfoSavedTrigger(oldRec, newRec) { // trigger table esdHTKTaccountingInformation
    if (!oldRec) {
        return;
    }
    var oldPrepaymentId = oldRec['prepayment.id'] || oldRec['prepayment_id'];
    var prepaymentId = newRec['prepayment.id'] || newRec['prepayment_id'];
    if (oldPrepaymentId != prepaymentId) return;
    if ((oldRec['status'] == "NEW" || oldRec['status'] == "CREATED") && newRec['status'] == "COMPLETED") {
        sendEmailAccountingCompleted(newRec);
    }
    if ((oldRec['status'] == "NEW" || oldRec['status'] == "CREATED") && newRec['status'] == "ERROR") {
        sendEmailAccountingError(newRec);
    }

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
    print("[MAIL][S6_MAIL_01_07] Bắt đầu xử lý gửi email Tái phân công cán bộ cho phiếu: " + ticketId);

    if (!reassignRecord) {
        print("[MAIL][S6_MAIL_01_07] LỖI: reassignRecord rỗng, hủy gửi email.");
        return;
    }

    // 1. Xác định cán bộ nhận bàn giao mới
    var newAssignee = reassignRecord["new.assignee"] || reassignRecord["assignee"] || reassignRecord["new_assignee"];
    print("[MAIL][S6_MAIL_01_07] Cán bộ nhận bàn giao mới: " + newAssignee + " | Vai trò: " + (reassignRecord.role || reassignRecord.field));

    if (!newAssignee) {
        print("[MAIL][S6_MAIL_01_07] LỖI: Không tìm thấy cán bộ được tái phân công (new.assignee rỗng)");
        return;
    }

    // 2. Tra cứu email và tên người nhận qua getContactInfo
    var receiver = getContactInfo(newAssignee);
    if (!receiver || !receiver.email) {
        print("[MAIL][S6_MAIL_01_07] LỖI: Không tìm thấy email của cán bộ: " + newAssignee);
        return;
    }

    print("[MAIL][S6_MAIL_01_07] Tìm thấy email người nhận: " + receiver.email + " (" + (receiver.fullName || newAssignee) + ")");

    // 3. Gán biến toàn cục phục vụ gửi mail và binding vào template
    vars["$G.mail.receiver"] = [receiver.email];
    vars["$G.mail.receiver.name"] = receiver.fullName || newAssignee;
    vars["$G.mail.new.assignee"] = newAssignee;
    vars["$G.mail.old.assignee"] = reassignRecord["old.assignee"] || reassignRecord["previous.assignee"] || "";
    vars["$G.mail.reassign.reason"] = reassignRecord["reason"] || "";
    vars["$G.mail.reassign.role"] = reassignRecord["role"] || reassignRecord["field"] || "";

    // Lấy SCFile thực tế của phiếu để tránh lỗi $RECORD bị null trong template
    var targetFile = null;
    if (ticketId) {
        try {
            var tbl = ticketId.toUpperCase().startsWith("TT") ? "esdHTKTpayment" : "esdHTKTprepayment";
            var tf = new SCFile(tbl, SCFILE_READONLY);
            if (tf.doSelect('id="' + escapeSmQueryValue(ticketId) + '"') === RC_SUCCESS) {
                targetFile = tf;
            }
        } catch (eTf) {}
    }
    var recordToSend = targetFile || reassignRecord;

    ///// 4. GỬI MAIL /////
    try {
        print("[MAIL][S6_MAIL_01_07] Đang gọi RuleSet: " + RULE_SET_MAIL.S6_MAIL_01_07);
        sendEmailAction(recordToSend, RULE_SET_MAIL.S6_MAIL_01_07);
        print("[MAIL][S6_MAIL_01_07] Hoàn tất gọi gửi email tái phân công cho: " + receiver.email);
    } catch (emailError) {
        print(
                "[MAIL][S6_MAIL_01_07] LỖI ngoại lệ khi gửi mail: " +
                emailError
        );
    } finally {
        if (targetFile) {
            try { targetFile.doClose(); } catch (eCloseTf) {}
        }
        // 5. Dọn dẹp biến toàn cục
        vars["$G.mail.receiver"] = null;
        vars["$G.mail.receiver.name"] = null;
        vars["$G.mail.new.assignee"] = null;
        vars["$G.mail.old.assignee"] = null;
        vars["$G.mail.reassign.reason"] = null;
        vars["$G.mail.reassign.role"] = null;
        print("[MAIL][S6_MAIL_01_07] Đã dọn dẹp các biến toàn cục $G.mail.*");
    }
}

///////////////////////////////////////////////////////////////////////////////////////////
function sendEmailToCreatedBy(record, rulesetName, senderContacts) {
    //    sendEmailToContact(record, rulesetName, record["created.by"],senderContacts);
    testSendEmailToContact(record, rulesetName, record["created.by"], senderContacts); // test
}