/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_COMMON
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Khai báo constants dùng chung cho gen phiếu, ECM, ký số và workflow.
 * - Chuẩn hóa response giữa Service Manager và NextJS.
 * - Chuẩn hóa xử lý String, Number, Boolean, Array và JSON.
 * - Đọc an toàn các field đa biểu diễn (current.phase / current_phase, v.v.).
 * - Xác định người dùng nghiệp vụ hiện tại.
 * - Sinh Request ID dùng cho các API tích hợp.
 * - Cung cấp helper thao tác SCFile an toàn.
 * -----------------------------------------------------------------------------
 */

/* =============================================================================
 * 1. THÔNG TIN SCRIPT LIBRARY & CONFIG
 * ============================================================================= */

var HTKT_COMMON_NAME = "ESD_HTKT_PAYMENT_COMMON";
var HTKT_COMMON_VERSION = "1.1.0";
var HTKT_COMMON_LOG_PREFIX = "[ESD_HTKT_PAYMENT_COMMON]";

/* Bật log debug trên DEV/SIT (Tắt trên PROD để tránh phình log) */
var HTKT_COMMON_ENABLE_LOG = false;


/* =============================================================================
 * 2. TÊN BẢNG (DATABASE TABLES)
 * ============================================================================= */

var HTKT_TABLE = {
    PAYMENT           : "esdHTKTpayment",
    PAYMENT_VENDOR    : "esdHTKTpaymentVendor",
    PAYMENT_ENTRY     : "esdHTKTpaymentEntry",
    PAYMENT_INVOICE   : "esdHTKTpaymentInvoice",
    PAYMENT_ATTACHMENT: "esdHTKTpaymentAttachment",

    VENDOR               : "esdHTKTvendor",
    INVOICE              : "esdHTKTinvoice",
    CONTACT              : "contacts",
    ORG_UNIT             : "esdQTorgUnit",
    BANK                 : "esdDMbank",

    ACTIVITY             : "activityHTKTpayment"
};


/* =============================================================================
 * 3. PHASE WORKFLOW
 * ============================================================================= */

var HTKT_PHASE = {
    INITIAL_DMMS : "initial_dmms",
    INITIAL_KTTC : "initial_kttc",

    CHECK_DMMS   : "check_dmms",
    APPROVAL_DMMS: "approval_dmms",
    APPROVAL_KTTC: "approval_kttc",

    CHECK_FINAL  : "check_final",
    APPROVAL_FINAL: "approval_final"
};


/* =============================================================================
 * 4. TRẠNG THÁI PHIẾU (PAYMENT STATUS)
 * ============================================================================= */

var HTKT_PAYMENT_STATUS = {
    DMMS_CREATED  : "dmms_created",
    KTTC_CREATED  : "kttc_created",

    DMMS_INITIATED: "dmms_initiated",
    KTTC_CHECKED  : "kttc_checked",
    DMMS_CHECKED  : "dmms_checked",

    DMMS_APPROVED : "dmms_approved",
    KTTC_APPROVED : "kttc_approved",
    CHECKED       : "checked",

    APPROVED      : "approved",
    CANCELLED     : "cancelled",
    REQUEST_EDIT  : "request_edit",
    ACCOUNTED     : "accounted"
};


/* =============================================================================
 * 5. TRẠNG THÁI BẢN TRÌNH KÝ (DOCUMENT STATUS)
 * ============================================================================= */

var HTKT_DOCUMENT_STATUS = {
    GENERATED   : "GENERATED",    // PDF đã sinh từ template, chưa upload ECM
    UPLOADED    : "UPLOADED",     // PDF đã upload & kiểm tra tồn tại trên ECM
    SIGN_PENDING: "SIGN_PENDING", // DSM đã tiếp nhận yêu cầu ký, chờ kết quả
    SIGNED      : "SIGNED",       // Hoàn thành 1 bước ký (chưa phải chữ ký cuối)
    COMPLETED   : "COMPLETED",    // Bản trình ký đã đầy đủ chữ ký theo workflow
    INVALIDATED : "INVALIDATED",  // Bị hủy hiệu lực do yêu cầu chỉnh sửa
    FAILED      : "FAILED"        // Lỗi sinh/upload/ký file
};


/* =============================================================================
 * 6. LOẠI TÀI LIỆU (DOCUMENT TYPE)
 * ============================================================================= */

var HTKT_DOCUMENT_TYPE = {
    PRESENTATION: "TRINH_KY",
    PRINT_FORM  : "PHIEU_IN",
    SUPPORTING  : "TAI_LIEU_DINH_KEM"
};


/* =============================================================================
 * 7. PHƯƠNG THỨC KÝ (SIGN TECHNOLOGY)
 * ============================================================================= */

var HTKT_SIGN_TECH = {
    HSM          : "HSM",
    SMART_CA     : "SMARTCA",
    SMART_CA_ALT : "SMART-GOI"
};


/* =============================================================================
 * 8. TRẠNG THÁI DSM
 * ============================================================================= */

var HTKT_DSM_STATUS = {
    REQUESTED       : "01", // Client tạo yêu cầu ký
    SENT_TO_PROVIDER: "03", // DSM gửi yêu cầu tới đối tác ký
    FAILED          : "04", // Ký thất bại
    SIGNED          : "05", // Chữ ký thành công (file có thể chưa lên ECM)
    ECM_UPLOADED    : "07", // File kết quả đã upload ECM (Thành công cuối)
    UNKNOWN_ERROR   : "99"  // Lỗi không xác định
};


