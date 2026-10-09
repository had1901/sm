try {
    if (system.functions.filename(vars.$L_file) == "ModuleStatus") {
        lib.custom.selectWfPhaseByWorkflow(vars.$L_file.workflow);
    }

    // Custom back action
    var table = system.functions.filename(vars.$L_file);
    lib.ESD_Utils.backQueue(table);

    vars['$G.payment.id'] = vars.$L_file.id;
    vars['$G.payment.status'] = vars.$L_file.status;
    vars['$G.contract.id'] = vars.$L_file.contract_id;
} catch (e) { }

var record = vars.$L_file;

vars.$showTab = false;
vars.$descriptionReadOnly = !lib.ESD_HTKT_PAYMENT_WF.canEditInCurrenPhase(vars.$L_file);
vars.$hideApprovalKttc = record['created.by'] == vars.$lo_operator["contact.name"] && record['initial.role'] == 'dmms';

var accountingCurrentUser = vars.$lo_operator
    ? String(vars.$lo_operator["contact.name"] || "").trim().toLowerCase()
    : "";
var accountingInitialRole = record
    ? String(record["initial.role"] || "").trim().toLowerCase()
    : "";
var accountingCreatedBy = record
    ? String(record["created.by"] || "").trim().toLowerCase()
    : "";
var accountingCurrentPhase = record
    ? String(record["current.phase"] || "").trim().toLowerCase()
    : "";
var paymentStatus = record
    ? String(record["status"] || "").trim().toLowerCase()
    : "";

vars["$showAccountingTab"] = !(
    accountingInitialRole == "dmms" &&
    accountingCurrentUser != "" &&
    accountingCurrentUser == accountingCreatedBy
);

vars["$showAttachmentTab"] = !(
    accountingInitialRole == "kttc" &&
    accountingCurrentUser != ""
);

print('[DS] record role= ', record["initial.role"]);
print('[DS] accountingCurrentUser = ', vars["$showAttachmentTab"]);
// chỉ hiển thị tab Kết quả giao dịch khi quy trình kết thúc và phiếu không bị hủy
vars["$showAccountingResultTab"] =
    accountingCurrentPhase == "end" &&
    paymentStatus != "cancelled";

if (vars.$L_file.department) {
    var unitId = vars.$L_file.department;
    try {
        var orgUnitFile = new SCFile("esdQTorgUnit", SCFILE_READONLY);
        if (orgUnitFile.doSelect("unit.id=\"" + unitId + "\"") == RC_SUCCESS) {
            vars.$departmentName = orgUnitFile["unit.name"];
        }
        orgUnitFile.doClose();
    } catch (eDept) { }
}


vars.$totalContractAmount = "0";
vars.$totalPrepaymentAndPayment = "0";
vars.$remainingContractValue = "0";   // (3) Tổng giá trị HĐ/KMS còn lại

var contractId = vars.$L_file.contract_id;

if (contractId) {
    try {
        var totalPrepaymentAndPayment = "0";

        // =====================================================
        // 1. LẤY TỔNG GIÁ TRỊ ĐÃ TẠM ỨNG & THANH TOÁN TỪ HỢP ĐỒNG
        // =====================================================
        var contractFile = new SCFile("esdHDcontract", SCFILE_READONLY);
        
        // Chú ý: Sửa 'id' thành tên trường khóa chính thực tế của bảng esdHDcontract (vd: 'contract.id') nếu cần.
        var sqlContract = 'id="' + contractId + '"'; 
        
        if (contractFile.doSelect(sqlContract) === RC_SUCCESS) {
            var rawTotalPaid = contractFile["total.paid.amount"];
            
            // Xử lý an toàn: Nếu khác null và không phải chuỗi rỗng thì mới gán
            if (rawTotalPaid != null && String(rawTotalPaid).trim() !== "") {
                totalPrepaymentAndPayment = String(rawTotalPaid).trim();
            }
        }
        contractFile.doClose();

        // =====================================================
        // 2. TÍNH GIÁ TRỊ HĐ/KMS CÒN LẠI
        // =====================================================
        var currentContractAmount = String(record["total.contract.amount"] || "0").trim();
        // Bắt lỗi thêm cho giá trị hợp đồng phòng trường hợp cũng bị rỗng
        if (currentContractAmount === "") {
            currentContractAmount = "0";
        }
        
        var remainingContractValue = lib.ESD_HTKT_Utils.subtractStringsManual(
            currentContractAmount,
            totalPrepaymentAndPayment
        );

        // =====================================================
        // 3. KIỂM TRA NẾU KẾT QUẢ LÀ SỐ ÂM THÌ ĐẶT VỀ "0"
        // =====================================================
        if (
            remainingContractValue && 
            (remainingContractValue.charAt(0) === "-" || 
             lib.ESD_HTKT_Utils.compareMoneyStrings(remainingContractValue, "0") < 0)
        ) {
            remainingContractValue = "0";
        }

        // =====================================================
        // 4. GÁN KẾT QUẢ VÀO BIẾN HIỂN THỊ
        // =====================================================
        vars.$totalPrepaymentAndPayment = totalPrepaymentAndPayment;
        vars.$remainingContractValue = remainingContractValue;

    } catch (eCalc) {
        print("ERROR CALCULATE MONEY: " + eCalc);
    }
}

vars['$showWF'] = lib.ESD_ENV_CONFIG.getENV() == "SIT";