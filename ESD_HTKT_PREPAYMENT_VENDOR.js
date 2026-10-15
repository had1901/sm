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
            case 'getListPrepaymentVendor':
                var data = getListPrepaymentVendor(input);
                result = { success: true, data: data };
                break;
                //tổng nhà cung cấp
            case 'totalContractSuppliers':
                var data = totalContractSuppliers(input);
                result = { success: true, data: data };
                break;
                //Gỡ hóa đơn vào nhà cung cấp
            case 'deletePrepaymentVendor':
                var data = deletePrepaymentVendor(input);
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
    var prepaymentId = "";

    try {
        if (input.details) {
            var queryObj = JSON.parse(input.details);
            prepaymentId = queryObj.prepaymentId || "";
        } else if (input.queryString) {
            var queryObjOld = JSON.parse(input.queryString);
            prepaymentId = queryObjOld.prepaymentId || "";
        }
    } catch (ex) {
        return totalSuppliers;
    }

    if (!prepaymentId) return totalSuppliers;

    // 1. Lấy contractId từ esdHTKTprepayment
    var contractId = "";
    var prepayment = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
    var sqlPrepayment = "id=\"" + prepaymentId + "\"";

    if (prepayment.doSelect(sqlPrepayment) == RC_SUCCESS) {
        if (prepayment["contract.id"]) {
            contractId = prepayment["contract.id"];
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


function getListPrepaymentVendor(input) {
    var invoiceList = [];
    var prepaymentId = "";

    try {
        if (input.details) {
            var queryObj = JSON.parse(input.details);
            prepaymentId = queryObj.prepaymentId || "";
        } else if (input.queryString) {
            var queryObjOld = JSON.parse(input.queryString);
            prepaymentId = queryObjOld.prepaymentId || "";
        }
    } catch (ex) {
        return invoiceList;
    }

    if (!prepaymentId) return invoiceList;

    var fieldMappings = [
        ['v.id', 'vendorId', 'S'],
        ['pv.id', 'id', 'S'],
        ['pv.prepayment.id', 'prepayment_id', 'S'],
        ['p.contract.id', 'contract_id', 'S'],
        ['pv.vendor.id', 'vendor_id', 'S'],
        ['v.vendor.name', 'vendor_name', 'S'],
        ['v.vendor.number', 'vendor_number', 'S'],
        ['pv.amount', 'amount', 'S'],
        ['pv.currency', 'currency', 'S'],
        ['pv.payment.method', 'payment_method', 'S'],
        ['v.supplier.id', 'supplier_id', 'S'],
        ['pv.ogl.sync.status', 'ogl_sync_status', 'S'],
        ['v.ogl.vendor.id', 'ogl_vendor_id', 'S']
    ];

    var sqlFields = fieldMappings.map(function(item) { return item[0]; });
    var select = " SELECT " + sqlFields.join(", ");
    var mapping = ' FROM esdHTKTprepaymentVendor pv ' +
        ' JOIN esdHTKTprepayment p ON (pv.prepayment.id = p.id) ' +
        ' JOIN esdHTKTvendor v ON (pv.vendor.id = v.id) ' +
        ' LEFT JOIN esdHTKTvendorSite vs ON (pv.vendor.site.id = vs.id) ';
    var control = ' WHERE p.id = "' + prepaymentId + '"';

    var f = new SCFile('esdHTKTprepaymentVendor', SCFILE_READONLY);
    var rc = f.doSelect(select + mapping + control);

    while (rc == RC_SUCCESS) {
        var item = mapRowToObject(f, fieldMappings);

        var vendorId = item.vendorId || "";
        var countInvoiceId = 0;

        if (vendorId) {

            var countFile = new SCFile('esdHTKTinvoice', SCFILE_READONLY);

            var countSelect = "SELECT count(*)";
            var countMapping = " FROM esdHTKTinvoice i LEFT JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) ";
            var countControl = ' WHERE i.request.id = "' + prepaymentId + '" AND v.id = "' + vendorId + '"';

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


function getPrepaymentRemainingAmount(prepaymentId) {
    var resultList = [];

    if (!prepaymentId) {
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

    var sqlFrom = ' FROM esdHTKTprepaymentVendor hpv' +
        ' LEFT JOIN esdHTKTvendor hv ON (hpv.vendor.id = hv.id)' +
        ' LEFT JOIN esdHTKTprepayment hp ON (hpv.prepayment.id = hp.id)' +
        ' LEFT JOIN esdHTKTvendorSite hvs ON (hvs.id = hpv.vendor.site.id)' +
        ' LEFT JOIN esdHDcontractSupplier hdVendor ON (hp.contract.id = hdVendor.contract.id)';

    var sqlWhere = ' WHERE hp.id = "' + prepaymentId + '"';

    var itemQuery = sqlSelect + sqlFrom + sqlWhere;

    var f = new SCFile('esdHTKTprepaymentVendor', SCFILE_READONLY);

    try {
        var rc = f.doSelect(itemQuery);

        while (rc == RC_SUCCESS) {
            var item = mapRowToObject(f, fieldMappings);
            resultList.push(item);

            rc = f.getNext();
        }
    } catch (e) {
        print("[ERROR getPrepaymentVendorListByPrepaymentId] Lỗi doSelect: " + e);
    } finally {
        try { if (f) f.doClose(); } catch (e) {}
    }


    return resultList;
}
//

function getListInvoinVendor(input) {
    var invoiceList = [];
    var prepaymentId = "";
    var vendorId = "";

    var tempObj = {};

    try {
        if (input.details) {
            tempObj = JSON.parse(input.details);
        } else if (input.queryString) {
            tempObj = JSON.parse(input.queryString);
        }

        prepaymentId = tempObj.prepaymentId || "";
        vendorId = tempObj.vendorId || "";

    } catch (ex) {
        print("[DEBUG run] Error parsing JSON: " + ex);
        return invoiceList;
    }

    if (!prepaymentId) return invoiceList;

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

    var control = ' WHERE v.id = "' + vendorId + '" AND (i.check.status <> "CHECKING")';
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
    var prepaymentId = "";
    var vendorId = "";

    var tempObj = {};

    try {
        if (input.details) {
            tempObj = JSON.parse(input.details);
        } else if (input.queryString) {
            tempObj = JSON.parse(input.queryString);
        }

        prepaymentId = tempObj.prepaymentId || "";
        vendorId = tempObj.vendorId || "";

    } catch (ex) {
        print("[DEBUG run] Error parsing JSON: " + ex);
        return invoiceList;
    }

    if (!prepaymentId) return invoiceList;

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

    var control = ' WHERE i.request.id = "' + prepaymentId + '" AND v.id = "' + vendorId + '"';
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
    if (input.esdHTKTlistPrepaymentVendor && input.esdHTKTlistPrepaymentVendor.details) {
        rawDetails = input.esdHTKTlistPrepaymentVendor.details;
    } else if (input.details) {
        rawDetails = input.details;
    } else if (input.queryString) {
        try {
            var parsedQuery = JSON.parse(input.queryString);
            if (parsedQuery.esdHTKTlistPrepaymentVendor && parsedQuery.esdHTKTlistPrepaymentVendor.details) {
                rawDetails = parsedQuery.esdHTKTlistPrepaymentVendor.details;
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
        var prepaymentId = dataObj[0]['transactionId'] || "";
        var vendorId = dataObj[0]['vendorId'] || "";

        if (prepaymentId === "" || vendorId === "") {
            return {
                success: false,
                message: "Thiếu thông tin mã giao dịch (transactionId) hoặc mã nhà cung cấp (vendorId).",
                checkStatus: []
            };
        }

        // Bước 2.1: Kiểm tra cặp prepayment.id và vendor.id trong esdHTKTprepaymentVendor
        var checkVendorFile = new SCFile("esdHTKTprepaymentVendor");
        var checkVendorQuery = "prepayment.id=\"" + prepaymentId + "\" and vendor.id=\"" + vendorId + "\"";
        var rcCheckVendor = checkVendorFile.doSelect(checkVendorQuery);

        if (rcCheckVendor != RC_SUCCESS) {
            return {
                success: false,
                message: "Không tìm thấy thông tin khoản tạm ứng của nhà cung cấp trong hệ thống. Thao tác đã bị hủy.",
                checkStatus: []
            };
        }
        print("test 123")

        // Bước 2.2: Tính tổng grandTotal của tất cả hóa đơn MỚI được chọn
        for (var k = 0; k < dataObj.length; k++) {
            var gTotal = String(dataObj[k]['grandTotal'] || "0");
            totalGrandTotal = lib.ESD_HTKT_Utils.addStringsManual(totalGrandTotal, gTotal);
        }

        // Bước 2.3: Lấy tổng tiền của các hóa đơn CŨ đã liên kết
        var sumExistingGrandTotal = "0";
        var existingInvoiceFile = new SCFile("esdHTKTinvoice", SCFILE_READONLY);
        var mappingExist = " FROM esdHTKTinvoice i JOIN esdHTKTvendor v ON (i.seller.tax.code = v.vendor.number) ";
        var controlExist = " WHERE i.request.id = \"" + prepaymentId + "\" AND v.id = \"" + vendorId + "\"";
        var queryExistingSQL = "SELECT i.id, i.grand.total " + mappingExist + controlExist;

        var rcExisting = existingInvoiceFile.doSelect(queryExistingSQL);
        while (rcExisting === RC_SUCCESS) {
            var existAmt = String(existingInvoiceFile["grand.total"] || existingInvoiceFile["grandTotal"] || "0");
            sumExistingGrandTotal = lib.ESD_HTKT_Utils.addStringsManual(sumExistingGrandTotal, existAmt);
            rcExisting = existingInvoiceFile.getNext();
        }

        // Bước 2.4: Tổng tiền Tích lũy (Cũ + Mới)
        var totalAccumulatedGrandTotal = lib.ESD_HTKT_Utils.addStringsManual(sumExistingGrandTotal, totalGrandTotal);

        if (lib.ESD_HTKT_Utils.compareMoneyStrings(totalAccumulatedGrandTotal, "0") <= 0) {
            return {
                success: false,
                message: "Tổng số tiền các hoá đơn sau khi tích lũy phải lớn hơn 0 để gắn vào nhà cung cấp. Thao tác đã bị hủy.",
                checkStatus: []
            };
        }

        // Bước 2.4.1: Kiểm tra tổng tiền hóa đơn <= giá trị bảo lãnh
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
            try { docInfoFile.doClose(); } catch (e) {}

            var cleanGuaranteeStr = String(guaranteeAmountStr || "").replace(/,/g, '').trim();

            if (cleanGuaranteeStr !== "" && cleanGuaranteeStr !== "null" && lib.ESD_HTKT_Utils.compareMoneyStrings(cleanGuaranteeStr, "0") === 1) {
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
                try { prepFile.doClose(); } catch (e) {}

                var totalAmountStr = lib.ESD_HTKT_Utils.addStringsManual(totalAccountedAmountStr, totalAccumulatedGrandTotal);
                var finalGuaranteeStr = String(guaranteeAmountStr).trim();

                if (lib.ESD_HTKT_Utils.compareMoneyStrings(totalAmountStr, finalGuaranteeStr) === 1) {
                    return {
                        success: false,
                        message: "Tổng số tiền tạm ứng hiện tại vượt quá Giá trị bảo lãnh. Thao tác đã bị hủy.",
                        checkStatus: []
                    };
                }
            }
        }

        // Bước 2.5: Kiểm tra vượt quá số tiền còn lại của khoản tạm ứng
        var remainingData = getPrepaymentRemainingAmount(prepaymentId);
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
                message: "Tổng tiền các hóa đơn sau khi tích lũy vượt quá số tiền còn lại của khoản tạm ứng. Thao tác đã bị hủy.",
                checkStatus: []
            };
        }

        // =========================================================================
        // 3. VÒNG LẶP XỬ LÝ LƯU HÓA ĐƠN & CHECK HẠN MỨC 5 TRIỆU
        // =========================================================================
        var successInvoiceIds = [];
        var failedInvoiceDetails = [];
        var affectedTaxPrepaymentIds = {};
        var checkStatusList = []; // DÀNH RIÊNG CHO CHECK 5 TRIỆU
        var isRequireBankTransfer = false;

        for (var i = 0; i < dataObj.length; i++) {
            var feeData = dataObj[i];
            var invoiceId = feeData['id'] || "";
            var invoiceNumber = feeData['invoiceNumber'] || feeData['id'] || "";
            var currentPrepaymentId = feeData['transactionId'] || "";

            if (!invoiceId) {
                failedInvoiceDetails.push("Dữ liệu thiếu mã hóa đơn");
                continue;
            }

            // 1. Kiểm tra hóa đơn tồn tại trong DB
            var invFile = new SCFile("esdHTKTinvoice");
            var query = "id=\"" + invoiceId + "\"";
            var rcInv = invFile.doSelect(query);

            if (rcInv !== RC_SUCCESS) {
                failedInvoiceDetails.push("Hóa đơn " + invoiceNumber + " (Không tìm thấy trong DB)");
                continue;
            }

            // 2. Gọi API kiểm tra hóa đơn
            var apiSuccess = false;
            var apiErrorReason = "Kiểm tra API thất bại";

            try {
                var apiResponse = lib.ESD_HTKT_SCHEDULE_OGL.callCheckInvoiceAPI(invFile);
                if (apiResponse && apiResponse.success === true) {
                    apiSuccess = true;
                } else if (apiResponse && apiResponse.message) {
                    apiErrorReason = apiResponse.message;
                }
            } catch (apiErr) {
                apiErrorReason = apiErr.toString();
            }

            if (!apiSuccess) {
                failedInvoiceDetails.push("Hóa đơn " + invoiceNumber + " kiểm tra hóa đơn thất bại");
                continue;
            }

            // 3. Tạo bản ghi liên kết
            var itemRec = new SCFile("esdHTKTprepaymentInvoice");
            mapPrepaymentAttachment(itemRec, feeData);

            var rc = itemRec.doInsert();

            if (rc === true || rc == RC_SUCCESS) {
                successInvoiceIds.push(invoiceId);

                // Cập nhật thông tin hóa đơn gốc
                invFile["request.id"] = itemRec["prepayment.id"];
                invFile['last.check.date'] = new Date();
                invFile.doUpdate();

                // --- KIỂM TRA HẠN MỨC 5 TRIỆU (Đưa kết quả vào checkStatusList) ---
                try {
                    var queryObj = {
                        "id": feeData["id"],
                        "seller.tax.code": feeData["sellerTaxCode"] || "",
                        "grand.total": feeData["grandTotal"] || 0,
                        "invoice.date": feeData["invoiceDate"] || null,
                        "currency": feeData["currency"] || "VND"
                    };

                    var limitResult = lib.ESD_HTKT_INVOICE_INTEGRATION.get5MillionLimitStatus(queryObj);

                    if (limitResult && typeof limitResult === "object") {
                        if (limitResult.code === "E06" || limitResult.checkStatus === "E06" || limitResult.errorCode === "E06") {
                            isRequireBankTransfer = true;
                        }

                        var invoiceDateStr = formatDateToDDMMYYYY(feeData["invoiceDate"]);
                        var targetVendorId = feeData["vendorId"] || "";
                        var vendorNameStr = "Không xác định";

                        if (targetVendorId !== "") {
                            var vendorRec = new SCFile("esdHTKTvendor");
                            if (vendorRec.doSelect("id=\"" + targetVendorId + "\"") === RC_SUCCESS) {
                                vendorNameStr = vendorRec["vendor.name"] || targetVendorId;
                            }
                        }

                        var warningMsg = "Hóa đơn " + invoiceNumber + " của nhà cung cấp " + vendorNameStr + " có tổng trong ngày " + invoiceDateStr + " từ 5 triệu đồng trở lên phải có chứng từ thanh toán không dùng tiền mặt";

                        checkStatusList.push({
                            id: feeData["id"],
                            checkStatus: limitResult.checkStatus || 'DangKiemTra',
                            warningMsg: warningMsg
                        });
                    }
                } catch (limitErr) {
                    print("Lỗi kiểm tra hạn mức 5 triệu: " + limitErr.toString());
                }

                // Kiểm tra thuế
                var feeTax = String(feeData['totalTax'] || "0");
                if (currentPrepaymentId !== "" && lib.ESD_HTKT_Utils.compareMoneyStrings(feeTax, "0") > 0) {
                    affectedTaxPrepaymentIds[currentPrepaymentId] = true;
                }
            } else {
                failedInvoiceDetails.push("Hóa đơn " + invoiceNumber + " (Thêm bản ghi liên kết thất bại)");
            }
        }

        // Đồng bộ dữ liệu thuế
        syncPrepaymentEntries(affectedTaxPrepaymentIds);

        // =========================================================================
        // 3.1 CẬP NHẬT AMOUNT (STRING) DÀNH CHO BẢN GHI THÀNH CÔNG
        // =========================================================================
        if (successInvoiceIds.length > 0) {
            var processedPrepaymentItems = {};
            var uniquePrepaymentIds = {};

            for (var j = 0; j < dataObj.length; j++) {
                var pId = dataObj[j]['transactionId'] || "";
                var vdId = dataObj[j]['vendorId'] || "";

                if (pId !== "") {
                    var uniqueKey = pId + "_" + vdId;
                    processedPrepaymentItems[uniqueKey] = { prepaymentId: pId, vendorId: vdId };
                    uniquePrepaymentIds[pId] = true;
                }
            }

            // Cập nhật esdHTKTprepaymentVendor
            for (var key in processedPrepaymentItems) {
                if (processedPrepaymentItems.hasOwnProperty(key)) {
                    var itemInfo = processedPrepaymentItems[key];
                    var vendorFile = new SCFile("esdHTKTprepaymentVendor");
                    var vendorQuery = "prepayment.id=\"" + itemInfo.prepaymentId + "\" and vendor.id=\"" + itemInfo.vendorId + "\"";

                    if (vendorFile.doSelect(vendorQuery) == RC_SUCCESS) {
                        vendorFile["amount"] = totalAccumulatedGrandTotal;
                        if (isRequireBankTransfer && vendorFile["payment.method"] !== "CHUYENKHOAN") {
                            vendorFile["payment.method"] = "CHUYENKHOAN";
                            vendorFile["beneficiary.account"] = null;
                            vendorFile["beneficiary.bank"] = null;
                            vendorFile["beneficiary.name"] = null;
                            vendorFile["identity.number"] = null;
                            vendorFile["issued.date"] = null;
                            vendorFile["issued.place"] = null;
                        }
                        vendorFile.doUpdate();
                    }
                }
            }

            // Cập nhật esdHTKTprepayment
            for (var prepId in uniquePrepaymentIds) {
                if (uniquePrepaymentIds.hasOwnProperty(prepId)) {
                    var sumPrepaymentAmount = "0";
                    var sumVendorFile = new SCFile("esdHTKTprepaymentVendor");

                    if (sumVendorFile.doSelect("prepayment.id=\"" + prepId + "\"") == RC_SUCCESS) {
                        do {
                            var vAmount = String(sumVendorFile["amount"] || "0");
                            sumPrepaymentAmount = lib.ESD_HTKT_Utils.addStringsManual(sumPrepaymentAmount, vAmount);
                        } while (sumVendorFile.getNext() == RC_SUCCESS);
                    }

                    var prepaymentFile = new SCFile("esdHTKTprepayment");
                    if (prepaymentFile.doSelect("id=\"" + prepId + "\"") == RC_SUCCESS) {
                        prepaymentFile["amount"] = sumPrepaymentAmount;
                        prepaymentFile.doUpdate();
                    }
                }
            }
        }

        // =========================================================================
        // 4. KẾT QUẢ TRẢ VỀ
        // =========================================================================
        if (successInvoiceIds.length === dataObj.length) {
            return {
                success: true,
                message: "Thao tác thành công",
                checkStatus: checkStatusList
            };
        } else if (successInvoiceIds.length > 0) {
            return {
                success: true,
                message: "Thành công: " + successInvoiceIds.length + " hóa đơn. Thất bại " + failedInvoiceDetails.length + " hóa đơn: " + failedInvoiceDetails.join("; "),
                checkStatus: checkStatusList
            };
        } else {
            return {
                success: false,
                message: "Thực hiện thất bại: " + failedInvoiceDetails.join("; "),
                checkStatus: checkStatusList
            };
        }

    } catch (parseError) {
        return {
            success: false,
            message: "Xảy ra lỗi hệ thống: " + parseError.toString(),
            checkStatus: []
        };
    }
}


function updateListInvoinVendor(input) {
    var rawDetails = "";

    if (input.esdHTKTlistPrepaymentVendor && input.esdHTKTlistPrepaymentVendor.details) {
        rawDetails = input.esdHTKTlistPrepaymentVendor.details;
    } else if (input.details) {
        rawDetails = input.details;
    } else if (input.queryString) {
        try {
            var parsedQuery = JSON.parse(input.queryString);
            if (parsedQuery.esdHTKTlistPrepaymentVendor && parsedQuery.esdHTKTlistPrepaymentVendor.details) {
                rawDetails = parsedQuery.esdHTKTlistPrepaymentVendor.details;
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
        // trưởng thêm
        var affectedPrepaymentIds = {};

        // 3. Vòng lặp duyệt qua từng hóa đơn trong mảng (Dù có 1 hay nhiều hóa đơn)
        for (var i = 0; i < dataObj.length; i++) {
            var feeData = dataObj[i];

            // Map chính xác các trường từ dữ liệu JSON thực tế của bạn
            var invoiceId = feeData['id'] || "";
            var prepaymentId = feeData['transactionId'] || "";
            var deductionType = feeData['deductionType'] || "";

            if (invoiceId !== "" && prepaymentId !== "") {
                var invFile = new SCFile("esdHTKTprepaymentInvoice");

                // Tạo câu lệnh tìm kiếm bản ghi đã tồn tại dựa trên cặp ID
                var query = "invoice.id=\"" + invoiceId + "\" AND prepayment.id=\"" + prepaymentId + "\"";
                var rcInv = invFile.doSelect(query);

                // Nếu tìm thấy bản ghi liên kết trong Database
                if (rcInv == RC_SUCCESS) {

                    // Thực hiện cập nhật loại khấu trừ
                    invFile["deduction.type"] = deductionType;

                    var rcUpdate = invFile.doUpdate();

                    if (rcUpdate == RC_SUCCESS) {
                        successInvoiceIds.push(invoiceId);
                        // trưởng thêm
                        affectedPrepaymentIds[prepaymentId] = true;
                    }
                }
            }
        }

        // trưởng thêm
        syncPrepaymentEntries(affectedPrepaymentIds);

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

function mapPrepaymentAttachment(itemRec, feeData) {
    itemRec['prepayment.id'] = feeData['transactionId'];
    itemRec['invoice.id'] = feeData['id'];

    if (feeData['totalTax'] === 0) {
        itemRec['deduction.type'] = "KHAUTRU_003"; // Không khấu trừ
    } else if (feeData['totalTax'] > 0) {
        itemRec['deduction.type'] = "KHAUTRU_001"; // Khấu trừ toàn bộ
    }
}


function deletePrepaymentVendor(input) {

    var prepaymentId = "";
    var vendorId = "";

    try {
        var rawData = input.details || input.queryString;
        if (rawData) {
            var queryObj = JSON.parse(rawData);
            prepaymentId = queryObj.prepaymentId || "";
            vendorId = queryObj.vendorId || "";
        }
    } catch (ex) {
        return { status: "error", message: "Invalid input" };
    }

    if (!vendorId || !prepaymentId) {
        return { status: "error", message: "Thiếu vendorId hoặc prepaymentId" };
    }

    // 1. Xóa bản ghi trong bảng esdHTKTprepaymentVendor
    var vendorFile = new SCFile("esdHTKTprepaymentVendor");
    var vendorQuery = "vendor.id=\"" + vendorId + "\" and prepayment.id=\"" + prepaymentId + "\"";

    if (vendorFile.doSelect(vendorQuery) === RC_SUCCESS) {
        var rcDeleteVendor = vendorFile.doDelete();
        if (rcDeleteVendor !== RC_SUCCESS) {
            return { status: "error", message: "Xóa prepayment vendor thất bại" };
        }
    }

    // 2. Xóa tất cả bản ghi trong bảng esdHTKTprepaymentInvoice theo prepaymentId
    var prepInvFile = new SCFile("esdHTKTprepaymentInvoice");
    var prepInvQuery = "prepayment.id=\"" + prepaymentId + "\"";

    if (prepInvFile.doSelect(prepInvQuery) === RC_SUCCESS) {
        do {
            prepInvFile.doDelete();
        } while (prepInvFile.getNext() === RC_SUCCESS);
    }

//    // 3. Cập nhật request.id trong esdHTKTinvoice về null
//    var invFile = new SCFile("esdHTKTinvoice");
//    var invQuery = "request.id=\"" + prepaymentId + "\"";
//
//    if (invFile.doSelect(invQuery) === RC_SUCCESS) {
//        do {
//            invFile["request.id"] = null;
//            invFile.doSave();
//        } while (invFile.getNext() === RC_SUCCESS);
//    }
    // 4. Cập nhật amount của bảng esdHTKTprepayment thành rỗng
    var prepaymentFile = new SCFile("esdHTKTprepayment");
    var prepaymentQuery =
        "id=\"" + prepaymentId + "\"";

    if (prepaymentFile.doSelect(prepaymentQuery) === RC_SUCCESS) {

        prepaymentFile["amount"] = null;

        var rcUpdatePrepayment = prepaymentFile.doUpdate();
    }
    return {
        status: "success",
        message: "Xóa và cập nhật dữ liệu thành công"
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

// trưởng thêm
function syncPrepaymentEntries(prepaymentIds) {
    for (var prepaymentId in prepaymentIds) {
        if (!prepaymentIds.hasOwnProperty(prepaymentId)) continue;

        try {
            lib.ESD_HTKT_PREPAYMENT_ENTRY.syncPrepaymentEntryBySourceChange(
                "esdHTKTprepaymentInvoice", { "prepayment.id": prepaymentId }
            );
        } catch (syncError) {
            console.error("Khong the sinh lai but toan cho " + prepaymentId + ": " + syncError.toString());
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


///**
// * Lấy số ngày cấu hình từ bảng esdDMcategoryItems trong Service Manager
// * @param {string} categoryId - ID của danh mục (Mặc định: "htkt_thoi_gia")
// * @returns {number} Số ngày cấu hình
// */
//function getMaxAllowedDaysFromConfig(categoryId) {
//    if (!categoryId) categoryId = "htkt_thoi_gia";
//
//    var categoryFile = new SCFile("esdDMcategoryItems");
//    var query = "category.id=\"" + categoryId + "\"";
//
//    try {
//        if (categoryFile.doSelect(query) === RC_SUCCESS) {
//
//            var configValue = categoryFile["item.id"];
//            var parsedDays = parseFloat(configValue);
//
//            if (!isNaN(parsedDays)) {
//                return parsedDays;
//            }
//        }
//    } catch (e) {
//
//    }
//
//    return 2; // Giá trị mặc định nếu không tìm thấy cấu hình
//}


/**
 * Đồng bộ OGL tất cả thông tin NCC/site theo đề nghị tạm ứng cb dmms
 * @param record 
 */
//function syncVendorOglFromPrepayment(record) {
//    var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(record['unit.lv1']);
//    if (entityInfo && entityInfo.entity && entityInfo.oglBranchCode) {
//        var entityCode = entityInfo.entity;
//        var branchCode = entityInfo.oglBranchCode.length == 4 ?
//            entityInfo.oglBranchCode.substr(1, 4) :
//            entityInfo.oglBranchCode;
//                    var defaultVendorSiteInfo =
//            lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();
//
//        var itemPrepaymentVendor = new SCFile("esdHTKTprepaymentVendor");
//        var prepaymentVendorRc = itemPrepaymentVendor.doSelect(`prepayment.id = "${record.id}"`);
//        while (prepaymentVendorRc == RC_SUCCESS) {
//            if (!itemPrepaymentVendor['ogl.sync.status']) {
//                var result = syncVendorToOgl(itemPrepaymentVendor,
//                    branchCode,
//                    entityCode,
//                    record['user.checker.kttc'] || vars.$lo_operator["contact.name"]);
//                if (result && result.success == true) {
//                    itemPrepaymentVendor['ogl.sync.status'] = true;
//                    itemPrepaymentVendor.doUpdate();
//                }
//            }
//            prepaymentVendorRc = itemPrepaymentVendor.getNext();
//        }
//        try { if (prepaymentVendorRc) prepaymentVendorRc.doClose(); } catch (e) {}
//    }
//}
function syncVendorOglFromPrepayment(record) {
    var entityInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.mapPsToEntity(record['unit.lv1']);

    if (entityInfo && entityInfo.entity && entityInfo.oglBranchCode) {
        var entityCode = entityInfo.entity;
        var branchCode = entityInfo.oglBranchCode.length == 4 ?
            entityInfo.oglBranchCode.substr(1, 4) :
            entityInfo.oglBranchCode;

        var defaultVendorSiteInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();

        var itemPrepaymentVendor = new SCFile("esdHTKTprepaymentVendor");
        var prepaymentVendorRc = itemPrepaymentVendor.doSelect(`prepayment.id = "${record.id}"`);

        while (prepaymentVendorRc == RC_SUCCESS) {
            if (!itemPrepaymentVendor['ogl.sync.status']) {

                var result = syncVendorToOgl(
                    itemPrepaymentVendor,
                    branchCode,
                    entityCode,
                    record['user.checker.kttc'] || vars.$lo_operator["contact.name"]
                );

                if (result && result.success == true) {
                    itemPrepaymentVendor['ogl.sync.status'] = true;

                    // =========================================================================
                    // BỔ SUNG: Kiểm tra số lượng Site của Nhà cung cấp sau khi đồng bộ
                    // =========================================================================
                    var vendorId = itemPrepaymentVendor['vendor.id'];

                    if (vendorId) {
                        var siteFile = new SCFile("esdHTKTvendorSite", SCFILE_READONLY);

                        // Tuỳ logic hệ thống, nếu site phân theo entity thì bạn bổ sung thêm: 
                        // and ogl.org.code="' + entityCode + '"
                        var siteQuery = 'vendor.id="' + vendorId + '"';

                        // Đếm số lượng site của NCC này
                        var siteCount = siteFile.doCount(siteQuery);

                        // Nếu chỉ có ĐÚNG 1 SITE -> Tự động điền luôn vào DB
                        if (siteCount === 1) {
                            if (siteFile.doSelect(siteQuery) === RC_SUCCESS) {
                                itemPrepaymentVendor['vendor.site.id'] = siteFile['id'];
                            }
                        }
                        // Nếu có > 1 site hoặc 0 site -> Bỏ qua, giữ nguyên như bình thường

                        try { siteFile.doClose(); } catch (e) {}
                    }
                    // =========================================================================

                    itemPrepaymentVendor.doUpdate();
                }
            }
            prepaymentVendorRc = itemPrepaymentVendor.getNext();
        }

        // Sửa lỗi: Gọi doClose trên đối tượng SCFile thay vì biến RC
        try { if (itemPrepaymentVendor) itemPrepaymentVendor.doClose(); } catch (e) {}
    }
}
///**
// * Đồng bộ từng NCC
// * @param prepaymentVendor 
// * @param branchCode 
// * @param entityCode 
// */
//function syncVendorToOgl(prepaymentVendor, branchCode, entityCode, username = vars.$lo_operator["contact.name"]) {
//    var itemVendor = new SCFile("esdHTKTvendor");
//    var rcItem = itemVendor.doSelect(`id="${prepaymentVendor['vendor.id']}"`);
//    var defaultVendorSiteInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();
//    var vendorExist = false;
//    var vendorNameFromOGL = null;
//    if (rcItem == RC_SUCCESS) {
//
//        // Lấy giá trị supplier.id
//        var supplierId = itemVendor['supplier.id'];
//
//        if (itemVendor['vendor.name'] && itemVendor['vendor.number']) {
//            var checkVendorReponse = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.getVendorSiteInfo({
//                "vendorNumber": itemVendor['vendor.number'],
//                //                "vendorName": itemVendor['vendor.name'],
//                "entity": branchCode,
//            });
//            if (checkVendorReponse && checkVendorReponse['success'] === true &&
//                checkVendorReponse['data'] &&
//                checkVendorReponse['data'].length > 0) {
//                var allSites = [];
//                if (checkVendorReponse['data'][0].vendorName) {
//                    vendorNameFromOGL = checkVendorReponse['data'][0].vendorName;
//                }
//                checkVendorReponse['data'].forEach(item => {
//                    if (item.sites && item.sites.length > 0) {
//                        allSites = allSites.concat(item.sites);
//                    }
//                });
//
//                // Lấy ra tất cả site đang lưu theo entity - đơn vị
//                var arrVendorSiteCodeExit = [];
//                var itemVendorSite = new SCFile('esdHTKTvendorSite');
//                var vendorSiteRC = itemVendorSite.doSelect(`vendor.id = "${itemVendor.id}" and ogl.entity = "${branchCode}"`);
//                while (vendorSiteRC == RC_SUCCESS) {
//                    // trong các site trả về kiểm tra để cập nhật/set inactive cho các site đang có(set inactive cho site khác site mặc định)
//                    var findVendorSite = allSites.find(x => x.entity == itemVendorSite['ogl.entity'] &&
//                        x.vendorSiteCode == itemVendorSite['ogl.site.code']);
//                    if (findVendorSite) {
//                        if (itemVendorSite['credit.account'] != findVendorSite.debitAccount ||
//                            itemVendorSite['debit.account'] != findVendorSite.debitAccount) {
//                            itemVendorSite['credit.account'] = findVendorSite.debitAccount;
//                            itemVendorSite['debit.account'] = findVendorSite.debitAccount;
//                            itemVendorSite.doUpdate();
//                        }
//                        arrVendorSiteCodeExit.push(findVendorSite.vendorSiteCode);
//                    } else {
//                        itemVendorSite.active = false;
//                        itemVendorSite.doUpdate();
//                    }
//                    vendorSiteRC = itemVendorSite.getNext();
//                }
//
//                if (allSites.length > 0) {
//                    vendorExist = allSites.find(x => x.vendorSiteCode == defaultVendorSiteInfo.siteCode) != null;
//                    var newSiteArr = [];
//                    if (arrVendorSiteCodeExit.length != allSites.length) {
//                        // tìm ra và tạo các site mới
//                        if (arrVendorSiteCodeExit.length == 0) newSiteArr = allSites;
//                        else newSiteArr = allSites.filter(x => !arrVendorSiteCodeExit.includes(x.vendorSiteCode)) || [];
//                    }
//                    newSiteArr.forEach(item => {
//                        item['vendor.id'] = itemVendor.id;
//                        saveVendorSite(item);
//                    });
//                }
//            }
//            if (!vendorExist) {
//                var vendorInfo = buildVendorAndSiteInfo(itemVendor, defaultVendorSiteInfo, branchCode, entityCode, username, vendorNameFromOGL);
//                print(`buildVendorAndSiteInfo: ${JSON.stringify(vendorInfo)}`);
//                var response = createVendor(vendorInfo, itemVendor.id);
//                //                print('createVendor 1= ', JSON.stringify(response));
//                if (response) {
//                    if (response['success'] === true) {
//                        vendorExist = true;
//                    } else {
//                        return response;
//                    }
//                }
//            }
//
//            if (vendorExist) {
//                if (!itemVendor['ogl.sync.status']) {
//                    itemVendor['ogl.sync.status'] = true;
//                    itemVendor.doUpdate();
//                }
//                //                if (!prepaymentVendor['ogl.sync.status']) {
//                //                    prepaymentVendor['ogl.sync.status'] = true;
//                //                    prepaymentVendor.doUpdate();
//                //                }
//
//                // 2. Chỉ CẬP NHẬT TRẠNG THÁI TRÊN MEMORY cho prepaymentVendor ($L_file)
//                // KHÔNG gọi prepaymentVendor.doUpdate() ở đây
//                // Vì nếu là bản ghi mới tạo, doSave/doInsert ở bước sau sẽ tự lưu trạng thái này xuống DB.
//                prepaymentVendor['ogl.sync.status'] = true;
//
//                //cap nhat esdDMSupplier
//                if (supplierId) {
//                    var itemSupplier = new SCFile("esdDMSupplier");
//                    var rcSupplier = itemSupplier.doSelect(`id="${supplierId}"`);
//
//                    if (rcSupplier == RC_SUCCESS) {
//                        if (!itemSupplier['isAccounted']) {
//                            itemSupplier['isAccounted'] = true;
//                            itemSupplier.doUpdate();
//                        }
//                    }
//                }
//            }
//        }
//    }
//    return {
//        success: true
//    };
//}
/**
 * Đồng bộ từng NCC (Logic MỚI: Query QLTS -> Sync OGL -> Create OGL)
 * @param prepaymentVendor 
 * @param branchCode 
 * @param entityCode 
 * @param username
 */
function syncVendorToOgl(prepaymentVendor, branchCode, entityCode, username) {
    if (!username) username = vars.$lo_operator["contact.name"];

    var itemVendor = new SCFile("esdHTKTvendor");
    var rcItem = itemVendor.doSelect('id="' + prepaymentVendor['vendor.id'] + '"');
    var defaultVendorSiteInfo = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();
    
    var vendorExistInOGL = false;
    var vendorNameFromOGL = null;

    if (rcItem == RC_SUCCESS) {
        var supplierId = itemVendor['supplier.id'];
        var vendorId = itemVendor['id'];

        if (itemVendor['vendor.name'] && itemVendor['vendor.number']) {

            // =====================================================================
            // BƯỚC 1: Query site tại danh mục QLTS (esdHTKTvendorSite)
            // =====================================================================
            var hasSiteInQLTS = false;
            var itemVendorSiteCheck = new SCFile('esdHTKTvendorSite');
            var queryLocalSite = 'vendor.id = "' + vendorId + '" and ogl.entity = "' + branchCode + '" and active = true';
            
            if (itemVendorSiteCheck.doSelect(queryLocalSite) == RC_SUCCESS) {
                hasSiteInQLTS = true; // Đã tồn tại site hợp lệ trên QLTS
            }
            try { itemVendorSiteCheck.doClose(); } catch(e) {}

            // Nếu đã có site trên QLTS => Bỏ qua gọi API OGL, chỉ cập nhật memory/trạng thái và return
            if (hasSiteInQLTS) {
                if (!itemVendor['ogl.sync.status']) {
                    itemVendor['ogl.sync.status'] = true;
                    itemVendor.doUpdate();
                }
                prepaymentVendor['ogl.sync.status'] = true;

                // Cập nhật isAccounted cho esdDMSupplier
                if (supplierId) {
                    var itemSupplier = new SCFile("esdDMSupplier");
                    if (itemSupplier.doSelect('id="' + supplierId + '"') == RC_SUCCESS) {
                        if (!itemSupplier['isAccounted']) {
                            itemSupplier['isAccounted'] = true;
                            itemSupplier.doUpdate();
                        }
                    }
                    try { itemSupplier.doClose(); } catch(e) {}
                }
                return { success: true };
            }

            // =====================================================================
            // BƯỚC 2: Đồng bộ OGL NẾU CHƯA CÓ site trên QLTS
            // =====================================================================
            var checkVendorReponse = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.getVendorSiteInfo({
                "vendorNumber": itemVendor['vendor.number'],
                "entity": branchCode
            });

            if (checkVendorReponse && checkVendorReponse['success'] === true &&
                checkVendorReponse['data'] && checkVendorReponse['data'].length > 0) {

                var allSites = [];
                if (checkVendorReponse['data'][0].vendorName) {
                    vendorNameFromOGL = checkVendorReponse['data'][0].vendorName;
                }
                
                checkVendorReponse['data'].forEach(function(item) {
                    if (item.sites && item.sites.length > 0) {
                        allSites = allSites.concat(item.sites);
                    }
                });

                // Xử lý lưu các site trả về từ OGL vào QLTS
                if (allSites.length > 0) {
                    vendorExistInOGL = allSites.find(function(x) { return x.vendorSiteCode == defaultVendorSiteInfo.siteCode; }) != null;

                    allSites.forEach(function(item) {
                        item['vendor.id'] = vendorId;
                        saveVendorSite(item); // Hàm này tự động add/update vào esdHTKTvendorSite
                    });
                }
            }

            // =====================================================================
            // BƯỚC 3: Tạo site NẾU CHƯA CÓ trên OGL
            // =====================================================================
            if (!vendorExistInOGL) {
                var vendorInfo = buildVendorAndSiteInfo(itemVendor, defaultVendorSiteInfo, branchCode, entityCode, username, vendorNameFromOGL);
                var response = createVendor(vendorInfo, vendorId);
                
                if (response) {
                    if (response['success'] === true) {
                        vendorExistInOGL = true;
                    } else {
                        return response; // Trả về lỗi ra ngoài nếu tạo OGL thất bại
                    }
                }
            }

            // =====================================================================
            // Cập nhật trạng thái sau khi Đồng bộ (B2) hoặc Tạo mới (B3) thành công
            // =====================================================================
            if (vendorExistInOGL) {
                if (!itemVendor['ogl.sync.status']) {
                    itemVendor['ogl.sync.status'] = true;
                    itemVendor.doUpdate();
                }
                
                prepaymentVendor['ogl.sync.status'] = true;

                if (supplierId) {
                    var itemSupplierObj = new SCFile("esdDMSupplier");
                    if (itemSupplierObj.doSelect('id="' + supplierId + '"') == RC_SUCCESS) {
                        if (!itemSupplierObj['isAccounted']) {
                            itemSupplierObj['isAccounted'] = true;
                            itemSupplierObj.doUpdate();
                        }
                    }
                    try { itemSupplierObj.doClose(); } catch(e) {}
                }
            }
        }
    }
    return { success: true };
}
/**
 * Tạo payload gọi Tạo NCC/site sang OGL
 * @param esdHTKTvendor 
 * @param defaultVendorSiteInfo 
 * @param branchCode 
 * @param entityCode 
 * @returns 
 */
function buildVendorAndSiteInfo(esdHTKTvendor, defaultVendorSiteInfo, branchCode, entityCode, username, vendorNameFromOGL) {
    return {
        entity: branchCode,
        username: username,
        vendorNumber: esdHTKTvendor['vendor.number'],
        vendorName: vendorNameFromOGL || esdHTKTvendor['vendor.name'],
        vendorSiteCode: defaultVendorSiteInfo.siteCode,
        country: "VN",
        address: esdHTKTvendor['address'],
        drSegment1: entityCode,
        drSegment2: "000000",
        drSegment3: defaultVendorSiteInfo.debitAccount,
        drSegment4: "0000000",
        drSegment5: "0000000",
        drSegment6: "0000000",
        drSegment7: "0000000",
        crSegment1: entityCode,
        crSegment2: "000000",
        crSegment3: defaultVendorSiteInfo.creditAccount,
        crSegment4: "0000000",
        crSegment5: "0000000",
        crSegment6: "0000000",
        crSegment7: "0000000"
    };
}

/**
 * Tạo NCC/site sang OGL
 * @param request 
 * @param vendor.Id 
 * @returns 
 */
function createVendor(request, vendorId) {
    var response = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.createVendorSiteInfo(request);
    //    print('save - create = ', JSON.stringify(response));
    if (response && response['success'] === true) {
        saveVendorSite({
            'vendor.id': vendorId,
            entity: request.entity,
            vendorSiteCode: request.vendorSiteCode,
            creditAccount: lib.ESD_HTKT_ACCOUNTING_UTILS.buildAccountSegment(request.crSegment3, request.crSegment1),
            debitAccount: lib.ESD_HTKT_ACCOUNTING_UTILS.buildAccountSegment(request.drSegment3, request.drSegment1)
        });
    }
    return response;
}

/**
 * Lưu thông tin vendorSite vào esdHTKTvendorSite
 * @param item 
 * @returns 
 */
function saveVendorSite(item) {
    var vendorSite = new SCFile('esdHTKTvendorSite');
    var rs = vendorSite.doSelect(`vendor.id = "${item['vendor.id']}" and ogl.site.code = "${item.vendorSiteCode}" and ogl.entity = "${item.entity}"`);
    if (rs == RC_SUCCESS) {
        vendorSite['ogl.sync.status'] = true;
        vendorSite['credit.account'] = item.creditAccount;
        vendorSite['debit.account'] = item.debitAccount;
        vendorSite.active = true;
        vendorSite.doAction('update');
    } else {
        var vendorId = new Datum();
        var rcode = new Datum();
        rcode = system.functions.rtecall("getnumber", rcode, vendorId, "esdHTKTvendorSite");

        vendorSite.id = vendorId;
        vendorSite['vendor.id'] = item['vendor.id'];
        vendorSite['ogl.entity'] = item.entity;
        vendorSite['ogl.sync.status'] = true;
        vendorSite['ogl.site.code'] = item.vendorSiteCode;
        vendorSite['credit.account'] = item.creditAccount;
        vendorSite['debit.account'] = item.debitAccount;
        vendorSite.active = true;
        vendorSite.doAction('add');
    }

    return vendorSite;
}

function loadPrepaymentVendorInfo(record) {
    var itemFile = new SCFile("esdHTKTprepaymentVendor");

    var itemQuery =
        'select hv.supplier.id as supplier.id,' +
        ' hv.vendor.name as supplier.name,' +
        ' hpv.payment.method as payment.method,' +
        ' hpv.amount as amount,' +
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
        ' hp.status as status,' +
        ' hp.created.by as created.by,' +
        ' hp.initial.role as initial.role,' +
        ' hp.user.checker.kttc as user.checker.kttc,' +
        ' hp.contract.id as contract.id,' +
        ' hp.guarantee.no as guarantee.no,' +
        ' hp.issuing.bank as issuing.bank,' +
        ' hp.guarantee.amount as guarantee.amount,' +
        ' hp.guarantee.expiry.date as guarantee.expiry.date' +
        ' from esdHTKTprepaymentVendor hpv' +
        ' LEFT JOIN esdHTKTvendor hv ON (hpv.vendor.id = hv.id)' +
        ' LEFT JOIN esdHTKTprepayment hp ON (hpv.prepayment.id = hp.id)' +
        ' LEFT JOIN esdHTKTvendorSite hvs ON (hvs.id = hpv.vendor.site.id)' +
        ' LEFT JOIN esdHDcontractSupplier hdVendor ON (hp.contract.id = hdVendor.contract.id)' +
        ' where hpv.id = "' + record.id + '"';

    if (itemFile.doSelect(itemQuery) == RC_SUCCESS) {

        vars.$currency = itemFile["currency"];
        vars.$supplierId = itemFile["supplier.id"];
        vars.$L_file["payment.method"] = itemFile["payment.method"];
        vars.$remainingAmt = itemFile["unpaid.amount"];
        vars.$taxCode = itemFile["tax.code"];
        vars.$supplierdisplays = [itemFile["supplier.name"]];
        vars.$suppliervalues = [itemFile["supplier.id"]];
        vars.$oglSiteCode = itemFile["ogl.site.code"];
        // ----------------- XỬ LÝ LOGIC BẢO LÃNH THEO STATUS -----------------
        var prepaymentStatus = itemFile["status"];

        // TODO: Cập nhật "approved" và "accounted" cho khớp với mã trạng thái trên form của bạn
        var isApprovedOrAccounted = (prepaymentStatus === "approved" || prepaymentStatus === "accounted");
        var bankCode = "";
        if (isApprovedOrAccounted) {
            // Lấy từ bảng esdHTKTprepayment khi đã duyệt/hạch toán
            vars.$guaranteeNo = itemFile["guarantee.no"];
            bankCode = itemFile["issuing.bank"];
            vars.$guaranteeAmount = itemFile["guarantee.amount"];
            vars.$expireDate = itemFile["guarantee.expiry.date"];
        } else {
            // Khởi tạo biến rỗng trước
            vars.$guaranteeNo = "";
            bankCode = "";
            vars.$guaranteeAmount = "";
            vars.$expireDate = "";

            var contractId = itemFile["contract.id"];
            if (contractId != null && contractId !== "") {
                var docInfoFile = new SCFile("esdHDcontractDocInfo");

                // Sử dụng điều kiện query từ SQL bạn cung cấp
                var docQuery = 'contract.id="' + contractId + '" and doc.type="BAOLANHTU" and status="Co hieu luc"';

                if (docInfoFile.doSelect(docQuery) == RC_SUCCESS) {
                    // Ánh xạ field chuẩn theo bảng esdHDcontractDocInfo từ SQL của bạn
                    vars.$guaranteeNo = docInfoFile["doc.no"];
                    bankCode = docInfoFile["issuing.bank"];
                    vars.$guaranteeAmount = docInfoFile["guarantee.amount"];
                    vars.$expireDate = docInfoFile["expire.date"];
                }

                try { docInfoFile.doClose(); } catch (e) {}
            }
        }
        // =========================================================
        // MAP MÃ NGÂN HÀNG -> TÊN NGÂN HÀNG (Dùng try-catch an toàn)
        // =========================================================
        var bankNameDisplay = bankCode; // Mặc định hiển thị mã nếu không map được

        if (bankCode) {
            try {
                var bankMapFile = new SCFile("esdDMcategoryItems", SCFILE_READONLY);
                var rcBankMap = bankMapFile.doSelect('category.id="dmhd_ngan_hang" and item.id="' + bankCode + '"');

                if (rcBankMap == RC_SUCCESS) {
                    bankNameDisplay = bankMapFile["item.name"]; // Lấy tên ngân hàng
                }
                try { bankMapFile.doClose(); } catch (e) {}
            } catch (e) {
                // Nuốt lỗi để không cản trở luồng chạy chính
            }
        }

        // Gán tên ngân hàng (hoặc mã nếu map lỗi) vào biến hiển thị trên form
        vars.$issuingBank = bankNameDisplay;
        // --------------------------------------------------------------------
        var rawAmount = itemFile["amount"];
        if (rawAmount != null && rawAmount !== "") {
            vars.$isAmount = rawAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        } else {
            vars.$isAmount = "";
        }
        //        vars.$isAmount = itemFile["amount"];
        //         vars.$isAmount = Number(itemFile["amount"]);
        vars.$unitLv1 = itemFile["unit.lv1"];
        vars.$unitLv2 = itemFile["unit.lv2"];

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
        print("Lỗi định dạng ngày: " + e.toString());
    }

    return rawDate;
}

function queryVendorData(record) {
    // Lấy giá trị prepaymentId và vendorTaxCode từ record hiện tại trên form
    var prepaymentId = record.prepaymentId; // Hoặc vars.$prepaymentId tùy theo cách bạn đặt tên biến
    var vendorTaxCode = record.vendorTaxCode; // Hoặc vars.$vendorTaxCode

    // Kiểm tra nếu đủ điều kiện thì mới thực hiện query
    if (prepaymentId && vendorTaxCode) {
        var sqlVendor = "prepayment.id=\"" + prepaymentId + "\" and vendor.id=\"" + vendorTaxCode + "\"";

        // Khởi tạo đối tượng SCFile trỏ đến bảng cần query (ví dụ: esdHTKTprepaymentVendor hoặc bảng chứa dữ liệu vendor)
        var vendorFile = new SCFile("esdHTKTprepaymentVendor");
        var rc = vendorFile.doSelect(sqlVendor);

        if (rc == RC_SUCCESS) {
            // Gán dữ liệu tìm được từ DB vào các trường/biến trên màn hình
            record.totalBeforeTax = vendorFile.totalBeforeTax;
            record.vendorName = vendorFile.vendorName;

            // Nếu muốn bật/tắt trạng thái readonly của trường
            vars.$isAmountReadonly = true;
        } else {
            // Xử lý khi không tìm thấy dữ liệu phù hợp
            print("Không tìm thấy bản ghi phù hợp với điều kiện: " + sqlVendor);
        }
    }
}


/**
 * Hàm cập nhật lại số tiền còn lại (contract.amount) cho TẤT CẢ các phiếu đề nghị tạm ứng 
 * đang chờ duyệt (cùng Hợp đồng, cùng NCC) ngay khi một phiếu được phê duyệt cuối.
 */
function updateRemainingAmountForPendingTickets(record) {
    var prepaymentId =
        String(record.id || record["id"] || "");

    if (!prepaymentId) {
        return;
    }

    var currentContractId =
        String(
            record.contract_id ||
            record["contract.id"] ||
            ""
        );

    var currentRequestAmount = "0.00";
    var currentSupplierId = "";

    // =========================================================
    // 1. Lấy thông tin phiếu vừa được duyệt
    // =========================================================
    var prepVendorFile =
        new SCFile(
            "esdHTKTprepaymentVendor",
            SCFILE_READONLY
        );

    if (
        prepVendorFile.doSelect(
            'prepayment.id="' + prepaymentId + '"'
        ) == RC_SUCCESS
    ) {

        currentRequestAmount =
            String(
                prepVendorFile["amount"] || "0.00"
            );

        if (!currentContractId) {
            currentContractId =
                String(
                    prepVendorFile["contract.id"] || ""
                );
        }

        var vendorId =
            prepVendorFile["vendor.id"];

        if (vendorId) {

            var vendorFile =
                new SCFile(
                    "esdHTKTvendor",
                    SCFILE_READONLY
                );

            if (
                vendorFile.doSelect(
                    'id="' + vendorId + '"'
                ) == RC_SUCCESS
            ) {
                currentSupplierId =
                    String(
                        vendorFile["supplier.id"] || ""
                    );
            }

            try {
                vendorFile.doClose();
            } catch (e) {}
        }
    }

    try {
        prepVendorFile.doClose();
    } catch (e) {}

    if (!currentContractId || !currentSupplierId) {
        return;
    }


    // =========================================================
    // 2. Lấy giá trị gốc của NCC trong hợp đồng
    // =========================================================
    var contractSupplierFile =
        new SCFile(
            "esdHDcontractSupplier",
            SCFILE_READONLY
        );

    if (
        contractSupplierFile.doSelect(
            'contract.id="' +
            currentContractId +
            '" and supplier.id="' +
            currentSupplierId +
            '"'
        ) == RC_SUCCESS
    ) {

        var initialAmount =
            String(
                contractSupplierFile["remaining.amount"] ||
                "0.00"
            );


        // =====================================================
        // 2.1 Tổng các phiếu đã duyệt trước đó
        //     Không lấy phiếu hiện tại
        // =====================================================
        var totalOtherApprovedAmount =
            "0.00";

        var checkFile =
            new SCFile(
                "esdHTKTprepaymentVendor",
                SCFILE_READONLY
            );

        var checkQuery =
            'select pv.amount as amount ' +
            'from esdHTKTprepaymentVendor pv ' +
            'join esdHTKTprepayment p ' +
            'on (pv.prepayment.id = p.id) ' +
            'join esdHTKTvendor v ' +
            'on (pv.vendor.id = v.id) ' +
            'where p.contract.id="' +
            currentContractId +
            '" ' +
            'and v.supplier.id="' +
            currentSupplierId +
            '" ' +
            'and (p.status="approved" or p.status="accounted") ' +
            'and p.id ~= "' +
            prepaymentId +
            '"';

        var rcCheck =
            checkFile.doSelect(checkQuery);

        while (rcCheck == RC_SUCCESS) {

            totalOtherApprovedAmount =
                lib.ESD_HTKT_Utils.addStringsManual(
                    totalOtherApprovedAmount,
                    String(
                        checkFile["amount"] || "0.00"
                    )
                );

            rcCheck =
                checkFile.getNext();
        }

        try {
            checkFile.doClose();
        } catch (e) {}


        // =====================================================
        // 2.2 Tính số tiền còn lại

        var newRemainingAmount =
            lib.ESD_HTKT_Utils.subtractStringsManual(
                initialAmount,
                totalOtherApprovedAmount
            );

        newRemainingAmount =
            lib.ESD_HTKT_Utils.subtractStringsManual(
                newRemainingAmount,
                currentRequestAmount
            );


        // =====================================================
        // 3. Cập nhật số dư cho tất cả phiếu đang chờ duyệt
        // =====================================================
        var pendingFile =
            new SCFile(
                "esdHTKTprepaymentVendor"
            );

        var pendingQuery =
            'select pv.id as id ' +
            'from esdHTKTprepaymentVendor pv ' +
            'join esdHTKTprepayment p ' +
            'on (pv.prepayment.id = p.id) ' +
            'join esdHTKTvendor v ' +
            'on (pv.vendor.id = v.id) ' +
            'where p.contract.id="' +
            currentContractId +
            '" ' +
            'and v.supplier.id="' +
            currentSupplierId +
            '" ' +
            'and p.id ~= "' +
            prepaymentId +
            '" ' +
            'and p.status ~= "approved" ' +
            'and p.status ~= "accounted" ' +
            'and p.status ~= "cancelled"';

        var rcPending =
            pendingFile.doSelect(pendingQuery);

        while (rcPending == RC_SUCCESS) {

            var pvId =
                pendingFile["id"];

            var updateFile =
                new SCFile(
                    "esdHTKTprepaymentVendor"
                );

            if (
                updateFile.doSelect(
                    'id="' + pvId + '"'
                ) == RC_SUCCESS
            ) {

                updateFile["contract.amount"] =
                    newRemainingAmount;

                updateFile.doUpdate();
            }

            try {
                updateFile.doClose();
            } catch (e) {}

            rcPending =
                pendingFile.getNext();
        }

        try {
            pendingFile.doClose();
        } catch (e) {}
    }

    try {
        contractSupplierFile.doClose();
    } catch (e) {}
}