/* =============================================================================
 * 9. ACTIONS (NEXTJS -> SERVICE MANAGER)
 * ============================================================================= */

var HTKT_ACTION = {
    GENERATE_AND_UPLOAD_PRESENTATION: "generateAndUploadPresentation",
    GET_CURRENT_PRESENTATION        : "getCurrentPresentation",
    DOWNLOAD_PRESENTATION           : "downloadPresentation",
    GET_PRINT_DOCUMENT              : "getPrintDocument",
    SUBMIT_FOR_APPROVAL             : "submitForApproval",
    CONFIRM_REVIEW                  : "confirmReview",
    REQUEST_CORRECTION              : "requestCorrection",
    GET_SIGNER_INFO                 : "getSignerInfo",
    PREPARE_SIGN_CONTEXT            : "prepareSignContext",
    GET_HSM_TOKEN                   : "getHsmToken",
    CREATE_SIGN_REQUEST             : "createSignRequest",
    GET_SIGN_STATUS                 : "getSignStatus",
    COMPLETE_SIGN                   : "completeSign"
};


/* =============================================================================
 * 10. MÃ LỖI DÙNG CHUNG (ERROR CODES)
 * ============================================================================= */

var HTKT_ERROR = {
    UNKNOWN                   : "UNKNOWN_ERROR",
    INVALID_INPUT             : "INVALID_INPUT",
    INVALID_JSON              : "INVALID_JSON",
    MISSING_PAYMENT_ID     : "MISSING_PAYMENT_ID",
    MISSING_CURRENT_USER      : "MISSING_CURRENT_USER",

    RECORD_NOT_FOUND          : "RECORD_NOT_FOUND",
    PAYMENT_NOT_FOUND      : "PAYMENT_NOT_FOUND",
    ATTACHMENT_NOT_FOUND      : "ATTACHMENT_NOT_FOUND",

    INVALID_CURRENT_PHASE     : "INVALID_CURRENT_PHASE",
    INVALID_CURRENT_ACTOR     : "INVALID_CURRENT_ACTOR",
    SIGNATURE_NOT_REQUIRED    : "SIGNATURE_NOT_REQUIRED",

    DOCUMENT_NOT_FOUND        : "DOCUMENT_NOT_FOUND",
    DOCUMENT_NOT_CURRENT      : "DOCUMENT_NOT_CURRENT",
    DOCUMENT_CONFLICT         : "DOCUMENT_CONFLICT",
    DOCUMENT_INVALID          : "DOCUMENT_INVALID",

    ECM_UPLOAD_FAILED         : "ECM_UPLOAD_FAILED",
    ECM_DOWNLOAD_FAILED       : "ECM_DOWNLOAD_FAILED",
    ECM_DELETE_FAILED         : "ECM_DELETE_FAILED",

    DSM_TOKEN_FAILED          : "DSM_TOKEN_FAILED",
    DSM_USER_INFO_FAILED      : "DSM_USER_INFO_FAILED",
    DSM_SIGN_REQUEST_FAILED   : "DSM_SIGN_REQUEST_FAILED",
    DSM_SIGN_STATUS_FAILED    : "DSM_SIGN_STATUS_FAILED",

    SIGN_PENDING              : "SIGN_PENDING",
    SIGN_FAILED               : "SIGN_FAILED",
    SIGN_RESULT_INVALID       : "SIGN_RESULT_INVALID",

    WORKFLOW_UPDATE_FAILED    : "WORKFLOW_UPDATE_FAILED",
    REQUEST_CORRECTION_FAILED : "REQUEST_CORRECTION_FAILED",

    ACTION_EXECUTION_ERROR    : "ACTION_EXECUTION_ERROR",
    UNKNOWN_ACTION            : "UNKNOWN_ACTION"
};


/* =============================================================================
 * 11. LOGGING HELPERS
 * ============================================================================= */

/**
 * Ghi log thông thường (Không truyền Token, Password, PIN, Base64).
 */
function log(message) {
    if (!HTKT_COMMON_ENABLE_LOG) {
        return;
    }
    try {
        // print(HTKT_COMMON_LOG_PREFIX + " " + toString(message));
    } catch (eLog) {}
}

/**
 * Ghi log lỗi.
 */
function logError(functionName, error) {
    try {
        // print(HTKT_COMMON_LOG_PREFIX + "." + trim(functionName) + " ERROR: " + exceptionToString(error));
    } catch (eLog) {}
}


/* =============================================================================
 * 12. RESPONSE STANDARDIZATION HELPERS
 * ============================================================================= */

/**
 * Response thành công chuẩn.
 */
function ok(data, message, code) {
    return {
        success: true,
        code   : trim(code) || "OK",
        message: trim(message) || "Thành công",
        data   : (data === undefined) ? null : data
    };
}

/**
 * Response thất bại chuẩn.
 */
function fail(code, message, detail, data) {
    return {
        success: false,
        code   : trim(code) || HTKT_ERROR.UNKNOWN,
        message: trim(message) || "Có lỗi xảy ra.",
        detail : trim(detail),
        data   : (data === undefined) ? null : data
    };
}

/**
 * Chuyển Exception thành Response thất bại chuẩn.
 */
