var logger = getLog("ESD_HTKT_ACCOUNTING_UTILS");

var ACCOUNTING_TYPE = {
    AP: "AP",
    GL: "GL",
    CORE: "CORE"
};

var ACCOUNTING_SUB_TYPE = {
    TAM_UNG: "TAM_UNG",
    THUE: "THUE",
    THANH_TOAN: "THANH_TOAN",
    TAT_TOAN: "TAT_TOAN",
    INHOUSE: "INHOUSE", // CORE chuyển tiền trong hệ thống
    CITAD: "CITAD" // CORE chuyển tiền ngoài hệ thống di CITAD
};

var ACCOUNTING_STATUS = {
    CREATED: "CREATED",
    NEW: "NEW",
    PROCESSING: "PROCESSING",
    COMPLETED: "COMPLETED",
    ERROR: "ERROR",
    NOT_FOUND: "NOT_FOUND",
    IN_QUEUE: "IN_QUEUE"
};

var ACCOUNTING_API_STATUS_MAP = {
    // STATUS AP
    "N": ACCOUNTING_STATUS.NEW,
    "P": ACCOUNTING_STATUS.PROCESSING,
    "C": ACCOUNTING_STATUS.COMPLETED,
    "E": ACCOUNTING_STATUS.ERROR,
    // STATUS GL
    "PROCESSING": ACCOUNTING_STATUS.PROCESSING,
    "COMPLETED": ACCOUNTING_STATUS.COMPLETED,
    "ERROR": ACCOUNTING_STATUS.ERROR,
    "NOT_FOUND": ACCOUNTING_STATUS.NOT_FOUND,
    // STATUS CORE
    "0": ACCOUNTING_STATUS.COMPLETED,
    "1001": ACCOUNTING_STATUS.ERROR,
    "98": ACCOUNTING_STATUS.ERROR,
};

var ACCOUNTING_STATUS_MAP = {
    "CREATED": "Đang thực hiện",
    "NEW": "Khởi tạo",
    "PROCESSING": "Đang xử lý hạch toán",
    "COMPLETED": "Hạch toán thành công",
    "ERROR": "Hạch toán gặp lỗi",
    "NOT_FOUND": "Không tìm thấy giao dịch với transactionId",
    "IN_QUEUE": "Đang thực hiện"
};


// Ánh xạ thông tin phòng ban thực hiện hoặc phòng ban của người dùng đang đăng nhập sang branchCode/entityCode trên OGL.
// unit.lv1 = CN/Khoi
// unit.lv2 = PB thuộc CN/KHOI
function mapPsToEntity(psUnitCode = '') {
    if (psUnitCode && psUnitCode.length > 1) {
        var fileItem = new SCFile('esdDMentity');
        var itemRc;
        if (psUnitCode.indexOf('0') == 0) {
            itemRc = fileItem.doSelect(`ps.code = "${psUnitCode}" or ps.code = "${psUnitCode.substr(1, psUnitCode.length)}"`);
        } else {
            itemRc = fileItem.doSelect(`ps.code = "${psUnitCode}"`);
        }

        if (itemRc == RC_SUCCESS) {
            return {
                psCode: fileItem['ps.code'],
                entity: fileItem['entity.code'],
                oglBranchCode: fileItem['ogl.branch.code'],
                orgTransactionCode: fileItem['org.transaction.code'],
                branchName: fileItem['branch.name']
            }
        }
        try { if (fileItem) fileItem.doClose(); } catch (e) {}
    }
    return null;
}

// get vendorSite theo loai HHDV
function getVendorDefaultSiteInfo(goodType = "HHDV") {
    var siteInfos = {
        "HHDV": { siteCode: "126150610", debitAccount: "126150610", creditAccount: "224421300" },
        "TSCĐ": { siteCode: "126150630", debitAccount: "126150630", creditAccount: "224421300" },
        "XDCB": { siteCode: "126150640", debitAccount: "126150640", creditAccount: "224421300" },
    }
    return siteInfos[goodType];
}

function accountSegmentToArr(account) {
    return account.split('.');
}

function buildAccountSegment(account, entity) {
    return [entity, "000000", account, "0000000", "0000000", "0000000", "0000000"].join('.');
}

