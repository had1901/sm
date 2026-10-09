/**
 * Hàm tạo khoảng thời gian Đầu ngày và Cuối ngày chuẩn Service Manager dựa trên chuỗi ngày đầu vào.
 * Chấp nhận mọi định dạng chuỗi: "MM/DD/YYYY HH:mm:ss", "MM/DD/YY", hoặc định dạng ISO "YYYY-MM-DDThh:mm:ss"
 * * @param {String} invDate Chuỗi ngày tháng cần parse từ API
 * @return {Object|null} Trả về đối tượng chứa chuỗi query đã qua hàm str(), hoặc null nếu lỗi.
 */
function getDateRangeForQuery(invDate) {
    if (!invDate) {
        return null;
    }

    var day, month, year;
    var matchStr = String(invDate).trim();

    try {
        // 1. BÓC TÁCH CHUỖI GỐC API (Giả định API luôn truyền MM/DD/YYYY)
        if (matchStr.indexOf("/") !== -1) {
            var cleanDate = matchStr.split(" ")[0];
            var dateParts = cleanDate.split("/");
            month = dateParts[0]; 
            day = dateParts[1];
            year = dateParts[2];
        } else if (matchStr.indexOf("-") !== -1) {
            var cleanDate = matchStr.split("T")[0];
            var dateParts = cleanDate.split("-");
            year = dateParts[0];
            month = dateParts[1];
            day = dateParts[2];
        } else {
            return null;
        }

        if (year && year.length === 2) year = "20" + year;
        
        if (month && month.length === 1) month = "0" + month;
        if (day && day.length === 1) day = "0" + day;

        // 2. TỰ ĐỘNG PHÁT HIỆN ĐỊNH DẠNG KHÔNG SẬP (SAFE DATE FORMAT DETECTOR)
        // Lấy ngày hiện tại của hệ thống dưới dạng Object Date chuẩn của Service Manager
        var sysDate = system.functions.tod(); 
        var sysDateStr = system.functions.str(sysDate); // Trả về chuỗi dạng "DD/MM/YYYY..." hoặc "MM/DD/YYYY..."
        
        // Trích xuất tháng hiện tại của hệ thống (Luôn trả về số từ 1 - 12)
        var currentMonth = String(system.functions.month(sysDate));
        if (currentMonth.length === 1) currentMonth = "0" + currentMonth;

        var finalStartDate, finalEndDate;

        // Nếu chuỗi ngày hệ thống hiển thị KHÔNG bắt đầu bằng Tháng hiện tại 
        // Hoặc Tháng hiện tại trùng Ngày hiện tại thì ta check vị trí dấu phân tách ký tự đầu tiên
        // Đơn giản nhất: Kiểm tra xem cấu hình có dạng dd/mm/yyyy hay không
        if (sysDateStr && sysDateStr.indexOf(currentMonth) === 0 && currentMonth !== String(system.functions.day(sysDate))) {
            // Server dùng chuẩn MM/DD/YYYY (Giống LAB)
            var strStart = month + "/" + day + "/" + year + " 00:00:00";
            var strEnd   = month + "/" + day + "/" + year + " 23:59:59";
            finalStartDate = system.functions.val(strStart, 3);
            finalEndDate   = system.functions.val(strEnd, 3);
        } else {
            // Mặc định hoặc Server dùng chuẩn DD/MM/YYYY (Giống con DEV mới của bạn)
            var strStart = day + "/" + month + "/" + year + " 00:00:00";
            var strEnd   = day + "/" + month + "/" + year + " 23:59:59";
            finalStartDate = system.functions.val(strStart, 3);
            finalEndDate   = system.functions.val(strEnd, 3);
        }

        // Bọc lót nếu tính toán sai lệch ra null chuỗi
        if (finalStartDate === null) {
            return null;
        }

        // 3. ĐÓNG GÓI CHUỖI TRẢ VỀ AN TOÀN
        return {
            startDateStr: system.functions.str(finalStartDate),
            endDateStr: system.functions.str(finalEndDate),
            cleanDateStr: month + "/" + day + "/" + year
        };

    } catch (e) {
        print("-> [ESD_HTKT_Utils EXCEPTION]: " + e.toString());
        return null;
    }
}


