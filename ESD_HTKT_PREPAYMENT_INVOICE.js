function run() {
    try {
        var input = vars['$L.file'];

        if (!input) { return; }

        var name = input.name;
        if (!name) {
            input.queryReturn = JSON.stringify({ success: false, error: 'Missing action "name"' });
            return;
        }

        var result;
        switch (name) {
            case 'getListPrepaymentInvoice':
                var invoices = getListPrepaymentInvoice(input);
                result = { success: true, data: invoices };
                break;

            case 'deletePrepaymentInvoice':
                var invoices = deletePrepaymentInvoice(input);
                result = { success: true, data: invoices };
                break;

            default:
                result = { success: false, error: "Hành động (name) không hợp lệ: " + name };
        }

        // Ép kiểu chuỗi JSON gọn gàng trả ra cổng API Gateway
        input.queryReturn = JSON.stringify(result);

    } catch (e) {
        if (vars['$L.file']) {
            vars['$L.file'].queryReturn = JSON.stringify({ success: false, error: 'Gateway Error: ' + e.toString() });
        }
    }
}


function getListPrepaymentInvoice(input) {
    var invoiceList = [];
    var transactionId = "";
    try {
        if (input.details) {
            var queryObj = JSON.parse(input.details);
            transactionId = queryObj.transactionId || "";
        } else if (input.queryString) {
            var queryObjOld = JSON.parse(input.queryString);
            transactionId = queryObjOld.transactionId || "";
        }
    } catch (ex) {
        return invoiceList;
    }

    if (!transactionId) return invoiceList;

    // 1. Định nghĩa thứ tự các trường để vừa làm SELECT vừa làm Map Key
    // Cấu trúc: [Tên trường SQL, Tên key JSON đầu ra, Kiểu dữ liệu ('S': String, 'N': Number)]
    var fieldMappings = [
        ["iv.id", "id", "S"],
        ["iv.tax.authority.code", "tax_authority_code", "S"],
        ["iv.invoice.name", "invoice_name", "S"],
        ["iv.invoice.number", "invoice_number", "S"],
        ["iv.invoice.serial", "invoice_serial", "S"],
        ["iv.invoice.pattern", "invoice_pattern", "S"],
        ["iv.invoice.date", "invoice_date", "D"],
        ["iv.seller.name", "seller_name", "S"],
        ["iv.seller.tax.code", "seller_tax_code", "S"],
        ["iv.seller.address", "seller_address", "S"],
        ["iv.seller.phone", "seller_phone", "S"],
        ["iv.seller.account.number", "seller_account_number", "S"],
        ["iv.seller.bank.name", "seller_bank_name", "S"],
        ["iv.payment.method", "payment_method", "S"],
        ["iv.buyer.name", "buyer_name", "S"],
        ["iv.buyer.tax.code", "buyer_tax_code", "S"],
        ["iv.buyer.address", "buyer_address", "S"],
        ["iv.buyer.phone", "buyer_phone", "S"],
        ["iv.statement.number", "statement_number", "S"],
        ["iv.statement.date", "statement_date", "D"],
        ["iv.invoice.type", "invoice_type", "S"],
        ["iv.total.fee.amount", "total_fee_amount", "N"],
        ["iv.total.before.tax", "total_before_tax", "N"],
        ["iv.total.tax", "total_tax", "N"],
        ["iv.total.discount.amount", "total_discount_amount", "N"],
        ["iv.grand.total", "grand_total", "N"],
        ["iv.currency", "currency", "S"],
        ["iv.exchange.rate", "exchange_rate", "N"],
        ["iv.seller.signed.at", "seller_signed_at", "D"],
        ["iv.note", "note", "S"],
        ["iv.process.type", "process_type", "S"],
        ["iv.accounting.status", "accounting_status", "S"],
        ["iv.check.status", "check_status", "S"],
        ["iv.check.status.detail", "check_status_detail", "S"],
        ["iv.last.check.date", "last_check_date", "S"],
        ["iv.last.check.by", "last_check_by", "S"],
        ["iv.last.check.image.id", "last_check_image_id", "S"],
        ["iv.last.check.seller.image.id", "last_check_seller_image_id", "S"],
        ["iv.check.priority.level", "check_priority_level", "N"],
        ["iv.request.id", "request_id", "S"],
        ["iv.ecm.doc.id", "ecm_doc_id", "S"],
        ["iv.file.name", "file_name", "S"],
        ["iv.branch.code", "branch_code", "S"],
        ["iv.ogl.id", "ogl_id", "S"],
        ["iv.created.at", "created_at", "D"],
        ["iv.created.by", "created_by", "S"],
        ["iv.operator", "operator", "S"],
        ["iv.fee.name", "fee_name", "S"],
        ["iv.job.status", "job_status", "S"],
        ["iv.parent.id", "parent_id", "S"],
        ["iv.parent.invoice.number", "parent_invoice_number", "S"],
        ["iv.unit.lv1", "unit_lv1", "S"],
        ["iv.unit.lv2", "unit_lv2", "S"],
        ["iv.unit.lv3", "unit_lv3", "S"],
        ["pi.deduction.type", "deduction_type", "S"],
        ["pi.prepayment.id", "prepayment_id", "S"]
    ];

    // 2. Tự động build câu lệnh SELECT từ mảng trên
    var sqlFields = [];
    for (var i = 0; i < fieldMappings.length; i++) {
        sqlFields.push(fieldMappings[i][0]);
    }
    var select = " SELECT " + sqlFields.join(", ");
    var mapping = " FROM esdHTKTprepaymentInvoice pi JOIN esdHTKTinvoice iv on (pi.invoice.id = iv.id) ";
    var control = " WHERE pi.prepayment.id = \"" + String(transactionId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + "\"";
    var querySQL = select + mapping + control;

    var f = new SCFile("esdHTKTprepaymentInvoice", SCFILE_READONLY);
    var rc = f.doSelect(querySQL);

    while (rc == RC_SUCCESS) {
        var item = mapRowToObject(f, fieldMappings);

        item.dateChecker = lib.ESD_HTKT_PREPAYMENT_VENDOR.checkInvoiceStatus(item.last_check_date);

        invoiceList.push(item);
        rc = f.getNext();
    }

    try { if (f) f.doClose(); } catch (e) {}
    return invoiceList;
}

//function deletePrepaymentInvoice(input) {
//    var prepaymentId = "";
//    var invoiceId = "";
//
//    try {
//        if (input.details) {
//            var queryObj = JSON.parse(input.details);
//            prepaymentId = queryObj.prepaymentId || "";
//            invoiceId = queryObj.invoiceId || "";
//        } else if (input.queryString) {
//            var queryObjOld = JSON.parse(input.queryString);
//            prepaymentId = queryObjOld.prepaymentId || "";
//            invoiceId = queryObjOld.invoiceId || "";
//        }
//    } catch (ex) {
//        return {
//            success: false,
//            message: "Lỗi phân tích dữ liệu đầu vào: " + ex.toString()
//        };
//    }
//
//    if (!prepaymentId || !invoiceId) {
//        return {
//            success: false,
//            message: "Thiếu thông tin prepaymentId hoặc invoiceId để thực hiện xóa."
//        };
//    }
//    
//    try {
//        var linkFile = new SCFile("esdHTKTprepaymentInvoice");
//        var linkQuery = "prepayment.id=\"" + prepaymentId + "\" and invoice.id=\"" + invoiceId + "\"";
//        var rcLink = linkFile.doSelect(linkQuery);
//
//        if (rcLink === RC_SUCCESS) {
//            var rcDelete = linkFile.doDelete();
//
//            if (rcDelete !== RC_SUCCESS && rcDelete !== true) {
//                return {
//                    success: false,
//                    message: "Không thể xóa bản ghi liên kết trong bảng esdHTKTprepaymentInvoice."
//                };
//            }
// 
//            // trưởng thêm
//            syncPrepaymentEntryAfterInvoiceDelete(prepaymentId);
//
//        } else {
//            console.warn("Không tìm thấy bản ghi liên kết trong esdHTKTprepaymentInvoice với query: " + linkQuery);
//        }
//
//        var invFile = new SCFile("esdHTKTinvoice");
//        var invQuery = "id=\"" + invoiceId + "\"";
//        var rcInv = invFile.doSelect(invQuery);
//
//        if (rcInv === RC_SUCCESS) {
//            invFile["request.id"] = null;
//
//            var rcUpdate = invFile.doUpdate();
//
//            if (rcUpdate !== RC_SUCCESS) {
//                return {
//                    success: false,
//                    message: "Đã xóa bản ghi liên kết nhưng thất bại khi cập nhật request.id về null cho hóa đơn " + invoiceId
//                };
//            }
//            
//        } else {
//            console.warn("Không tìm thấy hóa đơn " + invoiceId + " trong bảng esdHTKTinvoice để gỡ liên kết.");
//        }
//
//
//        return {
//            success: true,
//            message: "Xóa liên kết tạm ứng cho hóa đơn " + invoiceId + " thành công!"
//        };
//
//    } catch (dbError) {
//        return {
//            success: false,
//            message: "Bị lỗi hệ thống trong quá trình xóa/cập nhật: " + dbError.toString()
//        };
//    }
//}

//function deletePrepaymentInvoice(input) {
//    var prepaymentId = "";
//    var invoiceId = "";
//    var vendorId = "";
//
//    // 1. Phân tích dữ liệu đầu vào linh hoạt theo payload thực tế của bạn
//    try {
//        var rawDetails = "";
//        if (input.esdHTKTprepaymentInvoiceList && input.esdHTKTprepaymentInvoiceList.details) {
//            rawDetails = input.esdHTKTprepaymentInvoiceList.details;
//        } else if (input.details) {
//            rawDetails = input.details;
//        } else if (input.queryString) {
//            rawDetails = input.queryString;
//        }
//
//        if (rawDetails) {
//            var queryObj = JSON.parse(rawDetails);
//            prepaymentId = queryObj.prepaymentId || "";
//            invoiceId = queryObj.invoiceId || "";
//            vendorId = queryObj.vendorId || "";
//        }
//    } catch (ex) {
//        return {
//            success: false,
//            message: "Lỗi phân tích dữ liệu đầu vào: " + ex.toString()
//        };
//    }
//
//    if (!prepaymentId || !invoiceId) {
//        return {
//            success: false,
//            message: "Thiếu thông tin prepaymentId hoặc invoiceId để thực hiện xóa."
//        };
//    }
//
//    try {
//        // 2. Lấy thông tin grandTotal của hóa đơn chuẩn bị gỡ để hoàn trả tiền
//        var invoiceGrandTotal = 0;
//        var tempInvFile = new SCFile("esdHTKTinvoice");
//        var tempInvQuery = "id=\"" + invoiceId + "\"";
//        if (tempInvFile.doSelect(tempInvQuery) === RC_SUCCESS) {
//            invoiceGrandTotal = Number(tempInvFile["grand.total"] || tempInvFile["grandTotal"] || 0);
//        }
//// =====================================================================
//        // --- BƯỚC 2.5: CHẶN GỠ HÓA ĐƠN NẾU LÀM TỔNG TIỀN CÒN LẠI <= 0 ---
//        // =====================================================================
//        if (vendorId && prepaymentId) {
//            var vendorFileCheck = new SCFile("esdHTKTprepaymentVendor");
//            var vendorQueryCheck = "prepayment.id=\"" + prepaymentId + "\" and vendor.id=\"" + vendorId + "\"";
//            
//            if (vendorFileCheck.doSelect(vendorQueryCheck) === RC_SUCCESS) {
//                var currentAmount = Number(vendorFileCheck["amount"] || 0);
//                var newAmount = currentAmount - invoiceGrandTotal;
//
//                // Nếu giả lập gỡ xong mà tổng tiền <= 0, ta cần kiểm tra xem có phải do còn sót hóa đơn âm không
//                if (newAmount <= 0) {
//                    var checkOtherInvFile = new SCFile("esdHTKTinvoice", SCFILE_READONLY);
//                    var mapping = " FROM esdHTKTinvoice i JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) ";
//                    var control = " WHERE i.request.id = \"" + prepaymentId + "\" AND v.id = \"" + vendorId + "\" AND i.id ~= \"" + invoiceId + "\"";
//                    var querySQL = "SELECT i.id " + mapping + control;
//                    
//                    var hasOtherInvoices = false;
//                    // Nếu truy vấn select trả về thành công nghĩa là vẫn còn hóa đơn khác đang gắn
//                    if (checkOtherInvFile.doSelect(querySQL) === RC_SUCCESS) {
//                        hasOtherInvoices = true;
//                    }
//
//                    // Nếu VẪN CÒN hóa đơn khác gắn vào mà tổng tiền lại <= 0 -> Không hợp lệ (vi phạm rule > 0)
//                    if (hasOtherInvoices) {
//                        return {
//                            success: false,
//                            message: "Không thể gỡ hóa đơn này. Nếu gỡ, tổng tiền các hóa đơn còn lại sẽ nhỏ hơn hoặc bằng 0 (do còn hóa đơn âm). Vui lòng gỡ hóa đơn âm trước."
//                        };
//                    }
//                }
//            }
//        }
//        // 3. Xóa bản ghi liên kết trong bảng esdHTKTprepaymentInvoice
//        var linkFile = new SCFile("esdHTKTprepaymentInvoice");
//        var linkQuery = "prepayment.id=\"" + prepaymentId + "\" and invoice.id=\"" + invoiceId + "\"";
//        var rcLink = linkFile.doSelect(linkQuery);
//
//        if (rcLink === RC_SUCCESS) {
//            var rcDelete = linkFile.doDelete();
//
//            if (rcDelete !== RC_SUCCESS && rcDelete !== true) {
//                return {
//                    success: false,
//                    message: "Không thể xóa bản ghi liên kết trong bảng esdHTKTprepaymentInvoice."
//                };
//            }
//
//            // Đồng bộ thuế nếu có
//            if (typeof syncPrepaymentEntryAfterInvoiceDelete === "function") {
//                syncPrepaymentEntryAfterInvoiceDelete(prepaymentId);
//            }
//        } else {
//            console.warn("Không tìm thấy bản ghi liên kết trong esdHTKTprepaymentInvoice với query: " + linkQuery);
//        }
//
//        // 4. Cập nhật request.id trong bảng esdHTKTinvoice về null
//        var invFile = new SCFile("esdHTKTinvoice");
//        var invQuery = "id=\"" + invoiceId + "\"";
//        var rcInv = invFile.doSelect(invQuery);
//
//        if (rcInv === RC_SUCCESS) {
//            invFile["request.id"] = null;
//            var rcUpdate = invFile.doUpdate();
//
//            if (rcUpdate !== RC_SUCCESS) {
//                return {
//                    success: false,
//                    message: "Đã xóa bản ghi liên kết nhưng thất bại khi cập nhật request.id về null cho hóa đơn " + invoiceId
//                };
//            }
//        } else {
//            console.warn("Không tìm thấy hóa đơn " + invoiceId + " trong bảng esdHTKTinvoice để gỡ liên kết.");
//        }
//
//        // 5. Cập nhật lại số tiền (amount) trong bảng esdHTKTprepaymentVendor (Cộng bù lại tiền của hóa đơn vừa gỡ)
//   if (vendorId && prepaymentId && invoiceGrandTotal !== 0) {
//            var vendorFile = new SCFile("esdHTKTprepaymentVendor");
//            var vendorQuery = "prepayment.id=\"" + prepaymentId + "\" and vendor.id=\"" + vendorId + "\"";
//            var rcVendor = vendorFile.doSelect(vendorQuery);
//
//            if (rcVendor === RC_SUCCESS) {
//                var currentAmountToUpdate = Number(vendorFile["amount"] || 0);
//                
//                // Trừ số tiền hóa đơn đã gỡ (Nếu âm trừ âm sẽ thành cộng hoàn lại)
//                vendorFile["amount"] = currentAmountToUpdate - invoiceGrandTotal;
//
//                var rcVendorUpdate = vendorFile.doUpdate();
//                if (rcVendorUpdate !== RC_SUCCESS) {
//                    console.error("Lỗi khi cập nhật lại amount cho esdHTKTprepaymentVendor với prepayment.id: " + prepaymentId);
//                }
//            }
//        }
//
//        return {
//            success: true,
//            message: "Xóa liên kết tạm ứng cho hóa đơn " + invoiceId + " thành công và đã hoàn trả lại số tiền tương ứng!"
//        };
//
//    } catch (dbError) {
//        return {
//            success: false,
//            message: "Bị lỗi hệ thống trong quá trình xóa/cập nhật: " + dbError.toString()
//        };
//    }
//}

function deletePrepaymentInvoice(input) {
    var prepaymentId = "";
    var invoiceId = "";
    var vendorId = "";

    // 1. Phân tích dữ liệu đầu vào linh hoạt theo payload thực tế của bạn
    try {
        var rawDetails = "";
        if (input.esdHTKTprepaymentInvoiceList && input.esdHTKTprepaymentInvoiceList.details) {
            rawDetails = input.esdHTKTprepaymentInvoiceList.details;
        } else if (input.details) {
            rawDetails = input.details;
        } else if (input.queryString) {
            rawDetails = input.queryString;
        }

        if (rawDetails) {
            var queryObj = JSON.parse(rawDetails);
            prepaymentId = queryObj.prepaymentId || "";
            invoiceId = queryObj.invoiceId || "";
            vendorId = queryObj.vendorId || "";
        }
    } catch (ex) {
        return {
            success: false,
            message: "Lỗi phân tích dữ liệu đầu vào: " + ex.toString()
        };
    }

    if (!prepaymentId || !invoiceId) {
        return {
            success: false,
            message: "Thiếu thông tin prepaymentId hoặc invoiceId để thực hiện xóa."
        };
    }

    try {
        // 2. Lấy thông tin grandTotal của hóa đơn chuẩn bị gỡ để hoàn trả tiền (Dùng kiểu String)
        var invoiceGrandTotal = "0";
        var tempInvFile = new SCFile("esdHTKTinvoice");
        var tempInvQuery = "id=\"" + invoiceId + "\"";
        if (tempInvFile.doSelect(tempInvQuery) === RC_SUCCESS) {
            invoiceGrandTotal = String(tempInvFile["grand.total"] || tempInvFile["grandTotal"] || "0");
        }

        // =====================================================================
        // --- BƯỚC 2.5: CHẶN GỠ HÓA ĐƠN NẾU LÀM TỔNG TIỀN CÒN LẠI <= 0 ---
        // =====================================================================
        if (vendorId && prepaymentId) {
            var vendorFileCheck = new SCFile("esdHTKTprepaymentVendor");
            var vendorQueryCheck = "prepayment.id=\"" + prepaymentId + "\" and vendor.id=\"" + vendorId + "\"";
            
            if (vendorFileCheck.doSelect(vendorQueryCheck) === RC_SUCCESS) {
                var currentAmount = String(vendorFileCheck["amount"] || "0");
                
                // Trừ tiền bằng thư viện SL (String)
                var newAmount = lib.ESD_HTKT_Utils.subtractStringsManual(currentAmount, invoiceGrandTotal);

                // Kiểm tra newAmount <= 0
                if (lib.ESD_HTKT_Utils.compareMoneyStrings(newAmount, "0") <= 0) {
                    var checkOtherInvFile = new SCFile("esdHTKTinvoice", SCFILE_READONLY);
                    var mapping = " FROM esdHTKTinvoice i JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) ";
                    var control = " WHERE i.request.id = \"" + prepaymentId + "\" AND v.id = \"" + vendorId + "\" AND i.id ~= \"" + invoiceId + "\"";
                    var querySQL = "SELECT i.id " + mapping + control;
                    
                    var hasOtherInvoices = false;
                    // Nếu truy vấn select trả về thành công nghĩa là vẫn còn hóa đơn khác đang gắn
                    if (checkOtherInvFile.doSelect(querySQL) === RC_SUCCESS) {
                        hasOtherInvoices = true;
                    }

                    // Nếu VẪN CÒN hóa đơn khác gắn vào mà tổng tiền lại <= 0 -> Không hợp lệ
                    if (hasOtherInvoices) {
                        return {
                            success: false,
                            message: "Không thể gỡ hóa đơn này. Nếu gỡ, tổng tiền các hóa đơn còn lại sẽ nhỏ hơn hoặc bằng 0 (do còn hóa đơn âm). Vui lòng gỡ hóa đơn âm trước."
                        };
                    }
                }
                 var remainingData = lib.ESD_HTKT_PREPAYMENT_VENDOR.getPrepaymentRemainingAmount(prepaymentId);
                var totalRemainingAmount = "0";

                if (Array.isArray(remainingData)) {
                    for (var m = 0; m < remainingData.length; m++) {
                        var rAmt = String(remainingData[m].remaining_amount || "0");
                        totalRemainingAmount = lib.ESD_HTKT_Utils.addStringsManual(totalRemainingAmount, rAmt);
                    }
                } else if (typeof remainingData === "object" && remainingData !== null) {
                    totalRemainingAmount = String(remainingData.remaining_amount || remainingData.remainingAmount || "0");
                } else {
                    totalRemainingAmount = String(remainingData || "0");
                }

                if (lib.ESD_HTKT_Utils.compareMoneyStrings(newAmount, totalRemainingAmount) > 0) {
                    return {
                        success: false,
                        message: "Không thể gỡ hóa đơn này. Tổng tiền các hóa đơn còn lại sẽ vượt quá số tiền còn lại."
                    };
                }

                // TH3: Kiểm tra vượt quá Giá trị bảo lãnh (Guarantee Amount)
                var contractId = "";
                var parentPrepCheck = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
                if (parentPrepCheck.doSelect('id="' + prepaymentId + '"') == RC_SUCCESS) {
                    contractId = parentPrepCheck["contract.id"];
                }
                try { parentPrepCheck.doClose(); } catch (e) {}

                if (contractId) {
                    var guaranteeAmountStr = null;
                    var docInfoFile = new SCFile("esdHDcontractDocInfo", SCFILE_READONLY);
                    var docQuery = 'contract.id="' + contractId + '" and doc.type="BAOLANHTU" and status="Co hieu luc"';
                    
                    if (docInfoFile.doSelect(docQuery) == RC_SUCCESS) {
                        guaranteeAmountStr = docInfoFile["guarantee.amount"];
                    }
                    try { docInfoFile.doClose(); } catch(e) {}

                    var cleanGuaranteeStr = String(guaranteeAmountStr || "").replace(/,/g, '').trim();

                    if (cleanGuaranteeStr !== "" && cleanGuaranteeStr !== "null" && Number(cleanGuaranteeStr) > 0) {
                        var totalAccountedAmountStr = "0";
                        var prepFile = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
                        var query = 'contract.id="' + contractId + '" and (status="approved" or status="accounted")';
                        var rcPrep = prepFile.doSelect(query);

                        while (rcPrep == RC_SUCCESS) {
                            if (prepFile["id"] !== prepaymentId) {
                                var accountedAmtStr = String(prepFile["amount"] || "0").trim();
                                totalAccountedAmountStr = lib.ESD_HTKT_Utils.addStringsManual(totalAccountedAmountStr, accountedAmtStr);
                            }
                            rcPrep = prepFile.getNext();
                        }
                        try { prepFile.doClose(); } catch(e) {}

                        // Cộng tổng = (Các phiếu đã hạch toán + số tiền vendor sau khi gỡ hóa đơn)
                        var totalAmountStr = lib.ESD_HTKT_Utils.addStringsManual(totalAccountedAmountStr, newAmount);
                        var finalGuaranteeStr = String(guaranteeAmountStr).trim();

                        if (lib.ESD_HTKT_Utils.compareMoneyStrings(totalAmountStr, finalGuaranteeStr) === 1) {
                            return {
                                success: false,
                                message: "Không thể gỡ hóa đơn này. Tổng tiền các hóa đơn còn lại và phiếu đã phê duyệt sẽ vượt quá giá trị bảo lãnh."
                            };
                        }
                    }
                }
            }
        }

        // 3. Xóa bản ghi liên kết trong bảng esdHTKTprepaymentInvoice
        var linkFile = new SCFile("esdHTKTprepaymentInvoice");
        var linkQuery = "prepayment.id=\"" + prepaymentId + "\" and invoice.id=\"" + invoiceId + "\"";
        var rcLink = linkFile.doSelect(linkQuery);

        if (rcLink === RC_SUCCESS) {
            var rcDelete = linkFile.doDelete();

            if (rcDelete !== RC_SUCCESS && rcDelete !== true) {
                return {
                    success: false,
                    message: "Không thể xóa bản ghi liên kết trong bảng esdHTKTprepaymentInvoice."
                };
            }

            // Đồng bộ thuế nếu có
            if (typeof syncPrepaymentEntryAfterInvoiceDelete === "function") {
                syncPrepaymentEntryAfterInvoiceDelete(prepaymentId);
            }
        } else {
            console.warn("Không tìm thấy bản ghi liên kết trong esdHTKTprepaymentInvoice với query: " + linkQuery);
        }

        // 4. Cập nhật request.id trong bảng esdHTKTinvoice về null
        var invFile = new SCFile("esdHTKTinvoice");
        var invQuery = "id=\"" + invoiceId + "\"";
        var rcInv = invFile.doSelect(invQuery);

        if (rcInv === RC_SUCCESS) {
            invFile["request.id"] = null;
            var rcUpdate = invFile.doUpdate();

            if (rcUpdate !== RC_SUCCESS) {
                return {
                    success: false,
                    message: "Đã xóa bản ghi liên kết nhưng thất bại khi cập nhật request.id về null cho hóa đơn " + invoiceId
                };
            }
        } else {
            console.warn("Không tìm thấy hóa đơn " + invoiceId + " trong bảng esdHTKTinvoice để gỡ liên kết.");
        }

        // 5. Cập nhật lại số tiền (amount) trong bảng esdHTKTprepaymentVendor và esdHTKTprepayment
        if (vendorId && prepaymentId && lib.ESD_HTKT_Utils.compareMoneyStrings(invoiceGrandTotal, "0") !== 0) {
            
            // 5.1 Cập nhật amount cho esdHTKTprepaymentVendor (Nhà cung cấp hiện tại)
            var vendorFile = new SCFile("esdHTKTprepaymentVendor");
            var vendorQuery = "prepayment.id=\"" + prepaymentId + "\" and vendor.id=\"" + vendorId + "\"";
            var rcVendor = vendorFile.doSelect(vendorQuery);

            if (rcVendor === RC_SUCCESS) {
                var currentAmountToUpdate = String(vendorFile["amount"] || "0");
                var calculatedVendorAmount = lib.ESD_HTKT_Utils.subtractStringsManual(currentAmountToUpdate, invoiceGrandTotal);
                
                // NẾU TỔNG VỀ 0 HOẶC ÂM -> GÁN RỖNG ("") HOẶC NULL
                if (lib.ESD_HTKT_Utils.compareMoneyStrings(calculatedVendorAmount, "0") <= 0) {
                    vendorFile["amount"] = ""; 
                } else {
                    vendorFile["amount"] = calculatedVendorAmount;
                }

                var rcVendorUpdate = vendorFile.doUpdate();
                if (rcVendorUpdate !== RC_SUCCESS) {
                    console.error("Lỗi khi cập nhật lại amount cho esdHTKTprepaymentVendor với prepayment.id: " + prepaymentId);
                }
            }

            // 5.2 Tính lại tổng số tiền của tất cả NCC và cập nhật vào bảng esdHTKTprepayment
            var sumPrepaymentAmount = "0";
            var hasValidVendorAmount = false; // Kiểm tra xem còn NCC nào có tiền > 0 không
            
            var sumVendorFile = new SCFile("esdHTKTprepaymentVendor");
            var sumVendorQuery = "prepayment.id=\"" + prepaymentId + "\"";
            var rcSumVendor = sumVendorFile.doSelect(sumVendorQuery);
            
            while (rcSumVendor == RC_SUCCESS) {
                var vAmount = String(sumVendorFile["amount"] || "0");
                if (vAmount !== "") {
                    sumPrepaymentAmount = lib.ESD_HTKT_Utils.addStringsManual(sumPrepaymentAmount, vAmount);
                    if (lib.ESD_HTKT_Utils.compareMoneyStrings(vAmount, "0") > 0) {
                        hasValidVendorAmount = true;
                    }
                }
                rcSumVendor = sumVendorFile.getNext();
            }
            
            var prepaymentFile = new SCFile("esdHTKTprepayment");
            var prepaymentQuery = "id=\"" + prepaymentId + "\"";
            var rcPrepayment = prepaymentFile.doSelect(prepaymentQuery);

            if (rcPrepayment == RC_SUCCESS) {
                // NẾU KHÔNG CÒN SỐ TIỀN HỢP LỆ NÀO -> GÁN RỖNG ("")
                if (!hasValidVendorAmount || lib.ESD_HTKT_Utils.compareMoneyStrings(sumPrepaymentAmount, "0") <= 0) {
                    prepaymentFile["amount"] = "";
                } else {
                    prepaymentFile["amount"] = sumPrepaymentAmount;
                }

                var rcPrepaymentUpdate = prepaymentFile.doUpdate();
                if (rcPrepaymentUpdate !== RC_SUCCESS) {
                    console.error("Lỗi khi cập nhật tổng amount cho esdHTKTprepayment với id: " + prepaymentId);
                }
            }
        }

        return {
            success: true,
            message: "Xóa liên kết tạm ứng cho hóa đơn " + invoiceId + " thành công và đã hoàn trả lại số tiền tương ứng!"
        };

    } catch (dbError) {
        return {
            success: false,
            message: "Bị lỗi hệ thống trong quá trình xóa/cập nhật: " + dbError.toString()
        };
    }
}

function mapRowToObject(scFileRecord, fieldMappings) {
    var item = {};

    for (var j = 0; j < fieldMappings.length; j++) {
        var jsonKey = fieldMappings[j][1];
        var dataType = fieldMappings[j][2];
        var dbValue = scFileRecord[j];

        if (dataType === "N") {
            item[jsonKey] = dbValue ? Number(dbValue) : 0;
        } else if (dataType === "D") {
            if (dbValue) {
                item[jsonKey] = dbValue.toISOString ? dbValue.toISOString() : String(dbValue);
            } else {
                item[jsonKey] = "";
            }
        } else {
            item[jsonKey] = dbValue ? String(dbValue) : "";
        }
    }

    return item;
}

// trưởng thêm
function syncPrepaymentEntryAfterInvoiceDelete(prepaymentId) {
    try {
        lib.ESD_HTKT_PREPAYMENT_ENTRY.syncPrepaymentEntryBySourceChange(
            "esdHTKTprepaymentInvoice", { "prepayment.id": prepaymentId }
        );
    } catch (syncError) {
        console.error("Khong the sinh lai but toan cho " + prepaymentId + ": " + syncError.toString());
    }
}


/* =============================================================================
 * BO SUNG: Go lien ket hoa don khi XOA TOAN BO de nghi tam ung tren Workflow SM.
 * Khong dung cho thao tac xoa mot hoa don / xoa NCC tu giao dien NextJS.
 * Khong thay doi amount cua NCC, tong tien phieu hoac but toan da luu.
 * ============================================================================= */
function unlinkAllInvoicesOnPrepaymentCancel(prepaymentId) {
    var id = String(prepaymentId || "").trim();
    var invoiceIds = [];
    var seen = {};
    var linkFile = null;
    var invFile = null;
    var deletedCount = 0;
    var i;

    function escapeQuery(value) {
        return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }
    function closeFile(file) {
        try { if (file) file.doClose(); } catch (closeError) {}
    }

    if (!id) {
        return { success: false, message: "Thieu ma de nghi tam ung." };
    }

    try {
        var prepQuery = 'prepayment.id="' + escapeQuery(id) + '"';

        // Buoc 1: Lay danh sach invoice.id tu bang lien ket, KHONG xoa o day.
        linkFile = new SCFile("esdHTKTprepaymentInvoice", SCFILE_READONLY);
        var rc = linkFile.doSelect(prepQuery);
        while (rc == RC_SUCCESS) {
            var invoiceId = String(linkFile["invoice.id"] || "").trim();
            if (!invoiceId) {
                throw new Error("Ban ghi lien ket thieu invoice.id; khong the huy an toan.");
            }
            if (!seen["#" + invoiceId]) {
                seen["#" + invoiceId] = true;
                invoiceIds.push(invoiceId);
            }
            rc = linkFile.getNext();
        }
        closeFile(linkFile);
        linkFile = null;

        // Buoc 2: Kiem tra truoc tat ca hoa don, tranh can thiep request khac.
        invFile = new SCFile("esdHTKTinvoice", SCFILE_READONLY);
        for (i = 0; i < invoiceIds.length; i++) {
            if (invFile.doSelect('id="' + escapeQuery(invoiceIds[i]) + '"') != RC_SUCCESS) {
                throw new Error("Khong tim thay hoa don " + invoiceIds[i] + ".");
            }
            var owner = String(invFile["request.id"] || "").trim();
            if (owner && owner !== id) {
                throw new Error("Hoa don " + invoiceIds[i] + " dang thuoc de nghi " + owner + ".");
            }
        }
        closeFile(invFile);
        invFile = null;

        // Buoc 3: Go cac lien ket, sau do clear request.id neu van la phieu nay.
        // Khong goi deletePrepaymentInvoice vi ham do con validate / cap nhat amount.
        for (i = 0; i < invoiceIds.length; i++) {
            var currentId = invoiceIds[i];
            var linkQuery = prepQuery + ' and invoice.id="' + escapeQuery(currentId) + '"';
            linkFile = new SCFile("esdHTKTprepaymentInvoice");
            while (linkFile.doSelect(linkQuery) == RC_SUCCESS) {
                var deleteRc = linkFile.doDelete();
                if (deleteRc != RC_SUCCESS && deleteRc !== true) {
                    throw new Error("Khong go duoc lien ket hoa don " + currentId + ".");
                }
                deletedCount++;
            }
            closeFile(linkFile);
            linkFile = null;

            invFile = new SCFile("esdHTKTinvoice");
            if (invFile.doSelect('id="' + escapeQuery(currentId) + '"') != RC_SUCCESS) {
                throw new Error("Hoa don " + currentId + " khong con ton tai khi cap nhat.");
            }
            var currentOwner = String(invFile["request.id"] || "").trim();
            if (currentOwner && currentOwner !== id) {
                throw new Error("Hoa don " + currentId + " da duoc gan cho de nghi khac.");
            }
            if (currentOwner === id) {
                invFile["request.id"] = null;
                var updateRc = invFile.doUpdate();
                if (updateRc != RC_SUCCESS && updateRc !== true) {
                    throw new Error("Khong clear duoc request.id hoa don " + currentId + ".");
                }
            }
            closeFile(invFile);
            invFile = null;
        }

        return { success: true, deletedCount: deletedCount, invoiceCount: invoiceIds.length };
    } catch (e) {
        print("[PREPAYMENT_INVOICE.unlinkAllInvoicesOnPrepaymentCancel] " + e.toString());
        return { success: false, deletedCount: deletedCount, message: e.toString() };
    } finally {
        closeFile(linkFile);
        closeFile(invFile);
    }
}
