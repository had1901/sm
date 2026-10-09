/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_VENDOR
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Quản lý danh sách nhà cung cấp thụ hưởng trong đề nghị thanh toán (esdHTKTpaymentVendor).
 * - Thêm mới, cập nhật, xóa thông tin thanh toán (số tài khoản, ngân hàng, số tiền, hình thức thanh toán).
 * - Kiểm tra và xác thực tính hợp lệ của thông tin nhà cung cấp với dữ liệu Vendor/Site tập trung.
 * - Tự động đồng bộ và tính toán lại tổng tiền đề nghị thanh toán và bút toán hạch toán.
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
                //Danh sách Đề nghị theo nhà cung cấp
            case 'getListPaymentVendor':
                var data = getListPaymentVendor(input);
                result = { success: true, data: data };
                break;
                //tổng nhà cung cấp
            case 'totalContractSuppliers':
                var data = totalContractSuppliers(input);
                result = { success: true, data: data };
                break;
                //Xóa nhà cung cấp
            case 'deletePaymentVendor':
                var data = deletePaymentVendor(input);
                result = { success: true, data: data };
                break;
                //Danh sách Hóa đơn có thể chọn theo nhà cung cấp
            case 'getListInvoinVendor':
                var data = getListInvoinVendor(input);
                result = { success: true, data: data };
                break;
                //Danh sách Hóa đơn đã được gán với nhà cung cấp
            case 'getInvoicesBySupplier':
                var data = getInvoicesBySupplier(input);
                result = { success: true, data: data };
                break;
                //Gán hóa đơn vào nhà cung cấp
            case 'createListInvoinVendor':
                var data = createListInvoinVendor(input);
                result = { success: true, data: data };
                break;
            case 'deletePaymentInvoice':
                var data = deletePaymentInvoice(input);
                result = { success: true, data: data };
                break;
                //cập nhật Loại khấu trừ thuế 
            case 'updateListInvoinVendor':
                var data = updateListInvoinVendor(input);
                result = { success: true, data: data };
                break;
            default:
                result = { success: false, error: 'Hanh dong (name) khong hop le: ' + name };
        }

        input.queryReturn = JSON.stringify(result);
    } catch (e) {
        if (vars['$L.file']) {
            vars['$L.file'].queryReturn = JSON.stringify({ success: false, error: 'Gateway Error: ' + e.toString() });
        }
    }
}

function totalContractSuppliers(input) {
    var totalSuppliers = 0;
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
        return totalSuppliers;
    }

    if (!paymentId) return totalSuppliers;

    // 1. Lấy contractId từ esdHTKTpayment
    var contractId = "";
    var payment = new SCFile("esdHTKTpayment", SCFILE_READONLY);
    var sqlPayment = "id=\"" + paymentId + "\"";

    if (payment.doSelect(sqlPayment) == RC_SUCCESS) {
        if (payment["contract.id"]) {
            contractId = payment["contract.id"];
        }
    }

    // 2. Tính tổng số nhà cung cấp từ esdHDcontractSupplier theo contractId
    if (contractId) {
        var vendorFile = new SCFile("esdHDcontractSupplier", SCFILE_READONLY);
        var sqlVendor = "contract.id=\"" + contractId + "\"";
        totalSuppliers = vendorFile.doCount(sqlVendor);
    }

    return totalSuppliers;
}


function getListPaymentVendor(input) {
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

    var fieldMappings = [
        ['v.id', 'vendorId', 'S'],
        ['pv.id', 'id', 'S'],
        ['pv.payment.id', 'payment_id', 'S'],
        ['pv.contract.id', 'vendor_contract_id', 'S'],
        ['p.contract.id', 'contract_id', 'S'],
        ['pv.vendor.id', 'vendor_id', 'S'],
        ['v.vendor.name', 'vendor_name', 'S'],
        ['v.vendor.number', 'vendor_number', 'S'],
        ['pv.amount', 'amount', 'N'],
        ['pv.currency', 'currency', 'S'],
        ['pv.payment.method', 'payment_method', 'S'],
        ['v.supplier.id', 'supplier_id', 'S'],
        ['pv.ogl.sync.status', 'ogl_sync_status', 'S'],
        ['v.ogl.vendor.id', 'ogl_vendor_id', 'S']
    ];

    var sqlFields = fieldMappings.map(function(item) { return item[0]; });
    var select = " SELECT " + sqlFields.join(", ");
    var mapping = ' FROM esdHTKTpaymentVendor pv ' +
            ' JOIN esdHTKTpayment p ON (pv.payment.id = p.id) ' +
            ' JOIN esdHTKTvendor v ON (pv.vendor.id = v.id) ' +
            ' LEFT JOIN esdHTKTvendorSite vs ON (pv.vendor.site.id = vs.id) ';
    var control = ' WHERE p.id = "' + paymentId + '"';

    var f = new SCFile('esdHTKTpaymentVendor', SCFILE_READONLY);
    var rc = f.doSelect(select + mapping + control);

    while (rc == RC_SUCCESS) {
        var item = mapRowToObject(f, fieldMappings);
        
        var vendorId = item.vendorId || "";
        var countInvoiceId = 0;

        if (vendorId) {

            var countFile = new SCFile('esdHTKTinvoice', SCFILE_READONLY);

            var countSelect = "SELECT count(*)";
            var countMapping = " FROM esdHTKTinvoice i LEFT JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) ";
            var countControl = ' WHERE i.request.id = "' + paymentId + '" AND v.id = "' + vendorId + '"';

            var countSql = countSelect + countMapping + countControl;

            if (countFile.doSelect(countSql) == RC_SUCCESS) {
                countInvoiceId = countFile[0] || 0;
            }
        }
        item.count = countInvoiceId;
        invoiceList.push(item);

        rc = f.getNext();
    }

    try { if (f) f.doClose(); } catch (e) {}

    return invoiceList;
}



function getPaymentRemainingAmount(paymentId) {
    var resultList = [];

    if (!paymentId) {
        return resultList;
    }

    var fieldMappings = [
        ['hdVendor.supplier.id', 'supplier_id', 'S'],
        ['hdVendor.supplier.name', 'supplier_name', 'S'],
        ['hpv.payment.method', 'payment_method', 'S'],
        ['hpv.amount', 'amount', 'N'],
        ['hdVendor.remaining.amount', 'remaining_amount', 'N'],
        ['hv.vendor.number', 'tax_code', 'S'],
        ['hv.ogl.sync.status', 'ogl_sync_status', 'S'],
        ['hvs.ogl.site.code', 'ogl_site_code', 'S'],
        ['hvs.ogl.sync.status', 'hvs_ogl_sync_status', 'S'],
        ['hpv.vendor.site.id', 'vendor_site_id', 'S'],
        ['hpv.currency', 'currency', 'S'],
        ['hp.unit.lv1', 'unit_lv1', 'S'],
        ['hp.unit.lv2', 'unit_lv2', 'S'],
        ['hp.current.phase', 'current_phase', 'S'],
        ['hp.created.by', 'created_by', 'S'],
        ['hp.initial.role', 'initial_role', 'S'],
        ['hp.user.checker.kttc', 'user_checker_kttc', 'S']
    ];

    var sqlSelect = "SELECT " + fieldMappings.map(function(item) { return item[0]; }).join(", ");

    var sqlFrom = ' FROM esdHTKTpaymentVendor hpv' +
            ' LEFT JOIN esdHTKTvendor hv ON (hpv.vendor.id = hv.id)' +
            ' LEFT JOIN esdHTKTpayment hp ON (hpv.payment.id = hp.id)' +
            ' LEFT JOIN esdHTKTvendorSite hvs ON (hvs.id = hpv.vendor.site.id)' +
            ' LEFT JOIN esdHDcontractSupplier hdVendor ON (hp.contract.id = hdVendor.contract.id)';

    var sqlWhere = ' WHERE hp.id = "' + paymentId + '"';

    var itemQuery = sqlSelect + sqlFrom + sqlWhere;

    var f = new SCFile('esdHTKTpaymentVendor', SCFILE_READONLY);

    try {
        var rc = f.doSelect(itemQuery);

        while (rc == RC_SUCCESS) {
            var item = mapRowToObject(f, fieldMappings);
            resultList.push(item);

            rc = f.getNext();
        }
    } catch (e) {
        // print("[ERROR getPaymentVendorListByPaymentId] Lỗi doSelect: " + e);
    } finally {
        try { if (f) f.doClose(); } catch (e) {}
    }


    return resultList;
}
//

