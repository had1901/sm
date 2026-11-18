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
            case 'getListSupplierLedger':
                var invoices = getListSupplierLedger(input);
                result = { success: true, data: invoices };
                break;
            case 'getListAccountsPayable':
                var invoices = getListAccountsPayable(input);
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


function getListSupplierLedger(input) {
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
        print("[DEBUG run] Error parsing JSON input: " + ex);
        return invoiceList;
    }

    if (!vendorId) return invoiceList;

    function escapeSMQuery(val) {
        return String(val).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    // BƯỚC 1: Tìm contract.id từ esdHTKTprepayment theo prepaymentId (nếu prepaymentId có giá trị)
    var contractIdFromPrepayment = "";
    if (prepaymentId) {
        var fPrepayment = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
        var queryPrepayment = 'id="' + escapeSMQuery(prepaymentId) + '"';
        
        if (fPrepayment.doSelect(queryPrepayment) == RC_SUCCESS) {
            contractIdFromPrepayment = fPrepayment["contract.id"] || "";
        }
        print("contractIdFromPrepayment: "+contractIdFromPrepayment);
        try { fPrepayment.doClose(); } catch (e) {}

        if (!contractIdFromPrepayment) {
            return invoiceList;
        }
    }

    var fieldMappings = [
        ["request.id", "requestId", "S"],
        ["prepayment.id", "prepaymentId", "S"],
        ["vendor.id", "vendorId", "S"],
        ["type", "type", "S"],
        ["status", "status", "S"],
        ["message", "message", "S"],
        ["response", "response", "S"],
        ["transaction.id", "transactionId", "S"],
        ["ref.id", "refId", "S"],
        ["ap.code", "apCode", "S"],
        ["batch.name", "batchName", "S"],
        ["created.time", "createdTime", "D"],
        ["checked.time", "checkedTime", "D"],
        ["sub.type", "subType", "S"],
        ["amount", "amount", "N"],
        ["contract.id", "contractId", "S"]
    ];

    // BƯỚC 2: Xây dựng Query lọc esdHTKTaccountingInformation
    var query = 'vendor.id="' + escapeSMQuery(vendorId) + '"';
    query += ' and status="COMPLETED"';
    query += ' and type="AP"';
    query += ' and (null(sub.type) or toupper(sub.type)~="THUE")';

    if (contractIdFromPrepayment) {
        query += ' and contract.id="' + escapeSMQuery(contractIdFromPrepayment) + '"';
    }

    var f = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
    var rc = f.doSelect(query);

    while (rc == RC_SUCCESS) {
        var currentPrepaymentId = f["prepayment.id"] || "";
        print("currentPrepaymentId: "+currentPrepaymentId);

        // BƯỚC 3: Kiểm tra status bên esdHTKTprepayment (nếu dòng có prepayment.id)
        if (currentPrepaymentId) {
            var fPrepCheck = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
            var qPrepCheck = 'id="' + escapeSMQuery(currentPrepaymentId) + '"';
            var prepStatus = "";

            if (fPrepCheck.doSelect(qPrepCheck) == RC_SUCCESS) {
                prepStatus = String(fPrepCheck["status"] || "").toLowerCase();
            }
            try { fPrepCheck.doClose(); } catch (e) {}

            // Nếu status không phải 'accounted' -> Bỏ qua dòng này
            if (prepStatus !== "accounted") {
                rc = f.getNext();
                continue;
            }
        }

        // 1. Ánh xạ các trường từ DB
        var item = mapRowToObject(f, fieldMappings);

        // 2. Bóc tách trường `data` (JSON string)
        if (f["data"]) {
            try {
                var parsedData = JSON.parse(f["data"]);

                item.referenceId = parsedData.referenceId || "";
                item.invoiceType = parsedData.invoiceType || "";
                item.invoiceDate = parsedData.invoiceDate || "";
                item.currency = parsedData.currency || "";
                item.amountPay = parsedData.amountPay || 0;
                item.description = parsedData.description || "";
                item.vendorSiteCode = parsedData.vendorSiteCode || "";
                item.maker = parsedData.maker || "";
                item.checker = parsedData.checker || "";
                item.cashout = parsedData.cashout || "";

            } catch (e) {
                print("[DEBUG run] Error parsing column 'data': " + e);
            }
        }

        // 3. Tính toán refundAmount & remainingAmount
        item.refundAmount = 0;
        item.remainingAmount = (Number(item.amount) || 0) - item.refundAmount;

        invoiceList.push(item);
        rc = f.getNext();
    }

    try { if (f) f.doClose(); } catch (e) {}
    return invoiceList;
}