function getBankDroplist() {
    var bankList = [];
    var bankItem = new SCFile('esdDMbank');
    var bankRc = bankItem.doSelect(true);
    while (bankRc == RC_SUCCESS) {
        bankList.push({
            code: bankItem['citad.branch.code'],
            name: bankItem['name'],
            napas: bankItem['napas.code'],
            citad: bankItem['citad.code'],
        });
        bankRc = bankItem.getNext();
    }
    try { if (bankItem) bankItem.doClose(); } catch (e) {}
    return bankList;
}

var vendorSiteFields = ['vendor.id', 'ogl.entity', 'ogl.site.id', 'ogl.site.code', 'credit.account', 'debit.account', 'id'];

function getVendorSiteList(vendorId, entity) {
    var vendorSiteList = [];
    var itemFile = new SCFile("esdHTKTvendorSite");
    var rcItem = itemFile.doSelect(`vendor.id = "${vendorId}" and ogl.entity = "${entity}"`);

    while (rcItem == RC_SUCCESS) {
        var obj = {};
        vendorSiteFields.forEach(k => {
            obj[k] = itemFile[k];
        });
        vendorSiteList.push(obj);
        rcItem = itemFile.getNext();
    }
    try { if (itemFile) itemFile.doClose(); } catch (e) {}
    return vendorSiteList;
}
//getVendorSiteList('0000000002', '106');

function checkOpenAccoutingTime() {
    var defaultOpenTime = '08:30';
    var defaultCloseTime = '18:00';
    var openHour = 8;
    var openMin = 30;
    var closeHour = 18;
    var closeMin = 0;
    var openTime = lib.ESD_HTKT_Utils.getItemNameFromConfig({ categoryId: 'dmhtkt_working_hours', itemId: 'OPEN_TIME', defaultValue: defaultOpenTime });
    var closeTime = lib.ESD_HTKT_Utils.getItemNameFromConfig({ categoryId: 'dmhtkt_working_hours', itemId: 'CLOSE_TIME', defaultValue: defaultCloseTime });
    if (lib.ESD_HTKT_Utils.isValidOpenCloseTime(openTime)) {
        var openTimeSplit = openTime.split(':');
        openHour = +openTimeSplit[0];
        openMin = +openTimeSplit[1];
    }
    if (lib.ESD_HTKT_Utils.isValidOpenCloseTime(closeTime)) {
        var closeTimeSplit = closeTime.split(':');
        closeHour = +closeTimeSplit[0];
        openTime = +closeTimeSplit[1];
    }

    if (closeHour * 60 + closeMin <= openHour * 60 + openMin) {
        openHour = 8;
        openMin = 30;
        closeHour = 18;
        closeMin = 0;
    }

    var now = funcs.tod();
    var currentHour = now.getHours();
    var currentMin = now.getMinutes();

    var currentTimeInMin = currentHour * 60 + currentMin;
    var openTimeInMin = openHour * 60 + openMin;
    var closeTimeInMin = closeHour * 60 + closeMin;
    return currentTimeInMin > openTimeInMin && currentTimeInMin < closeTimeInMin;
}

function processAccounting(esdHTKTprepayment) {
    // logger.info('ESD_HTKT_ACCOUNTING_UTILS::processAccounting: ' + rteJSONStringify(esdHTKTprepayment));
    if (!esdHTKTprepayment || !esdHTKTprepayment.id) return;

    var accountingInTime = checkOpenAccoutingTime();
    var itemEsdHTKTaccountingInfo = new SCFile('esdHTKTaccountingInformation');
    var result = itemEsdHTKTaccountingInfo.doSelect(`prepayment.id = "${esdHTKTprepayment.id}"`);
    var arrAPItem = [];
    var arrGLItem = [];
    //    var arrCoreItem = [];
    var fields = ['request.id', 'prepayment.id', 'type', 'sub.type', 'data'];
    while (result == RC_SUCCESS) {
        if (accountingInTime) {
            var obj = {};
            fields.forEach(k => {
                //            print(`${k}: ${itemEsdHTKTaccountingInfo[k]}`)
                obj[k] = itemEsdHTKTaccountingInfo[k];
            });
            if (itemEsdHTKTaccountingInfo.status == ACCOUNTING_STATUS.CREATED ||
                itemEsdHTKTaccountingInfo.status == ACCOUNTING_STATUS.IN_QUEUE) {
                if (obj.type == ACCOUNTING_TYPE.AP) {
                    arrAPItem.push(obj);
                } else if (obj.type == ACCOUNTING_TYPE.GL) {
                    arrGLItem.push(obj);

                }
                //            else if (obj.type == ACCOUNTING_TYPE.CORE) {
                //                arrCoreItem.push(obj);
                //            }
            }
        } else {
            itemEsdHTKTaccountingInfo.status = ACCOUNTING_STATUS.IN_QUEUE;
            itemEsdHTKTaccountingInfo.doUpdate();
        }
        result = itemEsdHTKTaccountingInfo.getNext();
    }
    //    print('done');
    if (accountingInTime) {
        //        var hasOGLError = false;
        arrAPItem.forEach(itemHt => {
            callApiAp(itemHt);
            //            if (!callApiAp(itemHt)) {
            //                hasOGLError = true;
            //            }
        });
        arrGLItem.forEach(itemHt => {
            callApiGl(itemHt);
            //            if (!callApiGl(itemHt)) {
            //                hasOGLError = true;
            //            }
        });
        if (arrAPItem.length == 0 && arrGLItem.length == 0) {
            checkCompleteAccounting(esdHTKTprepayment.id);
        }
        //        if (!hasOGLError) {
        //            arrCoreItem.forEach(itemHt => {
        //                callApiCore(itemHt);
        //            });
        //        }
    }
    try { if (itemEsdHTKTaccountingInfo) itemEsdHTKTaccountingInfo.doClose(); } catch (e) {}
}

