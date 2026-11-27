// Nút Đồng bộ TU dùng cùng hàm XDCB của TT/DC; HHDV giữ nguyên xử lý phía dưới.
if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(vars.$L_file)) {
    var syncResult = lib.ESD_HTKT_PAYMENT_VENDOR.syncPaymentXdcbVendorToOgl(vars.$L_file);
    vars.$G_hasError = !syncResult.success;
    vars.$G_errMsg = syncResult.success ? "" : syncResult.message;
    if (syncResult.success) {
        vars.$L_file.doUpdate();
        lib.ESD_HTKT_PREPAYMENT_VENDOR.loadPrepaymentVendorInfo(vars.$L_file);

        // [MỚI] Cập nhật MST xuống vendorsite cho luồng XDCB
        // (Tốt nhất nên gán trực tiếp bên trong hàm syncPaymentXdcbVendorToOgl để dùng chung cho cả TT/DC)
        syncVendorNumberToVendorSite(vars.$L_file['vendor.id'], null, vars.$L_file['vendor.site.id']);
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

            var siteIdsToSync = [];

            // 1. Gán danh sách Dropdown hiển thị và gom danh sách siteId cần ghi MST
            result.forEach(x => {
                vars.$vendorSiteOptValue.push(x['id']);
                vars.$vendorSiteOptDisp.push(x['ogl.site.code']);
                if (x['id']) {
                    siteIdsToSync.push(x['id']);
                }
            });

            // Cập nhật vendor.number từ esdHTKTvendor xuống tất cả vendorsite vừa đồng bộ
            if (itemFile['vendor.number'] && siteIdsToSync.length > 0) {
                updateVendorNumberForSites(siteIdsToSync, itemFile['vendor.number']);
            }

            // 2. AUTO-FILL SITE NCC NGAY SAU KHI ĐỒNG BỘ (CÁCH 2)
            if (!vars.$L_file['vendor.site.id'] || vars.$L_file['vendor.site.id'] == "") {
                var matchedSiteId = null;

                if (defaultVendorSiteInfo && defaultVendorSiteInfo.siteCode) {
                    var found = result.find(x => x['ogl.site.code'] == defaultVendorSiteInfo.siteCode);
                    if (found) {
                        matchedSiteId = found.id;
                    }
                }

                if (matchedSiteId) {
                    updateVendorSiteIdForPrepaymentVendor(matchedSiteId);
                } else {
                    updateVendorSiteIdForPrepaymentVendor(result[0].id);
                }
            }

            vars.$canEditSite = true;
        }
    }

    if (vars.$isAmount != null && vars.$isAmount !== "") {
        var cleanAmount = vars.$isAmount.toString().replace(/,/g, '');
        vars.$isAmount = cleanAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }
}

function updateVendorSiteIdForPrepaymentVendor(vendorSiteId) {
    vars.$L_file['vendor.site.id'] = vendorSiteId;
    vars.$L_file.doUpdate();
}

// Cập nhật MST cho danh sách site
function updateVendorNumberForSites(siteIds, vendorNumber) {
    if (!siteIds || siteIds.length === 0 || !vendorNumber) return;

    for (var i = 0; i < siteIds.length; i++) {
        var fSite = new SCFile("esdHTKTvendorSite");
        try {
            if (fSite.doSelect('id="' + siteIds[i] + '"') === RC_SUCCESS) {
                if (fSite['vendor.number'] != vendorNumber) {
                    fSite['vendor.number'] = vendorNumber;
                    fSite.doSave();
                }
            }
        } finally {
            try { if (fSite) fSite.doClose(); } catch (e) {}
        }
    }
}

// Hỗ trợ luồng XDCB: tra MST từ esdHTKTvendor rồi ghi sang vendorsite
function syncVendorNumberToVendorSite(vendorId, knownTaxCode, siteId) {
    if (!siteId) return;
    var taxCode = knownTaxCode || "";

    if (!taxCode && vendorId) {
        var fVendor = new SCFile("esdHTKTvendor", SCFILE_READONLY);
        try {
            if (fVendor.doSelect('id="' + vendorId + '"') === RC_SUCCESS) {
                taxCode = fVendor['vendor.number'];
            }
        } finally {
            try { if (fVendor) fVendor.doClose(); } catch (e) {}
        }
    }

    if (taxCode) {
        updateVendorNumberForSites([siteId], taxCode);
    }
}