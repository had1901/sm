var errorMss = lib.ESD_HTKT_PREPAYMENT_WF.validateVendorAndPaymentDetails(vars.$L_file);

if (errorMss && errorMss.length > 0) {
    vars.$G_hasError = true;
    vars.$G_errMsg = "Dữ liệu chưa hợp lệ:\n - " + errorMss.join("\n - ");
    vars.$L_action = "do nothing";
} else {
    vars.$G_hasError = false; // Khởi tạo cờ lỗi là false để theo dõi ở phần dưới

    // gia lap kiem tra ten tai khoan thu huong
    if (vars.$L_file['payment.method'] == "CHUYENKHOAN" && vars.$L_file['beneficiary.bank'] && vars.$L_file['beneficiary.account']) {
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
//  var checkAccountRes = lib.ESD_HTKT_FUND_TRANSFER_INTEGRATION.checkNameAccount({
//      data : {
//          bankCode: vars.$L_file['beneficiary.bank'],
//          acctId: vars.$L_file['beneficiary.account']
//      }
//  });
//  if (checkAccountRes && checkAccountRes.data && checkAccountRes.data.acctNam) {
//      vars.$L_file['beneficiary.name'] = checkAccountRes.data.acctNam;
//      vars.$L_file['check.name.success'] = true;
//  }
    }

    // CHỈ CẬP NHẬT DATABASE KHI KHÔNG BỊ LỖI (Bao gồm cả lỗi không lấy được tên Vietinbank)
    if (!vars.$G_hasError) {
        vars.$L_file.amount = vars.$isAmount;

        // ============================
        // Cập nhật amount cho prepayment
        // ============================
        var prepaymentFile = new SCFile('esdHTKTprepayment');

        // Field này phải là field chứa ID phiếu tạm ứng
        var prepaymentId = vars.$L_file['prepayment.id'];

        if (prepaymentId) {

            var rc = prepaymentFile.doSelect(
                'id = "' + prepaymentId + '"'
            );

            if (rc == RC_SUCCESS) {

                prepaymentFile['amount'] = vars.$isAmount;

                var rcUpdate = prepaymentFile.doUpdate();
            }
        }
    }
}