//processAccounting({ id: 'TU.106.26.0000060' });
//processAccounting({ id: 'TU.106.26.0000193' });

function callApiAp(esdHTKTacountingInfo) {
    var success = false;
    if (!esdHTKTacountingInfo || !esdHTKTacountingInfo['request.id'] || !esdHTKTacountingInfo.data) {
        // logger.info('ESD_HTKT_ACCOUNTING_UTILS::callApiAp: invalid payload');
        return success;
    }
    var payload = null;
    try {
        payload = rteJSONParse(esdHTKTacountingInfo.data);
    } catch (e) {
        // logger.info("ESD_HTKT_ACCOUNTING_UTILS::callApiAp: sub.type không xác định");
    }

    if (payload) {
        var apiResult = null;
        if (esdHTKTacountingInfo['sub.type'] == ACCOUNTING_SUB_TYPE.THANH_TOAN ||
            esdHTKTacountingInfo['sub.type'] == ACCOUNTING_SUB_TYPE.TAM_UNG ||
            esdHTKTacountingInfo['sub.type'] == ACCOUNTING_SUB_TYPE.THUE) {
//            apiResult = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.createApInvoice(payload);
            apiResult = { success: false }
        } else if (esdHTKTacountingInfo['sub.type'] == ACCOUNTING_SUB_TYPE.TAT_TOAN) {
            apiResult = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.createApPayment(payload);
        } else {
            // logger.info("ESD_HTKT_ACCOUNTING_UTILS::callApiAp: sub.type không xác định");
        }
        if (apiResult) {
            var response = apiResult.body;
            var httpStatus = apiResult.httpStatus;
            var rawResponseBody = apiResult.rawBody;

            if (!response) {
                response = {
                    success: false,
                    message: apiResult.error || "API returned empty response"
                };
            }

            success = response.success;
            var itemAccounting = new SCFile('esdHTKTaccountingInformation');
            var result = itemAccounting.doSelect(`request.id = "${esdHTKTacountingInfo['request.id']}"`);
            if (result == RC_SUCCESS) {
                itemAccounting.status = success ? ACCOUNTING_STATUS.NEW : ACCOUNTING_STATUS.ERROR;
                // Chỉ lưu đúng raw body do API trả về, không chèn metadata HTTP vào JSON.
                itemAccounting.response = rawResponseBody;
                itemAccounting['response.http.status'] = httpStatus == null ? null : String(httpStatus);
                
                if (response.data && response.data.transactionId) {
                    itemAccounting['transaction.id'] = response.data.transactionId;
                }
                if (response.message) {
                    itemAccounting.message = response.message;
                }
                itemAccounting.doUpdate();
                createJobCheckAccounting(esdHTKTacountingInfo['request.id']);
            }
            try { if (itemAccounting) itemAccounting.doClose(); } catch (e) {}
        }
    }
    return success;
}

