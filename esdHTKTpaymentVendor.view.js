
try {
    if (system.functions.filename(vars.$L_file) == "ModuleStatus") {
        lib.custom.selectWfPhaseByWorkflow(vars.$L_file.workflow);
    }

    //custom back action
    var table = system.functions.filename(vars.$L_file);
    lib.ESD_Utils.backQueue(table);
} catch (e) { }

vars.$ReadOnly = !lib.ESD_HTKT_PAYMENT_WF.canEditInCurrenPhase(vars.$L_file);
vars.$L_mode = "view";
vars.$showSyncVendorOgl = false;
vars.$canEditSite = false;
vars.$vendorSiteOptValue = [];
vars.$vendorSiteOptDisp = [];
vars.$canEditObj = false; 
vars.$canEditAmount = false;
vars.$canEditRefundAmount = false;
arrVendors = []

var paymentId = String(vars.$L_file["payment.id"] || vars.$L_file.payment_id || "");
var contractId = String(vars.$L_file["contract.id"] || vars.$L_file.contract_id || "");
var paymentPrefix = paymentId.split(".")[0].toUpperCase();
var isPayment = paymentPrefix === "TT";
var isExpense = paymentPrefix === "DC";
var isPostAuditPaymentVendorView = isPayment &&
    String(vars["$G.HTKT_PAYMENT_MENU_CONTEXT"] || "").trim().toLowerCase() === "post_audit" ||
    isExpense && String(vars["$G.HTKT_DUCHI_MENU_CONTEXT"] || "").trim().toLowerCase() === "post_audit";
vars.$isPayment = isPayment;
vars.$isExpense = isExpense;
var isXDCB = vars.$L_file["original.contract.category"] === "XDCB";

if (isExpense) {
//    lib.ESD_HTKT_EXPENSE_VENDOR.loadPaymentVendorInfo(vars.$L_file);
//    vars.$canEditAmount = vars.$canEditObj && !lib.ESD_HTKT_EXPENSE_VENDOR.hasExpenseVendorInvoices(vars.$L_file);
//    var expenseContractContext = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseSupplierContext(vars.$L_file, "", false);
//    var contractInfo;
//    
//    if (expenseContractContext.category === "XDCB") {
//        // Chỉ XDCB lấy HĐ S4 và hiển thị contract.code; khóa trên món vẫn là contract.id.
//        contractInfo = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseContractInfo(vars.$L_file);
//        vars.$contractId = contractInfo.code || contractInfo.id;
//    } else {
//        // HHDV giữ nguyên getter HĐ S2 và cách điền mã như trước tích hợp.
//        contractInfo = lib.ESD_HTKT_PAYMENT_VENDOR.getContractInfo(contractId);
//        vars.$contractId = contractInfo.id;
//    }

    var expenseContractContext = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseSupplierContext(vars.$L_file, "", false);
    var contractInfo;
    if (expenseContractContext.category === "XDCB") {
        // Gọi thẳng loader S4 để DS không đi qua loader S2 cũ; bind danh sách trong scope của DS.
        arrVendors = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.loadExpenseSupplierScreen(vars.$L_file);
        // XDCB lấy HĐ S4 bằng ID và hiển thị cùng mã đã lưu trong contract.id của món.
        contractInfo = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseContractInfo(vars.$L_file);
        vars.$contractId = contractInfo.id;
    } else {
        // HHDV giữ loader/getter S2 cũ; loader tự điền biến và có thể không trả về mảng.
        lib.ESD_HTKT_EXPENSE_VENDOR.loadPaymentVendorInfo(vars.$L_file);
        contractInfo = lib.ESD_HTKT_PAYMENT_VENDOR.getContractInfo(contractId);
        vars.$contractId = contractInfo.id;
    }
    
    vars.$canEditAmount = vars.$canEditObj;
    vars.$canEditRefundAmount = vars.$canEditObj;
    
    vars.$contractName = contractInfo.name;
    vars.$contractCategoryCode = contractInfo.category;
    vars.$contractCategory = contractInfo.categoryName;
    vars.$contractStartDate = contractInfo.startDate;
    vars.$totalContractValue = contractInfo.totalValue;
    vars.$totalPaidAmount = contractInfo.totalPaidAmount;
    vars.$contractRemainingAmount = contractInfo.remainingAmount;
} else if (isPayment) {
    // TT S4 nhận mảng trong scope DS; HHDV giữ lời gọi và cách bind loader S2 cũ.
    if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(vars.$L_file)) {
        arrVendors = lib.ESD_HTKT_PAYMENT_VENDOR.loadPaymentXdcbVendorInfo(vars.$L_file);
    } else {
        lib.ESD_HTKT_PAYMENT_VENDOR.loadPaymentVendorInfo(vars.$L_file);
    }
    vars.$canEditAmount = vars.$canEditObj;
}

