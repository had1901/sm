// Đọc lại NCC/HS và số dư S4 trước khi chạy validate TU cũ; giữ biến nhập $isAmount.
var isTUXdcb = lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(vars.$L_file);
vars.$G_hasError = false;
if (isTUXdcb) {
    try {
        lib.ESD_HTKT_PAYMENT_VENDOR.preparePaymentXdcbSave(vars.$L_file);
    } catch (sourceError) {
        vars.$G_hasError = true;
        vars.$G_errMsg = String(sourceError.message || sourceError);
        vars.$L_action = "do nothing";
    }
}

if (!vars.$G_hasError) {
    var errorMss = lib.ESD_HTKT_PREPAYMENT_WF.validateVendorAndPaymentDetails(vars.$L_file);

    if (errorMss && errorMss.length > 0) {
        vars.$G_hasError = true;
        vars.$G_errMsg = "Dữ liệu chưa hợp lệ:\n - " + errorMss.join("\n - ");
        vars.$L_action = "do nothing";
    } else {
        vars.$G_hasError = false;

        // 1. Check tên người thụ hưởng
        if (
            vars.$L_file['payment.method'] == "CHUYENKHOAN" &&
            vars.$L_file['beneficiary.bank'] &&
            vars.$L_file['beneficiary.account']
        ) {
            var bankSplit = vars.$L_file['beneficiary.bank'].split('|');

            if (bankSplit && bankSplit.length == 3) {
                var checkAccountRes = lib.ESD_HTKT_ACCOUNTING_UTILS.checkAccount(
                    vars.$L_file['beneficiary.account'],
                    bankSplit[2]
                );

                if (checkAccountRes && checkAccountRes.acctName) {
                    vars.$L_file['beneficiary.name'] = checkAccountRes.acctName;
                    vars.$L_file['check.name.success'] = true;
                    vars.$L_file['bank.branch.code'] = checkAccountRes.branchCode;
                } else {
                    vars.$L_file['check.name.success'] = false;
                    if (bankSplit[2] === "970415") {
                        vars.$G_hasError = true;
                        vars.$G_errMsg = "Lỗi: Ngân hàng thụ hưởng là VietinBank TSC nhưng hệ thống không thể lấy được Tên chủ tài khoản. Vui lòng kiểm tra lại Số tài khoản thụ hưởng!";
                        vars.$L_action = "do nothing";
                    }
                }
            }
        }

        if (!vars.$G_hasError) {
            // 2. Tìm / tạo vendor
            // XDCB tái sử dụng master theo MST như TT/DC; HHDV giữ điều kiện MST + supplier.id cũ.
            var $vendorId;
            if (isTUXdcb) {
                try {
                    var syncResult = lib.ESD_HTKT_PAYMENT_VENDOR.savePaymentXdcbSupplier(vars.$L_file);
                    $vendorId = vars.$L_file["vendor.id"];
                    if (!syncResult.success) print("Đồng bộ NCC/Site TU XDCB chưa thành công: " + syncResult.message);
                } catch (saveError) {
                    vars.$G_hasError = true;
                    vars.$G_errMsg = String(saveError.message || saveError);
                    vars.$L_action = "do nothing";
                }
            } else {
                var itemVendor = new SCFile('esdHTKTvendor');
                var queryVendor = 'vendor.number = "' + vars.$taxCode +
                                  '" and supplier.id = "' + vars.$supplierId + '"';

                var result = itemVendor.doSelect(queryVendor);

                if (result === RC_SUCCESS) {
                    $vendorId = itemVendor['id'];
                } else {
                    $vendorId = new Datum();
                    var rcodeVendor = new Datum();

                    rcodeVendor = system.functions.rtecall(
                        "getnumber",
                        rcodeVendor,
                        $vendorId,
                        "esdHTKTvendor"
                    );

                    itemVendor['id'] = $vendorId;
                    itemVendor['vendor.name'] = vars.$supplierName;
                    itemVendor['vendor.number'] = vars.$taxCode;
                    itemVendor['username'] = vars.$lo_operator["name"];
                    itemVendor['ogl.country'] = 'VN';
                    itemVendor['address'] = vars.$supplierAddress;
                    itemVendor['supplier.id'] = vars.$supplierId;
                    itemVendor['vendor.type'] = vars.$vendorType;

                    var rcAddVendor = itemVendor.doAction('add');
                    if (rcAddVendor !== RC_SUCCESS && rcAddVendor !== true) {
                        vars.$G_hasError = true;
                        vars.$G_errMsg = "Lỗi tạo mới nhà cung cấp (esdHTKTvendor).";
                        vars.$L_action = "do nothing";
                    }
                }
            }

            // 3. Xử lý ID và Gán dữ liệu cho Prepayment Vendor
            if (!vars.$G_hasError) {
                var isNewRecord = (!vars.$L_file['id'] || vars.$L_file['id'] == null || vars.$L_file['id'] == "");

                // Chỉ cấp số mới khi tạo lần đầu, nếu Back lại (đã có ID) thì bỏ qua bước cấp số
                if (isNewRecord) {
                    var numberClass = "esdHTKTprepaymentVendor";
                    var numberRc = new SCDatum();
                    numberRc.setValue(-1);
                    var nextNumber = new SCDatum();

                    system.functions.rtecall("getnumber", numberRc, nextNumber, numberClass);

                    var rcText = String(numberRc.getText()).replace(/^\s+|\s+$/g, "");
                    var rawNumber = String(nextNumber.getText()).replace(/^\s+|\s+$/g, "");
                    if (/^"[^"]*"$/.test(rawNumber) || /^'[^']*'$/.test(rawNumber)) {
                        rawNumber = rawNumber.substring(1, rawNumber.length - 1);
                    }

                    if (rcText !== "0" || !/^\d+$/.test(rawNumber)) {
                        vars.$G_hasError = true;
                        vars.$G_errMsg = "Không cấp được số thứ tự từ Sequential Numbers: " + numberClass;
                        vars.$L_action = "do nothing";
                    } else {
                        var sequence = Number(rawNumber);
                        var newid = ("000000000000000" + sequence).slice(-15);

                        // Kiểm tra trùng mã trên DB
                        var existing = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
                        try {
                            var rcCheck = existing.doSelect('id="' + newid + '"');
                            if (rcCheck === RC_SUCCESS) {
                                vars.$G_hasError = true;
                                vars.$G_errMsg = "Mã " + newid + " đã tồn tại trong bảng " + numberClass + ". Vui lòng kiểm tra lại bộ đếm.";
                                vars.$L_action = "do nothing";
                            }
                        } finally {
                            try { if (existing) existing.doClose(); } catch (e) {}
                        }

                        if (!vars.$G_hasError) {
                            vars.$L_file['id'] = newid;
                        }
                    }
                }

                // Gán/Cập nhật dữ liệu cho prepayment vendor
                if (!vars.$G_hasError) {
                    vars.$L_file['vendor.id']       = $vendorId;
                    if (!isTUXdcb) vars.$L_file['vendor.site.id'] = vars.$oglSiteCode;
                    vars.$L_file['currency']        = vars.$currency;
                    vars.$L_file['amount']          = vars.$isAmount;
                    print("amount ở đâu", vars.$L_file['amount']);
                    print("amount ở đâu", vars.$L_file);
                    vars.$L_file['contract.amount'] = vars.$remainingAmt;

                    // [MỚI] 3b. Lưu mã số thuế (vendor.number) xuống bảng vendorsite
                    var vendorSiteId = vars.$L_file['vendor.site.id'];
                    var taxCodeToSave = vars.$taxCode || vars.$L_file['vendor.number'] || "";

                    // Dự phòng cho luồng XDCB nếu vars.$taxCode không có giá trị trên màn hình
                    if (!taxCodeToSave && $vendorId) {
                        var fVendorLookup = new SCFile("esdHTKTvendor", SCFILE_READONLY);
                        try {
                            var cleanVendorId = String($vendorId).replace(/^["']|["']$/g, "");
                            if (fVendorLookup.doSelect('id="' + cleanVendorId + '"') === RC_SUCCESS) {
                                taxCodeToSave = fVendorLookup['vendor.number'];
                            }
                        } finally {
                            try { if (fVendorLookup) fVendorLookup.doClose(); } catch (e) {}
                        }
                    }

                    if (vendorSiteId && taxCodeToSave) {
                        var fVendorSite = new SCFile("esdHTKTvendorSite");
                        try {
                            // Kiểm tra lại đúng tên field khóa của bảng vendorsite
                            var querySite = 'id="' + vendorSiteId + '"';
                            var rcSite = fVendorSite.doSelect(querySite);

                            if (rcSite === RC_SUCCESS) {
                                if (fVendorSite['vendor.number'] != taxCodeToSave) {
                                    fVendorSite['vendor.number'] = taxCodeToSave;
                                    var rcSaveSite = fVendorSite.doSave();
                                    if (rcSaveSite !== RC_SUCCESS && rcSaveSite !== true) {
                                        vars.$G_hasError = true;
                                        vars.$G_errMsg = "Lỗi cập nhật mã số thuế (vendor.number) xuống bảng vendorsite.";
                                        vars.$L_action = "do nothing";
                                    }
                                }
                            } else {
                                print("Không tìm thấy bản ghi vendorsite để cập nhật MST: " + querySite);
                            }
                        } finally {
                            try { if (fVendorSite) fVendorSite.doClose(); } catch (e) {}
                        }
                    }

                    // 4. Quyết định action: Nếu tạo mới dùng "add", nếu Back lại đã có ID dùng "save"
                    if (!vars.$G_hasError) {
                        vars.$L_action = isNewRecord ? "add" : "save";
                    }
                }
            }
        }
    }
}