function callApiGl(esdHTKTacountingInfo) {
    var success = false;
    if (!esdHTKTacountingInfo || !esdHTKTacountingInfo['request.id'] || !esdHTKTacountingInfo.data) {
        // logger.info('ESD_HTKT_ACCOUNTING_UTILS::callApiGl: invalid payload');
        return success;
    }
    var payload = null;
    try {
        payload = rteJSONParse(esdHTKTacountingInfo.data);
    } catch (e) {
        // logger.info("ESD_HTKT_ACCOUNTING_UTILS::callApiGl: QLTS Cannot parse json payload");
    }
    if (payload) {
        var response = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.createBatchGL(payload);
        if (response) {
            success = response.success;
            var itemAccounting = new SCFile('esdHTKTaccountingInformation');
            var result = itemAccounting.doSelect(`request.id = "${esdHTKTacountingInfo['request.id']}"`);
            if (result == RC_SUCCESS) {
                itemAccounting.status = success ? ACCOUNTING_STATUS.NEW : ACCOUNTING_STATUS.ERROR;
                itemAccounting.response = rteJSONStringify(response);
                if (response.data && response.data.transactionId) {
                    itemAccounting['transaction.id'] = response.data.transactionId;
                }
                if (response.message) {
                    itemAccounting.message = response.message;
                }
                itemAccounting.doUpdate();
                createJobCheckAccounting(esdHTKTacountingInfo['request.id']);
            }
            try { if (itemAccounting) itemAccounting.doClose(); } catch (e) {}
        }
    }
    return success;
}


// Goi API chuyen tien
//checkCompleteAccounting('TU.106.26.0000013')
function callApiCore(esdHTKTacountingInfo) {
    // Đặt false để tắt giả lập và gọi lại CORE thật.
    var USE_FAKE_CORE_RESPONSE = false;
    var success = false;
    if (!esdHTKTacountingInfo || !esdHTKTacountingInfo['request.id'] || !esdHTKTacountingInfo.data) {
        // logger.info('ESD_HTKT_ACCOUNTING_UTILS::callApiCore: invalid payload');
        return success;
    }
    var payload = null;
    try {
        payload = rteJSONParse(esdHTKTacountingInfo.data);
    } catch (e) {
        // logger.info("ESD_HTKT_ACCOUNTING_UTILS::callApiCore: QLTS Cannot parse json payload");
    }
    if (payload) {
        var apiResult = null;
        var response = null;
        var rawResponseBody = null;
        var httpStatus = null;
        var status = "UNKNOWN";
        var statusDetail = null;
        if (USE_FAKE_CORE_RESPONSE &&
            (esdHTKTacountingInfo['sub.type'] == ACCOUNTING_SUB_TYPE.INHOUSE ||
                esdHTKTacountingInfo['sub.type'] == ACCOUNTING_SUB_TYPE.CITAD)) {
            var fakeStatuses = [
                { code: "1", detail: "Thất bại" },
                { code: "1001", detail: "Lỗi server" },
                { code: "98", detail: "Time out call sang XES" },
                { code: "202", detail: "Lỗi kết nối database" },
                { code: "100", detail: "Lỗi dữ liệu. Mã lỗi hệ thống chung" }
            ];
            var fakeStatus = fakeStatuses[Math.floor(Math.random() * fakeStatuses.length)];
            response = {
                status: {
                    code: fakeStatus.code,
                    detail: fakeStatus.detail + " (Giả lập)"
                },
            };
            rawResponseBody = rteJSONStringify(response);
        } else if (esdHTKTacountingInfo['sub.type'] == ACCOUNTING_SUB_TYPE.INHOUSE) {
            apiResult = lib.ESD_HTKT_FUND_TRANSFER_INTEGRATION.fundTranfer(payload);
        } else if (esdHTKTacountingInfo['sub.type'] == ACCOUNTING_SUB_TYPE.CITAD) {
            apiResult = lib.ESD_HTKT_FUND_TRANSFER_INTEGRATION.fundTranferOut(payload);
        } else {
            // logger.info("ESD_HTKT_ACCOUNTING_UTILS::callApiCore: sub.type không xác định");
        }

        if (apiResult) {
            response = apiResult.body;
            rawResponseBody = apiResult.rawBody;
            httpStatus = apiResult.httpStatus;

            if (!response) {
                response = {
                    status: {
                        code: "400",
                        detail: apiResult.error || "CORE returned empty response"
                    }
                };
            }
        }

        // Log duy nhất response trả về của call core
        logger.info("ESD_HTKT_ACCOUNTING_UTILS::callApiCore response: " + rteJSONStringify(response));

        if (response) {
            var responseData = response.data && typeof response.data === "object" ?
                response.data :
                {};
            var hostRefNum = String(responseData.hostRefNum || "").trim();

            if (response.status) {
                status = response.status.code === "0" ? ACCOUNTING_STATUS.COMPLETED : ACCOUNTING_STATUS.ERROR;
                statusDetail = response.status.detail;
                success = (status == ACCOUNTING_STATUS.COMPLETED);
            } else {
                status = ACCOUNTING_STATUS.ERROR;
                statusDetail = response.message || "Response không có status.code";
            }
            var itemAccounting = new SCFile('esdHTKTaccountingInformation');
            var result = itemAccounting.doSelect(`request.id = "${esdHTKTacountingInfo['request.id']}"`);
            if (result == RC_SUCCESS) {
                itemAccounting['checked.time'] = funcs.tod();
                itemAccounting.status = status;
                itemAccounting.response = rawResponseBody;
                itemAccounting['response.http.status'] = httpStatus == null ? null : String(httpStatus);
                itemAccounting.message = statusDetail;
                itemAccounting['host.res.num'] = hostRefNum;
                itemAccounting.doUpdate();
            }
            try { if (itemAccounting) itemAccounting.doClose(); } catch (e) {}
        } else {
            var itemAccounting = new SCFile('esdHTKTaccountingInformation');
            var result = itemAccounting.doSelect(`request.id = "${esdHTKTacountingInfo['request.id']}"`);
            if (result == RC_SUCCESS) {
                itemAccounting['checked.time'] = funcs.tod();
                itemAccounting.status = ACCOUNTING_STATUS.ERROR;
                itemAccounting['response.http.status'] = null;
                itemAccounting.message = "Không nhận được phản hồi từ hệ thống CORE";
                itemAccounting.doUpdate();
            }
            try { if (itemAccounting) itemAccounting.doClose(); } catch (e) {}
        }
    }
    return success;
}

