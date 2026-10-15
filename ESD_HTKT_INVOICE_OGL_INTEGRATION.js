// Log bằng print để hiển thị trực tiếp trong Messages của Service Manager.

function parseHttpResponse(operation, response) {
    print(operation + '::httpStatus: ' + (response ? response.statusCode : null));
    print(operation + '::response: ' + (response ? response.body : null));

    if (!response) {
        return null;
    }

    if (!response.body) {
        return {
            success: false,
            httpStatus: response.statusCode,
            message: response.error || "API returned empty response"
        };
    }

    try {
        return rteJSONParse(response.body);
    } catch (e) {
        print(operation + '::error: API return invalid JSON');
        return {
            success: false,
            httpStatus: response.statusCode,
            message: "Fail: " + response.body
        };
    }
}

// Giữ metadata HTTP tách biệt hoàn toàn với body do API trả về.
function parseHttpResponseWithMeta(operation, response) {
    print(operation + '::httpStatus: ' + (response ? response.statusCode : null));
    print(operation + '::response: ' + (response ? response.body : null));

    var result = {
        body: null,
        rawBody: response ? response.body : null,
        httpStatus: response ? response.statusCode : null,
        error: response ? response.error : "No response from API server"
    };

    if (!response || !response.body) {
        return result;
    }

    try {
        result.body = rteJSONParse(response.body);
    } catch (e) {
        result.error = "API return invalid JSON";
        print(operation + '::error: ' + result.error);
    }

    return result;
}
/**
 * Hàm tao activity
 */

/**
 * Kiểm tra hóa đơn (Check Invoice)
 * @param {Object} invoiceData - Object chứa thông tin hóa đơn truyền vào từ SM
 * @returns {Object|null} Trả về data kết quả từ API hoặc null
 */
function checkInvoice(invoiceData) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/invoice/check-invoice";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(invoiceData), headers);
    return parseHttpResponse('checkInvoice', response);
}

//function checkInvoice(invoiceData) {
//    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('vatin');
//    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
//    if (!token || !config) {
//        logger.error('checkInvoice::error: Missing token or system config');
//        return { success: false, message: "Missing authorization token or system configuration" };
//    }
//
//    var url = config.vatinBaseUrl + "/tax/check-all-api";
//    var headers = [
//        new Header("Content-Type", "application/json"),
//        new Header("Authorization", "Bearer " + token)
//    ];
//    
//    var payload = rteJSONStringify(invoiceData);
//    var responseStr = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, payload, headers);
//    
//    if (responseStr) {
//        if (typeof responseStr === 'string' && responseStr.trim() === '') {
//            return { success: false, message: "API returned empty response" };
//        }
//
//        try {
//            return rteJSONParse(responseStr);
//        } catch (e) {
//            logger.error('checkInvoice::error: API return invalid JSON. Raw response: ' + responseStr);
//            return {
//                success: false,
//                message: "API returned non-JSON content",
//                rawResponse: responseStr
//            };
//        }
//    }
//
//    logger.error('checkInvoice::error: No response received from API endpoint');
//    return { success: false, message: "No response from API server" };
//}

/**
 * 2. Kiểm tra số tiền hóa đơn (Check Amount)
 * @param {Array} checkAmountList - Mảng danh sách các object chứa thông tin số tiền cần kiểm tra
 */
function checkAmount(checkAmountList) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/invoice/check-amount";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(checkAmountList), headers);
    return parseHttpResponse('checkAmount', response);
}


// Van tin site NCC
function getVendorSiteInfo(vendorData) {
    if (!vendorData || !vendorData.vendorNumber) {
        print('ESD_HTKT_INVOICE_OGL_INTEGRATION::getVendorSiteInfo: Du lieu truy van khong hop le');
        return null;
    }
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;
    var queryParams = [];
    ['entity', 'vendorName', 'vendorNumber', 'vendorSiteCode'].forEach(name => {
        if (vendorData[name]) {
            queryParams.push(`${name}=${encodeURIComponent(vendorData[name])}`);
        }
    });
    var url = `${config.oglBaseUrl}/vendors/site-info?${queryParams.join('&')}`;
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.get(url, headers);
    return parseHttpResponse('getVendorSiteInfo', response);
}

// Tao site/Ncc 
function createVendorSiteInfo(vendorData) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/vendors/site";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    // tam thoi trong luc cho confirm
    //    vendorData.username = "VTB.HTKT.110";

    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(vendorData), headers);
    return parseHttpResponse('createVendorSiteInfo', response);
}

// Kiem tra cong no
function checkVendorDebtReport(vendorData) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/vendor-debts/report";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(vendorData), headers);
    return parseHttpResponse('checkVendorDebtReport', response);
}

// Thanh toan hoa don
function createApInvoice(invoiceData) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/ap/create-invoice";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    // tam thoi trong luc cho confirm
    //    invoiceData.checker = "VTB.HTKT.110";
    //    invoiceData.maker = "VTB.HTKT.113";

    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(invoiceData), headers);
    return parseHttpResponseWithMeta('createApInvoice', response);
}

// Kiem tra trang thai giao dich AP
function checkAP(apData) {
    if (!apData || !apData.transactionId || apData.transactionId.trim().length === 0 || !apData.requestId || apData.requestId.trim().length === 0) return null;
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;
    const { transactionId, requestId } = apData;
    var url = `${config.oglBaseUrl}/ap/check?transactionId=${encodeURIComponent(transactionId)}&requestId=${encodeURIComponent(requestId)}`;
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.get(url, headers);
    return parseHttpResponse('checkAP', response);
}

// Hach toan batch phan he OGL
function createBatchGL(glData) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/general-ledger/interface";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(glData), headers);
    return parseHttpResponse('createBatchGL', response);
}

// Kiem tra trang thai batch
function checkBatchGl(transactionId) {
    if (!transactionId || transactionId.trim().length === 0) return null;
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var checkData = { "transactionId": transactionId };

    var url = config.oglBaseUrl + "/batch/status";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(checkData), headers);
    return parseHttpResponse('checkBatchGl', response);
}

// Thanh toan yeu cau thanh toan da co tu truoc
function createApPayment(invoiceData) {
    var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('ogl');
    var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
    if (!token || !config) return null;

    var url = config.oglBaseUrl + "/ap/create-payment";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    rteJSONStringify("token " + token)

    var response = lib.ESD_HTKT_BASE_API_INTEGRATION.postJson(url, rteJSONStringify(invoiceData), headers);
    return parseHttpResponseWithMeta('createApPayment', response);
}
