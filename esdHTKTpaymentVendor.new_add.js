// Nguồn/giới hạn NCC S4 kiểm tra lại trước Save; không đổi bind tiền/validate TT hiện tại.
var isTtXdcbSave = false;
try {
    isTtXdcbSave = lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(vars.$L_file);
    if (isTtXdcbSave) lib.ESD_HTKT_PAYMENT_VENDOR.preparePaymentXdcbSave(vars.$L_file);
var errorMss = lib.ESD_HTKT_PAYMENT_WF.validateVendorAndPaymentDetails(vars.$L_file);

if (errorMss && errorMss.length > 0) {    
    vars.$G_hasError = true;
    vars.$G_errMsg = "Dữ liệu chưa hợp lệ:\n - " + errorMss.join("\n - ");
    vars.$L_action = "do nothing";
} else {
    vars.$G_hasError = false;

    // Check tên người thụ hưởng
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
        var $vendorId;
        if (isTtXdcbSave) {
            // Chỉ sau validate và kiểm tra tài khoản TT mới lưu master S6 theo MST và thử đồng bộ site.
            var xdcbSync = lib.ESD_HTKT_PAYMENT_VENDOR.savePaymentXdcbSupplier(vars.$L_file);
            $vendorId = vars.$L_file['vendor.id'];
            if (!xdcbSync.success) print("Đồng bộ NCC/Site TT XDCB chưa thành công: " + xdcbSync.message);
        } else {
        // 1. Tìm hoặc thêm Vendor (Chỉ tạo mới khi chưa có)
        var itemVendor = new SCFile('esdHTKTvendor');
        var queryVendor = `vendor.number = "${vars.$taxCode}" and supplier.id = "${vars.$supplierId}"`;
        var result = itemVendor.doSelect(queryVendor);
        var $vendorId;
       
        if (result === RC_SUCCESS) {
            $vendorId = itemVendor['id'];
        } else {
            $vendorId = new Datum();
            var rcodeVendor = new Datum();
            rcodeVendor = system.functions.rtecall("getnumber", rcodeVendor, $vendorId, "esdHTKTvendor");
            
            itemVendor['id'] = $vendorId;
            itemVendor['vendor.name'] = vars.$supplierName;
            itemVendor['vendor.number'] = vars.$taxCode;
            itemVendor['username'] = vars.$lo_operator["name"];
            itemVendor['ogl.country'] = 'VN';
            itemVendor['address'] = vars.$supplierAddress;
            itemVendor['supplier.id'] = vars.$supplierId;
            itemVendor['vendor.type'] = vars.$isCNvendorType ? "CN" : "DN";
            itemVendor.doAction('add');
        }
        
        }
        // 2. GÁN DỮ LIỆU CHO PAYMENT VENDOR ($L_file)
        vars.$L_file['vendor.id']               = $vendorId;
        if (!isTtXdcbSave) vars.$L_file['vendor.site.id'] = vars.$oglSiteSode;
        vars.$L_file['currency']                = vars.$currency;
        vars.$L_file['approved.invoice.amount'] = vars.$approvedInvoiceAmount;
        vars.$L_file['amount']                  = vars.$amount;
        vars.$L_file['payable.amount']          = vars.$payableAmount || "0";
        vars.$L_file['refund.amount']           = vars.$refundAmount;       
        vars.$L_file['vendor.type']             = vars.$isCNvendorType ? "CN" : "DN";
        vars.$L_file['contract.amount']         = vars.$remainingAmount;

        // 3. XỬ LÝ ID & ACTION: Chống nhảy 2 số và hỗ trợ Back mượt mà
        var isNewRecord = (!vars.$L_file['id'] || vars.$L_file['id'] == null || vars.$L_file['id'] == "");

        if (isNewRecord) {
            // Chỉ lấy số mới khi record CHƯA có ID
            var newid = new Datum();
            var rcodePrev = new Datum();
            rcodePrev = system.functions.rtecall("getnumber", rcodePrev, newid, "esdHTKTpaymentVendor");
            
            // BẮT BUỘC GÁN: Gán ID vào $L_file để Document Engine không tự sinh thêm lần 2
            vars.$L_file['id'] = newid;
            vars.$L_action = "add";
        } else {
            // Nếu đã có ID (khi Back lại hoặc cập nhật), KHÔNG gọi getnumber nữa
            vars.$L_action = "save";
        }
    }
}
} catch (xdcbSaveError) {
    vars.$G_hasError = true;
    vars.$G_errMsg = String(xdcbSaveError.message || xdcbSaveError);
    vars.$L_action = "do nothing";
}
