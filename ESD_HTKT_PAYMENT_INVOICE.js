/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_INVOICE
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Thêm mới, cập nhật, xóa và liên kết hóa đơn (esdHTKTpaymentInvoice) vào đề nghị thanh toán.
 * - Kiểm tra tính hợp lệ, trạng thái và kiểm tra hạn mức hóa đơn.
 * - Tự động kích hoạt đồng bộ lại bút toán hạch toán khi danh sách hóa đơn thay đổi.
 * -----------------------------------------------------------------------------
 */

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
            case 'getListPaymentInvoice':
                var invoices = getListPaymentInvoice(input);
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


function getListPaymentInvoice(input) {
    var invoiceList = [];
    var paymentId = "";
    try {
        if (input.details) {
            var queryObj = JSON.parse(input.details);
            paymentId = queryObj.paymentId || "";
        } else if (input.queryString) {
            var queryObjOld = JSON.parse(input.queryString);
            paymentId = queryObjOld.paymentId || "";
        }
    } catch (ex) {
        return invoiceList;
    }

    if (!paymentId) return invoiceList;

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
        ["pi.contract.id", "contract_code", "S"],
        ["pi.payment.id", "payment_id", "S"]
    ];

    // 2. Tự động build câu lệnh SELECT từ mảng trên
    var sqlFields = [];
    for (var i = 0; i < fieldMappings.length; i++) {
        sqlFields.push(fieldMappings[i][0]);
    }
    var select = " SELECT " + sqlFields.join(", ");
    var mapping = " FROM esdHTKTpaymentInvoice pi JOIN esdHTKTinvoice iv on (pi.invoice.id = iv.id) ";
    var control = " WHERE pi.payment.id = \"" + String(paymentId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + "\"";
    var querySQL = select + mapping + control;

    var f = new SCFile("esdHTKTpaymentInvoice", SCFILE_READONLY);
    var rc = f.doSelect(querySQL);

    while (rc == RC_SUCCESS) {
        var item = mapRowToObject(f, fieldMappings);
        item.dateChecker = lib.ESD_HTKT_PAYMENT_VENDOR.checkInvoiceStatus(item.last_check_date);

        invoiceList.push(item);
        rc = f.getNext();
    }

    try { if (f) f.doClose(); } catch (e) {}
    return invoiceList;
}

//Mhung
//Xóa paymenrInvoice tạm thời đang không ở SL này
function deletePaymentInvoice(input) {
    var paymentId = "";
    var invoiceId = "";

    try {
        if (input.details) {
            var queryObj = JSON.parse(input.details);
            paymentId = queryObj.paymentId || "";
            invoiceId = queryObj.invoiceId || "";
        } else if (input.queryString) {
            var queryObjOld = JSON.parse(input.queryString);
            paymentId = queryObjOld.paymentId || "";
            invoiceId = queryObjOld.invoiceId || "";
        }
    } catch (ex) {
        return {
            success: false,
            message: "Lỗi phân tích dữ liệu đầu vào: " + ex.toString()
        };
    }

    if (!paymentId || !invoiceId) {
        return {
            success: false,
            message: "Thiếu thông tin paymentId hoặc invoiceId để thực hiện xóa."
        };
    }

    try {
        var linkFile = new SCFile("esdHTKTpaymentInvoice");
        var linkQuery = "payment.id=\"" + paymentId + "\" and invoice.id=\"" + invoiceId + "\"";
        var rcLink = linkFile.doSelect(linkQuery);

        if (rcLink === RC_SUCCESS) {
            var rcDelete = linkFile.doDelete();

            if (rcDelete !== RC_SUCCESS && rcDelete !== true) {
                return {
                    success: false,
                    message: "Không thể xóa bản ghi liên kết trong bảng esdHTKTpaymentInvoice."
                };
            }

            // TODO: Sinh bút toán chưa làm 

            // trưởng thêm
            syncPaymentEntryAfterInvoiceDelete(paymentId);

        } else {
            // console.warn("Không tìm thấy bản ghi liên kết trong esdHTKTpaymentInvoice với query: " + linkQuery);
        }

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
            // console.warn("Không tìm thấy hóa đơn " + invoiceId + " trong bảng esdHTKTinvoice để gỡ liên kết.");
        }


        return {
            success: true,
            message: "Xóa liên kết tạm ứng cho hóa đơn " + invoiceId + " thành công!"
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


function syncPaymentEntryAfterInvoiceDelete(paymentId) {
    try {
        lib.ESD_HTKT_PAYMENT_ENTRY.syncPrepaymentEntryBySourceChange(
                "esdHTKTpaymentInvoice",
                { "payment.id": paymentId }
        );
    } catch (syncError) {
        // console.error("Khong the sinh lai but toan cho " + paymentId + ": " + syncError.toString());
    }
}