function getListInvoinVendor(input) {
    var invoiceList = [];
    var paymentId = "";
    var vendorId = "";

    var tempObj = {};

    try {
        if (input.details) {
            tempObj = JSON.parse(input.details);
        } else if (input.queryString) {
            tempObj = JSON.parse(input.queryString);
        }

        paymentId = tempObj.paymentId || "";
        vendorId = tempObj.vendorId || "";

    } catch (ex) {
        // print("[DEBUG run] Error parsing JSON: " + ex);
        return invoiceList;
    }

    if (!paymentId) return invoiceList;

    var fieldMappings = [
        ['i.id', 'id', 'S'], // Số hoá đơn
        ['i.invoice.number', 'invoice_number', 'S'], // Số hoá đơn
        ['i.invoice.serial', 'invoice_serial', 'S'], // Ký hiệu (hoặc dùng 'invoice_pattern')
        ['i.invoice.type', 'invoice_type', 'S'], // Phân loại HĐ
        ['i.process.type', 'process_type', 'S'], // Tính chất HĐ
        ['i.seller.tax.code', 'seller_tax_code', 'S'], // Mã số thuế người bán (Nhà cung cấp)
        ['i.seller.name', 'seller_name', 'S'], // Tên Nhà cung cấp
        ['i.total.tax', 'total_tax', 'N'], // Tiền thuế VAT (Kiểu số 'N' hoặc 'S')
        ['i.grand.total', 'grand_total', 'N'], // Tổng tiền sau thuế (Kiểu số 'N' hoặc dùng 'S' nếu hệ thống đích nhận chuỗi)
        ['i.currency', 'currency', 'S'], // Loại tiền (VNĐ, USD...)
        ['i.invoice.date', 'invoice_date', 'D'], // Ngày hoá đơn (Kiểu Date 'D')
        ['i.check.status.detail', 'check_status_detail', 'S'], // Chi tiết trạng thái kiểm tra
        ['i.last.check.date', 'lastCheckDate', 'S'],
        ['i.request.id', 'request_id', 'S'],
        ['i.parent.invoice.number', 'parentInvoiceNumber', 'S']
    ];

    var sqlFields = [];
    for (var i = 0; i < fieldMappings.length; i++) {
        sqlFields.push(fieldMappings[i][0]);
    }

    var select = " SELECT " + sqlFields.join(", ");
    var mapping = ' FROM esdHTKTinvoice i ' +
            'JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) ';

    var control = ' WHERE v.id = "' + vendorId + '"';
    var querySQL = select + mapping + control;

    var f = new SCFile('esdHTKTinvoice', SCFILE_READONLY);
    var rc = f.doSelect(querySQL);
    while (rc == RC_SUCCESS) {

        var currentRequestId = f["request.id"];

        if (currentRequestId == null || currentRequestId == "") {
            var item = mapRowToObject(f, fieldMappings);

            var parentInvNumber = f["parent.invoice.number"];
            if (parentInvNumber == null || parentInvNumber == "") {
                item.process_type = "Hóa đơn gốc";
            } else {
                item.process_type = "Hóa đơn thay thế";
            }

            item.dateChecker = checkInvoiceStatus(f["last.check.date"]);
            invoiceList.push(item);
        }
        rc = f.getNext();
    }

    try { if (f) f.doClose(); } catch (e) {}

    return invoiceList;
}


function getInvoicesBySupplier(input) {
    var invoiceList = [];
    var paymentId = "";
    var vendorId = "";

    var tempObj = {};

    try {
        if (input.details) {
            tempObj = JSON.parse(input.details);
        } else if (input.queryString) {
            tempObj = JSON.parse(input.queryString);
        }

        paymentId = tempObj.paymentId || "";
        vendorId = tempObj.vendorId || "";

    } catch (ex) {
        // print("[DEBUG run] Error parsing JSON: " + ex);
        return invoiceList;
    }

    if (!paymentId) return invoiceList;

    var fieldMappings = [
        ['i.id', 'id', 'S'], // Số hoá đơn
        ['i.invoice.number', 'invoiceNumber', 'S'], // Số hoá đơn
        ['i.seller.tax.code', 'sellerTaxCode', 'S'], // Mã số thuế người bán (Nhà cung cấp)
        ['i.invoice.type', 'invoiceType', 'S'], // Phân loại HĐ
        ['i.invoice.date', 'invoiceDate', 'D'], // Ngày hoá đơn (Kiểu Date 'D')
        ['i.check.status.detail', 'checkStatusDetail', 'S'], // Chi tiết trạng thái kiểm tra
        ['i.total.tax', 'totalTax', 'N'], // Tiền thuế VAT (Kiểu số 'N' hoặc 'S')
        ['i.grand.total', 'grandTotal', 'N'], // Tổng tiền sau thuế (Kiểu số 'N' hoặc dùng 'S' nếu hệ thống đích nhận chuỗi)
        ['i.currency', 'currency', 'S'], // Loại tiền (VNĐ, USD...)
        ['i.last.check.date', 'lastCheckDate', 'S'],
        ['i.request.id', 'requestId', 'S']
    ];

    var sqlFields = [];
    for (var i = 0; i < fieldMappings.length; i++) {
        sqlFields.push(fieldMappings[i][0]);
    }


    var select = " SELECT " + sqlFields.join(", ");
    var mapping = ' FROM esdHTKTinvoice i ' +
            'JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) ';

    var control = ' WHERE i.request.id = "' + paymentId + '" AND v.id = "' + vendorId + '"';
    var querySQL = select + mapping + control;

    var f = new SCFile('esdHTKTinvoice', SCFILE_READONLY);
    var rc = f.doSelect(querySQL);
    while (rc == RC_SUCCESS) {

        var item = mapRowToObject(f, fieldMappings);

        item.dateChecker = checkInvoiceStatus(f["last.check.date"]);

        invoiceList.push(item);

        rc = f.getNext();
    }

    try { if (f) f.doClose(); } catch (e) {}

    return invoiceList;
}

