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