// kiem tra thong tin hach toan theo request ID
function checkAccountingInfo(requestId) {
    // logger.info(`checkAccountingInfo: ${requestId}`);
    if (!requestId || requestId.trim().length == 0) return;
    var itemAccounting = new SCFile('esdHTKTaccountingInformation');
    var result = itemAccounting.doSelect(`request.id = "${requestId}"`);
    if (result == RC_SUCCESS) {
        var response = null;
        var prepId = itemAccounting['prepayment.id'];
        if (itemAccounting.status !== ACCOUNTING_STATUS.NEW && itemAccounting.status !== ACCOUNTING_STATUS.PROCESSING) {
            // chi check voi 2 trang thai NEW && PROCESSING
            var currentStatus = itemAccounting.status;
            try { if (itemAccounting) itemAccounting.doClose(); } catch (e) {}
            if (currentStatus === ACCOUNTING_STATUS.COMPLETED && prepId) {
                checkCompleteAccounting(prepId);
            }
            return;
        }
        if (itemAccounting.type == ACCOUNTING_TYPE.AP) {
            response = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.checkAP({
                transactionId: itemAccounting['transaction.id'],
                requestId: itemAccounting['request.id']
            });
        } else if (itemAccounting.type == ACCOUNTING_TYPE.GL) {
            response = lib.ESD_HTKT_INVOICE_OGL_INTEGRATION.checkBatchGl(itemAccounting['transaction.id']);
            // print("resds", response);
        }

        if (response) {
            itemAccounting.response = rteJSONStringify(response);
            var status = "UNKNOWN";
            if (response.data) {
                if (response.data.status) {
                    status = ACCOUNTING_API_STATUS_MAP[response.data.status] || "UNKNOWN";
                }
                itemAccounting['checked.time'] = funcs.tod();
                if (response.data.invoiceNumber) {
                    itemAccounting['ap.code'] = response.data.invoiceNumber;
                }
                if (response.data.batchName) {
                    itemAccounting['batch.name'] = response.data.batchName;
                }
                if (response.data.referenceId) {
                    itemAccounting['ref.id'] = response.data.referenceId;
                }
                if (response.data.paymentNumber) {
                    itemAccounting['payment.number'] = response.data.paymentNumber;
                }
            }
            if (!response.success) {
                status = ACCOUNTING_STATUS.ERROR;
                itemAccounting.message = response.message;
            }
            itemAccounting.status = status;
            itemAccounting.doUpdate();

        }
        try { if (itemAccounting) itemAccounting.doClose(); } catch (e) {}
        if (prepId) {
            checkCompleteAccounting(prepId);
        }
    } else {
        try { if (itemAccounting) itemAccounting.doClose(); } catch (e) {}
    }
}

