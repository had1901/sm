var record = vars.$L_file;

// Escape giá trị đưa vào điều kiện truy vấn SM.
function escapePrepaymentDsQuery(value) {
    return String(value == null ? "" : value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}

// Đóng SCFile an toàn, kể cả khi truy vấn phát sinh lỗi.
function closePrepaymentDsFile(file) {
    if (file) {
        try {
            file.doClose();
        } catch (eClose) {}
    }
}

try {
    var table = system.functions.filename(record);

    if (table == "ModuleStatus") {
        lib.custom.selectWfPhaseByWorkflow(record.workflow);
    }

    lib.ESD_Utils.backQueue(table);

    vars["$G.prepayment.id"] = record.id;
    vars["$G.prepayment.status"] = record.status;
    vars["$G.contract.id"] = record.contract_id;
} catch (eInit) {}

// Quyền chỉnh sửa thông tin tạm ứng.
vars.$descriptionReadOnly = vars["$G.fromHK"] || !lib.ESD_HTKT_PREPAYMENT_WF.canEditInCurrenPhase(record);

//vars.$approvalLv1ReadOnly =
//    !lib.ESD_HTKT_PREPAYMENT_WF.canUpdateApprovalInfo(
//        record,
//        "require.check.level1"
//    );
//
//vars.$approvalLv2ReadOnly =
//    !lib.ESD_HTKT_PREPAYMENT_WF.canUpdateApprovalInfo(
//        record,
//        "require.check.level2"
//    );

// Giữ tên đăng nhập gốc để truyền vào hàm kiểm tra quyền.
var currentUser = vars.$lo_operator
    ? String(vars.$lo_operator["contact.name"] || "").trim()
    : "";

var accountingCurrentUser = currentUser.toLowerCase();
var accountingInitialRole = String(
    record["initial.role"] || ""
).trim().toLowerCase();
var accountingCreatedBy = String(
    record["created.by"] || ""
).trim().toLowerCase();
var accountingCurrentPhase = String(
    record["current.phase"] || ""
).trim().toLowerCase();
var prepaymentStatus = String(
    record["status"] || ""
).trim().toLowerCase();

// Chỉ ẩn với chính người ĐMMS khởi tạo phiếu.
var isDmmsCreator =
    accountingInitialRole == "dmms" &&
    accountingCurrentUser != "" &&
    accountingCurrentUser == accountingCreatedBy;

vars.$hideApprovalKttc = isDmmsCreator;
vars["$showAccountingTab"] = !isDmmsCreator;

// Chỉ hiển thị kết quả khi quy trình kết thúc và phiếu không bị hủy.
vars["$showAccountingResultTab"] =
    accountingCurrentPhase == "end" &&
    prepaymentStatus != "cancelled";

// Giá trị hiển thị mặc định.
vars.$totalPrepayment = "0";
vars.$totalPayment = "0";
vars.$remainingContractValue = "0";
vars.$totalPrepaymentAndPayment = "0";

var contractId = record.contract_id;

if (contractId) {
    var contractFile = null;
    var totalPrepaymentAndPayment = "0";

    try {
        contractFile = new SCFile("esdHDcontract", SCFILE_READONLY);

        if (
            contractFile.doSelect(
                'id="' + escapePrepaymentDsQuery(contractId) + '"'
            ) == RC_SUCCESS
        ) {
            var rawTotalPaid = contractFile["total.paid.amount"];

            if (
                rawTotalPaid != null &&
                String(rawTotalPaid).trim() != ""
            ) {
                totalPrepaymentAndPayment = String(rawTotalPaid).trim();
            }
        }
    } catch (eContract) {
        print("ERROR LOAD CONTRACT AMOUNT: " + eContract);
    } finally {
        closePrepaymentDsFile(contractFile);
    }

    vars.$totalPrepaymentAndPayment = totalPrepaymentAndPayment;

    try {
        // Tạm ứng sử dụng contract_amount, giữ đúng field của DS gốc.
        var currentContractAmount = String(
            record.contract_amount || "0"
        ).trim();

        if (currentContractAmount == "") {
            currentContractAmount = "0";
        }

        var remainingContractValue =
            lib.ESD_HTKT_Utils.subtractStringsManual(
                currentContractAmount,
                totalPrepaymentAndPayment
            );

        // Giống thanh toán: giá trị còn lại âm thì hiển thị 0.
        if (
            remainingContractValue &&
            (
                remainingContractValue.charAt(0) == "-" ||
                lib.ESD_HTKT_Utils.compareMoneyStrings(
                    remainingContractValue,
                    "0"
                ) < 0
            )
        ) {
            remainingContractValue = "0";
        }

        vars.$remainingContractValue = remainingContractValue;
    } catch (eCalc) {
        print("ERROR CALCULATE MONEY: " + eCalc);
    }
}

vars["$showWF"] = lib.ESD_ENV_CONFIG.getENV() == "SIT";

// Chọn form chi tiết theo menu đã mở danh sách.
var prepaymentMenuContext = String(
    vars["$G.HTKT_PREPAYMENT_MENU_CONTEXT"] || ""
).trim().toLowerCase();

//vars["$L.format"] = prepaymentMenuContext === "post_audit"
//    ? "esdHTKTprepaymentPostaudit.view"
//    : "esdHTKTprepayment.view";

//print(
//    "[PREPAYMENT_FORMAT] context=" + prepaymentMenuContext +
//    " format=" + vars["$L.format"]
//);