/**
 * Ho tro render header HTKT:
 * - tieu de
 * - ma
 * - trang thai
 *
 * Trang thai duoc map tu ma workflow sang text hien thi + mau.
 */

function escapeHtml(input) {
    if (input === null || input === undefined) {
        return "";
    }

    return String(input)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function getPrepaymentStatusUI(status) {
    var statusMap = {
        "dmms_created": {
            label: "Tạo mới",
            backgroundColor: "#F4F5F7",
            textColor: "#6B778C"
        },
        "kttc_created": {
            label: "Tạo mới",
            backgroundColor: "#F4F5F7",
            textColor: "#6B778C"
        },
        "dmms_initiated": {
            label: "Chờ KTTC xử lý",
            backgroundColor: "#FFF1CC",
            textColor: "#D78B00"
        },
        "kttc_checked": {
            label: "Chờ phê duyệt đề nghị",
            backgroundColor: "#FFF1CC",
            textColor: "#D78B00"
        },
        "dmms_checked": {
            label: "Chờ phê duyệt đề nghị",
            backgroundColor: "#FFF1CC",
            textColor: "#D78B00"
        },
        "dmms_approved": {
            label: "Chờ phê duyệt đề nghị",
            backgroundColor: "#FFF1CC",
            textColor: "#D78B00"
        },
        "kttc_approved": {
            label: "Chờ phê duyệt đề nghị",
            backgroundColor: "#FFF1CC",
            textColor: "#D78B00"
        },
        "checked": {
            label: "Chờ phê duyệt đề nghị",
            backgroundColor: "#FFF1CC",
            textColor: "#D78B00"
        },
        "approved": {
            label: "Đã phê duyệt",
            backgroundColor: "#DEEBFF",
            textColor: "#0747A6"
        },
        "cancelled": {
            label: "Đã xóa",
            backgroundColor: "#FDEDEA",
            textColor: "#DE350B"
        },
        "request_edit": {
            label: "Chờ chỉnh sửa đề nghị",
            backgroundColor: "#FCE8D9",
            textColor: "#D97008"
        },
        "accounted": {
            label: "Đã hạch toán",
            backgroundColor: "#E3FCEF",
            textColor: "#1F845A"
        }
    };

    if (statusMap[status]) {
        return statusMap[status];
    }

    return {
        label: status || "",
        backgroundColor: "#F4F5F7",
        textColor: "#42526E"
    };
}

function getPaymentStatusUI(status) {
    var statusMap = {
        "dmms_created": {
            label: "Tạo mới",
            backgroundColor: "#F4F5F7",
            textColor: "#6B778C"
        },
        "kttc_created": {
            label: "Tạo mới",
            backgroundColor: "#F4F5F7",
            textColor: "#6B778C"
        },
        "dmms_initiated": {
            label: "Chờ KTTC xử lý",
            backgroundColor: "#FFF1CC",
            textColor: "#D78B00"
        },
        "kttc_checked": {
            label: "Chờ phê duyệt đề nghị",
            backgroundColor: "#FFF1CC",
            textColor: "#D78B00"
        },
        "dmms_checked": {
            label: "Chờ phê duyệt đề nghị",
            backgroundColor: "#FFF1CC",
            textColor: "#D78B00"
        },
        "dmms_approved": {
            label: "Chờ phê duyệt đề nghị",
            backgroundColor: "#FFF1CC",
            textColor: "#D78B00"
        },
        "kttc_approved": {
            label: "Chờ phê duyệt đề nghị",
            backgroundColor: "#FFF1CC",
            textColor: "#D78B00"
        },
        "checked": {
            label: "Chờ phê duyệt đề nghị",
            backgroundColor: "#FFF1CC",
            textColor: "#D78B00"
        },
        "approved": {
            label: "Đã phê duyệt",
            backgroundColor: "#DEEBFF",
            textColor: "#0747A6"
        },
        "cancelled": {
            label: "Đã xóa",
            backgroundColor: "#FDEDEA",
            textColor: "#DE350B"
        },
        "request_edit": {
            label: "Chờ chỉnh sửa đề nghị",
            backgroundColor: "#FCE8D9",
            textColor: "#D97008"
        },
        "accounted": {
            label: "Đã hạch toán",
            backgroundColor: "#E3FCEF",
            textColor: "#1F845A"
        }
    };

    if (statusMap[status]) {
        return statusMap[status];
    }

    return {
        label: status || "",
        backgroundColor: "#F4F5F7",
        textColor: "#42526E"
    };
}

// =========== Tạm ứng ==============
function getPrepaymentVendorStatusUI(status) {
    return {
        label: status ? 'Đã đồng bộ OGL' : 'Chưa đồng bộ OGL',
        backgroundColor: status ? '#E3FCEF' : '#F4F5F7',
        textColor: "#42526E"
    };
}

// ========= Thanh toán =============
function getPaymentVendorStatusUI(status) {
    return {
        label: status ? 'Đã đồng bộ OGL' : 'Chưa đồng bộ OGL',
        backgroundColor: status ? '#a0e3b2' : '#F4F5F7',
        textColor: "#1b5f2d"
    };
}


function getAccountingInforStatusUI(status) {
    return {
        label: status ? 'Đã đồng bộ OGL' : 'Chưa đồng bộ OGL',
        backgroundColor: status ? '#a0e3b2' : '#F4F5F7',
        textColor: "#1b5f2d"
    };
}

function renderStatus(status) {
  const normalized = String(status || '').trim().toUpperCase()
  
  let label = '---'
  let backgroundColor = '#E5E7EB'
  let color = '#4B5563'          
 
  if (normalized.includes('IN_QUEUE') || normalized.includes('ERROR') || normalized.includes('NEW') || normalized.includes('CREATED')) {
     label = 'Đang hạch toán'
     backgroundColor = '#FFF0C2'
     color = '#D97706'
  } else if (normalized.includes('ACCOUNTED')) {
     label = 'Đã hạch toán'
     backgroundColor = '#cff2d8'
     color = '#2e9e4c'
  }
  
  return {
    label,
    backgroundColor,
    color
  }
}


function renderAccountingInforHeaderStatus(title, id, statusUI, dynamicTextColor) {
    var safeTitle = escapeHtml(title || "");
    var safeId = escapeHtml(id || "");
    var safeStatusLabel = escapeHtml(statusUI.label || "");
    var idHtml = safeId ? `<span id="dynamicText" style="color:${dynamicTextColor || "#000000"};"> #${safeId}</span>` : "";
    var statusHtml = safeStatusLabel ? `
        <div class="status-wrap">
            <span class="status-name">${statusUI.paymentId ? "#"+statusUI.paymentId : ""} </span>
            <div class="status-text" style="background-color:${statusUI.backgroundColor};color:${statusUI.color};">${safeStatusLabel}</div>
        </div>` : "";

    var html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="../js/sl/css/base.css">
    <link rel="stylesheet" href="../js/sl/css/iconhpt.css">
    <style>
        html, body {
            margin: 0;
            padding: 0;
            background: transparent !important;
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
            overflow: hidden;
        }

        body, div, p, span {
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
        }

        .header-container {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin: 0;
            padding: 0;
            width: auto;
            max-width: 100%;
            background: transparent !important;
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
        }

        .header-title {
            margin: 0;
            padding: 0;
            font-size: 17px;
            font-weight: 600;
            color: #97A0AF;
            line-height: 1.4;
            white-space: nowrap;
        }

        .header-title span {
            color: #000000;
        }

        .status-wrap {
            display: inline-flex;
            align-items: center;
            margin: 0;
            padding: 0;
            background: transparent !important;
        }
        
        .status-name{
            font-weight: 600;
            font-size: 16px;
            margin-right: 10px        
        }

        .status-text {
            display: inline-block;
            margin: 0;
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 600;
            line-height: 18px;
            text-align: center;
            white-space: nowrap;
            border-radius: 8px;
        }
    </style>
</head>
<body>
<div class="header-container">
    <p class="header-title" title="${safeTitle}">${safeTitle}${idHtml}</p>
    ${statusHtml}
</div>
</body>
</html>`;

    return html;
}



function renderHeaderStatusPlain(title, id, statusUI, dynamicTextColor) {
    var safeTitle = escapeHtml(title || "");
    var safeId = escapeHtml(id || "");
    var safeStatusLabel = escapeHtml(statusUI.label || "");
    var idHtml = safeId ? `<span id="dynamicText" style="color:${dynamicTextColor || "#000000"};"> #${safeId}</span>` : "";
    var statusHtml = safeStatusLabel ? `
        <div class="status-wrap">
            <span class="status-name">${statusUI.vendorNumber ? "#"+statusUI.vendorNumber : ""} </span>
            <div class="status-text" style="background-color:${statusUI.backgroundColor};color:${statusUI.textColor};">${safeStatusLabel}</div>
        </div>` : "";

    var html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="stylesheet" href="../js/sl/css/base.css">
    <link rel="stylesheet" href="../js/sl/css/iconhpt.css">
    <style>
        html, body {
            margin: 0;
            padding: 0;
            background: transparent !important;
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
            overflow: hidden;
        }

        body, div, p, span {
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
        }

        .header-container {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            margin: 0;
            padding: 0;
            width: auto;
            max-width: 100%;
            background: transparent !important;
            border: none !important;
            outline: none !important;
            box-shadow: none !important;
        }

        .header-title {
            margin: 0;
            padding: 0;
            font-size: 17px;
            font-weight: 600;
            color: #97A0AF;
            line-height: 1.4;
            white-space: nowrap;
        }

        .header-title span {
            color: #000000;
        }

        .status-wrap {
            display: inline-flex;
            align-items: center;
            margin: 0;
            padding: 0;
            background: transparent !important;
        }
        
        .status-name{
            font-weight: 600;
            font-size: 16px;
            margin-right: 10px        
        }

        .status-text {
            display: inline-block;
            margin: 0;
            padding: 6px 12px;
            font-size: 13px;
            font-weight: 600;
            line-height: 18px;
            text-align: center;
            white-space: nowrap;
            border-radius: 8px;
        }
    </style>
</head>
<body>
<div class="header-container">
    <p class="header-title" title="${safeTitle}">${safeTitle}${idHtml}</p>
    ${statusHtml}
</div>
</body>
</html>`;

    return html;
}

function formatDateToISOWithOffset(date = new Date()) {
  const pad = (num, length = 2) => String(num).padStart(length, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  const seconds = pad(date.getSeconds());

  const microseconds = pad(date.getMilliseconds(), 3) + '000';

  const tzo = -date.getTimezoneOffset();
  const diffSign = tzo >= 0 ? '+' : '-';
  const tzHours = pad(Math.floor(Math.abs(tzo) / 60));
  const tzMinutes = pad(Math.abs(tzo) % 60);
  const timezoneOffset = `${diffSign}${tzHours}:${tzMinutes}`;

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${microseconds}${timezoneOffset}`;
}

function formatDateToISO(date = new Date()) {
  const pad = (num, length = 2) => String(num).padStart(length, '0');

  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());

  return `${year}-${month}-${day}`;
}

