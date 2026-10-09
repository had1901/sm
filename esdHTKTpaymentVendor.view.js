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
arrVendors = []

var paymentId = String(vars.$L_file["payment.id"] || vars.$L_file.payment_id || "");
var contractId = String(vars.$L_file["contract.id"] || vars.$L_file.contract_id || "");
var paymentPrefix = paymentId.split(".")[0].toUpperCase();
var isPayment = paymentPrefix === "TT";
var isExpense = paymentPrefix === "DC";
vars.$isPayment = isPayment;
vars.$isExpense = isExpense;

if (isExpense) {
    lib.ESD_HTKT_EXPENSE_VENDOR.loadPaymentVendorInfo(vars.$L_file);
    
    var contractInfo = lib.ESD_HTKT_PAYMENT_VENDOR.getContractInfo(contractId);
    vars.$contractId = contractInfo.id;
    vars.$contractName = contractInfo.name;
    vars.$contractCategoryCode = contractInfo.category;
    vars.$contractCategory = contractInfo.categoryName;
    vars.$contractStartDate = contractInfo.startDate;
    vars.$totalContractValue = contractInfo.totalValue;
    vars.$totalPaidAmount = contractInfo.totalPaidAmount;
    vars.$contractRemainingAmount = contractInfo.remainingAmount;
} else if (isPayment) {
    lib.ESD_HTKT_PAYMENT_VENDOR.loadPaymentVendorInfo(vars.$L_file);
}

var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(vars.$unitLv1);
if (entityInfo && entityInfo.entity && entityInfo.oglBranchCode) {
    vars.$entityCode = entityInfo.entity;
    vars.$branchCode = entityInfo.oglBranchCode.length == 4 ? entityInfo.oglBranchCode.substr(1, 4) : entityInfo.oglBranchCode;
    if (vars.$branchCode && vars.$L_file.vendor_id) {
        var result = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorSiteList(vars.$L_file.vendor_id, vars.$branchCode);
        if (result && result.length > 0) {
            vars.$vendorSiteOptValue = [];
            vars.$vendorSiteOptDisp = [];
            result.forEach(x => {
                vars.$vendorSiteOptValue.push(x['id']);
                vars.$vendorSiteOptDisp.push(x['ogl.site.code']);
            });
        }
    }
}

if (isPayment) {
  // droplist ngan hang thu huong
  var bankList = lib.ESD_HTKT_ACCOUNTING_UTILS.getBankDroplist();
  vars.$bankcode = bankList.map((b) => `${b.code}|${b.citad}|${b.napas}`); // citab.branch.code|citad.code|napas.code trong esdDMbank
  vars.$bankname = bankList.map((b) => b.name);
}

