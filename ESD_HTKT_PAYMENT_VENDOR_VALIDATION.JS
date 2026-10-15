/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_VENDOR_VALIDATION
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Kiểm tra và xác thực thông tin tài khoản ngân hàng của người thụ hưởng qua hệ thống NAPAS / Core.
 * - Xác thực thông tin Vendor Site và trạng thái đồng bộ với hệ thống Oracle GL (OGL).
 * - Kiểm tra tính đầy đủ và hợp lệ của các trường thông tin thụ hưởng trước khi tạo phiếu.
 * -----------------------------------------------------------------------------
 */

// =============================================================================
// HELPER FUNCTIONS (CÁC HÀM HỖ TRỢ CHUẨN HÓA VÀ XỬ LÝ DỮ LIỆU)
// =============================================================================


function handleBeforeDeleteRecord(currentRecord) {
    // print('[SL] Xoa record = ', currentRecord);
}

/**
 * Chuyển đổi số tiền về dạng chuỗi có dấu phẩy phân cách hàng nghìn và bỏ phần thập phân lẻ
 * Ví dụ: 499999.5 -> "500,000" (hoặc nếu lấy phần nguyên: "499,999")
 */
function formatMoney(val) {
    if (val === null || val === undefined || String(val).trim() === '') return '';

    // 1. Loại bỏ tất cả ký tự không phải số và dấu chấm (.)
    var strVal = String(val).replace(/[^0-9.]/g, '');
    if (strVal === '') return '';

    // 2. Tách lấy phần số nguyên, bỏ hẳn phần thập phân đằng sau dấu chấm
    var integerPart = strVal.split('.')[0];
    if (!integerPart) return '';

    // 3. Ép kiểu về số nguyên để làm tròn (nếu cần) hoặc dùng trực tiếp chuỗi số nguyên
    var num = parseInt(integerPart, 10);
    if (isNaN(num)) return '';

    // 4. Thêm dấu phẩy ngăn cách hàng nghìn
    return String(num).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}


/**
 * Hàm kiểm tra & ép kiểu số cho Validation
 * - Rỗng / Delete sạch -> trả về null (để bắt lỗi bắt buộc nhập)
 * - Có nhập (kể cả 0) -> trả về Number
 */
function parseAmount(val) {
    if (val === null || val === undefined || String(val).trim() === '') {
        return null;
    }
    var cleanVal = String(val).replace(/[^0-9-]/g, '');
    if (cleanVal === '' || cleanVal === '-') return null;

    var num = parseInt(cleanVal, 10);
    return isNaN(num) ? null : num;
}



/**
 * Hàm kiểm tra giá trị hợp lệ trước khi gán vào DB
 * Tự động làm sạch dấu phân cách tiền tệ (dấu phẩy, dấu chấm) trước khi kiểm tra
 * @param {any} value Giá trị cần kiểm tra từ UI
 * @returns {number|null} Trả về Number nếu hợp lệ, ngược lại trả về null
 */
function checkValue(value) {
    var parsed = parseAmount(value);
    return (parsed === null) ? 0 : parsed;
}



function getUiValue(uiVar, recordValue) {
    return (uiVar !== undefined) ? uiVar : recordValue;
}

function isNotEmpty(val) {
    return val !== null && val !== undefined && String(val).trim() !== '';
}

function checkMaxLength(value, maxLength, fieldName, errorMessage) {
    if (value && String(value).length > maxLength) {
        errorMessage.push(fieldName + ' không được vượt quá ' + maxLength + ' ký tự.');
    }
}



/**
 * Hàm show message lỗi màu đỏ
 */
//function showPopUp(message) {
//    var rteReturnValue = new Datum();
//    // Parameter 3 (Thứ ba) = 3 nghĩa là hiển thị dạng Pop-up Dialog trên màn hình UI
//    system.functions.rtecall("msg", rteReturnValue, message, 3);
//}