function formatDateToISOWithOffset2(date = new Date()) {
    const pad = (num) => String(num).padStart(2, '0');

    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    const seconds = pad(date.getSeconds());

    const offsetMinutes = date.getTimezoneOffset();
    const offsetSign = offsetMinutes <= 0 ? '+' : '-';
    const absOffset = Math.abs(offsetMinutes);
    const offsetHours = pad(Math.floor(absOffset / 60));
    const offsetMins = pad(absOffset % 60);

    return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${offsetSign}${offsetHours}:${offsetMins}`;
} 

/**
 * Lấy item.name từ bảng esdDMcategoryItems dựa trên category.id hoặc item.id
 * 
 * @param {Object} params - Tham số tìm kiếm
 * @param {string} [params.categoryId] - ID của category (tuỳ chọn)
 * @param {string} [params.itemId] - ID của item (tuỳ chọn)
 * @param {string} [params.defaultValue=""] - Giá trị trả về mặc định nếu không tìm thấy
 * @returns {string} - Giá trị item.name hoặc defaultValue
 */
function getItemNameFromConfig(params) {
    params = params || {};
    var categoryId = params.categoryId;
    var itemId = params.itemId;
    var defaultValue = params.defaultValue !== undefined ? params.defaultValue : "";

    // Bắt buộc phải truyền ít nhất 1 điều kiện tìm kiếm
    if (!categoryId && !itemId) {
        return defaultValue;
    }

    var categoryFile = new SCFile("esdDMcategoryItems");
    var queryParts = [];

    if (categoryId) {
        queryParts.push('category.id="' + categoryId + '"');
    }
    if (itemId) {
        queryParts.push('item.id="' + itemId + '"');
    }

    // Ghép điều kiện query (dùng AND nếu truyền cả 2)
    var query = queryParts.join(" and ");

    try {
        if (categoryFile.doSelect(query) === RC_SUCCESS) {
            // Trả về item.name nếu có giá trị, ngược lại trả về defaultValue
            return categoryFile["item.name"] ? categoryFile["item.name"] : defaultValue;
        }
    } catch (e) {
        print("Error in getItemNameFromConfig: " + e.toString());
    }

    return defaultValue;
}

function isValidOpenCloseTime(timeStr) {
    // Biểu thức chính quy cho định dạng 00:00 - 23:59
    var regex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    return regex.test(timeStr);
}

function createSchedule(params) {
    if (!params || !params.name || !params.script) return;
    var schedule = new SCFile("schedule");
    var className = "ESD_Schedule_Signature_HTKT";
    var actionDelaySeconds = (typeof params.actionDelaySeconds === "number") ? params.actionDelaySeconds : 1;
    var now = new Date();
    
    var actionTime = new Date(now.getTime());
    actionTime.setSeconds(actionTime.getSeconds() + actionDelaySeconds);
    
    var expirationTime = new Date(now.getTime());
    expirationTime.setSeconds(expirationTime.getSeconds() + actionDelaySeconds + 1);
    
    var query = 'name="' + params.name + '"';
    var rc = schedule.doSelect(query);

    schedule._class = className;
    schedule["sched.class"] = className;
    schedule["expiration"] = expirationTime;
    schedule.status = "scheduled";
    schedule.javascript = params.script;

    if (rc == RC_SUCCESS) {
        schedule["action.time"] = actionTime;
        schedule.doUpdate();
    } else {
        schedule.name = params.name;
        schedule.doInsert();
    }
}

// =========================================================
// ESD_HTKT_Utils
// Xử lý tiền chính xác bằng STRING (Đã tối ưu số âm và lọc dấu phẩy)
// =========================================================

function normalizeMoneyString(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return "0";
    }

    var str = String(value).trim();
    
    // 1. Kiểm tra xem có dấu trừ ở đầu hay không để xử lý số âm
    var isNegative = false;
    if (str.charAt(0) === '-') {
        isNegative = true;
        str = str.substring(1); // Tạm cắt dấu trừ ra
    }

    // 2. LOẠI BỎ HOÀN TOÀN DẤU PHẨY (,) (Dấu phân tách hàng nghìn) và khoảng trắng
    str = str.replace(/[, ]/g, "");

    // 3. Chỉ giữ lại: số (0-9) và dấu chấm (.)
    str = str.replace(/[^0-9.]/g, "");

    if (str === "" || str === ".") {
        return "0";
    }

    // 4. Trả lại dấu trừ nếu là số âm
    return isNegative ? "-" + str : str;
}


// =========================================================
// CỘNG 2 SỐ DƯƠNG (Hàm phụ trợ cho addStringsManual)
// =========================================================
function addPositiveStrings(num1, num2) {
    num1 = normalizeMoneyString(num1);
    num2 = normalizeMoneyString(num2);

    var parts1 = num1.split(".");
    var parts2 = num2.split(".");

    var int1 = parts1[0] || "0";
    var int2 = parts2[0] || "0";

    var dec1 = parts1.length > 1 ? parts1[1] : "00";
    var dec2 = parts2.length > 1 ? parts2[1] : "00";

    var maxDecLen = Math.max(dec1.length, dec2.length);

    while (dec1.length < maxDecLen) dec1 += "0";
    while (dec2.length < maxDecLen) dec2 += "0";

    var maxIntLen = Math.max(int1.length, int2.length);

    while (int1.length < maxIntLen) int1 = "0" + int1;
    while (int2.length < maxIntLen) int2 = "0" + int2;

    var str1 = int1 + dec1;
    var str2 = int2 + dec2;

    var carry = 0;
    var result = "";

    for (var i = str1.length - 1; i >= 0; i--) {
        var digit1 = parseInt(str1.charAt(i), 10);
        var digit2 = parseInt(str2.charAt(i), 10);

        var sum = digit1 + digit2 + carry;

        result = (sum % 10) + result;
        carry = Math.floor(sum / 10);
    }

    if (carry > 0) {
        result = carry + result;
    }

    if (maxDecLen > 0) {
        var intPart = result.substring(0, result.length - maxDecLen);
        var decPart = result.substring(result.length - maxDecLen);

        intPart = intPart.replace(/^0+(?=\d)/, "");

        if (parseInt(decPart, 10) === 0) {
            return intPart !== "" ? intPart : "0";
        }

        return (intPart !== "" ? intPart : "0") + "." + decPart;
    }

    return result.replace(/^0+(?=\d)/, "") || "0";
}


// =========================================================
// CỘNG 2 SỐ TIỀN (Đã hỗ trợ đầy đủ số âm/dương)
// =========================================================
function addStringsManual(num1, num2) {
    num1 = normalizeMoneyString(num1);
    num2 = normalizeMoneyString(num2);

    var isNeg1 = (num1.charAt(0) === '-');
    var isNeg2 = (num2.charAt(0) === '-');

    if (isNeg1) num1 = num1.substring(1);
    if (isNeg2) num2 = num2.substring(1);

    // Trường hợp 1: (-a) + (-b) = -(a + b)
    if (isNeg1 && isNeg2) {
        var res = addPositiveStrings(num1, num2);
        return res === "0" ? "0" : "-" + res;
    }

    // Trường hợp 2: (-a) + b = b - a (Tương đương subtractStringsManual(b, a))
    if (isNeg1 && !isNeg2) {
        return subtractStringsManual(num2, num1);
    }

    // Trường hợp 3: a + (-b) = a - b (Tương đương subtractStringsManual(a, b))
    if (!isNeg1 && isNeg2) {
        return subtractStringsManual(num1, num2);
    }

    // Trường hợp 4: a + b (Cả 2 đều dương)
    return addPositiveStrings(num1, num2);
}


// =========================================================
// SO SÁNH 2 SỐ TIỀN (Đã hỗ trợ số âm)
//
//  1  => num1 > num2
//  0  => num1 = num2
// -1  => num1 < num2
// =========================================================
function compareMoneyStrings(num1, num2) {
    num1 = normalizeMoneyString(num1);
    num2 = normalizeMoneyString(num2);

    if (num1 === "-0") num1 = "0";
    if (num2 === "-0") num2 = "0";

    var isNeg1 = (num1.charAt(0) === '-');
    var isNeg2 = (num2.charAt(0) === '-');

    // Nếu num1 âm, num2 dương => num1 < num2
    if (isNeg1 && !isNeg2) return -1;
    
    // Nếu num1 dương, num2 âm => num1 > num2
    if (!isNeg1 && isNeg2) return 1;

    // Nếu cả 2 đều âm => Bỏ dấu âm, so sánh ngược lại (-100 > -300 vì |-100| < |-300|)
    if (isNeg1 && isNeg2) {
        var abs1 = num1.substring(1);
        var abs2 = num2.substring(1);
        return compareMoneyStrings(abs2, abs1);
    }

    var parts1 = num1.split(".");
    var parts2 = num2.split(".");

    var int1 = parts1[0] || "0";
    var int2 = parts2[0] || "0";

    var dec1 = parts1.length > 1 ? parts1[1] : "00";
    var dec2 = parts2.length > 1 ? parts2[1] : "00";

    int1 = int1.replace(/^0+/, "") || "0";
    int2 = int2.replace(/^0+/, "") || "0";

    if (int1.length > int2.length) return 1;
    if (int1.length < int2.length) return -1;
    if (int1 > int2) return 1;
    if (int1 < int2) return -1;

    var maxDecLen = Math.max(dec1.length, dec2.length);

    while (dec1.length < maxDecLen) dec1 += "0";
    while (dec2.length < maxDecLen) dec2 += "0";

    if (dec1 > dec2) return 1;
    if (dec1 < dec2) return -1;

    return 0;
}


// =========================================================
// TRỪ 2 SỐ DƯƠNG
// num1 phải >= num2
// =========================================================
function subtractPositiveStrings(num1, num2) {
    num1 = normalizeMoneyString(num1);
    num2 = normalizeMoneyString(num2);

    var parts1 = num1.split(".");
    var parts2 = num2.split(".");

    var int1 = parts1[0] || "0";
    var int2 = parts2[0] || "0";

    var dec1 = parts1.length > 1 ? parts1[1] : "00";
    var dec2 = parts2.length > 1 ? parts2[1] : "00";

    var maxDecLen = Math.max(dec1.length, dec2.length);

    while (dec1.length < maxDecLen) dec1 += "0";
    while (dec2.length < maxDecLen) dec2 += "0";

    var maxIntLen = Math.max(int1.length, int2.length);

    while (int1.length < maxIntLen) int1 = "0" + int1;
    while (int2.length < maxIntLen) int2 = "0" + int2;

    var str1 = int1 + dec1;
    var str2 = int2 + dec2;

    var borrow = 0;
    var result = "";

    for (var i = str1.length - 1; i >= 0; i--) {
        var digit1 = parseInt(str1.charAt(i), 10);
        var digit2 = parseInt(str2.charAt(i), 10);

        digit1 = digit1 - borrow;

        if (digit1 < digit2) {
            digit1 += 10;
            borrow = 1;
        } else {
            borrow = 0;
        }

        result = (digit1 - digit2) + result;
    }

    var intPart = result.substring(0, result.length - maxDecLen);
    var decPart = result.substring(result.length - maxDecLen);

    intPart = intPart.replace(/^0+(?=\d)/, "") || "0";

    while (decPart.length < 2) decPart += "0";

    if (parseInt(decPart, 10) === 0) {
        return intPart;
    }

    return intPart + "." + decPart;
}


// =========================================================
// TRỪ 2 SỐ TIỀN
// Có thể trả về số âm
// =========================================================
function subtractStringsManual(num1, num2) {
    num1 = normalizeMoneyString(num1);
    num2 = normalizeMoneyString(num2);

    var isNegative1 = (num1.charAt(0) == "-");
    var isNegative2 = (num2.charAt(0) == "-");

    if (isNegative1) num1 = num1.substring(1);
    if (isNegative2) num2 = num2.substring(1);

    // a - (-b) = a + b
    if (!isNegative1 && isNegative2) {
        return addStringsManual(num1, num2);
    }

    // (-a) - b = -(a + b)
    if (isNegative1 && !isNegative2) {
        var negativeResult = addPositiveStrings(num1, num2);
        if (negativeResult == "0") return "0";
        return "-" + negativeResult;
    }

    // (-a) - (-b) = (-a) + b = b - a
    if (isNegative1 && isNegative2) {
        return subtractStringsManual(num2, num1);
    }

    var compare = compareMoneyStrings(num1, num2);

    if (compare == 0) return "0";
    if (compare > 0) return subtractPositiveStrings(num1, num2);

    return "-" + subtractPositiveStrings(num2, num1);
}



// Lấy scope HTKT của người đăng nhập; trả chuỗi rỗng nếu chưa có phân quyền.
function getCurrentUserScope() {
    var contactId = String(vars["$lo.contact.name"] || "").trim();
    if (!contactId) return "";

    var permissions = lib.ESD_PERMS_RIGHTS.getUnitByDataPermissions(contactId, "00401") || {};
    return String(permissions.scope || "").trim();
}

// Chỉ trả thông tin đơn vị, mã liên hệ và email; null nếu không tìm thấy.
function getCurrentUserContact() {
    var contactId = String(vars["$lo.contact.name"] || "").trim();
    if (!contactId) return null;

    var contactFile = new SCFile("contacts", SCFILE_READONLY);
    var queryValue = contactId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    try {
        contactFile.setFields(["lv1.id", "lv2.id", "contact.name", "email"]);
        if (contactFile.doSelect('contact.name="' + queryValue + '"') == RC_SUCCESS) {
            return {
                "lv1.id": String(contactFile["lv1.id"] || ""),
                "lv2.id": String(contactFile["lv2.id"] || ""),
                "contact.name": String(contactFile["contact.name"] || ""),
                "email": String(contactFile["email"] || "")
            };
        }
        return null;
    } finally {
        contactFile.doClose();
    }
}