function createListInvoinVendor(input) {
    var rawDetails = "";

    // 1. Phân tích dữ liệu đầu vào (Input Parsing)
    if (input.esdHTKTlistPaymentVendor && input.esdHTKTlistPaymentVendor.details) {
        rawDetails = input.esdHTKTlistPaymentVendor.details;
    } else if (input.details) {
        rawDetails = input.details;
    } else if (input.queryString) {
        try {
            var parsedQuery = JSON.parse(input.queryString);
            if (parsedQuery.esdHTKTlistPaymentVendor && parsedQuery.esdHTKTlistPaymentVendor.details) {
                rawDetails = parsedQuery.esdHTKTlistPaymentVendor.details;
            } else {
                rawDetails = parsedQuery.details || input.queryString;
            }
        } catch (e) {
            rawDetails = input.queryString;
        }
    }

    if (!rawDetails) {
        return {
            success: false,
            message: "Thiếu dữ liệu chi tiết hóa đơn",
            checkStatus: []
        };
    }

    try {
        var parsedData = JSON.parse(rawDetails);
        var dataObj = [];

        if (parsedData.updatedSelectedRows && Array.isArray(parsedData.updatedSelectedRows)) {
            dataObj = parsedData.updatedSelectedRows;
        } else if (Array.isArray(parsedData)) {
            dataObj = parsedData;
        } else {
            return {
                success: false,
                message: "Dữ liệu không đúng định dạng",
                checkStatus: []
            };
        }

        if (dataObj.length === 0) {
            return {
                success: false,
                message: "Danh sách hóa đơn trống",
                checkStatus: []
            };
        }

        // =========================================================================
        // 2. KIỂM TRA TỒN TẠI VÀ TỔNG GRANDTOTAL TÍCH LŨY (CŨ + MỚI) (FAIL-FAST)
        // =========================================================================
        var totalGrandTotal = "0";
        var paymentId = dataObj[0]['transactionId'] || "";
        var vendorId = dataObj[0]['vendorId'] || "";

        if (paymentId === "" || vendorId === "") {
            return {
                success: false,
                message: "Thiếu thông tin mã giao dịch (transactionId) hoặc mã nhà cung cấp (vendorId).",
                checkStatus: []
            };
        }

        // Bước 2.1: Kiểm tra xem cặp payment.id và vendor.id đã có dữ liệu chưa trong bảng esdHTKTpaymentVendor
        var checkVendorFile = new SCFile("esdHTKTpaymentVendor");
        var checkVendorQuery = "payment.id=\"" + paymentId + "\" and vendor.id=\"" + vendorId + "\"";
        var rcCheckVendor = checkVendorFile.doSelect(checkVendorQuery);

        if (rcCheckVendor != RC_SUCCESS) {
            return {
                success: false,
                message: "Không tìm thấy thông tin khoản thanh toán của nhà cung cấp (Payment ID: " + paymentId + ", Vendor ID: " + vendorId + ") trong hệ thống. Thao tác đã bị hủy.",
                checkStatus: []
            };
        }

        // Bước 2.2: Tính tổng grandTotal của tất cả hóa đơn MỚI được chọn từ popup
        for (var k = 0; k < dataObj.length; k++) {
            var gTotal = String(dataObj[k]['grandTotal'] || "0");
            totalGrandTotal = lib.ESD_HTKT_Utils.addStringsManual(totalGrandTotal, gTotal);
        }

        // Bước 2.3: Lấy tổng tiền của các hóa đơn CŨ đã liên kết trước đó với paymentId và vendorId này
        var sumExistingGrandTotal = "0";
        var existingInvoiceFile = new SCFile("esdHTKTinvoice", SCFILE_READONLY);
        var mappingExist = " FROM esdHTKTinvoice i JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) ";
        var controlExist = " WHERE i.request.id = \"" + paymentId + "\" AND v.id = \"" + vendorId + "\"";
        var queryExistingSQL = "SELECT i.id, i.grand.total " + mappingExist + controlExist;

        var rcExisting = existingInvoiceFile.doSelect(queryExistingSQL);
        while (rcExisting === RC_SUCCESS) {
            var existAmt = String(existingInvoiceFile["grand.total"] || existingInvoiceFile["grandTotal"] || "0");
            sumExistingGrandTotal = lib.ESD_HTKT_Utils.addStringsManual(sumExistingGrandTotal, existAmt);
            rcExisting = existingInvoiceFile.getNext();
        }

        // Bước 2.4: Tổng tiền Tích lũy (Cũ + Mới)
        var totalAccumulatedGrandTotal = lib.ESD_HTKT_Utils.addStringsManual(sumExistingGrandTotal, totalGrandTotal);

        // --- CHẶN 1: Tổng tích lũy (Cũ + Mới) phải lớn hơn 0 ---
        if (lib.ESD_HTKT_Utils.compareMoneyStrings(totalAccumulatedGrandTotal, "0") <= 0) {
            return {
                success: false,
                message: "Tổng số tiền các hoá đơn sau khi tích lũy phải lớn hơn 0 để gắn vào nhà cung cấp. Thao tác đã bị hủy.",
                checkStatus: []
            };
        }

        // Bước 2.5: Kiểm tra vượt quá số tiền còn lại của khoản thanh toán (Remaining Amount)
        var remainingData = getPaymentRemainingAmount(paymentId);
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

        if (lib.ESD_HTKT_Utils.compareMoneyStrings(totalAccumulatedGrandTotal, totalRemainingAmount) > 0) {
            return {
                success: false,
                message: "Tổng tiền các hóa đơn sau khi tích lũy vượt quá số tiền còn lại của khoản thanh toán. Thao tác đã bị hủy.",
                checkStatus: []
            };
        }
        // =========================================================================

        // 3. Thực hiện Insert và Update dữ liệu
        var successInvoiceIds = [];
        var affectedTaxPaymentIds = {};
        var checkStatusList = [];

        for (var i = 0; i < dataObj.length; i++) {
            var feeData = dataObj[i];

            // Tạo bản ghi mới trong bảng liên kết
            var itemRec = new SCFile("esdHTKTpaymentInvoice");
            mapPaymentAttachment(itemRec, feeData);

            var rc = itemRec.doInsert();

            if (rc === true || rc == RC_SUCCESS) {
                var invoiceId = feeData['id'] || "";
                var invoiceNumber = feeData['invoiceNumber'] || "";
                var currentPaymentId = feeData['transactionId'] || "";
                var grandTotal = feeData['grandTotal'] || "0";
                successInvoiceIds.push(invoiceId);

                // --- Kiểm tra hạn mức 5 triệu ---
                var itemCheckStatus = 'DangKiemTra';
                var itemWarningMsg = "";

                try {
                    if (feeData) {
                        var queryObj = {
                            "id": feeData["id"],
                            "seller.tax.code": feeData["sellerTaxCode"] || "",
                            "grand.total": feeData["grandTotal"] || 0,
                            "invoice.date": feeData["invoiceDate"] || null,
                            "currency": feeData["currency"] || "VND"
                        };

                        var limitResult = lib.ESD_HTKT_INVOICE_INTEGRATION.get5MillionLimitStatus(queryObj);

                        if (limitResult && typeof limitResult === "object") {
                            itemCheckStatus = limitResult.checkStatus || 'DangKiemTra';

                            var invoiceDateStr = formatDateToDDMMYYYY(feeData["invoiceDate"]);
                            var targetVendorId = feeData["vendorId"] || "";
                            var vendorNameStr = "Không xác định";

                            if (targetVendorId !== "") {
                                var vendorRec = new SCFile("esdHTKTvendor");
                                var vendorQuery = "id=\"" + targetVendorId + "\"";
                                var rcVendor = vendorRec.doSelect(vendorQuery);

                                if (rcVendor === RC_SUCCESS) {
                                    vendorNameStr = vendorRec["vendor.name"] || targetVendorId;
                                }
                            }

                            var currentInvoiceNo = feeData['invoiceNumber'] || feeData['id'] || "";
                            itemWarningMsg = "Hóa đơn " + currentInvoiceNo + " của nhà cung cấp " + vendorNameStr + " có tổng trong ngày " + invoiceDateStr + " từ 5 triệu đồng trở lên phải có chứng từ thanh toán không dùng tiền mặt";
                        } else {
                            itemCheckStatus = 'ChuaKiemTra';
                        }
                    }
                } catch (limitErr) {
                    // print("Lỗi kiểm tra hạn mức (đã bỏ qua): " + limitErr.toString());
                    itemCheckStatus = 'ChuaKiemTra';
                }

                // Lưu trạng thái
                checkStatusList.push({
                    invoiceId: invoiceId,
                    invoiceNumber: invoiceNumber,
                    status: itemCheckStatus,
                    warningMsg: itemWarningMsg
                });

                // Kiểm tra totalTax > 0 bằng SL
                var feeTax = String(feeData['totalTax'] || "0");
                if (currentPaymentId !== "" && lib.ESD_HTKT_Utils.compareMoneyStrings(feeTax, "0") > 0) {
                    affectedTaxPaymentIds[currentPaymentId] = true;
                }

                // Cập nhật thông tin hóa đơn
                if (invoiceId !== "") {
                    var invFile = new SCFile("esdHTKTinvoice");
                    var query = "id=\"" + invoiceId + "\"";
                    var rcInv = invFile.doSelect(query);

                    if (rcInv == RC_SUCCESS) {
                        invFile["request.id"] = itemRec["payment.id"];
                        var rcUpdate = invFile.doUpdate();
                        if (rcUpdate != RC_SUCCESS) {
                            // print("Lỗi khi cập nhật request.id cho hóa đơn id: " + invoiceId);
                        }

                        // Gọi API
                        try {
                            var apiResponse = lib.ESD_HTKT_SCHEDULE_OGL.callCheckInvoiceAPI(invFile);
                            if (apiResponse !== null && apiResponse.success === true) {
                                invFile['last.check.date'] = new Date();
                                invFile.doUpdate();
                            }
                        } catch (apiErr) {
                            // print("Lỗi khi gọi API check hóa đơn " + invoiceId + ": " + apiErr.toString());
                        }


                    } else {
                        // print("Không tìm thấy hóa đơn trong bảng esdHTKTinvoice với id: " + invoiceId);
                    }
                }
            } else {
                // print("Không thể thêm bản ghi vào esdHTKTpaymentInvoice cho hóa đơn: " + feeData['id']);
            }
        }

        // Đồng bộ dữ liệu (da co trigger xu ly)
//        syncPaymentEntries(affectedTaxPaymentIds);

        // =========================================================================
        // 3.1 CẬP NHẬT AMOUNT BẰNG STRING TỪ SL
        // =========================================================================
        if (successInvoiceIds.length > 0) {
            var processedPaymentItems = {};
            var uniquePaymentIds = {};

            for (var j = 0; j < dataObj.length; j++) {
                var pId = dataObj[j]['transactionId'] || "";
                var vdId = dataObj[j]['vendorId'] || "";

                if (pId !== "") {
                    var uniqueKey = pId + "_" + vdId;
                    processedPaymentItems[uniqueKey] = {
                        paymentId: pId,
                        vendorId: vdId
                    };
                    uniquePaymentIds[pId] = true;
                }
            }

            // 3.1.1 Cập nhật cho nhà cung cấp hiện tại (esdHTKTpaymentVendor)
            for (var key in processedPaymentItems) {
                if (processedPaymentItems.hasOwnProperty(key)) {
                    var itemInfo = processedPaymentItems[key];
                    var paymentKey = itemInfo.paymentId;
                    var vendorKey = itemInfo.vendorId;

                    var vendorFile = new SCFile("esdHTKTpaymentVendor");
                    var vendorQuery = "payment.id=\"" + paymentKey + "\" and vendor.id=\"" + vendorKey + "\"";
                    var rcVendor = vendorFile.doSelect(vendorQuery);

                    if (rcVendor == RC_SUCCESS) {
                        // totalAccumulatedGrandTotal đã là string chuẩn
                        vendorFile["approved.invoice.amount"] = totalAccumulatedGrandTotal;
                        vendorFile["amount"] = totalAccumulatedGrandTotal;

                        var rcVendorUpdate = vendorFile.doUpdate();
                        if (rcVendorUpdate != RC_SUCCESS) {
                            // print("Lỗi khi cập nhật amount cho payment.id: " + paymentKey + " và vendor.id: " + vendorKey);
                        }
                    } else {
                        // print("Không tìm thấy bản ghi trong esdHTKTpaymentVendor với payment.id: " + paymentKey + " và vendor.id: " + vendorKey);
                    }
                }
            }

            // 3.1.2 Tính tổng các nhà cung cấp và cập nhật vào phiếu (esdHTKTpayment)
            for (var prepId in uniquePaymentIds) {
                if (uniquePaymentIds.hasOwnProperty(prepId)) {
                    var sumPaymentAmount = "0"; // Khởi tạo chuỗi "0"

                    var sumVendorFile = new SCFile("esdHTKTpaymentVendor");
                    var sumVendorQuery = "payment.id=\"" + prepId + "\"";
                    var rcSumVendor = sumVendorFile.doSelect(sumVendorQuery);

                    while (rcSumVendor == RC_SUCCESS) {
                        var vAmount = String(sumVendorFile["approved.invoice.amount"] || "0");
                        // Dùng SL để cộng chuỗi
                        sumPaymentAmount = lib.ESD_HTKT_Utils.addStringsManual(sumPaymentAmount, vAmount);
                        rcSumVendor = sumVendorFile.getNext();
                    }

                    var paymentFile = new SCFile("esdHTKTpayment");
                    var paymentQuery = "id=\"" + prepId + "\"";
                    var rcPayment = paymentFile.doSelect(paymentQuery);

                    if (rcPayment == RC_SUCCESS) {
                        // Gán thẳng chuỗi đã tính vào DB
                        paymentFile["approved.invoice.amount"] = sumPaymentAmount;

                        var rcPaymentUpdate = paymentFile.doUpdate();
                        if (rcPaymentUpdate != RC_SUCCESS) {
                            // print("Lỗi khi cập nhật tổng amount cho esdHTKTpayment với id: " + prepId);
                        }
                    } else {
                        // print("Không tìm thấy bản ghi trong esdHTKTpayment với id: " + prepId);
                    }
                }
            }
        }
        // =========================================================================

        // 5. Trả về kết quả
        if (successInvoiceIds.length === dataObj.length) {
            return {
                success: true,
                message: "Đã liên kết thành công tất cả các hóa đơn: " + successInvoiceIds.join(", "),
                checkStatus: checkStatusList
            };
        } else if (successInvoiceIds.length > 0) {
            return {
                success: true,
                message: "Liên kết thành công các hóa đơn: " + successInvoiceIds.join(", ") + " (Thất bại " + (dataObj.length - successInvoiceIds.length) + " hóa đơn)",
                checkStatus: checkStatusList
            };
        } else {
            return {
                success: false,
                message: "Lưu thông tin hóa đơn liên kết thất bại. Không có hóa đơn nào được thêm vào hệ thống.",
                checkStatus: []
            };
        }

    } catch (parseError) {
        return {
            success: false,
            message: "Bị lỗi khi xử lý dữ liệu: " + parseError.toString(),
            checkStatus: []
        };
    }
}

