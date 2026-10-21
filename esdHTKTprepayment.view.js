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
vars.$descriptionReadOnly =
    !lib.ESD_HTKT_PREPAYMENT_WF.canEditInCurrenPhase(record);

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

/*
Đã tắt query tên phòng ban và Khối/CN.
FD đọc trực tiếp các trường trên bản ghi:
- Khối/CN/ĐVSN: unit.lv1.name
- Phòng ban/TT ĐNTU: unit.lv2.name

// Tên phòng ban.
vars.$departmentName = "";

if (record.department) {
    var orgUnitFile = null;

    try {
        orgUnitFile = new SCFile("esdQTorgUnit", SCFILE_READONLY);

        if (
            orgUnitFile.doSelect(
                'unit.id="' +
                escapePrepaymentDsQuery(record.department) +
                '"'
            ) == RC_SUCCESS
        ) {
            vars.$departmentName = orgUnitFile["unit.name"];
        }
    } catch (eDept) {
    } finally {
        closePrepaymentDsFile(orgUnitFile);
    }
}

// Tên Khối/CN của người tạo phiếu.
vars.$unitLv1Name = "";

var creatorName = String(record["created.by"] || "").trim();
var creatorLv1Id = "";

if (creatorName) {
    var creatorContactFile = null;

    try {
        creatorContactFile = new SCFile("contacts", SCFILE_READONLY);

        if (
            creatorContactFile.doSelect(
                'contact.name="' +
                escapePrepaymentDsQuery(creatorName) +
                '"'
            ) == RC_SUCCESS
        ) {
            // Giữ mapping đang có trong DS gốc.
            creatorLv1Id = String(
                creatorContactFile["lv1.id"] ||
                creatorContactFile.lv1_id ||
                ""
            ).trim();
        }
    } catch (eCreatorContact) {
    } finally {
        closePrepaymentDsFile(creatorContactFile);
    }
}

if (creatorLv1Id) {
    var orgUnitLv1File = null;

    try {
        orgUnitLv1File = new SCFile("esdQTorgUnit", SCFILE_READONLY);

        if (
            orgUnitLv1File.doSelect(
                'unit.id="' +
                escapePrepaymentDsQuery(creatorLv1Id) +
                '"'
            ) == RC_SUCCESS
        ) {
            vars.$unitLv1Name = orgUnitLv1File["unit.name"];
        }
    } catch (eLv1) {
    } finally {
        closePrepaymentDsFile(orgUnitLv1File);
    }
}
*/

// Nạp danh sách người phê duyệt.
//try {
//    lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX
//        .loadPrepaymentApprovalComboBoxes(record);
//} catch (eApprovalCombo) {
//    vars["$L.kttc.ids"] = [];
//    vars["$L.kttc.names"] = [];
//    vars["$L.dmms.ids"] = [];
//    vars["$L.dmms.rs1"] = [];
//    vars["$L.dmms.approval1.ids"] = [];
//    vars["$L.dmms.approval1"] = [];
//    vars["$L.kttc.approve2.ids"] = [];
//    vars["$L.kttc.approve2"] = [];
//    vars["$L.kttc.check2.ids"] = [];
//    vars["$L.kttc.check2"] = [];
//    vars["$L.approve.all.ids"] = [];
//    vars["$L.approve.all"] = [];
//}

// Xác định vai trò độc lập với việc nạp combobox.
//vars["$isKttc"] = false;
//vars["$isDmms"] = false;
//
//if (currentUser) {
//    try {
//        var currentPrepaymentRole =
//            lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX
//                .getPrepaymentRoleByRights(currentUser);
//
//        vars["$isKttc"] = currentPrepaymentRole == "kttc";
//        vars["$isDmms"] = currentPrepaymentRole == "dmms";
//    } catch (eRole) {}
//}

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