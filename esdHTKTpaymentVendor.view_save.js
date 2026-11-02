// =========================================================================
// 1. CHUẨN BỊ VÀ GÁN DỮ LIỆU VÀO RECORD TRƯỚC KHI XỬ LÝ
// =========================================================================
if (vars.$approvedInvoiceAmount == null || vars.$approvedInvoiceAmount === "") vars.$approvedInvoiceAmount = "0";
if (vars.$refundAmount == null || vars.$refundAmount === "") vars.$refundAmount = "0";
if (vars.$amount == null || vars.$amount === "") vars.$amount = "0";

vars.$L_file['approved.invoice.amount'] = vars.$approvedInvoiceAmount;      
vars.$L_file['amount']                  = vars.$amount; 
vars.$L_file['payable.amount']          = vars.$payableAmount || "0";                           
vars.$L_file['refund.amount']           = vars.$refundAmount;            
vars.$L_file['vendor.type']             = (vars.$isCNvendorType == true) ? "CN" : "DN";
if (vars.$remainingAmount != null && vars.$remainingAmount !== "") {
    vars.$L_file['contract.amount']     = vars.$remainingAmount;            
}

// =========================================================================
// 2. THỰC HIỆN VALIDATE TRƯỚC TIÊN
// =========================================================================
var errorMss = lib.ESD_HTKT_PAYMENT_WF.validateVendorAndPaymentDetails(vars.$L_file);

if (errorMss && errorMss.length > 0) {
    vars.$G_hasError = true;
    vars.$G_errMsg = "Dữ liệu chưa hợp lệ:\n - " + errorMss.join("\n - ");
    vars.$L_action = "do nothing";
} else {
    vars.$G_hasError = false;
    vars.$G_errMsg = "";

    // =========================================================================
    // 3. KHI VALIDATE THÀNH CÔNG -> MỚI KIỂM TRA TÊN TÀI KHOẢN THỤ HƯỞNG
    // =========================================================================
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
//                if (bankSplit[2] === "970415") {
//                    vars.$G_hasError = true; 
//                    vars.$G_errMsg = "Lỗi: Ngân hàng thụ hưởng là VietinBank TSC nhưng hệ thống không thể lấy được Tên chủ tài khoản. Vui lòng kiểm tra lại Số tài khoản thụ hưởng!"; 
//                    vars.$L_action = "do nothing"; 
//                }
            }
            
            
        }
    }

    if (!vars.$G_hasError) {
        // Dữ liệu hợp lệ hoàn toàn (cả validate nghiệp vụ lẫn tài khoản Vietinbank)
        // Tiếp tục các bước xử lý tiếp theo nếu có
    }
}