/**
 * Hàm kiểm tra độ dài chuỗi ký tự user nhập
 */
function checkMaxLength(value, maxLength = 255, fieldName) {
    if (value && value.length > maxLength) {
        errorMessage.push(fieldName + ' không được vượt quá ' + maxLength + ' ký tự.');
    }
}



/**
 * Hàm validate bản ghi Payment Vendor
 * @param {Object} record Bản ghi $L_file
 * @returns {Array} Mảng chứa danh sách các thông báo lỗi (errorMessage)
 */
function validatePaymentVendorRecord(record) {
    record = record || {};
    var errorMessage = [];

    // -------------------------------------------------------------------------
    // 1. TRÍCH XUẤT VÀ CHUẨN HÓA DỮ LIỆU
    // -------------------------------------------------------------------------
    var supplierId = vars.$supplierId;

    // Nếu người dùng ĐÃ XÓA supplierId trên UI -> Reset luôn supplierName về null
    if (!supplierId) {
        vars.$supplierName = null;
    }
    // Nếu là màn View (chưa có supplierName) nhưng CÓ supplierId -> Query hoặc gán fallback
    else if (!vars.$supplierName && supplierId) {
        var vendorFile = new SCFile("esdHDcontractSupplier");
        if (vendorFile.doSelect('supplier.id="' + supplierId + '"') === RC_SUCCESS) {
            vars.$supplierName = vendorFile['supplier.name'];
        } else {
            vars.$supplierName = supplierId;
        }
    }

    var supplierName = vars.$supplierName;
    var taxCode = vars.$taxCode;

    var approvedInvoiceAmount = vars.$approvedInvoiceAmount || record['approved.invoice.amount'];
    var amount = vars.$amount || record['amount'];
    var refundAmount = vars.$refundAmount || record['refund.amount'];
    var remainingAmount = vars.$remainingAmount || record['remaining.amount'];
    var paymentMethod = record['payment.method'] || vars.$paymentMethod;
    var transactionDes = record['transaction.des'] || vars.$description;

    var beneficiaryAccount = record['beneficiary.account'] || vars.$beneficiaryAccount;
    var beneficiaryBank = record['beneficiary.bank'] || vars.$beneficiaryBank;
    var beneficiaryName = record['beneficiary.name'] || vars.$beneficiaryName;
    var identityNumber = record['identity.number'] || vars.$identityNumber;
    var issuedDate = record['issued.date'] || vars.$issuedDate;
    var issuedPlace = record['issued.place'] || vars.$issuedPlace;
    var phone = record['phone'] || vars.$phone;

    // Trích xuất dữ liệu từ UI
    var rawApprovedAmount  = getUiValue(vars.$approvedInvoiceAmount, record['approved.invoice.amount']);
    var rawAmount          = getUiValue(vars.$amount, record['amount']);
    var rawRefundAmount    = getUiValue(vars.$refundAmount, record['refund.amount']);
    var rawRemainingAmount = getUiValue(vars.$remainingAmount, record['remaining.amount']);

    // Ép về kiểu Number để so sánh & kiểm tra rỗng
    var approvedAmt  = parseAmount(rawApprovedAmount);
    var requestAmt   = parseAmount(rawAmount);
    var refundAmt    = parseAmount(rawRefundAmount);
    var remainingAmt = parseAmount(rawRemainingAmount) || 0;

    // -------------------------------------------------------------------------
    // 2. NHÓM 1: VALIDATE BẮT BUỘC CHUNG & BẮT ĐỘ DÀI (MAX LENGTH)
    // -------------------------------------------------------------------------

    // Tên nhà cung cấp
    if (!supplierId || !supplierName || String(supplierName).trim() === '') {
        errorMessage.push('Tên Nhà cung cấp là bắt buộc.');
    } else {
        checkMaxLength(supplierName, 255, 'Tên Nhà cung cấp', errorMessage);
    }

    // Mã số thuế
    if (!taxCode) {
        errorMessage.push('Mã số thuế là bắt buộc.');
    } else {
        checkMaxLength(taxCode, 255, 'Mã số thuế', errorMessage);
    }

    // Phương thức thanh toán
    if (!paymentMethod) {
        errorMessage.push('Phương thức thanh toán là bắt buộc.');
    }

    // Nội dung giao dịch
    if (!transactionDes) {
        errorMessage.push('Nội dung giao dịch là bắt buộc.');
    } else {
        checkMaxLength(transactionDes, 255, 'Nội dung giao dịch', errorMessage);
    }


    // -------------------------------------------------------------------------
    //  VALIDATE BẮT BUỘC NHẬP SỐ TIỀN (BẮT LỖI NẾU RỖNG - CHẤP NHẬN 0)
    // -------------------------------------------------------------------------

    // Giá trị hóa đơn chấp nhận
    if (approvedAmt === null) {
        errorMessage.push('Giá trị hóa đơn chấp nhận là bắt buộc (nhập 0 nếu không có).');
    } else if (approvedAmt < 0) {
        errorMessage.push('Giá trị hóa đơn chấp nhận (' + approvedAmt + ') không được là số âm.');
    }

    // Số tiền đề nghị thanh toán
    if (requestAmt === null) {
        errorMessage.push('Số tiền đề nghị thanh toán là bắt buộc (nhập 0 nếu không có).');
    } else if (requestAmt < 0) {
        errorMessage.push('Số tiền đề nghị thanh toán (' + requestAmt + ') không được là số âm.');
    }

    // Số tiền hoàn ứng lần này
    if (refundAmt === null) {
        errorMessage.push('Số tiền hoàn ứng lần này là bắt buộc (nhập 0 nếu không có).');
    } else if (refundAmt < 0) {
        errorMessage.push('Số tiền hoàn ứng lần này (' + refundAmt + ') không được là số âm.');
    }

    // -------------------------------------------------------------------------
    // 3. NHÓM 2: VALIDATE HẠN MỨC SỐ TIỀN
    // -------------------------------------------------------------------------
    if (approvedAmt !== null && approvedAmt > remainingAmt) {
        errorMessage.push('Giá trị hóa đơn chấp nhận (' + approvedAmt + ') không được lớn hơn Số tiền còn lại của hợp đồng (' + remainingAmt + ').');
    }

    if (requestAmt !== null && requestAmt > remainingAmt) {
        errorMessage.push('Số tiền đề nghị thanh toán (' + requestAmt + ') không được lớn hơn Số tiền còn lại của hợp đồng (' + remainingAmt + ').');
    }

    if (refundAmt !== null && refundAmt > remainingAmt) {
        errorMessage.push('Số tiền hoàn ứng lần này (' + refundAmt + ') không được lớn hơn Số tiền còn lại của hợp đồng (' + remainingAmt + ').');
    }


    // -------------------------------------------------------------------------
    // 4. NHÓM 3: VALIDATE THEO PHƯƠNG THỨC THANH TOÁN
    // -------------------------------------------------------------------------
    if (paymentMethod === "CHUYENKHOAN") {
        // Số tài khoản thụ hưởng
        if (!beneficiaryAccount) {
            errorMessage.push('Số tài khoản thụ hưởng là bắt buộc.');
        } else {
            checkMaxLength(beneficiaryAccount, 255, 'Số tài khoản thụ hưởng', errorMessage);
        }

        // Ngân hàng thụ hưởng
        if (!beneficiaryBank) {
            errorMessage.push('Ngân hàng thụ hưởng là bắt buộc.');
        } else {
            checkMaxLength(beneficiaryBank, 255, 'Ngân hàng thụ hưởng', errorMessage);
        }


        // 4.2 XỬ LÝ TRA CỨU TÊN CHỦ TÀI KHOẢN VÀ XÁC THỰC LẠI THÔNG TIN NGƯỜI THỤ HƯỞNG
        if (beneficiaryAccount && beneficiaryBank) {

            // So sánh xem STK/Bank hiện tại đã được check thành công trước đó chưa
            var currentCheckedAcct = vars.$lastCheckedAccount;
            var currentCheckedBank = vars.$lastCheckedBank;
            var isAlreadyChecked   = (record['check.name.success'] === true) &&
                    (currentCheckedAcct === beneficiaryAccount) &&
                    (currentCheckedBank === beneficiaryBank);

//            // Nếu người dùng có thay đổi STK hoặc Ngân hàng (chưa được xác thực thành công)
//            if (!isAlreadyChecked) {
//              print('Đang kiểm tra xác thực STK/Ngân hàng...');
//              
//              try {
//                  // Kiểm tra beneficiaryBank có giá trị (bankCode)
//                  if (beneficiaryBank && String(beneficiaryBank).trim() !== "") {
//                      var bankCode = String(beneficiaryBank).trim();
//                      
//                      // Gọi trực tiếp checkAccount với bankCode lấy từ DB
//                      var checkAccountRes = lib.ESD_HTKT_ACCOUNTING_UTILS.checkAccount(
//                          beneficiaryAccount,
//                          bankCode
//                      );
//          
//                      if (checkAccountRes) {
//                          print('Lấy thành công tên người thụ hưởng: ', checkAccountRes);
//          
//                          // Cập nhật tên thụ hưởng & cờ xác thực vào record và biến UI
//                          record['beneficiary.name']     = checkAccountRes;
//                          vars.$beneficiaryName          = checkAccountRes;
//                          record['check.name.success']   = true;
//                          
//                          // Đánh dấu lại STK và Ngân hàng vừa check thành công vào biến toàn cục vars.$
//                            vars.$lastCheckedAccount       = beneficiaryAccount;
//                            vars.$lastCheckedBank          = beneficiaryBank;
//                          
//                          // Cập nhật lại biến beneficiaryName local để pass bước validate phía dưới
//                          beneficiaryName = checkAccountRes;
//                          
//                          // Lưu tạm vào 1 biến tạm trên vars nếu cần pass ra ngoài
//                            vars.$tempCheckedBeneficiaryName = checkAccountRes;
//                      } else {
//                          record['check.name.success'] = false;
//                          errorMessage.push('Không thể xác thực Số tài khoản thụ hưởng tại Ngân hàng đã chọn.');
//                      }
//                  } else {
//                      record['check.name.success'] = false;
//                      errorMessage.push('Vui lòng chọn Ngân hàng thụ hưởng trước khi xác thực.');
//                  }
//              } catch (e) {
//                  record['check.name.success'] = false;
//                  errorMessage.push('Lỗi hệ thống khi tra cứu Tên tài khoản thụ hưởng: ' + e.toString());
//              }
//          }
        }

        // Tên chủ tài khoản thụ hưởng
        if (!beneficiaryName) {
            errorMessage.push('Tên chủ tài khoản thụ hưởng là bắt buộc.');
        } else {
            checkMaxLength(beneficiaryName, 255, 'Tên chủ tài khoản thụ hưởng', errorMessage);
        }

    } else if (paymentMethod === "TIENMAT") {

        // Họ tên người thụ hưởng
        if (!beneficiaryName) {
            errorMessage.push('Họ tên người thụ hưởng là bắt buộc.');
        } else {
            checkMaxLength(beneficiaryName, 255, 'Họ tên người thụ hưởng', errorMessage);
        }

        // Số GTTT
        if (!identityNumber) {
            errorMessage.push('Số giấy tờ tùy thân (CMND/CCCD/Hộ chiếu) là bắt buộc.');
        } else {
            var strIdentity = String(identityNumber).trim();
            if (!/^\d+$/.test(strIdentity)) {
                errorMessage.push('Số giấy tờ tùy thân chỉ được phép nhập số.');
            } else {
                checkMaxLength(strIdentity, 255, 'Số giấy tờ tùy thân', errorMessage);
            }
        }

        // Ngày cấp
        if (!issuedDate) {
            errorMessage.push('Ngày cấp giấy tờ tùy thân là bắt buộc.');
        }

        // Nơi cấp
        if (!issuedPlace) {
            errorMessage.push('Nơi cấp giấy tờ tùy thân là bắt buộc.');
        } else {
            checkMaxLength(issuedPlace, 255, 'Nơi cấp giấy tờ tùy thân', errorMessage);
        }

        // Số điện thoại
        if (!phone) {
            errorMessage.push('Số điện thoại là bắt buộc.');
        } else {
            var strPhone = String(phone).trim();

            if (!/^\d+$/.test(strPhone)) {
                errorMessage.push('Số điện thoại chỉ được chứa các chữ số.');
            } else {
                if (strPhone.length !== 10) {
                    errorMessage.push('Số điện thoại phải gồm đúng 10 số.');
                }
                if (strPhone.charAt(0) !== '0') {
                    errorMessage.push('Số điện thoại phải bắt đầu bằng số 0.');
                }
            }
        }
    }

    return errorMessage;
}