function failFromException(code, message, error, data) {
    return fail(
            code || HTKT_ERROR.UNKNOWN,
            message || "Có lỗi xảy ra.",
            exceptionToString(error),
            data
    );
}

/**
 * Kiểm tra response có thành công hay không.
 */
function isSuccess(result) {
    return Boolean(result && (result.success === true || toBoolean(result.success) === true));
}

/**
 * Chuẩn hóa Response từ các thư viện cũ/khác nhau.
 */
function normalizeResponse(rawResult) {
    var parsed = rawResult;

    if (typeof rawResult === "string") {
        parsed = safeParseJson(rawResult, null);
        if (parsed === null) {
            return fail(HTKT_ERROR.INVALID_JSON, "Response không phải JSON hợp lệ.", rawResult);
        }
    }

    if (parsed === null || parsed === undefined) {
        return fail(HTKT_ERROR.UNKNOWN, "Không nhận được dữ liệu phản hồi.", "");
    }

    if (typeof parsed !== "object") {
        return ok(parsed, "Thành công");
    }

    var explicitSuccess = readValue(parsed, ["success"], null);

    if (explicitSuccess !== null && explicitSuccess !== undefined) {
        if (toBoolean(explicitSuccess)) {
            return ok(
                    readValue(parsed, ["data", "Data"], parsed),
                    readString(parsed, ["message", "Msg", "statusDesc"]) || "Thành công",
                    readString(parsed, ["code", "Code", "statusCode"]) || "OK"
            );
        }

        return fail(
                readString(parsed, ["code", "Code", "statusCode"]) || HTKT_ERROR.UNKNOWN,
                readString(parsed, ["message", "Msg", "statusDesc"]) || "Thao tác thất bại.",
                readString(parsed, ["detail", "error"]),
                readValue(parsed, ["data", "Data"], parsed)
        );
    }

    var responseCode = readString(parsed, ["code", "Code", "statusCode"]);
    var normalizedCode = toUpper(responseCode);

    if (normalizedCode === "OK" || normalizedCode === "00" || normalizedCode === "SUCCESS" || normalizedCode === "TRUE") {
        return ok(
                readValue(parsed, ["data", "Data"], parsed),
                readString(parsed, ["message", "Msg", "statusDesc"]) || "Thành công",
                responseCode || "OK"
        );
    }

    if (responseCode) {
        return fail(
                responseCode,
                readString(parsed, ["message", "Msg", "statusDesc"]) || "Thao tác thất bại.",
                readString(parsed, ["detail", "error"]),
                readValue(parsed, ["data", "Data"], parsed)
        );
    }

    return ok(parsed, "Thành công");
}


/* =============================================================================
 * 13. STRING HELPERS
 * ============================================================================= */

function toString(value) {
    if (value === null || value === undefined) {
        return "";
    }
    try {
        return String(value);
    } catch (eString) {
        return "";
    }
}

function trim(value) {
    return toString(value).replace(/^\s+|\s+$/g, "");
}

function isBlank(value) {
    return trim(value) === "";
}

function hasValue(value) {
    return !isBlank(value);
}

function toUpper(value) {
    return trim(value).toUpperCase();
}

function toLower(value) {
    return trim(value).toLowerCase();
}

function equals(value1, value2) {
    return toString(value1) === toString(value2);
}

function equalsIgnoreCase(value1, value2) {
    return toUpper(value1) === toUpper(value2);
}

/**
 * Loại bỏ dấu tiếng Việt (Dùng chuẩn hóa Code).
 */
function removeVietnameseAccents(value) {
    return toString(value)
            .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, "a")
            .replace(/[èéẹẻẽêềếệểễ]/g, "e")
            .replace(/[ìíịỉĩ]/g, "i")
            .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, "o")
            .replace(/[ùúụủũưừứựửữ]/g, "u")
            .replace(/[ỳýỵỷỹ]/g, "y")
            .replace(/đ/g, "d")
            .replace(/[ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴ]/g, "A")
            .replace(/[ÈÉẸẺẼÊỀẾỆỂỄ]/g, "E")
            .replace(/[ÌÍỊỈĨ]/g, "I")
            .replace(/[ÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ]/g, "O")
            .replace(/[ÙÚỤỦŨƯỪỨỰỬỮ]/g, "U")
            .replace(/[ỲÝỴỶỸ]/g, "Y")
            .replace(/Đ/g, "D");
}

/**
 * Chuẩn hóa giá trị thành Mã Code (A-Z, 0-9, _)
 */
function normalizeCode(value) {
    return removeVietnameseAccents(trim(value))
            .toUpperCase()
            .replace(/[^A-Z0-9_]/g, "");
}

/**
 * Escape chuỗi dùng cho SCFile Query.
 */
function escapeQueryValue(value) {
    return toString(value)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
}

/**
 * Escape HTML cơ bản.
 */