function createJobCheckAccounting(requestId) {
    // logger.info(`createJobCheckAccounting: ${requestId}`);
    var workerName = "ESD HTKT CHECK ACCOUNTING == " + requestId;
    lib.ESD_HTKT_Utils.createSchedule({
        name: workerName,
        script: `lib.ESD_HTKT_ACCOUNTING_UTILS.checkAccountingInfo("${requestId}");`,
        actionDelaySeconds: 120
    });
}

//createJobCheckAccounting('8257D136-145F-4B85-8C12-CAB1E6001A51');
//checkAccountingInfo('1BCFEC01-BED7-4BBB-9E98-C376F7001A44');


// Moi lan kiem tra xong 1 row
// Kiem tra de nghi da hach toan thanh cong chua
// duyet ds accountingInformation, neu tat ca ban ghi da complete -> cap nhat esdHTKTprepayment.status = ACCOUNTED;
function checkCompleteAccounting(prepaymentId) {

    var fields = ['request.id', 'prepayment.id', 'type', 'sub.type', 'data'];
    var countRecord = 0;
    var countRecordCompleted = 0;
    var countOGL = 0;
    var countOGLCompleted = 0;
    var itemAccountingCore = [];
    var isPayment = false;
    var accountingInfoItem = new SCFile('esdHTKTaccountingInformation');
    var result = accountingInfoItem.doSelect(`prepayment.id = "${prepaymentId}"`);
    while (result == RC_SUCCESS) {
        countRecord++;
        if (accountingInfoItem.type == ACCOUNTING_TYPE.AP || accountingInfoItem.type == ACCOUNTING_TYPE.GL) {
            countOGL++;
        } else if (accountingInfoItem.type == ACCOUNTING_TYPE.CORE &&
            (accountingInfoItem.status == ACCOUNTING_STATUS.CREATED || accountingInfoItem.status == ACCOUNTING_STATUS.IN_QUEUE)) {
            var obj = {};
            fields.forEach(k => {
                obj[k] = accountingInfoItem[k];
            });
            itemAccountingCore.push(obj);
        }
        if (accountingInfoItem.status == ACCOUNTING_STATUS.COMPLETED) {
            countRecordCompleted++;
            if (accountingInfoItem.type == ACCOUNTING_TYPE.AP || accountingInfoItem.type == ACCOUNTING_TYPE.GL) {
                countOGLCompleted++;
            }
        }

        if (accountingInfoItem["sub.type"] == ACCOUNTING_SUB_TYPE.THANH_TOAN ||
            accountingInfoItem["sub.type"] == ACCOUNTING_SUB_TYPE.TAT_TOAN) {
            isPayment = true;
        }

        result = accountingInfoItem.getNext();
    }
    try { if (accountingInfoItem) accountingInfoItem.doClose(); } catch (e) {}
    //    print(`countRecord: ${countRecord} === countRecordCompleted: ${countRecordCompleted}`);
    if (countRecord == countRecordCompleted && countRecordCompleted > 0) {
        updatePaymentAccountingCompletedStatus(prepaymentId, isPayment);
    }

    if (countOGL == countOGLCompleted && itemAccountingCore.length > 0) {
        itemAccountingCore.forEach(itemHT => {
            if (callApiCore(itemHT)) {
                countRecordCompleted++;
            }
        });
        if (countRecord == countRecordCompleted && countRecordCompleted > 0) {
            updatePaymentAccountingCompletedStatus(prepaymentId, isPayment);
        }
    }
}

/**
 * Đồng bộ trạng thái hạch toán từ phiếu Tạm Ứng sang các hóa đơn đã gắn đề nghị.
 */
