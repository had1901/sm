// Nút đồng bộ TT XDCB dùng quyền KTTC và site riêng; nhánh HHDV phía dưới giữ nguyên.
if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(vars.$L_file)) {
    vars.$G_hasError = false;
    try {
        var context = lib.ESD_HTKT_PAYMENT_VENDOR.getPaymentXdcbContext(vars.$L_file, true);
        if (!context.canSync) throw new Error("Không có quyền đồng bộ site tại bước hiện tại.");
        var synced = lib.ESD_HTKT_PAYMENT_VENDOR.syncPaymentXdcbVendorToOgl(vars.$L_file);
        if (!synced.success) throw new Error(synced.message);
        if (vars.$L_file.doUpdate() !== RC_SUCCESS) throw new Error("Không lưu được site lên dòng NCC TT.");
        vars.$vendorSiteOptValue = [vars.$L_file['vendor.site.id']];
        vars.$vendorSiteOptDisp = [lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo("XDCB").siteCode];
        vars.$canEditSite = true;
    } catch (syncError) {
        vars.$G_hasError = true;
        vars.$G_errMsg = String(syncError.message || syncError);
    }
} else {
var defaultVendorSiteInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();
var itemFile = new SCFile("esdHTKTvendor");
var itemQuery = `id="${vars.$L_file['vendor.id']}"`;
var rcItem = itemFile.doSelect(itemQuery);
vars.$G_hasError = false;

if (rcItem == RC_SUCCESS) {
    var syncResult = lib.ESD_HTKT_PREPAYMENT_VENDOR.syncVendorToOgl(vars.$L_file, vars.$branchCode, vars.$entityCode);
    if (syncResult && !syncResult.success && syncResult.message) {
        vars.$G_hasError = true;
        vars.$G_errMsg = 'Đồng bộ thông tin NCC/Site không thành công: ' + syncResult.message;
    }

    var result = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorSiteList(itemFile.id, vars.$branchCode);
    
    if (result && result.length > 0) {
       vars.$vendorSiteOptValue = [];
       vars.$vendorSiteOptDisp = [];
       
       result.forEach(x => {
           vars.$vendorSiteOptValue.push(x['id']);
           vars.$vendorSiteOptDisp.push(x['ogl.site.code']);
           if (!vars.$L_file['vendor.site.id'] && x['ogl.site.code'] == defaultVendorSiteInfo.siteCode) {
                updateVendorSiteIdForPaymentVendor(x.id);
           }
       });
       vars.$canEditSite = true;
    }
}

function updateVendorSiteIdForPaymentVendor(vendorSiteId) {
    vars.$L_file['vendor.site.id'] = vendorSiteId;
    vars.$L_file.doUpdate()
}
}