function escapeHtml(value) {
    return toString(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
}

/**
 * Sanitize Tên File.
 */
function sanitizeFileName(value) {
    var fileName = trim(value)
            .replace(/[\\\/:*?"<>|]/g, "_")
            .replace(/\s+/g, " ");

    return fileName || "htkt-document";
}

/**
 * Che giấu thông tin nhạy cảm khi log.
 */
function maskSecret(value, visibleCharacters) {
    var text = toString(value);
    var visible = toInteger(visibleCharacters, 4);

    if (!text) {
        return "";
    }
    if (visible < 0) {
        visible = 0;
    }
    if (text.length <= visible) {
        return "****";
    }

    var maskLength = text.length - visible;
    var masked = "";
    for (var i = 0; i < maskLength; i++) {
        masked += "*";
    }

    return masked + text.substr(maskLength);
}

/* =============================================================================
 * 13A. PAYMENT FORMATTING HELPERS
 * ============================================================================= */

function htktEscapeForJavaScript(value) {
    return toString(value)
            .replace(/\\/g, "\\\\")
            .replace(/'/g, "\\'")
            .replace(/\r/g, "")
            .replace(/\n/g, "");
}

function htktFormatMoney(value) {
    var amount = Number(value || 0);

    try {
        if (lib && lib.ESD_Utils && typeof lib.ESD_Utils.formatMoneyView === "function") {
            return toString(lib.ESD_Utils.formatMoneyView(amount));
        }
    } catch (eFormatMoney) {}

    var parts = toString(amount).split(".");
    var integerPart = parts[0];
    var decimalPart = parts.length > 1 ? parts[1] : "";
    var result = "";

    while (integerPart.length > 3) {
        result = "." + integerPart.substr(integerPart.length - 3) + result;
        integerPart = integerPart.substr(0, integerPart.length - 3);
    }

    result = integerPart + result;

    if (decimalPart !== "" && Number(decimalPart) !== 0) {
        result += "," + decimalPart;
    }

    return result;
}

function htktNormalizePaymentMethod(value) {
    return normalizeCode(value).replace(/_/g, "");
}

function htktIsCashPaymentMethod(value) {
    var normalized = htktNormalizePaymentMethod(value);
    return normalized === "TIENMAT" || normalized === "CASH";
}

function htktIsTransferPaymentMethod(value) {
    var normalized = htktNormalizePaymentMethod(value);
    return normalized === "CHUYENKHOAN" ||
            normalized === "BANKTRANSFER" ||
            normalized === "TRANSFER";
}

function htktFormatDateLong(value) {
    var dateValue = toDate(value);
    if (!dateValue) {
        return "";
    }

    return "Ng\u00e0y " + dateValue.getDate() +
            " th\u00e1ng " + (dateValue.getMonth() + 1) +
            " n\u0103m " + dateValue.getFullYear();
}

function htktPadDatePart(value) {
    var numberValue = Number(value || 0);
    return numberValue < 10 ? "0" + numberValue : String(numberValue);
}

function htktFormatDateShort(value) {
    var dateValue = toDate(value);
    if (!dateValue) {
        return "";
    }

    return htktPadDatePart(dateValue.getDate()) + "/" +
            htktPadDatePart(dateValue.getMonth() + 1) + "/" +
            dateValue.getFullYear();
}

function htktBuildErrorHtml(title, message) {
    return (
            "<div style='padding:20px;font-family:Arial,sans-serif;color:#b91c1c;'>" +
            "<div style='font-size:16px;font-weight:bold;margin-bottom:8px;'>" +
            escapeHtml(title || "C\u00f3 l\u1ed7i x\u1ea3y ra") +
            "</div>" +
            "<div>" +
            escapeHtml(message || "") +
            "</div>" +
            "</div>"
    );
}

function htktGetContactDisplayName(contactName) {
    var safeContactName = trim(contactName);

    if (!safeContactName) {
        return "";
    }

    var contactFile = selectOne(
            HTKT_TABLE.CONTACT,
            ["contact.name"],
            safeContactName
    );
    if (!contactFile) {
        return safeContactName;
    }

    var displayName = readString(
            contactFile,
            ["full.name", "contact.full.name", "contact.name"]
    );

    closeFile(contactFile);
    return displayName || safeContactName;
}

function htktGetOrgUnitName(unitId) {
    var safeUnitId = trim(unitId);
    var unitFile = null;
    var unitName = "";

    if (!safeUnitId) {
        return "";
    }

    unitFile = selectOne(
            HTKT_TABLE.ORG_UNIT,
            ["unit.id"],
            safeUnitId
    );
    if (unitFile) {
        unitName = readString(unitFile, ["unit.name"]);
    }

    closeFile(unitFile);
    return unitName;
}

function htktGetCreatorUnitName(contactName) {
    var safeContactName = trim(contactName);
    var contactFile = null;
    var unitLv1Id = "";

    if (!safeContactName) {
        return "";
    }

    contactFile = selectOne(
            HTKT_TABLE.CONTACT,
            ["contact.name"],
            safeContactName
    );

    if (contactFile) {
        unitLv1Id = readString(contactFile, ["lv1.id"]);
    }

    closeFile(contactFile);
    return htktGetOrgUnitName(unitLv1Id);
}

function htktReadThreeDigits(numberValue, readFull) {
    var digits = ["kh\u00f4ng", "m\u1ed9t", "hai", "ba", "b\u1ed1n", "n\u0103m", "s\u00e1u", "b\u1ea3y", "t\u00e1m", "ch\u00edn"];
    var hundreds = Math.floor(numberValue / 100);
    var tens = Math.floor((numberValue % 100) / 10);
    var units = numberValue % 10;
    var result = [];

    if (hundreds > 0 || readFull) {
        result.push(digits[hundreds] + " tr\u0103m");
    }

    if (tens > 1) {
        result.push(digits[tens] + " m\u01b0\u01a1i");
        if (units === 1) {
            result.push("m\u1ed1t");
        } else if (units === 4) {
            result.push("t\u01b0");
        } else if (units === 5) {
            result.push("l\u0103m");
        } else if (units > 0) {
            result.push(digits[units]);
        }
    } else if (tens === 1) {
        result.push("m\u01b0\u1eddi");
        if (units === 5) {
            result.push("l\u0103m");
        } else if (units > 0) {
            result.push(digits[units]);
        }
    } else if (units > 0) {
        if (hundreds > 0 || readFull) {
            result.push("l\u1ebb");
        }
        result.push(digits[units]);
    }

    return result.join(" ");
}

function htktIntegerToVietnameseWords(numberValue) {
    var scales = ["", "ngh\u00ecn", "tri\u1ec7u", "t\u1ef7", "ngh\u00ecn t\u1ef7", "tri\u1ec7u t\u1ef7"];
    var number = Math.floor(Math.abs(Number(numberValue || 0)));

    if (number === 0) {
        return "kh\u00f4ng";
    }

    var groups = [];
    while (number > 0) {
        groups.push(number % 1000);
        number = Math.floor(number / 1000);
    }

    var result = [];
    for (var i = groups.length - 1; i >= 0; i--) {
        var groupValue = groups[i];
        if (groupValue === 0) {
            continue;
        }

        var readFull = i < groups.length - 1 && groupValue < 100;
        var groupText = htktReadThreeDigits(groupValue, readFull);
        if (groupText) {
            result.push(groupText + (scales[i] ? " " + scales[i] : ""));
        }
    }

    return result.join(" ").replace(/\s+/g, " ");
}

function htktAmountToVietnameseWords(value, currency) {
    var amount = Number(value || 0);
    var signText = amount < 0 ? "\u00e2m " : "";
    var absolute = Math.abs(amount);
    var integerPart = Math.floor(absolute);
    var decimalText = toString(absolute).split(".")[1] || "";
    var result = signText + htktIntegerToVietnameseWords(integerPart);

    decimalText = decimalText.replace(/0+$/, "");
    if (decimalText) {
        var digitWords = ["kh\u00f4ng", "m\u1ed9t", "hai", "ba", "b\u1ed1n", "n\u0103m", "s\u00e1u", "b\u1ea3y", "t\u00e1m", "ch\u00edn"];
        var decimalWords = [];
        for (var i = 0; i < decimalText.length; i++) {
            decimalWords.push(digitWords[Number(decimalText.charAt(i))]);
        }
        result += " ph\u1ea9y " + decimalWords.join(" ");
    }

    var safeCurrency = trim(currency).toUpperCase();
    if (safeCurrency === "VND") {
        result += " \u0111\u1ed3ng";
    } else if (safeCurrency === "USD") {
        result += " \u0111\u00f4 la M\u1ef9";
    } else if (safeCurrency) {
        result += " " + safeCurrency;
    }

    result = result.replace(/\s+/g, " ");
    if (result) {
        result = result.charAt(0).toUpperCase() + result.substr(1);
    }
    return result;
}


/* =============================================================================
 * 14. NUMBER HELPERS
 * ============================================================================= */

function toNumber(value, defaultValue) {
    var fallback = (defaultValue === null || defaultValue === undefined) ? 0 : Number(defaultValue);

    if (value === null || value === undefined || trim(value) === "") {
        return isNaN(fallback) ? 0 : fallback;
    }

    if (typeof value === "number") {
        return isNaN(value) ? (isNaN(fallback) ? 0 : fallback) : value;
    }

    var normalized = trim(value).replace(/\s/g, "");

    /* Hỗ trợ định dạng số thập phân & dấu phân cách ngàn */
    if (normalized.indexOf(".") >= 0 && normalized.indexOf(",") >= 0) {
        if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
            normalized = normalized.replace(/\./g, "").replace(",", ".");
        } else {
            normalized = normalized.replace(/,/g, "");
        }
    } else if (normalized.indexOf(",") >= 0) {
        var commaCount = (normalized.match(/,/g) || []).length;
        if (commaCount === 1) {
            normalized = normalized.replace(",", ".");
        } else {
            normalized = normalized.replace(/,/g, "");
        }
    }

    var result = Number(normalized);
    return isNaN(result) ? (isNaN(fallback) ? 0 : fallback) : result;
}

function toInteger(value, defaultValue) {
    return parseInt(toNumber(value, defaultValue), 10);
}


/* =============================================================================
 * 15. BOOLEAN HELPERS
 * ============================================================================= */

function toBoolean(value) {
    if (value === true) {
        return true;
    }
    if (value === false || value === null || value === undefined) {
        return false;
    }

    var normalized = toUpper(value);
    return (
            normalized === "TRUE" ||
            normalized === "T" ||
            normalized === "YES" ||
            normalized === "Y" ||
            normalized === "1" ||
            normalized === "X"
    );
}


/* =============================================================================
 * 16. ARRAY HELPERS
 * ============================================================================= */

function isArray(value) {
    try {
        return Object.prototype.toString.call(value) === "[object Array]";
    } catch (eArray) {
        return false;
    }
}

/**
 * Chuyển SM Array / Object sang JS Array chuẩn.
 */
function toArray(value) {
    if (value === null || value === undefined) {
        return [];
    }
    if (isArray(value)) {
        return value;
    }
    try {
        if (typeof value.toArray === "function") {
            return value.toArray();
        }
    } catch (eToArray) {}

    return [value];
}

function arrayContains(arrayValue, targetValue) {
    var list = toArray(arrayValue);
    for (var i = 0; i < list.length; i++) {
        if (equals(list[i], targetValue)) {
            return true;
        }
    }
    return false;
}

function arrayContainsIgnoreCase(arrayValue, targetValue) {
    var list = toArray(arrayValue);
    for (var i = 0; i < list.length; i++) {
        if (equalsIgnoreCase(list[i], targetValue)) {
            return true;
        }
    }
    return false;
}

function uniqueStringArray(arrayValue) {
    var source = toArray(arrayValue);
    var result = [];
    var seen = {};

    for (var i = 0; i < source.length; i++) {
        var value = trim(source[i]);
        if (!value || seen[value]) {
            continue;
        }
        seen[value] = true;
        result.push(value);
    }
    return result;
}


/* =============================================================================
 * 17. JSON HELPERS
 * ============================================================================= */

function safeParseJson(value, fallbackValue) {
    if (value === null || value === undefined) {
        return fallbackValue;
    }
    if (typeof value === "object") {
        return value;
    }

    var text = trim(value);
    if (!text) {
        return fallbackValue;
    }

    try {
        return JSON.parse(text);
    } catch (eJson) {
        return fallbackValue;
    }
}

function safeStringify(value, fallbackValue) {
    try {
        return JSON.stringify(value);
    } catch (eJson) {
        return (fallbackValue === undefined) ? "" : toString(fallbackValue);
    }
}

function cloneJson(value, fallbackValue) {
    var jsonText = safeStringify(value, "");
    if (!jsonText) {
        return fallbackValue;
    }
    return safeParseJson(jsonText, fallbackValue);
}


/* =============================================================================
 * 18. EXCEPTION HELPERS
 * ============================================================================= */

function exceptionToString(error) {
    if (error === null || error === undefined) {
        return "";
    }
    try {
        if (error.message) {
            return toString(error.message);
        }
    } catch (eMessage) {}

    try {
        if (error.toString) {
            return toString(error.toString());
        }
    } catch (eToString) {}

    return toString(error);
}


/* =============================================================================
 * 19. SAFE FIELD READ / WRITE HELPERS
 * ============================================================================= */

function readValue(record, fieldNames, defaultValue) {
    if (!record || !fieldNames) {
        return defaultValue;
    }

    var fields = toArray(fieldNames);
    for (var i = 0; i < fields.length; i++) {
        var fieldName = trim(fields[i]);
        if (!fieldName) {
            continue;
        }

        try {
            var value = record[fieldName];
            if (value !== null && value !== undefined && trim(value) !== "") {
                return value;
            }
        } catch (eRead) {}
    }

    return defaultValue;
}

function readString(record, fieldNames, defaultValue) {
    return trim(readValue(record, fieldNames, defaultValue));
}

function readNumber(record, fieldNames, defaultValue) {
    return toNumber(readValue(record, fieldNames, defaultValue), defaultValue);
}

function readBoolean(record, fieldNames, defaultValue) {
    var value = readValue(record, fieldNames, defaultValue);
    if (value === null || value === undefined || trim(value) === "") {
        return toBoolean(defaultValue);
    }
    return toBoolean(value);
}

function writeValue(record, fieldName, value) {
    if (!record || !trim(fieldName)) {
        return false;
    }
    try {
        record[fieldName] = value;
        return true;
    } catch (eWrite) {
        logError("writeValue", eWrite);
        return false;
    }
}


/* =============================================================================
 * 20. RECORD FIELD ALIASES
 * ============================================================================= */

function getRecordId(record) {
    return readString(record, ["id", "payment.id", "payment_id"], "");
}

function getCurrentPhase(record) {
    return readString(record, ["current.phase", "current_phase", "currentPhase"], "");
}

function getInitialRole(record) {
    return readString(record, ["initial.role", "initial_role", "initialRole"], "");
}

function getRecordStatus(record) {
    return readString(record, ["status", "current.status", "current_status"], "");
}

function setCurrentPhase(record, phase) {
    if (!record) {
        return false;
    }
    var written = false;

    try {
        record["current.phase"] = phase;
        written = true;
    } catch (eField) {}

    try {
        record.current_phase = phase;
    } catch (eAlias) {}

    return written;
}

function setRecordStatus(record, status) {
    if (!record) {
        return false;
    }
    try {
        record["status"] = status;
        return true;
    } catch (eStatus) {
        return false;
    }
}


/* =============================================================================
 * 21. PHASE CLASSIFICATION
 * ============================================================================= */

function isSubmissionPhase(phaseOrRecord) {
    var phase = (typeof phaseOrRecord === "object") ? getCurrentPhase(phaseOrRecord) : trim(phaseOrRecord);
    return (phase === HTKT_PHASE.INITIAL_DMMS || phase === HTKT_PHASE.INITIAL_KTTC);
}

function isReviewPhase(phaseOrRecord) {
    var phase = (typeof phaseOrRecord === "object") ? getCurrentPhase(phaseOrRecord) : trim(phaseOrRecord);
    return (phase === HTKT_PHASE.CHECK_DMMS || phase === HTKT_PHASE.CHECK_FINAL);
}

function isSignaturePhase(phaseOrRecord) {
    var phase = (typeof phaseOrRecord === "object") ? getCurrentPhase(phaseOrRecord) : trim(phaseOrRecord);
    return (
            phase === HTKT_PHASE.APPROVAL_DMMS ||
            phase === HTKT_PHASE.APPROVAL_KTTC ||
            phase === HTKT_PHASE.APPROVAL_FINAL
    );
}


/* =============================================================================
 * 22. USER CONTEXT HELPERS
 * ============================================================================= */

/**
 * Lấy người dùng nghiệp vụ hiện tại (Không dùng system.user.name).
 */
function getCurrentUser() {
    var currentUser = "";

    try {
        if (vars.$lo_operator && vars.$lo_operator["contact.name"]) {
            currentUser = trim(vars.$lo_operator["contact.name"]);
        }
    } catch (eOperator) {}

    if (!currentUser) {
        try {
            currentUser = trim(vars["$lo.contact.name"]);
        } catch (eContact) {}
    }

    return currentUser;
}

/**
 * Lấy tài khoản kỹ thuật đang đăng nhập SM.
 */
function getOperatorName() {
    try {
        return trim(system.user.name);
    } catch (eOperator) {
        return "";
    }
}

function getCurrentUserOrOperator() {
    return getCurrentUser() || getOperatorName();
}


/* =============================================================================
 * 23. CURRENT FILE / PAYMENT ID RESOLUTION
 * ============================================================================= */

function getCurrentFile() {
    var currentFile = null;

    try {
        if (system.vars && system.vars.$L_file) {
            currentFile = system.vars.$L_file;
        }
    } catch (eSystemFile) {}

    if (!currentFile) {
        try { currentFile = vars.$L_file || null; } catch (eLocalFile1) {}
    }
    if (!currentFile) {
        try { currentFile = vars["$L.file"] || null; } catch (eLocalFile2) {}
    }

    return currentFile;
}

function getCurrentPaymentId(input) {
    var paymentId = "";

    if (input) {
        if (typeof input === "string") {
            paymentId = trim(input);
        } else {
            paymentId = readString(input, ["paymentId", "payment_id", "payment.id", "id"], "");
        }
    }

    if (!paymentId) {
        paymentId = getRecordId(getCurrentFile());
    }

    if (!paymentId) {
        try {
            paymentId = trim(
                    vars["$L.payment.id"] ||
                    vars["$L.paymentId"] ||
                    vars["$L.id"] || ""
            );
        } catch (eLocalId) {
            paymentId = "";
        }
    }

    return paymentId;
}


/* =============================================================================
 * 24. SCFILE DATABASE HELPERS
 * ============================================================================= */

function closeFile(file) {
    if (!file) {
        return;
    }
    try {
        file.doClose();
    } catch (eClose) {}
}

function newReadOnlyFile(tableName) {
    var file = null;
    try {
        file = new SCFile(tableName, SCFILE_READONLY);
    } catch (eReadOnly) {
        try {
            file = new SCFile(tableName);
        } catch (eNormal) {
            file = null;
        }
    }
    return file;
}

/**
 * Query 1 record theo danh sách các fields.
 * LƯU Ý: Phải closeFile(file) sau khi dùng xong.
 */
function selectOne(tableName, fieldNames, value) {
    var safeTable = trim(tableName);
    var safeValue = trim(value);
    var fields = toArray(fieldNames);

    if (!safeTable || !fields.length || !safeValue) {
        return null;
    }

    for (var i = 0; i < fields.length; i++) {
        var fieldName = trim(fields[i]);
        var file = null;

        if (!fieldName) {
            continue;
        }

        try {
            file = newReadOnlyFile(safeTable);
            if (!file) {
                continue;
            }

            var query = fieldName + '="' + escapeQueryValue(safeValue) + '"';
            var rc = file.doSelect(query);

            if (rc === RC_SUCCESS) {
                return file;
            }
        } catch (eSelect) {
            logError("selectOne", eSelect);
        }

        closeFile(file);
    }

    return null;
}

function recordExists(tableName, fieldNames, value) {
    var file = selectOne(tableName, fieldNames, value);
    var exists = (file !== null);
    closeFile(file);
    return exists;
}

function getPaymentRecord(paymentId) {
    var safeId = trim(paymentId);
    if (!safeId) {
        return null;
    }
    return selectOne(HTKT_TABLE.PAYMENT, ["id"], safeId);
}


/* =============================================================================
 * 25. DATE / TIME HELPERS
 * ============================================================================= */

function getSystemDateTime() {
    try {
        return system.functions.tod();
    } catch (eTod) {
        return new Date();
    }
}

function toDate(value) {
    if (value === null || value === undefined || trim(value) === "") {
        return null;
    }

    var result = null;
    try {
        result = new Date(value);
    } catch (eDate) {
        result = null;
    }

    if (!result || isNaN(result.getTime())) {
        return null;
    }
    return result;
}

function padLeft(value, length, padCharacter) {
    var text = toString(value);
    var expectedLength = toInteger(length, 2);
    var pad = toString(padCharacter) || "0";

    while (text.length < expectedLength) {
        text = pad + text;
    }
    return text;
}

function formatDateTimeCompact(value) {
    var dateValue = toDate(value);
    if (!dateValue) {
        dateValue = new Date();
    }

    return (
            dateValue.getFullYear() +
            padLeft(dateValue.getMonth() + 1, 2, "0") +
            padLeft(dateValue.getDate(), 2, "0") +
            padLeft(dateValue.getHours(), 2, "0") +
            padLeft(dateValue.getMinutes(), 2, "0") +
            padLeft(dateValue.getSeconds(), 2, "0") +
            padLeft(dateValue.getMilliseconds(), 3, "0")
    );
}

/**
 * Sinh Request ID duy nhất cho API tích hợp.
 * Ví dụ: HTKT_SIGN_20260803143015123_482731
 */
function generateRequestId(prefix) {
    var safePrefix = normalizeCode(prefix) || "HTKT";
    var randomNumber = Math.floor(Math.random() * 1000000);

    return (
            safePrefix + "_" +
            formatDateTimeCompact(new Date()) + "_" +
            padLeft(randomNumber, 6, "0")
    );
}

function generateRequestTime() {
    return toString(new Date().getTime());
}


/* =============================================================================
 * 26. SIGN TECH HELPERS
 * ============================================================================= */

function normalizeSignTech(value) {
    var normalized = normalizeCode(value);

    if (normalized === "HSM") {
        return HTKT_SIGN_TECH.HSM;
    }
    if (normalized === "SMARTCA" || normalized === "VNPTSMARTCA" || normalized === "SMARTGOI") {
        return HTKT_SIGN_TECH.SMART_CA;
    }

    return toUpper(value);
}

function isHsmSignTech(value) {
    return normalizeSignTech(value) === HTKT_SIGN_TECH.HSM;
}

function isSmartCaSignTech(value) {
    return normalizeSignTech(value) === HTKT_SIGN_TECH.SMART_CA;
}


/* =============================================================================
 * 27. DSM STATUS HELPERS
 * ============================================================================= */

function normalizeDsmStatus(value) {
    var status = trim(value);
    if (status.length === 1) {
        status = "0" + status;
    }
    return status;
}

function isDsmFileSignPendingStatus(value) {
    var status = normalizeDsmStatus(value);
    return (
            status === HTKT_DSM_STATUS.REQUESTED ||
            status === HTKT_DSM_STATUS.SENT_TO_PROVIDER ||
            status === HTKT_DSM_STATUS.SIGNED
    );
}

function isDsmFileSignSuccessStatus(value) {
    return normalizeDsmStatus(value) === HTKT_DSM_STATUS.ECM_UPLOADED;
}

function isDsmFileSignFailureStatus(value) {
    var status = normalizeDsmStatus(value);
    return (
            status === HTKT_DSM_STATUS.FAILED ||
            status === HTKT_DSM_STATUS.UNKNOWN_ERROR
    );
}


/* =============================================================================
 * 28. VALIDATION HELPERS
 * ============================================================================= */

function validateRequired(input, definitions) {
    var errors = [];
    var rules = toArray(definitions);

    for (var i = 0; i < rules.length; i++) {
        var rule = rules[i] || {};
        var fields = rule.fields || rule.field || [];
        var value = readValue(input, fields, null);

        if (value === null || value === undefined || trim(value) === "") {
            errors.push(
                    trim(rule.message) ||
                    ("Thiếu thông tin " + (trim(rule.label) || toArray(fields).join("/")) + ".")
            );
        }
    }

    return errors;
}

function requirePaymentId(input) {
    var paymentId = getCurrentPaymentId(input);

    if (!paymentId) {
        return fail(
                HTKT_ERROR.MISSING_PAYMENT_ID,
                "Không xác định được mã đề nghị thanh toán.",
                ""
        );
    }

    return ok({ paymentId: paymentId }, "Đã xác định mã đề nghị.");
}

function requireCurrentUser() {
    var currentUser = getCurrentUser();

    if (!currentUser) {
        return fail(
                HTKT_ERROR.MISSING_CURRENT_USER,
                "Không xác định được người dùng hiện tại.",
                "Không có $lo.contact.name hoặc $lo_operator.contact.name."
        );
    }

    return ok({ currentUser: currentUser }, "Đã xác định người dùng hiện tại.");
}


/* =============================================================================
 * 29. CONSTANT GETTERS
 * ============================================================================= */

function getVersion() {
    return HTKT_COMMON_VERSION;
}

function getTables() {
    return cloneJson(HTKT_TABLE, {});
}

function getPhases() {
    return cloneJson(HTKT_PHASE, {});
}

function getPaymentStatuses() {
    return cloneJson(HTKT_PAYMENT_STATUS, {});
}

function getDocumentStatuses() {
    return cloneJson(HTKT_DOCUMENT_STATUS, {});
}

function getDocumentTypes() {
    return cloneJson(HTKT_DOCUMENT_TYPE, {});
}

function getSignTechnologies() {
    return cloneJson(HTKT_SIGN_TECH, {});
}

function getDsmStatuses() {
    return cloneJson(HTKT_DSM_STATUS, {});
}

function getActions() {
    return cloneJson(HTKT_ACTION, {});
}

function getErrorCodes() {
    return cloneJson(HTKT_ERROR, {});
}

function getConstants() {
    return {
        version           : HTKT_COMMON_VERSION,
        tables            : getTables(),
        phases            : getPhases(),
        paymentStatuses: getPaymentStatuses(),
        documentStatuses  : getDocumentStatuses(),
        documentTypes     : getDocumentTypes(),
        signTechnologies  : getSignTechnologies(),
        dsmStatuses       : getDsmStatuses(),
        actions           : getActions(),
        errorCodes        : getErrorCodes()
    };
}

