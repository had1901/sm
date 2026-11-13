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
        
        // 1. Chỉ dùng vòng lặp để gán danh sách Dropdown hiển thị
        result.forEach(x => {
            vars.$vendorSiteOptValue.push(x['id']);
            vars.$vendorSiteOptDisp.push(x['ogl.site.code']);
        });

        // =========================================================================
        // 2. AUTO-FILL SITE NCC NGAY SAU KHI ĐỒNG BỘ (CÁCH 2)
        // =========================================================================
        if (!vars.$L_file['vendor.site.id'] || vars.$L_file['vendor.site.id'] == "") {
            var matchedSiteId = null;
            
            // 2.1 An toàn: Kiểm tra cấu hình default tồn tại
            if (defaultVendorSiteInfo && defaultVendorSiteInfo.siteCode) {
                var found = result.find(x => x['ogl.site.code'] == defaultVendorSiteInfo.siteCode);
                if (found) {
                    matchedSiteId = found.id;
                }
            }
            
            // 2.2 Nếu khớp thì lưu site đó, nếu KHÔNG khớp thì lưu luôn site ĐẦU TIÊN
            if (matchedSiteId) {
                updateVendorSiteIdForPrepaymentVendor(matchedSiteId);
            } else {
                updateVendorSiteIdForPrepaymentVendor(result[0].id);
            }
        }
        // =========================================================================

        vars.$canEditSite = true;
    }
}

function updateVendorSiteIdForPrepaymentVendor(vendorSiteId) {
    vars.$L_file['vendor.site.id'] = vendorSiteId;
    vars.$L_file.doUpdate();
}

if (vars.$isAmount != null && vars.$isAmount !== "") {
    var cleanAmount = vars.$isAmount.toString().replace(/,/g, '');
    vars.$isAmount = cleanAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}