if (isPostAuditPaymentVendorView) {
    vars.$ReadOnly = true;
    vars.$canEditSite = false;
    vars.$canEditObj = false;
    vars.$canEditAmount = false;
    vars.$canEditRefundAmount = false;
    vars.$showSyncVendorOgl = false;
}

vars.$paymentVendorPostAuditReadOnly = isPostAuditPaymentVendorView;
vars.$paymentVendorSiteReadOnly = vars.$ReadOnly || !vars.$canEditSite;
vars.$paymentVendorAmountReadOnly = vars.$ReadOnly || !vars.$canEditAmount;

var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(vars.$unitLv1);
if (entityInfo && entityInfo.entity && entityInfo.oglBranchCode) {
    vars.$entityCode = entityInfo.entity;
    vars.$branchCode = entityInfo.oglBranchCode.length == 4 ? entityInfo.oglBranchCode.substr(1, 4) : entityInfo.oglBranchCode;
    if (vars.$branchCode && vars.$L_file.vendor_id) {
        var result = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorSiteList(vars.$L_file.vendor_id, vars.$branchCode);
        if (result && result.length > 0) {
            // Site XDCB chỉ hiển thị đúng hạng mục; không chọn nhầm site HHDV cùng NCC.
            var sourceContext = isExpense
                ? lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseSupplierContext(vars.$L_file, "", false) : null;
            if ((sourceContext && sourceContext.category === "XDCB") ||
                    (isPayment && lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(vars.$L_file))) {
                var xdcbSiteConfig = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo("XDCB");
                var xdcbSite = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseXdcbSite(
                    vars.$L_file.vendor_id, vars.$branchCode, xdcbSiteConfig.siteCode);
                result = xdcbSite ? [xdcbSite] : [];
            }
            vars.$vendorSiteOptValue = [];
            vars.$vendorSiteOptDisp = [];
            result.forEach(x => {
                vars.$vendorSiteOptValue.push(x['id']);
                vars.$vendorSiteOptDisp.push(x['ogl.site.code']);
            });
            // =================================================================
            // AUTO-FILL SITE NCC
            // =================================================================
            if (vars.$canEditSite && (!vars.$L_file.vendor_site_id || vars.$L_file.vendor_site_id == "")) {
                if (result.length > 0) {
                    var matchedSite = null;
                    
                    // Lấy cấu hình Default Site tương ứng (XDCB hoặc HHDV chung)
                    var defaultSiteInfo = isXDCB 
                        ? lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo("XDCB") 
                        : lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();

                    // 1. Thử tìm xem có site nào khớp với cấu hình Default không
                    if (defaultSiteInfo && defaultSiteInfo.siteCode) {
                        matchedSite = result.find(x => x['ogl.site.code'] == defaultSiteInfo.siteCode);
                    }

                    // 2. Nếu khớp thì gán site đó, nếu KHÔNG khớp (hoặc không có default) thì lấy luôn site ĐẦU TIÊN (index 0)
                    if (matchedSite) {
                        vars.$L_file.vendor_site_id = matchedSite.id;
                    } else {
                        vars.$L_file.vendor_site_id = result[0].id;
                    }
                }
            }
        }
    }
}

if (isPayment) {
  // droplist ngan hang thu huong
  var bankList = lib.ESD_HTKT_ACCOUNTING_UTILS.getBankDroplist();
  vars.$bankcode = bankList.map((b) => `${b.code}|${b.citad}|${b.napas}`); // citab.branch.code|citad.code|napas.code trong esdDMbank
  vars.$bankname = bankList.map((b) => b.name);
}

print("[HTKT_PAYMENT_VENDOR][ACTION_FLAGS] paymentId=" + paymentId +
    " menuContext=" + String(vars["$G.HTKT_PAYMENT_MENU_CONTEXT"] || "") +
    " postAudit=" + String(isPostAuditPaymentVendorView) +
    " readOnly=" + String(vars.$ReadOnly) +
    " canEditObj=" + String(vars.$canEditObj) +
    " canEditSite=" + String(vars.$canEditSite) +
    " canEditAmount=" + String(vars.$canEditAmount) +
    " showSyncVendorOgl=" + String(vars.$showSyncVendorOgl));