function updateInvoiceAccountingStatusByRequestId(requestId) {
    var safeRequestId = String(requestId == null ? "" : requestId).trim();
    if (!safeRequestId) {
        return;
    }

    var escapedRequestId = safeRequestId
        .split("\\").join("\\\\")
        .split('"').join('\\"');

    var invoiceFile = null;
    var invoiceIds = [];
    var updatedCount = 0;

    try {
        /*
         * Bước 1: lấy danh sách ID hóa đơn theo request.id.
         */
        invoiceFile = new SCFile("esdHTKTinvoice");

        var selectRc = invoiceFile.doSelect(
            `request.id = "${escapedRequestId}"`
        );

        while (selectRc == RC_SUCCESS) {
            var invoiceId = String(invoiceFile["id"] || "").trim();

            if (invoiceId) {
                invoiceIds.push(invoiceId);
            }

            selectRc = invoiceFile.getNext();
        }
    } catch (eSelect) {
        // logger.info(
        //      "ESD_HTKT_ACCOUNTING_UTILS::updateInvoiceAccountingStatusByRequestId SELECT ERROR" +
        //      " requestId=" + safeRequestId +
        //      " error=" + eSelect
        // );
        return;
    } finally {
        try {
            if (invoiceFile) {
                invoiceFile.doClose();
            }
        } catch (eCloseSelect) {}
    }

    /*
     * Bước 2: update từng hóa đơn theo ID.
     */
    for (var i = 0; i < invoiceIds.length; i++) {
        var invoiceItem = null;
        var invoiceIdToUpdate = invoiceIds[i];

        try {
            invoiceItem = new SCFile("esdHTKTinvoice");

            var invoiceRc = invoiceItem.doSelect(
                `id = "${invoiceIdToUpdate}"`
            );

            if (invoiceRc == RC_SUCCESS) {
                var currentAccountingStatus = String(
                    invoiceItem["accounting.status"] || ""
                ).trim();

                if (currentAccountingStatus !== "1") {
                    invoiceItem["accounting.status"] = "1";

                    var updateInvoiceRc = invoiceItem.doUpdate();

                    if (updateInvoiceRc == RC_SUCCESS) {
                        updatedCount++;
                    } else {
                        // logger.info(
                        //      "ESD_HTKT_ACCOUNTING_UTILS::updateInvoiceAccountingStatusByRequestId UPDATE FAILED" +
                        //      " requestId=" + safeRequestId +
                        //      " invoiceId=" + invoiceIdToUpdate +
                        //      " rc=" + updateInvoiceRc
                        // );
                    }
                }
            }
        } catch (eUpdate) {
            // logger.info(
            //      "ESD_HTKT_ACCOUNTING_UTILS::updateInvoiceAccountingStatusByRequestId UPDATE ERROR" +
            //      " requestId=" + safeRequestId +
            //      " invoiceId=" + invoiceIdToUpdate +
            //      " error=" + eUpdate
            // );
        } finally {
            try {
                if (invoiceItem) {
                    invoiceItem.doClose();
                }
            } catch (eCloseUpdate) {}
        }
    }

    // logger.info(
    //      "ESD_HTKT_ACCOUNTING_UTILS::updateInvoiceAccountingStatusByRequestId DONE" +
    //      " requestId=" + safeRequestId +
    //      " matched=" + invoiceIds.length +
    //      " updated=" + updatedCount
    // );
}

function updatePaymentAccountingCompletedStatus(prepaymentId, isPayment) {
    var tableName = isPayment ?
        "esdHTKTpayment" :
        "esdHTKTprepayment";

    var itemPrepayment = new SCFile(tableName);
    //        var itemPrepayment = new SCFile('esdHTKTprepayment');
    var prResult = itemPrepayment.doSelect(`id = "${prepaymentId}"`);
    if (prResult == RC_SUCCESS) {
        itemPrepayment.status = 'accounted';
        itemPrepayment["completed.date"] = system.functions.tod();

        var updatePrepaymentRc = itemPrepayment.doUpdate();

        /*
         * Logic mới chỉ áp dụng cho bảng Tạm Ứng:
         * esdHTKTprepayment.id = esdHTKTinvoice.request.id.
         *
         * Không áp dụng khi isPayment = true vì quan hệ trên chỉ được chốt cho Tạm Ứng.
         * Toàn bộ logic cũ của esdHTKTpayment được giữ nguyên.
         */
        if (updatePrepaymentRc == RC_SUCCESS && !isPayment) {
            updateInvoiceAccountingStatusByRequestId(prepaymentId);
        }
    }
    try { if (itemPrepayment) itemPrepayment.doClose(); } catch (e) {}
}

