// Nút đồng bộ TT XDCB dùng quyền KTTC và site riêng; nhánh HHDV phía dưới giữ nguyên.
if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(vars.$L_file)) {
    vars.$G_hasError = false;
    try {
        var context = lib.ESD_HTKT_PAYMENT_VENDOR.getPaymentXdcbContext(vars.$L_file, true);
        if (!context.canSync) throw new Error("Không có quyền đồng bộ site tại bước hiện tại.");
        var synced = lib.ESD_HTKT_PAYMENT_VENDOR.syncPaymentXdcbVendorToOgl(vars.$L_file);
        if (!synced.success) throw new Error(synced.message);
        if (vars.$L_file.doUpdate() !== RC_SUCCESS) throw new Error("Không lưu được site lên dòng NCC TT.");

        // [MỚI] Cập nhật mã số thuế xuống bảng vendorsite cho luồng XDCB
        syncVendorNumberToVendorSite(vars.$L_file['vendor.id'], vars.$L_file['vendor.site.id']);

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
            var siteIdsToSync = []; // [MỚI]

            // 1. Đẩy toàn bộ dữ liệu vào Dropdown list để hiển thị trên UI
            result.forEach(x => {
                vars.$vendorSiteOptValue.push(x['id']);
                vars.$vendorSiteOptDisp.push(x['ogl.site.code']);
                if (x['id']) {
                    siteIdsToSync.push(x['id']); // [MỚI]
                }
            });

            // [MỚI] Cập nhật vendor.number từ esdHTKTvendor xuống tất cả vendorsite của NCC
            if (itemFile['vendor.number'] && siteIdsToSync.length > 0) {
                updateVendorNumberForSites(siteIdsToSync, itemFile['vendor.number']);
            }

            // =========================================================================
            // 2. AUTO-FILL SITE NCC NGAY SAU KHI ĐỒNG BỘ (CÁCH 2)
            // =========================================================================
            if (!vars.$L_file['vendor.site.id'] || vars.$L_file['vendor.site.id'] == "") {
                var matchedSiteId = null;

                // 2.1 Thử tìm xem có site nào khớp với cấu hình Default không
                if (defaultVendorSiteInfo && defaultVendorSiteInfo.siteCode) {
                    var found = result.find(x => x['ogl.site.code'] == defaultVendorSiteInfo.siteCode);
                    if (found) {
                        matchedSiteId = found.id;
                    }
                }

                // 2.2 Nếu khớp thì gán site đó, nếu KHÔNG khớp thì lấy site ĐẦU TIÊN
                if (matchedSiteId) {
                    updateVendorSiteIdForPaymentVendor(matchedSiteId);
                } else {
                    updateVendorSiteIdForPaymentVendor(result[0].id);
                }
            }
            // =========================================================================

            vars.$canEditSite = true;
        }
    }
}

function updateVendorSiteIdForPaymentVendor(vendorSiteId) {
    vars.$L_file['vendor.site.id'] = vendorSiteId;
    vars.$L_file.doUpdate();
}

// [MỚI] Cập nhật vendor.number cho danh sách site (đổi "vendorsite" nếu tên dbdict thực tế khác)
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

// [MỚI] Nhánh XDCB: lấy MST từ esdHTKTvendor theo vendor.id rồi lưu xuống vendorsite
function syncVendorNumberToVendorSite(vendorId, siteId) {
    if (!vendorId || !siteId) return;
    var taxCode = "";

    var fVendor = new SCFile("esdHTKTvendor", SCFILE_READONLY);
    try {
        if (fVendor.doSelect('id="' + vendorId + '"') === RC_SUCCESS) {
            taxCode = fVendor['vendor.number'];
        }
    } finally {
        try { if (fVendor) fVendor.doClose(); } catch (e) {}
    }

    if (taxCode) {
        updateVendorNumberForSites([siteId], taxCode);
    }
}