///**
// * Kiểm tra xem vendor.site.id hiện tại có thực sự tồn tại trong DB bảng vendorSite hay không.
// * Nếu không tồn tại (đã bị xóa) -> Tự động xoá site id & bỏ tick ogl.sync.status
// */
//function validateAndSyncVendorSite(record) {
//    var vendorSiteId = record['vendor.site.id'];
//    var vendorId     = record['vendor.id']; 
//    var isSiteValid = false;
//    
//    print('vendorSiteId == ', vendorSiteId);
//     print('vendorId == ', vendorId);
//    if (vendorSiteId && String(vendorSiteId).trim() !== "") {
//        
//        var fSite = new SCFile("esdHTKTvendorSite");
//        var paymentVendorRc = new SCFile("esdHTKTpaymentVendor");
//        
//        // Queri tìm record theo vendor.site.id (và vendor.id nếu cần)
//        var sql = 'id="' + vendorSiteId + '"';
//        if (vendorId) {
//            sql += ' and vendor.id="' + vendorId + '"';
//        }
//
//        if (fSite.doSelect(sql) === RC_SUCCESS) {
//            isSiteValid = true; // Site vẫn còn tồn tại trong DB
//        }
//    }
//
//    if (isSiteValid) {
//        record['ogl.sync.status'] = true;
//        print('isSiteValid == ', record['ogl.sync.status']);
//    } else {
//        // Nếu site đã bị xóa hoặc không hợp lệ -> Cập nhật lại thành rỗng và bỏ check sync status
//        record['vendor.site.id']  = null; 
//        record['ogl.sync.status'] = false;
//        vars.$oglSiteCode = null; 
//        
//        print('isSiteValid else == ', record['ogl.sync.status'], record['vendor.site.id']);
//        
//    }
//
//    return isSiteValid;
//}