function updateListInvoinVendor(input) {
    var rawDetails = "";

    if (input.esdHTKTlistPaymentVendor && input.esdHTKTlistPaymentVendor.details) {
        rawDetails = input.esdHTKTlistPaymentVendor.details;
    } else if (input.details) {
        rawDetails = input.details;
    } else if (input.queryString) {
        try {
            var parsedQuery = JSON.parse(input.queryString);
            if (parsedQuery.esdHTKTlistPaymentVendor && parsedQuery.esdHTKTlistPaymentVendor.details) {
                rawDetails = parsedQuery.esdHTKTlistPaymentVendor.details;
            } else {
                rawDetails = parsedQuery.details || input.queryString;
            }
        } catch (e) {
            rawDetails = input.queryString;
        }
    }

    if (!rawDetails) {
        return { success: false, message: "Thiếu dữ liệu chi tiết hóa đơn" };
    }

    try {
        var parsedData = JSON.parse(rawDetails);
        var dataObj = [];

        if (parsedData.updatedSelectedRows && Array.isArray(parsedData.updatedSelectedRows)) {
            dataObj = parsedData.updatedSelectedRows;
        } else if (Array.isArray(parsedData)) {
            dataObj = parsedData;
        } else {
            return { success: false, message: "Dữ liệu hóa đơn không đúng định dạng danh sách (Array)" };
        }

        if (dataObj.length === 0) {
            return { success: false, message: "Danh sách hóa đơn trống" };
        }

        var successInvoiceIds = [];

        var affectedPaymentIds = {};

        // 3. Vòng lặp duyệt qua từng hóa đơn trong mảng (Dù có 1 hay nhiều hóa đơn)
        for (var i = 0; i < dataObj.length; i++) {
            var feeData = dataObj[i];

            // Map chính xác các trường từ dữ liệu JSON thực tế của bạn
            var invoiceId = feeData['id'] || "";
            var paymentId = feeData['transactionId'] || "";
            var deductionType = feeData['deductionType'] || "";

            if (invoiceId !== "" && paymentId !== "") {
                var invFile = new SCFile("esdHTKTpaymentInvoice");

                // Tạo câu lệnh tìm kiếm bản ghi đã tồn tại dựa trên cặp ID
                var query = "invoice.id=\"" + invoiceId + "\" AND payment.id=\"" + paymentId + "\"";
                var rcInv = invFile.doSelect(query);

                // Nếu tìm thấy bản ghi liên kết trong Database
                if (rcInv == RC_SUCCESS) {

                    // Thực hiện cập nhật loại khấu trừ
                    invFile["deduction.type"] = deductionType;

                    var rcUpdate = invFile.doUpdate();

                    if (rcUpdate == RC_SUCCESS) {
                        successInvoiceIds.push(invoiceId);

                        affectedPaymentIds[paymentId] = true;
                    }
                }
            }
        }


        // syncPaymentEntries(affectedPaymentIds);

        if (successInvoiceIds.length === dataObj.length) {
            return {
                success: true,
                message: "Đã cập nhật thành công tất cả các hóa đơn: " + successInvoiceIds.join(", ")
            };
        } else if (successInvoiceIds.length > 0) {
            return {
                success: true,
                message: "Cập nhật thành công các hóa đơn: " + successInvoiceIds.join(", ") + " (Thất bại " + (dataObj.length - successInvoiceIds.length) + " hóa đơn)"
            };
        } else {
            return {
                success: false,
                message: "Cập nhật thất bại. Không có hóa đơn nào tìm thấy hoặc cập nhật thành công trong hệ thống."
            };
        }

    } catch (parseError) {
        return { success: false, message: "Xảy ra lỗi trong quá trình xử lý dữ liệu: " + parseError.toString() };
    }
}