//checkCompleteAccounting('TU.106.26.0000028');

// Liet ke danh sach cac ban ghi hach toan AP, GL can check trang thai: 
function jobCallCheckAccoutingStatus() {
    var accountingInfoItem = new SCFile('esdHTKTaccountingInformation');
    var sortFields = ["created.time"];
    var sortSeqs = [SCFILE_ASC];
    accountingInfoItem.setOrderBy(sortFields, sortSeqs);
    var result = accountingInfoItem.doSelect(`(type = "${ACCOUNTING_TYPE.AP}" or type = "${ACCOUNTING_TYPE.GL}") and transaction.id <> NULL and (status = "${ACCOUNTING_STATUS.NEW}" or status = "${ACCOUNTING_STATUS.PROCESSING}")`);
    var count = 0;
    var arrCheck = [];
    while (result == RC_SUCCESS && count < 5) {
        //        ['prepayment.id', 'request.id', 'status', 'type', 'created.time'].forEach(k => {
        //            print(`${k}: ${accountingInfoItem[k]}`);
        //        });
        count++;
        arrCheck.push(accountingInfoItem['request.id']);
        result = accountingInfoItem.getNext();
    }
    try { if (accountingInfoItem) accountingInfoItem.doClose(); } catch (e) {}
    if (arrCheck.length > 0) {
        arrCheck.forEach(requestId => checkAccountingInfo(requestId));
    } else {
        // logger.info('ESD_HTKT_ACCOUNTING_UTILS::jobCallCheckAccoutingStatus: no item for check');
    }
}

//jobCallCheckAccoutingStatus();

function jobCallIntegrateRecordInQueue() {
    // logger.info('ESD_HTKT_ACCOUNTING_UTILS::jobCallIntegrateRecordInQueue: ' + funcs.tod());
    if (!checkOpenAccoutingTime()) {
        // logger.info('ESD_HTKT_ACCOUNTING_UTILS::jobCallIntegrateRecordInQueue: COT');
        return;
    }
    var accountingInfoItem = new SCFile('esdHTKTaccountingInformation');
    var sortFields = ["created.time"];
    var sortSeqs = [SCFILE_ASC];
    accountingInfoItem.setOrderBy(sortFields, sortSeqs);
    var result = accountingInfoItem.doSelect(`transaction.id = NULL and status = "${ACCOUNTING_STATUS.IN_QUEUE}"`);
    var arrItem = [];
    while (result == RC_SUCCESS) {
        //        ['prepayment.id', 'request.id', 'status', 'type', 'created.time'].forEach(k => {
        //            print(`${k}: ${accountingInfoItem[k]}`);
        //        });
        if (!arrItem.includes(accountingInfoItem['prepayment.id'])) {
            arrItem.push(accountingInfoItem['prepayment.id']);
        }
        result = accountingInfoItem.getNext();
    }
    try { if (accountingInfoItem) accountingInfoItem.doClose(); } catch (e) {}
    if (arrItem.length > 0) {
        arrItem.forEach(prepaymentId => processAccounting({ id: prepaymentId }));
    } else {
        // logger.info('ESD_HTKT_ACCOUNTING_UTILS::jobCallIntegrateRecordInQueue: no item for check');
    }
}

//jobCallIntegrateRecordInQueue();

function checkAccount(accountId, napasCode) {
    if (napasCode == '970415') { // kiem tra trong he thong
        var response = lib.ESD_HTKT_FUND_TRANSFER_INTEGRATION.checkNameAccount(accountId);
        if (response && response.data && response.data.acctName) {
            if (response.data.stat !== "0") {
                return null;
            }
            var data = {
                acctName: response.data.acctName,
                branchCode: response.data.branchCode
            }
            return data;
        }
    } else if (napasCode) { // kiem tra ngoai he thong
        var response = lib.ESD_HTKT_FUND_TRANSFER_INTEGRATION.checkNameAccountNapas(accountId, napasCode);
        if (response && response.data && response.data.custInfo) {
            var custInfo = response.data.custInfo;
            if (custInfo && custInfo.length > 0 && response.data.custInfo[0].depAcctIdTo &&
                response.data.custInfo[0].depAcctIdTo.refVal) {
                return {acctName: response.data.custInfo[0].depAcctIdTo.refVal};
            }
        }
    }
    return null;
}