/**
 * Hàm validate dữ liệu đầu vào khi user nhập
 * @returns {true | false} Trả về True nếu hợp lệ, ngược lại trả về False
 */
//function validate(payload = {}) {
//    // Bóc tách dữ liệu từ payload (kèm fallback mặc định)
//    var supplierName = payload.supplierName;
//    var supplierId = payload.supplierId;
//    var approvedInvoiceAmount = payload.approvedInvoiceAmount;
//    var amount = payload.amount;
//    var refundAmount = payload.refundAmount;
//    var remainingAmount = payload.remainingAmount;
//    var paymentMethod = payload.paymentMethod;
//    
//    // Đối tượng $L_file truyền từ caller
//    var file = payload.file || {};
//    var transactionDes = file['transaction.des'] || payload.transactionDes;
//    var beneficiaryAccount = file['beneficiary.account'] || payload.beneficiaryAccount;
//    var beneficiaryBank = file['beneficiary.bank'] || payload.beneficiaryBank;
//    var beneficiaryName = file['beneficiary.name'] || payload.beneficiaryName;
//    var identityNumber = file['identity.number'] || payload.identityNumber;
//    var issuedDate = file['issued.date'] || payload.issuedDate;
//    var issuedPlace = file['issued.place'] || payload.issuedPlace;
//    var phone = file['phone'] || payload.phone;
//
//    // Format tiền tệ
//    var remainingAmt = parseAmount(remainingAmount);
//    var approvedAmt  = parseAmount(approvedInvoiceAmount);
//    var requestAmt   = parseAmount(amount);
//    var refundAmt    = parseAmount(refundAmount);
//
//    var errorMessage = "";
//
//    // Xu ly Validate
//    switch (true) {
//        // --- NHÓM 1: VALIDATE BẮT BUỘC CHUNG ---
//        case (!supplierName && !supplierId):
//            errorMessage = "Vui lòng chọn [Tên NCC]";
//            break;
//
//        case (!approvedInvoiceAmount && approvedInvoiceAmount !== 0):
//            errorMessage = "Vui lòng nhập [Giá trị hóa đơn chấp nhận]";
//            break;
//
//        case (!amount && amount !== 0):
//            errorMessage = "Vui lòng nhập [Số tiền đề nghị thanh toán]";
//            break;
//
//        case (!refundAmount && refundAmount !== 0):
//            errorMessage = "Vui lòng nhập [Số tiền hoàn ứng lần này]";
//            break;
//
//        case (!paymentMethod):
//            errorMessage = "Vui lòng chọn [Phương thức thanh toán]";
//            break;
//
//        case (!transactionDes):
//            errorMessage = "Vui lòng nhập [Nội dung giao dịch]";
//            break;
//
//        // --- NHÓM 2: VALIDATE HẠN MỨC SỐ TIỀN ---
//        case (approvedAmt > remainingAmt):
//            errorMessage = "Giá trị hóa đơn chấp nhận (" + approvedAmt + ") không được lớn hơn Số tiền còn lại của hợp đồng (" + remainingAmt + ")";
//            break;
//
//        case (requestAmt > remainingAmt):
//            errorMessage = "Số tiền đề nghị thanh toán (" + requestAmt + ") không được lớn hơn Số tiền còn lại của hợp đồng (" + remainingAmt + ")";
//            break;
//
//        case (refundAmt > remainingAmt):
//            errorMessage = "Số tiền hoàn ứng lần này (" + refundAmt + ") không được lớn hơn Số tiền còn lại của hợp đồng (" + remainingAmt + ")";
//            break;
//
//        // --- NHÓM 3: VALIDATE THEO PHƯƠNG THỨC THANH TOÁN ---
//        case (paymentMethod === "CHUYENKHOAN"):
//            if (!beneficiaryAccount) {
//                errorMessage = "Vui lòng nhập [Số tài khoản thụ hưởng]";
//            } else if (!beneficiaryBank) {
//                errorMessage = "Vui lòng nhập [Ngân hàng thụ hưởng]";
//            }
//            break;
//
//        case (paymentMethod === "TIENMAT"):
//            if (!beneficiaryName) {
//                errorMessage = "Vui lòng nhập [Họ tên người thụ hưởng]";
//            } else if (!identityNumber) {
//                errorMessage = "Vui lòng nhập [Số GTTT]";
//            } else if (!issuedDate) {
//                errorMessage = "Vui lòng nhập [Ngày cấp]";
//            } else if (!issuedPlace) {
//                errorMessage = "Vui lòng nhập [Nơi cấp]";
//            } else if (!phone) {
//                errorMessage = "Vui lòng nhập [Số điện thoại]";
//            }
//            break;
//    }
//
//    // 3. Nếu có lỗi -> Báo lỗi và trả về false
//    if (errorMessage !== "") {
//        showPopUp(errorMessage);
//        return false;
//    }
//
//    return true; // Hợp lệ
//}