//function getListAccountsPayable(input) {
//    var invoiceList = [];
//    var prepaymentId = "";
//    var vendorId = "";
//    var tempObj = {};
//
//    try {
//        if (input.details) {
//            tempObj = JSON.parse(input.details);
//        } else if (input.queryString) {
//            tempObj = JSON.parse(input.queryString);
//        }
//
//        prepaymentId = tempObj.prepaymentId || "";
//        vendorId = tempObj.vendorId || "";
//
//    } catch (ex) {
//        print("[DEBUG run] Error parsing JSON input: " + ex);
//        return invoiceList;
//    }
//
//    if (!vendorId) return invoiceList;
//
//    // Helper escape chuỗi cho câu truy vấn Service Manager
//    function escapeSMQuery(val) {
//        return String(val).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
//    }
//
//    // BƯỚC 1: Tìm contract.id từ esdHTKTprepayment theo prepaymentId (nếu có truyền prepaymentId)
//    var contractIdFromPrepayment = "";
//    if (prepaymentId) {
//        var fPrepayment = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
//        var queryPrepayment = 'id="' + escapeSMQuery(prepaymentId) + '"';
//        
//        if (fPrepayment.doSelect(queryPrepayment) == RC_SUCCESS) {
//            contractIdFromPrepayment = fPrepayment["contract.id"] || "";
//        }
//        try { fPrepayment.doClose(); } catch (e) {}
//
//        // Nếu có truyền prepaymentId nhưng không tìm thấy contract.id, trả về mảng rỗng
//        if (!contractIdFromPrepayment) {
//            print("[DEBUG run] Không tìm thấy contract.id tương ứng với prepaymentId: " + prepaymentId);
//            return invoiceList;
//        }
//    }
//
//    var fieldMappings = [
//        ["request.id", "requestId", "S"],
//        ["prepayment.id", "prepaymentId", "S"],
//        ["vendor.id", "vendorId", "S"],
//        ["type", "type", "S"],
//        ["status", "status", "S"],
//        ["message", "message", "S"],
//        ["response", "response", "S"],
//        ["transaction.id", "transactionId", "S"],
//        ["ref.id", "refId", "S"],
//        ["ap.code", "apCode", "S"],
//        ["batch.name", "batchName", "S"],
//        ["created.time", "createdTime", "D"],
//        ["checked.time", "checkedTime", "D"],
//        ["sub.type", "subType", "S"],
//        ["amount", "amount", "N"],
//        ["contract.id", "contractId", "S"]
//    ];
//
//    // BƯỚC 2: Xây dựng Query lọc esdHTKTaccountingInformation
//    var query = 'vendor.id="' + escapeSMQuery(vendorId) + '"';
//    query += ' and status="COMPLETED"';
//    query += ' and toupper(sub.type)="THUE"';
//
//    if (contractIdFromPrepayment) {
//        query += ' and contract.id="' + escapeSMQuery(contractIdFromPrepayment) + '"';
//    }
//
//    var f = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
//    var rc = f.doSelect(query);
//
//    while (rc == RC_SUCCESS) {
//        var currentPrepaymentId = f["prepayment.id"] || "";
//
//        // BƯỚC 3: Lọc theo prepaymentId -> Check sang esdHTKTprepayment id có status = accounted
//        if (currentPrepaymentId) {
//            var fPrepCheck = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
//            var qPrepCheck = 'id="' + escapeSMQuery(currentPrepaymentId) + '"';
//            var prepStatus = "";
//
//            if (fPrepCheck.doSelect(qPrepCheck) == RC_SUCCESS) {
//                prepStatus = String(fPrepCheck["status"] || "").toLowerCase();
//            }
//            try { fPrepCheck.doClose(); } catch (e) {}
//
//            // Bỏ qua dòng này nếu status không phải accounted
//            if (prepStatus !== "accounted") {
//                rc = f.getNext();
//                continue;
//            }
//        }
//
//        // 1. Map các thuộc tính chính từ DB
//        var item = mapRowToObject(f, fieldMappings);
//
//        // 2. Parse trường `data` (JSON string)
//        if (f["data"]) {
//            try {
//                var parsedData = JSON.parse(f["data"]);
//
//                item.referenceId = parsedData.referenceId || "";
//                item.invoiceType = parsedData.invoiceType || "";
//                item.invoiceDate = parsedData.invoiceDate || "";
//                item.currency = parsedData.currency || "";
//                item.amountPay = parsedData.amountPay || 0;
//                item.description = parsedData.description || "";
//                item.vendorSiteCode = parsedData.vendorSiteCode || "";
//                item.maker = parsedData.maker || "";
//                item.checker = parsedData.checker || "";
//                item.cashout = parsedData.cashout || "";
//
//            } catch (e) {
//                print("[DEBUG run] Error parsing column 'data': " + e);
//            }
//        }
//
//        invoiceList.push(item);
//        rc = f.getNext();
//    }
//
//    try { if (f) f.doClose(); } catch (e) {}
//    return invoiceList;
//}

