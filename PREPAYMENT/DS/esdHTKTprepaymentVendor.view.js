try {
    if (system.functions.filename(vars.$L_file) == "ModuleStatus") {
        lib.custom.selectWfPhaseByWorkflow(vars.$L_file.workflow);
    }
    //custom back action
    var table = system.functions.filename(vars.$L_file);
    lib.ESD_Utils.backQueue(table);
} catch (e) { }

vars.$ReadOnly = !lib.ESD_HTKT_PREPAYMENT_WF.canEditInCurrenPhase(vars.$L_file);
var isPostAuditVendorView = String(vars["$G.HTKT_PREPAYMENT_MENU_CONTEXT"] || "")
    .trim().toLowerCase() === "post_audit";
//print("[HTKT_PREPAYMENT_VENDOR][OPEN_CONTEXT] id=" + String(vars.$L_file.id || "") +
//    " localIsFromHK=" + String(vars["$L.isFromHK"] || "") +
//    " menuContext=" + String(vars["$G.HTKT_PREPAYMENT_MENU_CONTEXT"] || "") +
//    " globalFromHK=" + String(vars["$G.fromHK"] || "") +
//    " recordMenuContext=" + String(vars.$L_file.menuContext || vars.$L_file["menu.context"] || "") +
//    " readOnly=" + String(vars.$ReadOnly));
vars.$L_mode = "view";
vars.$showSyncVendorOgl = false;
vars.$canEditSite = false;
vars.$vendorSiteOptValue = [];
vars.$vendorSiteOptDisp = [];
vars.$canEditObj = false;

// Hàm này sẽ gán vars.$showSyncVendorOgl và vars.$canEditSite (kiểm tra role KTTC + OGL sync)
lib.ESD_HTKT_PREPAYMENT_VENDOR.loadPrepaymentVendorInfo(vars.$L_file);
if (isPostAuditVendorView) {
    vars.$canEditSite = false;
    vars.$canEditObj = false;
    vars.$showSyncVendorOgl = false;
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

            // Tự động fill Site NCC nếu ở role KTTC và đã đồng bộ OGL
            var defaultVendorSiteInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();

            if (vars.$canEditSite && (!vars.$L_file.vendor_site_id || vars.$L_file.vendor_site_id == "")) {
                
                if (result && result.length > 0) {
                    var defaultVendorSiteInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();
                    var matchedSite = null;
            
                    // 1. Thử tìm xem có site nào khớp với cấu hình Default không
                    if (defaultVendorSiteInfo && defaultVendorSiteInfo.siteCode) {
                        matchedSite = result.find(x => x['ogl.site.code'] == defaultVendorSiteInfo.siteCode);
                    }
            
                    // 2. Nếu khớp thì lấy site đó, nếu KHÔNG khớp (hoặc không có default) thì lấy luôn site ĐẦU TIÊN
                    if (matchedSite) {
                        vars.$L_file.vendor_site_id = matchedSite.id;
                    } else {
                        vars.$L_file.vendor_site_id = result[0].id;
                    }
                }
            }
            // =================================================================
        } 
    }
}

// droplist ngan hang thu huong
var bankList = lib.ESD_HTKT_ACCOUNTING_UTILS.getBankDroplist();
vars.$bankcode = bankList.map(b => `${b.code}|${b.citad}|${b.napas}`); // citab.branch.code|citad.code|napas.code trong esdDMbank
vars.$bankname = bankList.map(b => b.name);

// Số tiền đề nghị tạm ứng
var vendorTaxCode = vars.$taxCode;
var prepaymentId = vars.$G_prepayment_id || vars.$L_file["prepayment.id"] || ""; 
var totalBeforeTax = 0;
var hasMatchedInvoice = false;
var amount = vars.$amount; 

// =================================================================
// BIẾN CỜ KIỂM TRA MÃ E06
// =================================================================
var isRequireBankTransfer = false; 