function mapPaymentAttachment(itemRec, feeData) {
    itemRec['payment.id'] = feeData['transactionId'];
    itemRec['invoice.id'] = feeData['id'];
    itemRec['vendor.id'] = feeData['vendorId'];
    var contractId = String(feeData['contractId'] || feeData['contract.id'] || "").trim();
    if (contractId) {
        itemRec['contract.id'] = contractId;
    }

    if (feeData['totalTax'] === 0) {
        itemRec['deduction.type'] = "KHAUTRU_003"; // Không khấu trừ
    } else if (feeData['totalTax'] > 0) {
        itemRec['deduction.type'] = "KHAUTRU_001"; // Khấu trừ toàn bộ
    }
}



function deletePaymentVendor(input) {
    var paymentId = "";
    var vendorId = "";

    try {
        var rawData = input.details || input.queryString;
        if (rawData) {
            var queryObj = JSON.parse(rawData);
            paymentId = queryObj.paymentId || "";
            vendorId = queryObj.vendorId || "";
        }
    } catch (ex) {
        return { status: "error", message: "Invalid input" };
    }

    if (!vendorId || !paymentId) {
        return { status: "error", message: "Thiếu vendorId hoặc paymentId" };
    }


    // 1. Xóa bản ghi trong bảng esdHTKTpaymentVendor

    var vendorFile = new SCFile("esdHTKTpaymentVendor");
    var vendorQuery = "vendor.id=\"" + vendorId + "\" and payment.id=\"" + paymentId + "\"";


    if (vendorFile.doSelect(vendorQuery) === RC_SUCCESS) {
        var rcDeleteVendor = vendorFile.doDelete();
        if (rcDeleteVendor !== RC_SUCCESS) {
            return { status: "error", message: "Xóa payment vendor thất bại" };
        }
    }

    return {
        status: "success",
        message: "Xóa và cập nhật dữ liệu thành công"
    };
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
            item[jsonKey] = dbValue ? (dbValue.toISOString ? dbValue.toISOString() : String(dbValue)) : "";
        } else {
            item[jsonKey] = dbValue ? String(dbValue) : "";
        }
    }
    return item;
}


function syncPaymentEntries(paymentIds) {
    for (var paymentId in paymentIds) {
        if (!paymentIds.hasOwnProperty(paymentId)) continue;

        try {
            lib.ESD_HTKT_PAYMENT_ENTRY.syncPaymentEntryBySourceChange(
                    "esdHTKTpaymentInvoice", { "payment.id": paymentId }
            );
        } catch (syncError) {
            // console.error("Khong the sinh lai but toan cho " + paymentId + ": " + syncError.toString());
        }
    }
}


function checkInvoiceStatus(lastCheckDate) {
    if (!lastCheckDate) {
        return "Chưa kiểm tra";
    }

    try {
        var checkDate = (lastCheckDate instanceof Date) ? lastCheckDate : new Date(lastCheckDate);
        var currentDate = new Date();

        // Tính khoảng cách ngày
        var diffTime = currentDate.getTime() - checkDate.getTime();
        var diffDays = diffTime / (1000 * 60 * 60 * 24);

        var maxAllowedDays = lib.ESD_HTKT_Utils.getItemNameFromConfig({
            categoryId: "htkt_thoi_gia",
            defaultValue: "2"
        });

        return (diffDays > maxAllowedDays) ? "Quá hạn" : "Còn hạn";
    } catch (e) {
        return "Chưa kiểm tra";
    }
}



/**
 * Đồng bộ OGL tất cả thông tin NCC/site theo đề nghị thanh toán
 * @param record
 */
function syncVendorOglFromPayment(record) {
    var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(record['unit.lv1']);
    if (entityInfo && entityInfo.entity && entityInfo.oglBranchCode) {
        var entityCode = entityInfo.entity;
        var branchCode = entityInfo.oglBranchCode.length == 4 ?
                entityInfo.oglBranchCode.substr(1, 4) :
                entityInfo.oglBranchCode;

        var itemPaymentVendor = new SCFile("esdHTKTpaymentVendor");
        var paymentVendorRc = itemPaymentVendor.doSelect(`payment.id = "${record.id}"`);
        while (paymentVendorRc == RC_SUCCESS) {
            if (!itemPaymentVendor['ogl.sync.status']) {
                var result = lib.ESD_HTKT_PREPAYMENT_VENDOR.syncVendorToOgl(itemPaymentVendor,
                        branchCode,
                        entityCode,
                        record['user.checker.kttc'] || vars.$lo_operator["contact.name"]);
                if (result && result.success == true) {
                    itemPaymentVendor['ogl.sync.status'] = true;
                    itemPaymentVendor.doUpdate();
                }
            }
            paymentVendorRc = itemPaymentVendor.getNext();
        }
        try { if (paymentVendorRc) paymentVendorRc.doClose(); } catch (e) {}
    }
}

/**
 * Số tiền còn lại = số tiền ban đầu của NCC theo hợp đồng
 * - tổng thanh toán đã accounted, approved - tổng thanh toán đã accounted, approved.
 */
//function calculateVendorRemainingAmount(contractId, supplierId, initialRemainingAmount) {
//    var contract = String(contractId || '').trim();
//    var supplier = String(supplierId || '').trim();
//    var finalRemainingAmount = String(initialRemainingAmount || '0');
//
//    if (!contract || !supplier) return finalRemainingAmount;
//
//    var totalPrepaymentAmount = sumVendorAmount(
//            'esdHTKTprepaymentVendor',
//            'esdHTKTprepayment',
//            'prepayment.id',
//            contract,
//            supplier
//    );
//    var totalPaidAmount = sumVendorAmount(
//            'esdHTKTpaymentVendor',
//            'esdHTKTpayment',
//            'payment.id',
//            contract,
//            supplier
//    );
////    print('contract' + contract)
////    print('supplier' + supplier)
////    print('initialRemainingAmount' + initialRemainingAmount)
////    print('totalPrepaymentAmount' + totalPrepaymentAmount)
////    print('totalPaidAmount' + totalPaidAmount)
//
//    finalRemainingAmount = lib.ESD_HTKT_Utils.subtractStringsManual(finalRemainingAmount, totalPrepaymentAmount);
//    finalRemainingAmount = lib.ESD_HTKT_Utils.subtractStringsManual(finalRemainingAmount, totalPaidAmount);
//
//    if (
//            finalRemainingAmount &&
//            (finalRemainingAmount.charAt(0) === '-' ||
//                    lib.ESD_HTKT_Utils.compareMoneyStrings(finalRemainingAmount, '0') < 0)
//    ) {
//        return '0';
//    }
//
//    return finalRemainingAmount;
//}

function sumVendorAmount(vendorTable, requestTable, requestIdField, contractId, supplierId) {
    var totalAmount = '0';
    var file = null;
    var query =
            'select pv.amount as amount ' +
            'from ' + vendorTable + ' pv ' +
            'join ' + requestTable + ' p on (pv.' + requestIdField + ' = p.id) ' +
            'join esdHTKTvendor v on (pv.vendor.id = v.id) ' +
            'where p.contract.id = "' + escapePaymentVendorQueryValue(contractId) + '" ' +
            'and v.supplier.id = "' + escapePaymentVendorQueryValue(supplierId) + '" ' +
            'and (p.status="approved" or p.status="accounted")';

    try {
        file = new SCFile(vendorTable, SCFILE_READONLY);
        var rc = file.doSelect(query);
        while (rc == RC_SUCCESS) {
            totalAmount = lib.ESD_HTKT_Utils.addStringsManual(
                    totalAmount,
                    String(file.amount || '0')
            );
            rc = file.getNext();
        }
    } finally {
        try { if (file) file.doClose(); } catch (e) {}
    }

    return totalAmount;
}