function getListAccountsPayable(input) {
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
        print("[DEBUG run] Error parsing JSON input: " + ex);
        return invoiceList;
    }

    if (!vendorId) return invoiceList;

    // Helper escape chuỗi cho câu truy vấn Service Manager
    function escapeSMQuery(val) {
        return String(val).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    }

    // BƯỚC 1: Tìm contract.id từ esdHTKTprepayment theo prepaymentId (nếu có truyền prepaymentId)
    var contractIdFromPrepayment = "";
    if (prepaymentId) {
    
        var fPrepayment = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
        var queryPrepayment = 'id="' + escapeSMQuery(prepaymentId) + '"';
        
        if (fPrepayment.doSelect(queryPrepayment) == RC_SUCCESS) {
            contractIdFromPrepayment = fPrepayment["contract.id"] || "";
        }
        try { fPrepayment.doClose(); } catch (e) {}

        if (!contractIdFromPrepayment) {
            print("[DEBUG run] Không tìm thấy contract.id tương ứng với prepaymentId: " + prepaymentId);
            return invoiceList;
        }
    }

    var fieldMappings = [
        ["request.id", "requestId", "S"],
        ["prepayment.id", "prepaymentId", "S"],
        ["vendor.id", "vendorId", "S"],
        ["type", "type", "S"],
        ["status", "status", "S"],
        ["message", "message", "S"],
        ["response", "response", "S"],
        ["transaction.id", "transactionId", "S"],
        ["ref.id", "refId", "S"],
        ["ap.code", "apCode", "S"],
        ["batch.name", "batchName", "S"],
        ["created.time", "createdTime", "D"],
        ["checked.time", "checkedTime", "D"],
        ["sub.type", "subType", "S"],
        ["amount", "amount", "N"],
        ["contract.id", "contractId", "S"]
    ];

    // BƯỚC 2: Xây dựng Query lọc esdHTKTaccountingInformation
    var query = 'vendor.id="' + escapeSMQuery(vendorId) + '"';
    query += ' and status="COMPLETED"';
    query += ' and type="AP"';
    query += ' and toupper(sub.type)="THUE"';

    if (contractIdFromPrepayment) {
        query += ' and contract.id="' + escapeSMQuery(contractIdFromPrepayment) + '"';
    }

    var f = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
    
    // Sắp xếp thời gian mới nhất
    f.setOrderBy(["checked.time"], [SCFILE_DSC]);

    var rc = f.doSelect(query);

    while (rc == RC_SUCCESS) {
        var currentPrepaymentId = f["prepayment.id"] || "";

        // BƯỚC 3: Lọc theo prepaymentId -> Check sang esdHTKTprepayment id có status = accounted
        if (currentPrepaymentId) {
            var fPrepCheck = new SCFile("esdHTKTprepayment", SCFILE_READONLY);
            var qPrepCheck = 'id="' + escapeSMQuery(currentPrepaymentId) + '"';
            var prepStatus = "";

            if (fPrepCheck.doSelect(qPrepCheck) == RC_SUCCESS) {
                prepStatus = String(fPrepCheck["status"] || "").toLowerCase();
            }
            try { fPrepCheck.doClose(); } catch (e) {}

            // Bỏ qua dòng này nếu status không phải accounted
            if (prepStatus !== "accounted") {
                rc = f.getNext();
                continue;
            }
        }

        // 1. Map các thuộc tính chính từ DB
        var item = mapRowToObject(f, fieldMappings);

        // 2. Parse trường `data` (JSON string)
        if (f["data"]) {
            try {
                var parsedData = JSON.parse(f["data"]);

                item.referenceId = parsedData.referenceId || "";
                item.invoiceType = parsedData.invoiceType || "";
                item.invoiceDate = parsedData.invoiceDate || "";
                item.currency = parsedData.currency || "";
                item.amountPay = parsedData.amountPay || 0;
                item.description = parsedData.description || "";
                item.vendorSiteCode = parsedData.vendorSiteCode || "";
                item.maker = parsedData.maker || "";
                item.checker = parsedData.checker || "";
                item.cashout = parsedData.cashout || "";
                item.dataType = parsedData.type || "";

            } catch (e) {
                print("[DEBUG run] Error parsing column 'data': " + e);
            }
        }

        // 3. BỔ SUNG: Lấy thông tin Payment Entry (LEFT JOIN tương đương)
        item.paymentEntryAmount = 0;
        item.entryPaymentId = "";
        item.entryPaymentStatus = "";
        item.peDescription = "";
        item.oglStatus = "";

        if (currentPrepaymentId) {
            var fPE = new SCFile("esdHTKTpaymentEntry", SCFILE_READONLY);
            var qPE = 'ref.id="' + escapeSMQuery(currentPrepaymentId) + '"' +
                      ' and entry.type="PREPAYMENT"' +
                      ' and vendor.id="' + escapeSMQuery(vendorId) + '"';

            if (fPE.doSelect(qPE) == RC_SUCCESS) {
                item.paymentEntryAmount = fPE["amount"] || 0;
                item.entryPaymentId = fPE["payment.id"] || "";
                item.peDescription = fPE["description"] || "";

                // Lấy thông tin Payment (p.status)
                if (item.entryPaymentId) {
                    var fP = new SCFile("esdHTKTpayment", SCFILE_READONLY);
                    if (fP.doSelect('id="' + escapeSMQuery(item.entryPaymentId) + '"') == RC_SUCCESS) {
                        item.entryPaymentStatus = fP["status"] || "";
                    }
                    try { fP.doClose(); } catch (e) {}
                }

                // Lấy thông tin OGL Status (aip.status)
                var accountingRequestId = fPE["accounting.request.id"] || "";
                if (accountingRequestId) {
                    var fAIP = new SCFile("esdHTKTaccountingInformation", SCFILE_READONLY);
                    if (fAIP.doSelect('request.id="' + escapeSMQuery(accountingRequestId) + '"') == RC_SUCCESS) {
                        item.oglStatus = fAIP["status"] || "";
                    }
                    try { fAIP.doClose(); } catch (e) {}
                }
            }
            try { fPE.doClose(); } catch (e) {}
        }

        invoiceList.push(item);
        rc = f.getNext();
    }

    try { if (f) f.doClose(); } catch (e) {}
    return invoiceList;
}

function mapRowToObject(scFileRecord, fieldMappings) {
    var item = {};

    for (var j = 0; j < fieldMappings.length; j++) {
        var fieldName = fieldMappings[j][0];
        var jsonKey = fieldMappings[j][1];
        var dataType = fieldMappings[j][2];
        var dbValue = scFileRecord[fieldName];

        if (dataType === "N") {
            item[jsonKey] = (dbValue !== null && dbValue !== undefined) ? Number(dbValue) : 0;
        } else if (dataType === "D") {
            if (dbValue) {
                item[jsonKey] = dbValue.toISOString ? dbValue.toISOString() : String(dbValue);
            } else {
                item[jsonKey] = "";
            }
        } else {
            item[jsonKey] = (dbValue !== null && dbValue !== undefined) ? String(dbValue) : "";
        }
    }

    return item;
}