if (prepaymentId != null && prepaymentId != "" && vendorTaxCode != null && vendorTaxCode != "") {
    var invoiceFile = new SCFile("esdHTKTinvoice");
    
    // ĐÃ SỬA LỖI: Bắt buộc phải khóa chặt bằng cả Mã Phiếu VÀ Mã Số Thuế của Nhà Cung Cấp
    var sqlInvoice = "request.id=\"" + prepaymentId + "\" and seller.tax.code=\"" + vendorTaxCode + "\"";
    
    var rcInvoice = invoiceFile.doSelect(sqlInvoice);

    while (rcInvoice == RC_SUCCESS) {
        hasMatchedInvoice = true;
        if (invoiceFile["grand.total"]) {
            totalBeforeTax += Number(invoiceFile["grand.total"]);
        }
        
        // --- CHECK MÃ E06 TRONG DB CHO TỪNG HÓA ĐƠN ---
        if (!isRequireBankTransfer) { 
            var currentStatus = invoiceFile["check.status.detail"] || "";
            if (currentStatus.indexOf("E06") !== -1) {
                isRequireBankTransfer = true;
            }
        }
        
        rcInvoice = invoiceFile.getNext();
    }
    
    vars.$isAmountReadonly = false;
    if (hasMatchedInvoice && totalBeforeTax > 0) { // ĐÃ SỬA: Chỉ ghi đè nếu THỰC SỰ CÓ hóa đơn của NCC này
        vars.$isAmount = totalBeforeTax.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        vars.$isAmountReadonly = false;
    } else if (hasMatchedInvoice && totalBeforeTax === 0) {
        vars.$isAmount = "0";
        vars.$isAmountReadonly = false;
    } else {
        // NẾU KHÔNG CÓ HÓA ĐƠN: Giữ nguyên số tiền mà hàm loadPrepaymentVendorInfo đã gán trước đó!
        vars.$isAmountReadonly = true;
    }
}

// =================================================================
// CẬP NHẬT GIAO DIỆN VÀ KHÓA TRƯỜNG "PHƯƠNG THỨC THANH TOÁN"
// =================================================================
if (isRequireBankTransfer) {
    // 1. Bật cờ khóa trường Dropdown
    vars.$isDisableCash = true; 

    if (!isPostAuditVendorView && vars.$L_file["payment.method"] !== "CHUYENKHOAN") {
        vars.$L_file["payment.method"] = "CHUYENKHOAN";
    }
} else {
    // Tắt cờ khóa, cho phép chọn bình thường
    vars.$isDisableCash = false;
}

// Cờ riêng cho form NCC: giữ cả điều kiện khóa theo hóa đơn/E06 đã có.
vars.$vendorAmountReadOnly = vars.$ReadOnly || vars.$isAmountReadonly === true;
vars.$vendorPaymentMethodReadOnly = vars.$ReadOnly || vars.$isDisableCash === true;
vars.$vendorSiteReadOnly = vars.$ReadOnly || !vars.$canEditSite;
vars.$vendorActionReadOnly = isPostAuditVendorView;

//print("[HTKT_PREPAYMENT_VENDOR][FINAL_FLAGS] id=" + String(vars.$L_file.id || "") +
//    " readOnly=" + String(vars.$ReadOnly) +
//    " canEditSite=" + String(vars.$canEditSite) +
//    " isAmountReadonly=" + String(vars.$isAmountReadonly) +
//    " isDisableCash=" + String(vars.$isDisableCash) +
//    " showSyncVendorOgl=" + String(vars.$showSyncVendorOgl) +
//    " vendorAmountReadOnly=" + String(vars.$vendorAmountReadOnly) +
//    " vendorPaymentMethodReadOnly=" + String(vars.$vendorPaymentMethodReadOnly) +
//    " vendorSiteReadOnly=" + String(vars.$vendorSiteReadOnly));
