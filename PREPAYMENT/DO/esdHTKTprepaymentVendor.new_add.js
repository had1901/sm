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
        var itemVendor = new SCFile('esdHTKTvendor'); 
        var queryVendor = 'vendor.number = "' + vars.$taxCode + 
                          '" and supplier.id = "' + vars.$supplierId + '"';

        var result = itemVendor.doSelect(queryVendor); 
        var $vendorId; 

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
                vars.$L_file['vendor.site.id']  = vars.$oglSiteCode; 
                vars.$L_file['currency']        = vars.$currency; 
                vars.$L_file['amount']          = vars.$isAmount; 
                vars.$L_file['contract.amount'] = vars.$remainingAmt;

                // 4. Quyết định action: Nếu tạo mới dùng "add", nếu Back lại đã có ID dùng "save"
                vars.$L_action = isNewRecord ? "add" : "save";
            }
        }
    }
}