function escapePaymentVendorQueryValue(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/** Lấy thông tin HĐ/KMS theo mã hợp đồng để Display Screen bind vào FD. */
function getContractInfo(contractId) {
    var id = String(contractId || "").trim();
    var contractInfo = {
        id: id,
        name: "",
        category: "",
        categoryName: "",
        startDate: null,
        totalValue: "",
        totalPaidAmount: "",
        remainingAmount: ""
    };
    if (!id) return contractInfo;

    var contractFile = new SCFile("esdHDcontract", SCFILE_READONLY);
    try {
        if (contractFile.doSelect('id="' + escapePaymentVendorQueryValue(id) + '"') != RC_SUCCESS) {
            return contractInfo;
        }

        var category = String(contractFile["category"] || "");
        contractInfo.category = category;
        contractInfo.categoryName = category === "HD_GT" ? "Hợp đồng" :
            category === "HD_KMS" ? "Khoản mua sắm" : category;
        contractInfo.name = category === "HD_KMS" ?
            (contractFile["item.name"] || contractFile["name"] || "") :
            (contractFile["name"] || "");
        contractInfo.startDate = contractFile["start.date"] || null;
        contractInfo.totalValue = category === "HD_KMS" ?
            (contractFile["total.budget"] || "") :
            (contractFile["contract.value.after.tax"] || "");
        contractInfo.totalPaidAmount = contractFile["total.paid.amount"] || "";
        contractInfo.remainingAmount = contractFile["remaining.amount"] || "";
        return contractInfo;
    } finally {
        try { contractFile.doClose(); } catch (closeError) { }
    }
}

function loadPaymentVendorInfo(record) {
    var itemFile = new SCFile("esdHTKTpaymentVendor");

    var itemQuery =
            'select hv.supplier.id as supplier.id,' +
            ' hv.vendor.name as supplier.name,' +
            ' hpv.payment.method as payment.method,' +
            ' hpv.amount as amount,' +
            ' hpv.payable.amount as payable.amount,' +
            ' hpv.approved.invoice.amount as approved.invoice.amount,' +
            ' hpv.refund.amount as refund.amount,' +
            ' hpv.vendor.type as vendor.type,' +
            ' hp.contract.id as contract.id,' +
            ' hdVendor.unpaid.amount as unpaid.amount,' +
            ' hv.vendor.number as tax.code,' +
            ' hpv.ogl.sync.status as ogl.sync.status,' +
            ' hvs.ogl.site.code as ogl.site.code,' +
            ' hvs.ogl.sync.status as hvs.ogl.sync.status,' +
            ' hpv.vendor.site.id as vendor.site.id,' +
            ' hpv.currency as currency,' +
            ' hp.unit.lv1 as unit.lv1,' +
            ' hp.unit.lv2 as unit.lv2,' +
            ' hp.current.phase as current.phase,' +
            ' hp.created.by as created.by,' +
            ' hp.initial.role as initial.role,' +
            ' hp.user.checker.kttc as user.checker.kttc' +
            ' from esdHTKTpaymentVendor hpv' +
            ' LEFT JOIN esdHTKTvendor hv ON (hpv.vendor.id = hv.id)' +
            ' LEFT JOIN esdHTKTpayment hp ON (hpv.payment.id = hp.id)' +
            ' LEFT JOIN esdHTKTvendorSite hvs ON (hvs.id = hpv.vendor.site.id)' +
            ' LEFT JOIN esdHDcontractSupplier hdVendor ON (hp.contract.id = hdVendor.contract.id AND hdVendor.supplier.id = hv.supplier.id)' +
            ' where hpv.id = "' + record.id + '"';

    if (itemFile.doSelect(itemQuery) == RC_SUCCESS) {

        vars.$currency = itemFile["currency"];
        vars.$supplierId = itemFile["supplier.id"];
        vars.$L_file["payment.method"] = itemFile["payment.method"];
        vars.$remainingAmount = itemFile['unpaid.amount'];
        vars.$taxCode = itemFile["tax.code"];
        vars.$supplierdisplays = [itemFile["supplier.name"]];
        vars.$suppliervalues = [itemFile["supplier.id"]];
        vars.$oglSiteCode = itemFile["ogl.site.code"];
        vars.$amount = itemFile["amount"];
        vars.$payableAmount = itemFile["payable.amount"];
        vars.$approvedInvoiceAmount = itemFile["approved.invoice.amount"];
        vars.$refundAmount = itemFile["refund.amount"];
        vars.$unitLv1 = itemFile["unit.lv1"];
        vars.$unitLv2 = itemFile["unit.lv2"];

        vars.$isCNvendorType = itemFile['vendor.type'] === "CN" ? true : false;

        vars.$showSyncVendorOgl =
                itemFile["current.phase"] == "initial_kttc" &&
                (
                        itemFile["user.checker.kttc"] == vars.$lo_operator["contact.name"] ||
                        (
                                itemFile["created.by"] == vars.$lo_operator["contact.name"] &&
                                itemFile["initial.role"] == "kttc"
                        )
                );

        vars.$canEditSite = vars.$showSyncVendorOgl && itemFile["ogl.sync.status"] == true

        vars.$canEditObj =
                (
                        itemFile["current.phase"] == "initial_dmms" &&
                        itemFile["created.by"] == vars.$lo_operator["contact.name"] &&
                        itemFile["initial.role"] == "dmms"
                ) ||
                (
                        itemFile["current.phase"] == "initial_kttc" &&
                        (
                                itemFile["user.checker.kttc"] == vars.$lo_operator["contact.name"] ||
                                (
                                        itemFile["created.by"] == vars.$lo_operator["contact.name"] &&
                                        itemFile["initial.role"] == "kttc"
                                )
                        )
                );
    }

    try {
        itemFile.doClose();
    } catch (e) {}
}

function formatDateToDDMMYYYY(rawDate) {
    if (!rawDate) return "";

    try {
        // Cắt lấy phần YYYY-MM-DD từ chuỗi ISO
        var datePart = rawDate.toString().substring(0, 10);
        var parts = datePart.split("-"); // [YYYY, MM, DD]

        if (parts.length === 3) {
            var year = parts[0];
            var month = parts[1];
            var day = parts[2];

            return day + "/" + month + "/" + year;
        }
    } catch (e) {
        // print("Lỗi định dạng ngày: " + e.toString());
    }

    return rawDate;
}

function queryVendorData(record) {
    // Lấy giá trị paymentId và vendorTaxCode từ record hiện tại trên form
    var paymentId = record.paymentId; // Hoặc vars.$paymentId tùy theo cách bạn đặt tên biến
    var vendorTaxCode = record.vendorTaxCode; // Hoặc vars.$vendorTaxCode

    // Kiểm tra nếu đủ điều kiện thì mới thực hiện query
    if (paymentId && vendorTaxCode) {
        var sqlVendor = "payment.id=\"" + paymentId + "\" and vendor.id=\"" + vendorTaxCode + "\"";

        // Khởi tạo đối tượng SCFile trỏ đến bảng cần query (ví dụ: esdHTKTpaymentVendor hoặc bảng chứa dữ liệu vendor)
        var vendorFile = new SCFile("esdHTKTpaymentVendor");
        var rc = vendorFile.doSelect(sqlVendor);

        if (rc == RC_SUCCESS) {
            // Gán dữ liệu tìm được từ DB vào các trường/biến trên màn hình
            record.totalBeforeTax = vendorFile.totalBeforeTax;
            record.vendorName = vendorFile.vendorName;

            // Nếu muốn bật/tắt trạng thái readonly của trường
            vars.$isAmountReadonly = true;
        } else {
            // Xử lý khi không tìm thấy dữ liệu phù hợp
            // print("Không tìm thấy bản ghi phù hợp với điều kiện: " + sqlVendor);
        }
    }
}



/**
 * Hàm cập nhật lại số tiền còn lại (contract.amount) cho TẤT CẢ các phiếu đề nghị thanh toán
 * đang chờ duyệt (cùng Hợp đồng, cùng NCC) ngay khi một phiếu được phê duyệt cuối.
 */
function updateRemainingAmountForPendingTickets(record) {
    var paymentId = String(record.id || record["id"] || "");
    if (!paymentId) return;

    var currentContractId = String(record.contract_id || record["contract.id"] || "");
    var currentRequestAmount = 0;
    var currentSupplierId = "";

    // 1. Lấy thông tin nhà cung cấp và số tiền của chính phiếu VỪA ĐƯỢC DUYỆT
    var prepVendorFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
    if (prepVendorFile.doSelect('payment.id="' + paymentId + '"') == RC_SUCCESS) {
        currentRequestAmount = prepVendorFile["amount"] || 0;
        if (!currentContractId) currentContractId = prepVendorFile["contract.id"];

        var vendorId = prepVendorFile["vendor.id"];
        if (vendorId) {
            var vendorFile = new SCFile("esdHTKTvendor", SCFILE_READONLY);
            if (vendorFile.doSelect('id="' + vendorId + '"') == RC_SUCCESS) {
                currentSupplierId = vendorFile["supplier.id"];
            }
            try { if (vendorFile) vendorFile.doClose(); } catch (e) {}
        }
    }
    try { if (prepVendorFile) prepVendorFile.doClose(); } catch (e) {}

    if (!currentContractId || !currentSupplierId) return;

    // 2. Bắt đầu tính toán
    var contractSupplierFile = new SCFile("esdHDcontractSupplier", SCFILE_READONLY);
    if (contractSupplierFile.doSelect('contract.id="' + currentContractId + '" and supplier.id="' + currentSupplierId + '"') == RC_SUCCESS) {

        var initialAmount = contractSupplierFile["remaining.amount"] || 0;

        // 2.1 Tính tổng tiền các phiếu ĐÃ DUYỆT TRƯỚC ĐÓ (Bỏ qua phiếu hiện tại vì nó chưa commit xuống DB)
        var totalOtherApprovedAmount = 0;
        var checkFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
        var checkQuery = 'select pv.amount as amount from esdHTKTpaymentVendor pv ' +
                'join esdHTKTpayment p on (pv.payment.id = p.id) ' +
                'join esdHTKTvendor v on (pv.vendor.id = v.id) ' +
                'where p.contract.id = "' + currentContractId + '" ' +
                'and v.supplier.id = "' + currentSupplierId + '" ' +
                'and (p.status = "approved" or p.status = "accounted") ' +
                'and p.id ~= "' + paymentId + '"'; // Bỏ qua phiếu đang thao tác

        var rcCheck = checkFile.doSelect(checkQuery);
        while (rcCheck == RC_SUCCESS) {
            totalOtherApprovedAmount += (checkFile["amount"] || 0);
            rcCheck = checkFile.getNext();
        }
        try { if (checkFile) checkFile.doClose(); } catch (e) {}

        // 2.2 Số dư mới = Tiền gốc - (Tiền các phiếu cũ đã duyệt + Tiền của phiếu vừa duyệt xong)
        var newRemainingAmount = initialAmount - (totalOtherApprovedAmount + currentRequestAmount);

        // 3. Cập nhật lại số dư mới này cho TẤT CẢ các phiếu đang chờ duyệt
        var pendingFile = new SCFile("esdHTKTpaymentVendor");
        var pendingQuery = 'select pv.id as id from esdHTKTpaymentVendor pv ' +
                'join esdHTKTpayment p on (pv.payment.id = p.id) ' +
                'join esdHTKTvendor v on (pv.vendor.id = v.id) ' +
                'where p.contract.id = "' + currentContractId + '" ' +
                'and v.supplier.id = "' + currentSupplierId + '" ' +
                'and p.id ~= "' + paymentId + '" ' +
                'and p.status ~= "approved" and p.status ~= "accounted" and p.status ~= "cancelled"';

        var rcPending = pendingFile.doSelect(pendingQuery);
        while (rcPending == RC_SUCCESS) {
            var pvId = pendingFile["id"];

            // Khởi tạo một đối tượng ghi (Write) trực tiếp để tránh lỗi khi update qua bảng Join
            var updateFile = new SCFile("esdHTKTpaymentVendor");
            if (updateFile.doSelect('id="' + pvId + '"') == RC_SUCCESS) {
                updateFile["contract.amount"] = newRemainingAmount;
                updateFile.doUpdate();
            }

            rcPending = pendingFile.getNext();
        }
        try { if (pendingFile) pendingFile.doClose(); } catch (e) {}
    }
    try { if (contractSupplierFile) contractSupplierFile.doClose(); } catch (e) {}
}



//Doan code TT khac TU

function deletePaymentInvoice(input) {
    var rawDetails = "";

    if (input.esdHTKTlistPaymentInvoice && input.esdHTKTlistPaymentInvoice.details) {
        rawDetails = input.esdHTKTlistPaymentInvoice.details;
    } else if (input.details) {
        rawDetails = input.details;
    } else if (input.queryString) {
        try {
            var parsedQuery = JSON.parse(input.queryString);
            if (parsedQuery.esdHTKTlistPaymentInvoice && parsedQuery.esdHTKTlistPaymentInvoice.details) {
                rawDetails = parsedQuery.esdHTKTlistPaymentInvoice.details;
            } else {
                rawDetails = parsedQuery.details || input.queryString;
            }
        } catch (e) {
            rawDetails = input.queryString;
        }
    }

    if (!rawDetails) {
        return { success: false, message: "Thiếu dữ liệu chi tiết hóa đơn cần xóa" };
    }

    try {
        var parsedData = JSON.parse(rawDetails);
        var invoiceId = parsedData.invoiceId || "";
        var paymentId = parsedData.paymentId || "";

        return executeDeletePaymentInvoice(invoiceId, paymentId);

    } catch (error) {
        // print("[PAYMENT_INVOICE_DELETE] error=" + error.toString());
        return {
            success: false,
            message: "Lỗi khi xử lý xóa: " + error.toString()
        };
    }
}

/**
 * [HÀM 1] Thao tác dữ liệu:
 * - Xóa các bản ghi quan hệ trong esdHTKTpaymentInvoice
 * - Thu thập danh sách vendorId bị ảnh hưởng
 * - Gỡ liên kết hóa đơn trong esdHTKTinvoice (set request.id = null)
 * 
 * @param {string} invoiceId 
 * @param {string} paymentId 
 * @returns {{ deletedCount: number, affectedVendorIds: Object }}
 */
/**
 * Xóa các bản ghi quan hệ trong esdHTKTpaymentInvoice và gỡ liên kết hóa đơn
 */
function deletePaymentInvoiceRelations(invoiceId, paymentId) {
    var affectedVendorIds = {};
    var deletedCount = 0;

    // 1. Xóa bản ghi quan hệ trong bảng esdHTKTpaymentInvoice
    var paymentInvFile = null;
    try {
        paymentInvFile = new SCFile("esdHTKTpaymentInvoice");
        var queryMapping = 'invoice.id="' + invoiceId + '" and payment.id="' + paymentId + '"';
        var rcSelect = paymentInvFile.doSelect(queryMapping);

        while (rcSelect === RC_SUCCESS) {
            var vendorId = String(paymentInvFile["vendor.id"] || "").trim();
            if (vendorId) {
                affectedVendorIds[vendorId] = true;
            }

            var rcDelete = paymentInvFile.doDelete();
            if (rcDelete === RC_SUCCESS) {
                deletedCount++;
            }
            rcSelect = paymentInvFile.getNext();
        }
    } finally {
        try { if (paymentInvFile) paymentInvFile.doClose(); } catch (ignore) {}
    }

    // 2. Gọi hàm tách riêng để gỡ liên kết trên esdHTKTinvoice
//    resetInvoiceRequestId(invoiceId);

    return {
        deletedCount: deletedCount,
        affectedVendorIds: affectedVendorIds
    };
}

/**
 * Giải phóng liên kết hóa đơn gốc (set request.id = null)
 * 
 * @param {string} invoiceId - Mã hóa đơn cần reset
 * @returns {boolean} true nếu cập nhật thành công hoặc không tìm thấy, false nếu có lỗi
 */
function resetInvoiceRequestId(invoiceId) {
    if (!invoiceId) return false;

    var invFile = null;
    try {
        invFile = new SCFile("esdHTKTinvoice");
        var queryInv = 'id="' + invoiceId + '"';
        var rcInv = invFile.doSelect(queryInv);

        if (rcInv === RC_SUCCESS) {
            invFile["request.id"] = null;
            var rcUpdate = invFile.doUpdate();
            return (rcUpdate === RC_SUCCESS);
        }
        return false;
    } catch (e) {
        // Có thể log lỗi nếu cần: print("[RESET_INVOICE_REQUEST_ID_ERROR] " + e);
        return false;
    } finally {
        try {
            if (invFile) invFile.doClose();
        } catch (ignore) {}
    }
}

/**
 * [HÀM 2] Hàm điều phối chính (Main Flow):
 * - Validate đầu vào
 * - Gọi xóa dữ liệu hóa đơn liên kết
 * - Cập nhật lại số tiền của đề nghị thanh toán (nếu có hóa đơn bị xóa)
 * 
 * @param {string} invoiceId 
 * @param {string} paymentId 
 * @returns {{ success: boolean, message: string, deletedCount?: number }}
 */
function executeDeletePaymentInvoice(invoiceId, paymentId) {
    if (!invoiceId || !paymentId) {
        return { success: false, message: "Thiếu invoiceId hoặc paymentId" };
    }

    try {
        // Thực hiện xóa dữ liệu và lấy thông tin các vendor bị ảnh hưởng
        var result = deletePaymentInvoiceRelations(invoiceId, paymentId);

        // Nếu có bản ghi bị xóa, cập nhật lại số tiền đề nghị thanh toán
        if (result.deletedCount > 0) {
            refreshPaymentAmountsAfterInvoiceDelete(paymentId, result.affectedVendorIds);
        }

        return {
            success: true,
            message: "Đã xóa liên kết hóa đơn thành công",
            deletedCount: result.deletedCount
        };

    } catch (error) {
        return {
            success: false,
            message: "Lỗi khi xử lý xóa: " + error.toString()
        };
    }
}

function refreshPaymentAmountsAfterInvoiceDelete(paymentId, vendorIds) {
    for (var vendorId in vendorIds) {
        if (!vendorIds.hasOwnProperty(vendorId)) continue;

        var vendorInvoiceAmount = "0";
        var remainingInvoiceFile = new SCFile("esdHTKTpaymentInvoice", SCFILE_READONLY);
        var remainingInvoiceQuery =
                "SELECT i.grand.total " +
                "FROM esdHTKTpaymentInvoice pi " +
                "JOIN esdHTKTinvoice i ON (pi.invoice.id = i.id) " +
                "WHERE pi.payment.id=\"" + paymentId + "\" " +
                "AND pi.vendor.id=\"" + vendorId + "\"";
        var rcRemainingInvoice = remainingInvoiceFile.doSelect(remainingInvoiceQuery);

        while (rcRemainingInvoice === RC_SUCCESS) {
            var grandTotal = String(
                    remainingInvoiceFile["i.grand.total"] ||
                    remainingInvoiceFile["grand.total"] ||
                    "0"
            );
            vendorInvoiceAmount = lib.ESD_HTKT_Utils.addStringsManual(
                    vendorInvoiceAmount,
                    grandTotal
            );
            rcRemainingInvoice = remainingInvoiceFile.getNext();
        }
        try { remainingInvoiceFile.doClose(); } catch (remainingCloseError) {}

        var vendorFile = new SCFile("esdHTKTpaymentVendor");
        var vendorQuery =
                "payment.id=\"" + paymentId + "\" and vendor.id=\"" + vendorId + "\"";
        var rcVendor = vendorFile.doSelect(vendorQuery);

        if (rcVendor === RC_SUCCESS) {
            vendorFile["approved.invoice.amount"] = vendorInvoiceAmount;
            vendorFile["amount"] = vendorInvoiceAmount;
            var rcVendorUpdate = vendorFile.doUpdate();
            if (rcVendorUpdate !== RC_SUCCESS) {
                /* print(
                        "[PAYMENT_INVOICE_DELETE] Khong the cap nhat amount cho payment.id=" +
                        paymentId + ", vendor.id=" + vendorId
                ); */
            }
        }
        try { vendorFile.doClose(); } catch (vendorCloseError) {}
    }

    var totalPaymentAmount = "0";
    var sumVendorFile = new SCFile("esdHTKTpaymentVendor", SCFILE_READONLY);
    var rcSumVendor = sumVendorFile.doSelect('payment.id="' + paymentId + '"');

    while (rcSumVendor === RC_SUCCESS) {
        totalPaymentAmount = lib.ESD_HTKT_Utils.addStringsManual(
                totalPaymentAmount,
                String(sumVendorFile["approved.invoice.amount"] || "0")
        );
        rcSumVendor = sumVendorFile.getNext();
    }
    try { sumVendorFile.doClose(); } catch (sumCloseError) {}

    var paymentFile = new SCFile("esdHTKTpayment");
    var rcPayment = paymentFile.doSelect('id="' + paymentId + '"');
    if (rcPayment === RC_SUCCESS) {
        paymentFile["approved.invoice.amount"] = totalPaymentAmount;
        var rcPaymentUpdate = paymentFile.doUpdate();
        if (rcPaymentUpdate !== RC_SUCCESS) {
            /* print(
                    "[PAYMENT_INVOICE_DELETE] Khong the cap nhat approved.invoice.amount cho payment.id=" +
                    paymentId
            ); */
        }
    }
    try { paymentFile.doClose(); } catch (paymentCloseError) {}
}




/**
 * Lấy tất cả Vendor theo paymentId.
 */
function getAllVendorsByPaymentId(paymentId) {
    var vendors = [];

    paymentId = String(paymentId || "").trim();

    if (!paymentId) {
        return vendors;
    }

    var f = new SCFile(
            "esdHTKTpaymentVendor",
            SCFILE_READONLY
    );

    try {
        var sql =
                'SELECT pv.id, ' +
                'pv.vendor.id, ' +
                'pv.amount, ' +
                'pv.refund.amount, ' +
                'pv.approved.invoice.amount ' +
                'FROM esdHTKTpaymentVendor pv ' +
                'WHERE pv.payment.id = "' +
                paymentId +
                '"';

        var rc = f.doSelect(sql);

        while (rc == RC_SUCCESS) {

            vendors.push({
                id: String(f["pv.id"] || f["id"] || "").trim(),
                vendorId: String(f["pv.vendor.id"] || f["vendor.id"] || "").trim(),
                amount: Number(f["pv.amount"] || f["amount"]) || 0,
                refundAmount: Number(f["pv.refund.amount"] || f["refund.amount"]) || 0,
                approvedInvoiceAmount: Number(
                        f["pv.approved.invoice.amount"] ||
                        f["approved.invoice.amount"]
                ) || 0
            });
            rc = f.getNext();
        }
    } catch (e) {
        /* print(
                "[getAllVendorsByPaymentId] Lỗi: " +
                e.toString()
        ); */
    } finally {
        try {
            f.doClose();
        } catch (closeError) {}
    }

    return vendors;
}



/**
 * Tính tổng thông tin Vendor của Payment
 */
function getPaymentVendorList(paymentId) {
    var vendorList = getAllVendorsByPaymentId(paymentId) || [];

    var totals = {
        approvedInvoiceAmount: 0,
        paidAmount: 0,
        refundAmount: 0
    };

    if (vendorList.length === 0) {
        return totals;
    }

    for (var i = 0; i < vendorList.length; i++) {
        var vendor = vendorList[i];

        totals.approvedInvoiceAmount += Number(vendor.approvedInvoiceAmount) || 0;
        totals.paidAmount += Number(vendor.amount) || 0;
        totals.refundAmount += Number(vendor.refundAmount) || 0;
    }

    return totals;
}



/**
 * Cập nhật lại các giá trị tổng trên phiếu Đề nghị thanh toán
 * sau khi thông tin Vendor của phiếu bị thay đổi.
 *
 * Luồng xử lý:
 * 1. Nhận record của phiếu thanh toán.
 * 2. Lấy danh sách Vendor theo paymentId và tính lại:
 *    - Tổng giá trị hóa đơn chấp nhận.
 *    - Tổng số tiền thanh toán.
 *    - Tổng số tiền hoàn ứng.
 * 3. Map dữ liệu phiếu thành payload mới.
 * 4. Tìm record tương ứng trong bảng esdHTKTpayment.
 * 5. Cập nhật các trường tổng và lưu lại DB.
 *
 * @param {Object} record Record của phiếu thanh toán.
 */
function handleVendorChangeUpdate(record) {
    if (!record || !record["payment.id"]) {
        // print("[handleVendorChangeUpdate] Thiếu record hoặc paymentId.");
        return;
    }

    var paymentId = record["payment.id"];
    var f = null;

    try {
        // Tính lại tổng dữ liệu Vendor của phiếu
        var totals = getPaymentVendorList(paymentId);

        if (!totals) {
            totals = {
                approvedInvoiceAmount: 0,
                paidAmount: 0
            };
        }

        f = new SCFile("esdHTKTpayment");

        var rc = f.doSelect('id="' + paymentId + '"');

        if (rc != RC_SUCCESS) {
            /* print(
                    "[handleVendorChangeUpdate] Không tìm thấy paymentId=" +
                    paymentId +
                    ". rc=" +
                    rc
            ); */
            return;
        }

        // Cập nhật tổng tiền từ kết quả vừa tính lại
        f["total.amount.paid"] = totals.paidAmount || 0;

        f["approved.invoice.amount"] = totals.approvedInvoiceAmount || 0;

        var updateRc = f.doUpdate();

        if (updateRc != RC_SUCCESS) {
            /* print(
                    "[handleVendorChangeUpdate] Update thất bại: " +
                    system.functions.valmessage(updateRc)
            ); */
            return;
        }


    } catch (e) {
        /* print(
                "[handleVendorChangeUpdate] Error paymentId=" +
                paymentId +
                ": " +
                String(e.message || e)
        ); */
    } finally {
        if (f) {
            f.doClose();
        }
    }
}

