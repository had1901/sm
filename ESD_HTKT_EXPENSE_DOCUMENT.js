/**
 * ScriptLibrary: ESD_HTKT_EXPENSE_DOCUMENT
 * -----------------------------------------------------------------------------
 * Module      : HTKT - Dự chi
 * Version     : 2.1.0
 * 
 * Chức năng   : Quản lý vòng đời bản trình ký PDF (EForm PDF -> ECM Storage -> Versioning).
 * Môi trường  : OpenText Service Manager (JavaScript ES5 Engine).
 * -----------------------------------------------------------------------------
 */

/* =============================================================================
 * 1. CẤU HÌNH & HẰNG SỐ (CONFIG & CONSTANTS)
 * ============================================================================= */

var CONFIG = {
    SERVICE_NAME: "ESD_HTKT_EXPENSE_DOCUMENT",
    SERVICE_VERSION: "2.1.0",
    ATTACHMENT_TABLE: "esdHTKTpaymentAttachment",
    DOCUMENT_CODE: "TRINH_KY",
    /* Gia tri truong type luu tren bang attachment (danh muc loai tai lieu EDMS). */
    DOCUMENT_TYPE: "TL_S6",
    GROUP_PREFIX: "HTKT_DC_TK",
    NAME_PREFIX: "Phieu-de-nghi-du-chi-",
    MAX_SCAN_RECORDS: 500,
    HTTP_TIMEOUT: 300,
    MOCK_STORAGE_BASE_URL: "https://mockapi.smartsolutionvn.com.vn",
    ECM_REQUEST: {
        APP_ID: "NEWTPSS",
        SESSION_ID: "csep_session",
        SOURCE_ID: "DSM",
        DOC_CATEGORY: "File HTKT upload ECM",
        SEQUENCE: 1
    }
};

var STATUS = {
    CURRENT: "CURRENT",
    PREVIOUS: "PREVIOUS",
    COMPLETED: "COMPLETED",
    INVALIDATED: "INVALIDATED"
};


/* =============================================================================
 * 2. PHÂN TÁCH LỚP PHỤ THUỘC & TIỆN ÍCH (INFRASTRUCTURE & HELPERS)
 * ============================================================================= */

function getCommon() {
    return lib.ESD_HTKT_PREPAYMENT_COMMON;
}

function responseOk(data, message) {
    return getCommon().ok(data, message || "Thành công", "OK");
}

function responseFail(code, message, detail, data) {
    return getCommon().fail(
        code || "DOCUMENT_ERROR",
        message || "Có lỗi xảy ra khi xử lý bản trình ký.",
        detail || "",
        data
    );
}

function responseFailException(code, message, error, data) {
    // trưởng thêm: Ghép response lỗi từ các hàm COMMON nền tảng, không phụ thuộc failFromException ở runtime cũ.
    return responseFail(
        code || "DOCUMENT_ERROR",
        message || "Có lỗi xảy ra khi xử lý bản trình ký.",
        getCommon().exceptionToString(error),
        data
    );
}

function assertDependencies(requireEform) {
    if (!lib || !lib.ESD_HTKT_PREPAYMENT_COMMON || typeof lib.ESD_HTKT_PREPAYMENT_COMMON.ok !== "function") {
        throw new Error("Thiếu thư viện ESD_HTKT_PREPAYMENT_COMMON.");
    }
    if (!lib.ESD_ENV_CONFIG || typeof lib.ESD_ENV_CONFIG.getENV !== "function") {
        throw new Error("Thiếu ESD_ENV_CONFIG cho Document Service.");
    }
    var environment = getCommon().toUpper(lib.ESD_ENV_CONFIG.getENV());
    var provider = environment === "SIT" ? "MOCK" : "REAL";
    var storageBaseUrl = provider === "MOCK"
        ? CONFIG.MOCK_STORAGE_BASE_URL
        : (typeof lib.ESD_ENV_CONFIG.esdEcmService === "function" ? lib.ESD_ENV_CONFIG.esdEcmService() : "");
    storageBaseUrl = getCommon().trim(storageBaseUrl).replace(/\/+$/, "");
    if (!storageBaseUrl) {
        throw new Error("Thiếu URL ECM cho môi trường " + environment + ".");
    }

    if (requireEform === true &&
        (!lib.ESD_HTKT_EXPENSE_EFORM_SERVICE || typeof lib.ESD_HTKT_EXPENSE_EFORM_SERVICE.generatePresentationPdf !== "function")) {
        throw new Error("Thiếu thư viện ESD_HTKT_EXPENSE_EFORM_SERVICE.");
    }

    if (provider === "REAL" && (!lib.ESD_ECM_SERVICE ||
        typeof lib.ESD_ECM_SERVICE.uploadFileTaiLieu !== "function" ||
        typeof lib.ESD_ECM_SERVICE.downloadDocument !== "function" ||
        typeof lib.ESD_ECM_SERVICE.deleteDocument !== "function")) {
        throw new Error("Thiếu hoặc sai contract thư viện ESD_ECM_SERVICE (upload/download/delete).");
    }
    return {
        ENVIRONMENT: environment,
        PROVIDER: provider,
        STORAGE_BASE_URL: storageBaseUrl
    };
}

function resolveExpenseId(input) {
    var expenseId = typeof input === "string"
        ? getCommon().trim(input)
        : getCommon().readString(input, ["expenseId", "paymentId", "id"], "");
    if (!expenseId) {
        return responseFail("MISSING_EXPENSE_ID", "Không xác định được mã phiếu Dự chi.", "");
    }
    if (!/^DC\.[A-Za-z0-9._-]+$/.test(expenseId)) {
        return responseFail("INVALID_EXPENSE_ID", "Mã phiếu không thuộc Dự chi.", expenseId);
    }
    return responseOk({ expenseId: expenseId });
}

function resolveCurrentUser(input) {
    // The workflow passes the submitter explicitly. The SM session can already
    // belong to the next approver when this library runs.
    var user = getCommon().readString(input, ["currentUser", "current_user", "uploadedBy", "uploaded_by", "userad"], "");
    if (!user) {
        user = getCommon().getCurrentUser();
    }
    if (!user) {
        return responseFail("MISSING_CURRENT_USER", "Không xác định được người dùng hiện tại.", "Không có user session trong SM.");
    }
    return responseOk({ currentUser: user });
}

function normalizePdfBase64(value) {
    var base64 = getCommon().trim(value);
    var prefix = "data:application/pdf;base64,";
    if (base64.indexOf(prefix) === 0) {
        base64 = base64.substring(prefix.length);
    }
    return base64.replace(/\s/g, "");
}

function isPdfBase64(value) {
    return normalizePdfBase64(value).indexOf("JVBERi0") === 0;
}

function estimatePdfSize(value) {
    var base64 = normalizePdfBase64(value);
    if (!base64) return 0;

    var padding = 0;
    if (base64.substr(base64.length - 2) === "==") padding = 2;
    else if (base64.substr(base64.length - 1) === "=") padding = 1;

    return Math.max(0, Math.floor(base64.length * 3 / 4) - padding);
}


/* =============================================================================
 * 3. TẦNG TÍCH HỢP DOCUMENT STORAGE ADAPTER
 * ============================================================================= */

function parseDocumentStorageResponse(rawResponse) {
    var response = rawResponse;
    var rawResponseText = typeof rawResponse === "string"
        ? rawResponse
        : getCommon().safeStringify(rawResponse, getCommon().toString(rawResponse));
    rawResponseText = getCommon().toString(rawResponseText);
    if (response && response.success === false) {
        return responseFail("DOCUMENT_STORAGE_HTTP_ERROR", response.message || "Không gọi được dịch vụ tài liệu.", getCommon().exceptionToString(response.error), response);
    }

    if (typeof response === "string") {
        // trưởng thêm: Response HTTP của SM ưu tiên parser RTE; fallback COMMON cho object/string thông thường.
        try {
            response = rteJSONParse(rawResponseText);
        } catch (eRteJson) {
            response = getCommon().safeParseJson(rawResponseText, null);
        }
    }
    if (!response || typeof response !== "object") {
        var responsePreview = rawResponseText.substring(0, 300);
        // trưởng thêm: Chỉ trả preview để kiểm tra response, không đưa toàn bộ PDF Base64 vào log.
        return responseFail(
            "DOCUMENT_STORAGE_RESPONSE_INVALID",
            "Dịch vụ tài liệu trả về dữ liệu không hợp lệ.",
            "ResponseLength=" + rawResponseText.length + "; ResponsePreview=" + responsePreview
        );
    }

    var body = response;
    if (response.success === true && response.data && typeof response.data === "object" && (response.data.Code !== undefined || response.data.code !== undefined || response.data.Data !== undefined)) {
        body = response.data;
    }

    var code, data, message;
    if (response.success === true && body === response) {
        code = getCommon().toUpper(response.code || "OK");
        data = response.data;
        message = response.message || "";
    } else {
        // trưởng thêm: ECM thật có thể bọc Data trong success response nhưng không trả Code.
        code = getCommon().toUpper(body.Code || body.code || (response.success === true ? "OK" : ""));
        data = body.Data !== undefined ? body.Data : body.data;
        message = body.Msg || body.msg || body.message || response.message || "";
    }

    return responseOk({ code: code, message: message, data: data, raw: body });
}

function postDocumentJson(url, payload) {
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Accept", "application/json")
    ];

    // trưởng thêm: Gọi HTTP trực tiếp để nhận raw body cho upload/download/delete mock.
    var responseBody = doHTTPRequest(
        "POST",
        getCommon().toString(url),
        headers,
        rteJSONStringify(payload),
        CONFIG.HTTP_TIMEOUT,
        CONFIG.HTTP_TIMEOUT,
        CONFIG.HTTP_TIMEOUT
    );

    var responseText = getCommon().toString(responseBody);

    // trưởng thêm: Mockoon SIT trả JSON có trailing comma; làm sạch trước khi parse.
    return responseText.replace(/,\s*([}\]])/g, "$1");
}

// Chọn ECM hoặc mock theo môi trường của Dự chi.
function uploadDocument(input) {
    try {
        var environmentConfig = assertDependencies(false);
        var provider = getCommon().toUpper(environmentConfig.PROVIDER);
        var expenseId = getCommon().trim(input.expenseId);
        var cifNum = getCommon().trim(input.cifNum) || expenseId;
        var accNum = getCommon().trim(input.accNum) || expenseId;
        var rawResponse;

        if (provider === "MOCK") {
            rawResponse = postDocumentJson(environmentConfig.STORAGE_BASE_URL + "/CDM/service/document/upload", {
                fileName: input.fileName,
                content: input.pdfBase64
            });
        }
        else {
            rawResponse = lib.ESD_ECM_SERVICE.uploadFileTaiLieu({
                docCat: CONFIG.ECM_REQUEST.DOC_CATEGORY,
                docName: input.documentName,
                cifNum: cifNum,
                accNum: accNum,
                docCreated: getCommon().getSystemDateTime(),
                sourceId: CONFIG.ECM_REQUEST.SOURCE_ID,
                sessionId: CONFIG.ECM_REQUEST.SESSION_ID,
                appId: CONFIG.ECM_REQUEST.APP_ID,
                fileBytes: input.pdfBase64,
                fileName: input.fileName,
                seq: CONFIG.ECM_REQUEST.SEQUENCE
            });
        }

        var parsed = parseDocumentStorageResponse(rawResponse);
        if (parsed.success !== true) return parsed;

        var responseData = parsed.data;
        var list = responseData.data;
        if (responseData.code !== "OK" || !getCommon().isArray(list) || !list.length) {
            var rawUploadResponse = getCommon().safeStringify(responseData.raw, "");
            if (rawUploadResponse.length > 300) {
                rawUploadResponse = rawUploadResponse.substring(0, 300);
            }
            return responseFail(
                "DOCUMENT_UPLOAD_FAILED",
                responseData.message || "Upload bản trình ký thất bại.",
                "Code=" + responseData.code + "; Response=" + rawUploadResponse,
                responseData
            );
        }

        var item = list[0] || {};
        var uploadedDocId = getCommon().trim(item.DocId || item.docId);
        var uploadedObjectId = getCommon().trim(item.ObjectId || item.objectId);
        if (!uploadedDocId || !uploadedObjectId) {
            return responseFail("DOCUMENT_UPLOAD_ID_MISSING", "ECM không trả đủ Doc ID và Object ID.", "", responseData.raw);
        }
        return responseOk({
            docId: uploadedDocId,
            objectId: uploadedObjectId,
            docName: getCommon().trim(item.DocName || item.docName),
            sequence: getCommon().toNumber(item.Seq !== undefined ? item.Seq : item.seq, CONFIG.ECM_REQUEST.SEQUENCE)
        }, "Upload bản trình ký thành công.");
    } catch (error) {
        return responseFailException("DOCUMENT_UPLOAD_EXCEPTION", "Có lỗi khi upload bản trình ký.", error);
    }
}

// Download theo ObjectId bằng contract ECM thật.
function downloadDocument(documentIdentity) {
    documentIdentity = documentIdentity || {};

    try {
        var environmentConfig = assertDependencies(false);
        var provider = getCommon().toUpper(environmentConfig.PROVIDER);
        var rawResponse;

        if (provider === "MOCK") {
            rawResponse = postDocumentJson(environmentConfig.STORAGE_BASE_URL + "/CDM/service/document/download", {
                documentId: getCommon().trim(documentIdentity.docId) || getCommon().trim(documentIdentity.objectId)
            });
        }
        else {
            rawResponse = lib.ESD_ECM_SERVICE.downloadDocument([{
                DOC_OBJECTID: String(documentIdentity.objectId || documentIdentity.docId || ""),
                APP_ID: CONFIG.ECM_REQUEST.APP_ID,
                SESSION_ID: CONFIG.ECM_REQUEST.SESSION_ID
            }]);
        }

        var parsed = parseDocumentStorageResponse(rawResponse);
        if (parsed.success !== true) return parsed;

        var responseData = parsed.data;
        var dataObject = responseData.data;
        if (getCommon().isArray(dataObject) && dataObject.length) dataObject = dataObject[0];
        if (responseData.code !== "OK" || !dataObject || typeof dataObject !== "object") {
            return responseFail("DOCUMENT_DOWNLOAD_FAILED", responseData.message || "Tải bản trình ký thất bại.", "", responseData);
        }

        var fileName = "";
        var pdfBase64 = "";
        for (var key in dataObject) {
            // trưởng thêm: rteJSONParse có thể trả giá trị dạng RTE/Java String thay vì native string.
            var value = normalizePdfBase64(getCommon().toString(dataObject[key]));
            if (isPdfBase64(value)) {
                fileName = key;
                pdfBase64 = value;
                break;
            }
        }

        if (!pdfBase64) {
            return responseFail("DOCUMENT_PDF_NOT_FOUND", "Response không chứa PDF Base64 hợp lệ.", "", responseData);
        }

        return responseOk({
            docId: getCommon().trim(documentIdentity.docId),
            objectId: getCommon().trim(documentIdentity.objectId),
            fileName: fileName,
            mimeType: "application/pdf",
            encoding: "base64",
            size: estimatePdfSize(pdfBase64),
            pdfBase64: pdfBase64
        }, "Tải bản trình ký thành công.");
    } catch (error) {
        return responseFailException("DOCUMENT_DOWNLOAD_EXCEPTION", "Có lỗi khi tải bản trình ký.", error, documentIdentity);
    }
}

// Delete theo DocId bằng contract ECM thật.
function deleteStoredDocument(docId) {
    var safeDocId = getCommon().trim(docId);
    if (!safeDocId) {
        return responseFail("MISSING_DOCUMENT_ID", "Thiếu Doc ID cần xóa.", "");
    }

    try {
        var environmentConfig = assertDependencies(false);
        var provider = getCommon().toUpper(environmentConfig.PROVIDER);
        var rawResponse;

        if (provider === "MOCK") {
            rawResponse = postDocumentJson(
                environmentConfig.STORAGE_BASE_URL + "/CDM/service/document/delete",
                { documentId: safeDocId }
            );
        }
        else {
            rawResponse = lib.ESD_ECM_SERVICE.deleteDocument([{
                DOC_ID: safeDocId,
                APP_ID: CONFIG.ECM_REQUEST.APP_ID,
                SESSION_ID: CONFIG.ECM_REQUEST.SESSION_ID
            }]);
        }

        var parsed = parseDocumentStorageResponse(rawResponse);
        if (parsed.success !== true) return parsed;

        var responseData = parsed.data;
        var code = responseData.code;
        var message = responseData.message;
        var messageLower = message.toLowerCase();

        if (code === "ORA" || code === "OK" || code === "00") {
            return responseOk({
                docId: safeDocId,
                deleted: true,
                alreadyAbsent: false,
                provider: provider,
                storageResponse: responseData.raw
            }, "Xóa tài liệu thành công.");
        }

        var absent =
            code === "NOT_FOUND" ||
            code === "DOCUMENT_NOT_FOUND" ||
            (code === "404" && (
                messageLower.indexOf("not found") >= 0 ||
                messageLower.indexOf("không tồn tại") >= 0 ||
                messageLower.indexOf("khong ton tai") >= 0
            ));

        if (absent) {
            return responseOk({
                docId: safeDocId,
                deleted: true,
                alreadyAbsent: true,
                provider: provider,
                storageResponse: responseData.raw
            }, "Tài liệu đã không còn tồn tại trên hệ thống lưu trữ.");
        }

        return responseFail(
            "DOCUMENT_DELETE_FAILED",
            message || "Hệ thống lưu trữ từ chối xóa tài liệu.",
            "Code=" + code + "; DocId=" + safeDocId,
            responseData.raw
        );

    } catch (error) {
        return responseFailException(
            "DOCUMENT_DELETE_EXCEPTION",
            "Có lỗi khi xóa tài liệu.",
            error,
            { docId: safeDocId }
        );
    }
}


/* =============================================================================
 * 4. TẦNG TRUY VẤN DỮ LIỆU (ATTACHMENT REPOSITORY)
 * ============================================================================= */

function mapAttachment(file) {
    if (!file) return null;
    return {
        id: getCommon().readString(file, ["id"], ""),
        expenseId: getCommon().readString(file, ["payment.id"], ""),
        ecmDocId: getCommon().readString(file, ["ecm.doc.id"], ""),
        ecmObjectId: getCommon().readString(file, ["ecm.object.id"], ""),
        name: getCommon().readString(file, ["name"], ""),
        uploadedBy: getCommon().readString(file, ["uploaded.by"], ""),
        uploadedAt: getCommon().readValue(file, ["uploaded.at"], null),
        size: getCommon().toNumber(getCommon().readValue(file, ["size"], 0), 0),
        docCode: getCommon().readString(file, ["doc.code"], ""),
        groupCode: getCommon().readString(file, ["group.code"], ""),
        status: getCommon().toUpper(getCommon().readString(file, ["status"], "")),
        type: getCommon().readString(file, ["type"], ""),
        versionNo: getCommon().toNumber(getCommon().readValue(file, ["version.no"], 0), 0)
    };
}

function generateAttachmentId() {
    try {
        if (lib.ESD_Utils && typeof lib.ESD_Utils.generateNextNumber === "function") {
            return getCommon().trim(lib.ESD_Utils.generateNextNumber(CONFIG.ATTACHMENT_TABLE));
        }
    } catch (ignore) { }
    return getCommon().generateRequestId("HTKT_ATT");
}

function selectAttachmentById(attachmentId, readOnly) {
    var safeId = getCommon().trim(attachmentId);
    if (!safeId) return null;

    var file = null;
    try {
        file = readOnly === true ? getCommon().newReadOnlyFile(CONFIG.ATTACHMENT_TABLE) : new SCFile(CONFIG.ATTACHMENT_TABLE);
        if (file && file.doSelect('id="' + getCommon().escapeQueryValue(safeId) + '"') === RC_SUCCESS) {
            return file;
        }
    } catch (ignore) { }

    getCommon().closeFile(file);
    return null;
}

function listAttachmentsByQuery(queryStr, sortFn) {
    var records = [];
    var file = null;
    var count = 0;

    try {
        file = getCommon().newReadOnlyFile(CONFIG.ATTACHMENT_TABLE);
        var rc = file.doSelect(queryStr);

        while (rc === RC_SUCCESS && count < CONFIG.MAX_SCAN_RECORDS) {
            var mapped = mapAttachment(file);
            if (mapped && mapped.docCode === CONFIG.DOCUMENT_CODE && mapped.type === CONFIG.DOCUMENT_TYPE) {
                records.push(mapped);
            }
            count++;
            rc = file.getNext();
        }
    } catch (error) {
        throw error;
    } finally {
        getCommon().closeFile(file);
    }

    if (typeof sortFn === "function") {
        records.sort(sortFn);
    }
    return records;
}

function listByExpense(expenseId) {
    var safeId = getCommon().trim(expenseId);
    if (!safeId) return [];

    var records = listAttachmentsByQuery(
        'payment.id="' + getCommon().escapeQueryValue(safeId) + '" and type="' + CONFIG.DOCUMENT_TYPE + '"',
        function (a, b) {
            if (a.groupCode !== b.groupCode) return a.groupCode < b.groupCode ? -1 : 1;
            var aTime = getCommon().toString(a.uploadedAt);
            var bTime = getCommon().toString(b.uploadedAt);
            if (aTime !== bTime) return aTime < bTime ? -1 : 1;
            return a.id < b.id ? -1 : 1;
        }
    );

    var versionByGroup = {};
    for (var i = 0; i < records.length; i++) {
        var groupCode = records[i].groupCode;
        versionByGroup[groupCode] = (versionByGroup[groupCode] || 0) + 1;
        records[i].versionNo = versionByGroup[groupCode];
    }
    return records;
}

function listByGroup(groupCode) {
    var safeGroupCode = getCommon().trim(groupCode);
    if (!safeGroupCode) return [];

    var records = listAttachmentsByQuery(
        'group.code="' + getCommon().escapeQueryValue(safeGroupCode) + '" and type="' + CONFIG.DOCUMENT_TYPE + '"',
        function (a, b) {
            var aTime = getCommon().toString(a.uploadedAt);
            var bTime = getCommon().toString(b.uploadedAt);
            if (aTime !== bTime) return aTime < bTime ? -1 : 1;
            return a.id < b.id ? -1 : 1;
        }
    );

    for (var i = 0; i < records.length; i++) {
        records[i].versionNo = i + 1;
    }
    return records;
}

function findActiveAttachments(expenseId) {
    var list = listByExpense(expenseId);
    var active = [];
    for (var i = 0; i < list.length; i++) {
        // Earlier Dự chi rows can have an empty status; they are still the
        // presentation document and must prevent another insert.
        if (!list[i].status || list[i].status === STATUS.CURRENT || list[i].status === STATUS.COMPLETED) {
            active.push(list[i]);
        }
    }
    return active;
}

function findCompletedAttachments(expenseId) {
    var list = listByExpense(expenseId);
    var completed = [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].status === STATUS.COMPLETED) {
            completed.push(list[i]);
        }
    }
    return completed;
}

function getNextVersionNo(groupCode) {
    return listByGroup(groupCode).length + 1;
}

function insertAttachment(input) {
    var attachmentId = getCommon().trim(input.id) || generateAttachmentId();
    var expenseId = getCommon().trim(input.expenseId);
    var objectId = getCommon().trim(input.ecmObjectId);
    var name = getCommon().trim(input.name);
    var uploadedBy = getCommon().trim(input.uploadedBy);
    var groupCode = getCommon().trim(input.groupCode);
    var status = getCommon().toUpper(input.status);
    var versionNo = getCommon().toNumber(input.versionNo, 0);

    if (!expenseId || !objectId || !name || !uploadedBy || !groupCode || !status) {
        return responseFail("ATTACHMENT_INPUT_INVALID", "Không đủ dữ liệu để lưu bản trình ký.", "", input);
    }

    var file = null;
    try {
        file = new SCFile(CONFIG.ATTACHMENT_TABLE);
        file["id"] = attachmentId;
        file["payment.id"] = expenseId;
        file["ecm.doc.id"] = getCommon().trim(input.ecmDocId);
        file["ecm.object.id"] = objectId;
        file["name"] = name;
        file["uploaded.by"] = uploadedBy;
        file["size"] = getCommon().toString(getCommon().toNumber(input.size, 0));
        file["doc.code"] = CONFIG.DOCUMENT_CODE;
        file["group.code"] = groupCode;
        file["uploaded.at"] = input.uploadedAt || getCommon().getSystemDateTime();
        file["status"] = status;
        file["type"] = CONFIG.DOCUMENT_TYPE;
        try { file["version.no"] = versionNo > 0 ? versionNo : 1; } catch (ignoreVersion) { }

        var rc = file.doInsert();
        if (rc !== RC_SUCCESS) {
            return responseFail("ATTACHMENT_INSERT_FAILED", "Không tạo được bản ghi bản trình ký.", "doInsert RC=" + rc, input);
        }

        var inserted = mapAttachment(file);
        inserted.versionNo = versionNo > 0 ? versionNo : 1;
        return responseOk(inserted, "Lưu bản trình ký thành công.");
    } catch (error) {
        return responseFailException("ATTACHMENT_INSERT_EXCEPTION", "Có lỗi khi lưu bản trình ký.", error, input);
    } finally {
        getCommon().closeFile(file);
    }
}

function replaceAttachmentDocument(attachmentId, input) {
    var file = null;
    try {
        file = selectAttachmentById(attachmentId, false);
        if (!file || getCommon().trim(file["payment.id"]) !== getCommon().trim(input.expenseId) ||
            getCommon().trim(file["doc.code"]) !== CONFIG.DOCUMENT_CODE ||
            getCommon().trim(file["type"]) !== CONFIG.DOCUMENT_TYPE) {
            return responseFail("ATTACHMENT_NOT_FOUND", "Không tìm thấy bản trình ký cần ghi đè.", "id=" + attachmentId);
        }
        var previous = mapAttachment(file);
        file["ecm.doc.id"] = getCommon().trim(input.ecmDocId);
        file["ecm.object.id"] = getCommon().trim(input.ecmObjectId);
        file["name"] = getCommon().trim(input.name) || previous.name;
        file["size"] = getCommon().toString(getCommon().toNumber(input.size, 0));
        file["uploaded.by"] = getCommon().trim(input.uploadedBy) || previous.uploadedBy;
        file["uploaded.at"] = getCommon().getSystemDateTime();
        file["status"] = STATUS.CURRENT;
        try { file["version.no"] = (previous.versionNo || 1) + 1; } catch (ignoreVersion) { }
        var rc = file.doUpdate();
        if (rc !== RC_SUCCESS) {
            return responseFail("ATTACHMENT_REPLACE_FAILED", "Không ghi đè được bản trình ký.", "doUpdate RC=" + rc);
        }
        return responseOk({ previousDocument: previous, currentDocument: mapAttachment(file) }, "Đã ghi đè bản trình ký.");
    } catch (error) {
        return responseFailException("ATTACHMENT_REPLACE_EXCEPTION", "Có lỗi khi ghi đè bản trình ký.", error);
    } finally {
        getCommon().closeFile(file);
    }
}

function updateAttachmentStatus(attachmentId, targetStatus) {
    var safeId = getCommon().trim(attachmentId);
    var safeStatus = getCommon().toUpper(targetStatus);

    if (!safeId || !safeStatus) {
        return responseFail("ATTACHMENT_UPDATE_INPUT_INVALID", "Thiếu ID hoặc trạng thái bản trình ký.", "");
    }

    var file = null;
    try {
        file = selectAttachmentById(safeId, false);
        if (!file) {
            return responseFail("ATTACHMENT_NOT_FOUND", "Không tìm thấy bản trình ký cần cập nhật.", "id=" + safeId);
        }

        file["status"] = safeStatus;
        var rc = file.doUpdate();
        if (rc !== RC_SUCCESS) {
            return responseFail("ATTACHMENT_UPDATE_FAILED", "Không cập nhật được trạng thái bản trình ký.", "doUpdate RC=" + rc, { id: safeId, status: safeStatus });
        }

        return responseOk(mapAttachment(file), "Cập nhật trạng thái bản trình ký thành công.");
    } catch (error) {
        return responseFailException("ATTACHMENT_UPDATE_EXCEPTION", "Có lỗi khi cập nhật trạng thái bản trình ký.", error, { id: safeId, status: safeStatus });
    } finally {
        getCommon().closeFile(file);
    }
}

/*
 * Xóa vật lý một bản ghi attachment trong SM.
 * Hàm này chỉ xóa metadata trong bảng attach, không xóa tài liệu trên ECM.
 */
function deleteAttachmentRecord(attachmentId) {
    var safeId = getCommon().trim(attachmentId);
    if (!safeId) {
        return responseFail("ATTACHMENT_DELETE_INPUT_INVALID", "Thiếu ID bản trình ký cần xóa.", "");
    }

    var file = null;
    try {
        file = selectAttachmentById(safeId, false);
        if (!file) {
            return responseOk({
                id: safeId,
                deleted: false,
                alreadyAbsent: true,
                attachment: null
            }, "Bản ghi attachment đã không còn tồn tại.");
        }

        var attachment = mapAttachment(file);
        var rc = file.doDelete();
        if (rc !== RC_SUCCESS && rc !== true) {
            return responseFail(
                "ATTACHMENT_DELETE_FAILED",
                "Không xóa được bản ghi phiếu in chưa ký trong bảng attachment.",
                "doDelete RC=" + rc,
                attachment
            );
        }

        return responseOk({
            id: safeId,
            deleted: true,
            alreadyAbsent: false,
            attachment: attachment
        }, "Đã xóa bản ghi phiếu in chưa ký trong bảng attachment.");
    } catch (error) {
        return responseFailException(
            "ATTACHMENT_DELETE_EXCEPTION",
            "Có lỗi khi xóa bản ghi phiếu in chưa ký trong bảng attachment.",
            error,
            { id: safeId }
        );
    } finally {
        getCommon().closeFile(file);
    }
}

function restoreAttachmentRecord(attachment) {
    attachment = attachment || {};
    return insertAttachment({
        id: attachment.id,
        expenseId: attachment.expenseId,
        ecmDocId: attachment.ecmDocId,
        ecmObjectId: attachment.ecmObjectId,
        name: attachment.name,
        uploadedBy: attachment.uploadedBy,
        uploadedAt: attachment.uploadedAt,
        size: attachment.size,
        groupCode: attachment.groupCode,
        status: attachment.status,
        versionNo: attachment.versionNo
    });
}

/* =============================================================================
 * 5. PUBLIC API SERVICES (CÁC HÀM CUNG CẤP CHO BÊN NGOÀI GỌI)
 * ============================================================================= */

function getDocumentConfig() {
    try {
        var environmentConfig = assertDependencies(false);
        return responseOk({
            serviceName: CONFIG.SERVICE_NAME,
            serviceVersion: CONFIG.SERVICE_VERSION,
            commonVersion: getCommon().getVersion(),
            attachmentTable: CONFIG.ATTACHMENT_TABLE,
            documentCode: CONFIG.DOCUMENT_CODE,
            documentType: CONFIG.DOCUMENT_TYPE,
            statuses: STATUS,
            fields: {
                expenseId: "payment.id",
                ecmDocId: "ecm.doc.id",
                ecmObjectId: "ecm.object.id",
                uploadedBy: "uploaded.by",
                uploadedAt: "uploaded.at",
                docCode: "doc.code",
                groupCode: "group.code",
                status: "status",
                type: "type"
            },
            storageProvider: getCommon().toUpper(environmentConfig.PROVIDER)
        }, "Đã lấy cấu hình quản lý bản trình ký.");
    } catch (error) {
        return responseFailException("DOCUMENT_DEPENDENCY_ERROR", "Không khởi tạo được DOCUMENT Service.", error);
    }
}

function getCurrentPresentation(input) {
    var idRes = resolveExpenseId(input);
    if (idRes.success !== true) return idRes;

    var activeList;
    try {
        activeList = findActiveAttachments(idRes.data.expenseId);
    } catch (error) {
        return responseFailException("ATTACHMENT_QUERY_FAILED", "Không truy vấn được bản trình ký Dự chi.", error);
    }
    if (!activeList.length) {
        return responseFail("DOCUMENT_NOT_FOUND", "Phiếu chưa có bản trình ký hiện hành.", "expenseId=" + idRes.data.expenseId);
    }
    if (activeList.length > 1) {
        return responseFail("DOCUMENT_CURRENT_CONFLICT", "Phiếu đang có nhiều hơn một bản trình ký hiện hành.", "", activeList);
    }
    if (!activeList[0].status) {
        var repaired = updateAttachmentStatus(activeList[0].id, STATUS.CURRENT);
        if (repaired.success !== true) return repaired;
        activeList[0] = repaired.data;
        activeList[0].status = STATUS.CURRENT;
    }
    return responseOk(activeList[0], "Đã lấy bản trình ký hiện hành.");
}

function getPresentationByAttachmentId(input) {
    var attachmentId = getCommon().readString(input, ["attachmentId", "attachment_id", "id"], "");
    if (!attachmentId) {
        return responseFail("MISSING_ATTACHMENT_ID", "Thiếu ID bản trình ký.", "");
    }

    var file = selectAttachmentById(attachmentId, true);
    if (!file) {
        return responseFail("ATTACHMENT_NOT_FOUND", "Không tìm thấy bản trình ký.", "id=" + attachmentId);
    }

    var record = mapAttachment(file);
    getCommon().closeFile(file);

    return responseOk(record, "Đã lấy thông tin bản trình ký.");
}

function listPresentationCycle(input) {
    var groupCode = getCommon().readString(input, ["groupCode", "group_code", "group.code"], "");
    if (!groupCode) {
        var currentRes = getCurrentPresentation(input);
        if (currentRes.success !== true) return currentRes;
        groupCode = currentRes.data.groupCode;
    }

    return responseOk({
        groupCode: groupCode,
        documents: listByGroup(groupCode)
    }, "Đã lấy các phiên bản trong vòng trình ký.");
}

function verifyPdfObject(input) {
    var docId = getCommon().readString(input, ["docId", "doc_id", "ecmDocId", "ecm_doc_id", "DOC_ID"], "");
    var objectId = getCommon().readString(input, ["objectId", "object_id", "ecmObjectId", "ecm_object_id", "DOC_OBJECTID"], "");
    if (!docId && !objectId) {
        return responseFail("MISSING_DOCUMENT_ID", "Thiếu Doc ID/Object ID cần kiểm tra.", "");
    }

    var downloadRes = downloadDocument({ docId: docId, objectId: objectId });
    if (downloadRes.success !== true) return downloadRes;

    return responseOk({
        docId: docId,
        objectId: objectId,
        validPdf: true,
        fileName: downloadRes.data.fileName,
        mimeType: downloadRes.data.mimeType,
        encoding: downloadRes.data.encoding,
        size: downloadRes.data.size,
        pdfBase64Length: downloadRes.data.pdfBase64.length
    }, "Tài liệu lưu trữ chứa PDF hợp lệ.");
}

function downloadPresentation(input) {
    var docId = getCommon().readString(input, ["docId", "doc_id", "ecmDocId", "ecm_doc_id", "DOC_ID"], "");
    var objectId = getCommon().readString(input, ["objectId", "object_id", "ecmObjectId", "ecm_object_id", "DOC_OBJECTID"], "");
    var docRecord = null;

    if (!docId && !objectId) {
        var currentRes = getCurrentPresentation(input);
        if (currentRes.success !== true) return currentRes;
        docRecord = currentRes.data;
        docId = docRecord.ecmDocId;
        objectId = docRecord.ecmObjectId;
    }

    var downloadRes = downloadDocument({ docId: docId, objectId: objectId });
    if (downloadRes.success !== true) return downloadRes;

    return responseOk({
        document: docRecord,
        docId: docId,
        objectId: objectId,
        fileName: downloadRes.data.fileName,
        mimeType: downloadRes.data.mimeType,
        encoding: downloadRes.data.encoding,
        size: downloadRes.data.size,
        pdfBase64: downloadRes.data.pdfBase64
    }, "Tải bản trình ký thành công.");
}

// trưởng thêm: Public action getFileECM cho màn ký, lấy đúng bản trình ký hiện hành từ attachment.
function get_file_ecm_HTKT_Expense(file) {
    try {
        var input = file || {};
        var queryString = getCommon().readString(input, ["queryString"], "");
        if (queryString) {
            input = getCommon().safeParseJson(queryString, input);
        }

        var idRes = resolveExpenseId(input);
        if (idRes.success !== true) return idRes;

        var currentRes = getCurrentPresentation({ expenseId: idRes.data.expenseId });
        if (currentRes.success !== true) return currentRes;
        var currentDocument = currentRes.data;
        var downloadRes = downloadDocument({
            docId: currentDocument.ecmDocId,
            objectId: currentDocument.ecmObjectId
        });
        if (downloadRes.success !== true) return downloadRes;

        var fileData = {};
        // trưởng thêm: Nội dung lấy từ key hehe.pdf của Mockoon, tên hiển thị lấy từ attachment DB.
        fileData[currentDocument.name || downloadRes.data.fileName] = downloadRes.data.pdfBase64;

        return {
            success: true,
            message: "Đã lấy bản trình ký hiện hành.",
            data: {
                Data: fileData
            },
            params: [{
                ATTACHMENT_ID: currentDocument.id,
                DOC_ID: currentDocument.ecmDocId,
                DOC_OBJECTID: currentDocument.ecmObjectId,
                APP_ID: CONFIG.ECM_REQUEST.APP_ID,
                SESSION_ID: CONFIG.ECM_REQUEST.SESSION_ID
            }],
            status: currentDocument.status === STATUS.COMPLETED,
            attachment: currentDocument
        };
    } catch (error) {
        return responseFailException("GET_FILE_ECM_EXCEPTION", "Có lỗi khi lấy bản trình ký từ ECM.", error);
    }
}

function uploadPresentationPdf(input) {
    input = input || {};
    var idRes = resolveExpenseId(input);
    var userRes = resolveCurrentUser(input);
    if (idRes.success !== true) return idRes;
    if (userRes.success !== true) return userRes;

    var expenseId = idRes.data.expenseId;
    var pdfBase64 = normalizePdfBase64(getCommon().readString(input, ["pdfBase64", "pdf_base64", "fileBytes"], ""));

    if (!isPdfBase64(pdfBase64)) {
        return responseFail("INVALID_PDF_BASE64", "Nội dung truyền vào không phải PDF Base64 hợp lệ.", "Bắt buộc bắt đầu bằng JVBERi0.");
    }

    var fileName = getCommon().sanitizeFileName(getCommon().readString(input, ["fileName", "file_name", "name"], CONFIG.NAME_PREFIX + expenseId + ".pdf"));
    if (!/\.pdf$/i.test(fileName)) fileName += ".pdf";

    var uploadRes = uploadDocument({
        expenseId: expenseId,
        documentName: getCommon().readString(input, ["documentName", "document_name"], "Phiếu dự chi - " + expenseId),
        fileName: fileName,
        pdfBase64: pdfBase64,
        cifNum: getCommon().readString(input, ["cifNum"], expenseId),
        accNum: getCommon().readString(input, ["accNum"], expenseId)
    });
    if (uploadRes.success !== true) return uploadRes;

    // trưởng thêm: Chuyển phase upload ECM
    return responseOk({
        expenseId: expenseId,
        uploadedBy: userRes.data.currentUser,
        fileName: fileName,
        ecmDocId: uploadRes.data.docId,
        ecmObjectId: uploadRes.data.objectId,
        size: estimatePdfSize(pdfBase64),
        mimeType: "application/pdf",
        encoding: "base64"
    }, "Upload bản trình ký thành công.");
}

function generateAndUploadPresentation(input) {
    input = input || {};
    var idRes = resolveExpenseId(input);
    var userRes = resolveCurrentUser(input);
    if (idRes.success !== true) return idRes;
    if (userRes.success !== true) return userRes;

    var expenseId = idRes.data.expenseId;
    var activeList;
    try {
        // A returned/invalidated cycle still owns its attachment row. Reuse
        // it so one Dự chi ticket cannot accumulate TRINH_KY records.
        activeList = listByExpense(expenseId);
    } catch (error) {
        return responseFailException("ATTACHMENT_QUERY_FAILED", "Không truy vấn được bản trình ký Dự chi.", error);
    }

    if (activeList.length > 1) {
        return responseFail("DOCUMENT_CURRENT_CONFLICT", "Phiếu đang có nhiều hơn một bản trình ký hiện hành.", "", activeList);
    }
    if (activeList.length === 1 && activeList[0].status === STATUS.COMPLETED) {
        return responseFail("DOCUMENT_ALREADY_COMPLETED", "Bản trình ký đã hoàn tất, không thể sinh lại.", "", activeList[0]);
    }

    var genRes;
    try {
        if (!lib.ESD_HTKT_EXPENSE_EFORM_SERVICE ||
            typeof lib.ESD_HTKT_EXPENSE_EFORM_SERVICE.generatePresentationPdf !== "function") {
            return responseFail(
                "EFORM_SERVICE_MISSING",
                "Chưa có ScriptLibrary ESD_HTKT_EXPENSE_EFORM_SERVICE hoặc hàm generatePresentationPdf trên SM.",
                "expenseId=" + expenseId
            );
        }
        genRes = lib.ESD_HTKT_EXPENSE_EFORM_SERVICE.generatePresentationPdf({
            paymentId: expenseId,
            useCache: false,
            forceRegenerate: true,
            includeTemplateData: false
        });
    } catch (error) {
        var errorDetail = getCommon().exceptionToString(error);
        return responseFail(
            "EFORM_GENERATE_CALL_EXCEPTION",
            "Không gọi được EFORM Service để sinh PDF." +
                (errorDetail ? " Chi tiết: " + errorDetail.substring(0, 300) : ""),
            errorDetail,
            { expenseId: expenseId }
        );
    }

    if (!genRes || genRes.success !== true) {
        return responseFail("EFORM_GENERATE_FAILED", genRes && genRes.message ? genRes.message : "Không sinh được PDF bản trình ký.", genRes && genRes.detail ? genRes.detail : "", genRes ? genRes.data : null);
    }

    var genData = genRes.data || {};
    var uploadRes = uploadPresentationPdf({
        expenseId: expenseId,
        currentUser: userRes.data.currentUser,
        pdfBase64: genData.pdfBase64,
        fileName: genData.fileName,
        documentName: "Phiếu dự chi - " + expenseId
    });
    if (uploadRes.success !== true) return uploadRes;

    var groupCode = activeList.length ? activeList[0].groupCode : getCommon().generateRequestId(CONFIG.GROUP_PREFIX);
    var attachmentInput = {
        expenseId: expenseId,
        ecmDocId: uploadRes.data.ecmDocId,
        ecmObjectId: uploadRes.data.ecmObjectId,
        name: uploadRes.data.fileName,
        uploadedBy: userRes.data.currentUser,
        size: uploadRes.data.size,
        groupCode: groupCode,
        status: STATUS.CURRENT,
        versionNo: 1
    };
    var insertRes = activeList.length
        ? replaceAttachmentDocument(activeList[0].id, attachmentInput)
        : insertAttachment(attachmentInput);

    if (insertRes.success !== true) {
        return responseFail("ATTACHMENT_SAVE_AFTER_UPLOAD_FAILED", "Đã upload PDF lên ECM nhưng không lưu được bản trình ký.", insertRes.message, {
            ecmDocId: uploadRes.data.ecmDocId,
            ecmObjectId: uploadRes.data.ecmObjectId,
            cleanupRecommended: true,
            attachmentError: insertRes
        });
    }

    var verified = getCurrentPresentation({ expenseId: expenseId });
    if (verified.success !== true || !verified.data ||
        verified.data.ecmDocId !== uploadRes.data.ecmDocId ||
        verified.data.ecmObjectId !== uploadRes.data.ecmObjectId) {
        return responseFail(
            "ATTACHMENT_NOT_VISIBLE_AFTER_UPLOAD",
            "Đã upload ECM nhưng không đọc lại được bản trình ký vừa lưu trong SM.",
            verified.message || "ECM ID trong attachment không khớp kết quả upload.",
            { expenseId: expenseId, ecmDocId: uploadRes.data.ecmDocId, ecmObjectId: uploadRes.data.ecmObjectId }
        );
    }
    var document = verified.data;
    var cleanupPending = false;
    if (activeList.length && activeList[0].ecmDocId &&
        activeList[0].ecmDocId !== uploadRes.data.ecmDocId) {
        cleanupPending = deleteStoredDocument(activeList[0].ecmDocId).success !== true;
    }

    return responseOk({
        expenseId: expenseId,
        groupCode: groupCode,
        document: document,
        cleanupPending: cleanupPending,
        generated: {
            templateId: genData.templateId,
            templateCode: genData.templateCode,
            mimeType: genData.mimeType,
            encoding: genData.encoding,
            fromCache: genData.fromCache === true
        }
    }, "Sinh và lưu bản trình ký thành công.");
}

/* Upload the signed PDF and replace the existing attachment in place. */
function addFileECM_HTKT_Expense(file) {
    try {
        file = file || {};
        var currentRes = getCurrentPresentation(file);
        if (currentRes.success !== true) return currentRes;

        var oldDocument = currentRes.data;
        var expenseId = oldDocument.expenseId;
        var newObjectId = getCommon().trim(file.newObjectId);
        if (!newObjectId) return responseFail("MISSING_SIGNED_OBJECT_ID", "Thiếu Object ID của bản đã ký.", "");
        if (getCommon().trim(file.oldObjectId) &&
            getCommon().trim(file.oldObjectId) !== oldDocument.ecmObjectId) {
            return responseOk({ idempotent: true, currentDocument: oldDocument }, "Bản ký đã được cập nhật trước đó.");
        }
        if (newObjectId === oldDocument.ecmObjectId) {
            return responseOk({ idempotent: true, currentDocument: oldDocument }, "Bản ký đã được cập nhật trước đó.");
        }
        var signedFile = downloadDocument({ objectId: file.newObjectId });
        if (signedFile.success !== true) return signedFile;

        var uploadRes = uploadDocument({
            expenseId: expenseId,
            documentName: file.documentName || "Phiếu dự chi - " + expenseId,
            cifNum: file.cifNum || expenseId,
            accNum: file.accNum || expenseId,
            pdfBase64: signedFile.data.pdfBase64,
            fileName: oldDocument.name
        });
        if (uploadRes.success !== true) return uploadRes;

        var replaceRes = replaceAttachmentDocument(oldDocument.id, {
            expenseId: expenseId,
            ecmDocId: uploadRes.data.docId,
            ecmObjectId: uploadRes.data.objectId,
            name: oldDocument.name,
            // Keep the original submitter as the document uploader.
            uploadedBy: oldDocument.uploadedBy,
            size: signedFile.data.size,
            groupCode: oldDocument.groupCode
        });
        if (replaceRes.success !== true) {
            return responseFail("SIGNED_ATTACHMENT_REPLACE_FAILED", "Đã upload bản ký nhưng không ghi đè được attachment.", replaceRes.message, {
                uploadedDocument: uploadRes.data,
                cleanupRecommended: true
            });
        }

        var cleanupPending = false;
        if (oldDocument.ecmDocId && oldDocument.ecmDocId !== uploadRes.data.docId) {
            cleanupPending = deleteStoredDocument(oldDocument.ecmDocId).success !== true;
        }

        return responseOk({
            cleanupPending: cleanupPending,
            previousDocument: oldDocument,
            currentDocument: replaceRes.data.currentDocument,
            signedSource: signedFile.data,
            uploadedDocument: uploadRes.data
        }, "Đã upload ECM và ghi đè attachment có chữ ký.");
    } catch (err) {
        return responseFail("SIGNED_ADD_FAILED", "That bai: " + err, "");
    }
}
/* Legacy second step: cleanup now happens in addFileECM_HTKT_Expense. */
function deleteFileECM_HTKT_Expense(input) {
    var currentRes = getCurrentPresentation(input);
    if (currentRes.success !== true) return currentRes;
    return responseOk({ currentAttachmentId: currentRes.data.id, alreadyHandled: true }, "Bản trình ký đã được cập nhật trên cùng attachment.");
}

/* Workflow API: replace the single attachment, then clean up old ECM data. */
function replaceCurrentVersion(input) {
    return addFileECM_HTKT_Expense(input);
}

function markCurrentPresentationCompleted(input) {
    var currentRes = getCurrentPresentation(input);
    if (currentRes.success !== true) return currentRes;

    var currentDoc = currentRes.data;
    if (currentDoc.status === STATUS.COMPLETED) {
        return responseOk({ idempotent: true, document: currentDoc }, "Bản trình ký đã hoàn tất trước đó.");
    }
    if (currentDoc.status !== STATUS.CURRENT) {
        return responseFail("DOCUMENT_NOT_COMPLETABLE", "Bản trình ký hiện hành không thể đánh dấu hoàn tất.", "status=" + currentDoc.status, currentDoc);
    }

    var updateRes = updateAttachmentStatus(currentDoc.id, STATUS.COMPLETED);
    if (updateRes.success !== true) return updateRes;

    return responseOk({ idempotent: false, document: updateRes.data }, "Đã đánh dấu bản trình ký hoàn tất.");
}

function invalidateCurrentCycle(input) {
    input = input || {};
    var idRes = resolveExpenseId(input);
    if (idRes.success !== true) return idRes;

    var expenseId = idRes.data.expenseId;
    var activeList = findActiveAttachments(expenseId);

    if (!activeList.length) {
        /* Dọn các bản ghi đã xóa ECM nhưng còn sót trong DB từ luồng cũ. */
        var staleList = listByExpense(expenseId);
        var staleDeleted = [];
        for (var staleIndex = 0; staleIndex < staleList.length; staleIndex++) {
            var staleDocument = staleList[staleIndex];
            if (
                staleDocument.status === STATUS.INVALIDATED &&
                !getCommon().trim(staleDocument.ecmDocId) &&
                !getCommon().trim(staleDocument.ecmObjectId)
            ) {
                var staleDeleteRes = deleteAttachmentRecord(staleDocument.id);
                if (staleDeleteRes.success !== true) return staleDeleteRes;
                staleDeleted.push(staleDeleteRes.data);
            }
        }

        return responseOk({
            idempotent: staleDeleted.length === 0,
            expenseId: expenseId,
            groupCode: "",
            hardDeletedCount: 0,
            deletedAttachmentCount: staleDeleted.length,
            documents: staleDeleted
        }, staleDeleted.length
            ? "Đã xóa các attachment không còn liên kết ECM khỏi DB."
            : "Phiếu không còn vòng trình ký hiệu lực cần xóa.");
    }
    if (activeList.length > 1) {
        return responseFail(
            "DOCUMENT_CURRENT_CONFLICT",
            "Phiếu đang có nhiều hơn một bản trình ký hiện hành.",
            "",
            activeList
        );
    }

    var groupCode = activeList[0].groupCode;
    var cycleRecords = listByGroup(groupCode);
    if (!cycleRecords.length) {
        return responseFail(
            "DOCUMENT_CYCLE_NOT_FOUND",
            "Không tìm thấy vòng trình ký hiện hành.",
            "groupCode=" + groupCode
        );
    }

    /*
     * Xóa version cũ trước, CURRENT/COMPLETED cuối cùng.
     * Nếu có lỗi giữa chừng, bản hiện hành vẫn còn để lần retry xác định đúng group.code.
     */
    cycleRecords.sort(function (a, b) {
        var aActive = a.status === STATUS.CURRENT || a.status === STATUS.COMPLETED ? 1 : 0;
        var bActive = b.status === STATUS.CURRENT || b.status === STATUS.COMPLETED ? 1 : 0;
        if (aActive !== bActive) return aActive - bActive;
        return a.versionNo - b.versionNo;
    });

    var updated = [];
    var deletedDocIds = {};
    var hardDeletedCount = 0;

    for (var i = 0; i < cycleRecords.length; i++) {
        var document = cycleRecords[i];
        var docId = getCommon().trim(document.ecmDocId);
        var objectId = getCommon().trim(document.ecmObjectId);

        /* Retry-safe cho bản ghi còn sót từ luồng cũ: ECM đã xóa thì chỉ xóa DB. */
        if (!docId && !objectId && document.status === STATUS.INVALIDATED) {
            var staleCycleDeleteRes = deleteAttachmentRecord(document.id);
            if (staleCycleDeleteRes.success !== true) return staleCycleDeleteRes;
            updated.push(staleCycleDeleteRes.data);
            continue;
        }

        if (!docId) {
            return responseFail(
                "ECM_DOC_ID_REQUIRED_FOR_DELETE",
                "Không thể xóa cứng tài liệu vì attachment không có ECM Doc ID.",
                "attachmentId=" + document.id + "; objectId=" + objectId,
                {
                    expenseId: expenseId,
                    groupCode: groupCode,
                    processedDocuments: updated,
                    failedDocument: document
                }
            );
        }

        /* Một Doc ID có thể được dùng cho nhiều Object ID/version ký. Chỉ gọi delete một lần. */
        if (!deletedDocIds[docId]) {
            var deleteRes = deleteStoredDocument(docId);
            if (deleteRes.success !== true) {
                return responseFail(
                    "DOCUMENT_HARD_DELETE_FAILED",
                    deleteRes.message || "Không xóa được tài liệu trên ECM.",
                    deleteRes.detail || "",
                    {
                        expenseId: expenseId,
                        groupCode: groupCode,
                        processedDocuments: updated,
                        failedDocument: document,
                        ecmDeleteResult: deleteRes.data
                    }
                );
            }
            deletedDocIds[docId] = true;
            hardDeletedCount++;
        }

        var deleteAttachmentRes = deleteAttachmentRecord(document.id);
        if (deleteAttachmentRes.success !== true) {
            return responseFail(
                "DOCUMENT_HARD_DELETE_DB_FAILED",
                deleteAttachmentRes.message || "Đã xóa ECM nhưng không xóa được attachment trong SM.",
                deleteAttachmentRes.detail || "",
                {
                    expenseId: expenseId,
                    groupCode: groupCode,
                    processedDocuments: updated,
                    failedDocument: document,
                    retrySafe: true
                }
            );
        }

        updated.push(deleteAttachmentRes.data);
    }

    var userRes = resolveCurrentUser(input);

    return responseOk({
        idempotent: false,
        expenseId: expenseId,
        groupCode: groupCode,
        hardDeletedCount: hardDeletedCount,
        clearedAttachmentCount: updated.length,
        deletedAttachmentCount: updated.length,
        deletedBy: userRes.success === true ? userRes.data.currentUser : "",
        reason: getCommon().readString(input, ["reason", "returnReason", "return_reason"], ""),
        documents: updated
    }, "Đã xóa tài liệu trên ECM và xóa bản ghi attachment trong SM.");
}

function getPrintDocument(input) {
    var idRes = resolveExpenseId(input);
    if (idRes.success !== true) return idRes;

    var expenseId = idRes.data.expenseId;
    var completedList = findCompletedAttachments(expenseId);

    if (!completedList.length) {
        return responseFail("COMPLETED_DOCUMENT_NOT_FOUND", "Phiếu chưa có bản trình ký hoàn tất để in.", "expenseId=" + expenseId);
    }
    if (completedList.length > 1) {
        return responseFail("COMPLETED_DOCUMENT_CONFLICT", "Phiếu có nhiều hơn một bản trình ký hoàn tất.", "", completedList);
    }

    var docRecord = completedList[0];
    var includePdfBase64 = getCommon().readBoolean(input, ["includePdfBase64", "include_pdf_base64"], false);

    if (!includePdfBase64) {
        return responseOk({ document: docRecord }, "Đã lấy bản trình ký hoàn tất.");
    }

    var downloadRes = downloadDocument({
        docId: docRecord.ecmDocId,
        objectId: docRecord.ecmObjectId
    });
    if (downloadRes.success !== true) return downloadRes;

    return responseOk({
        document: docRecord,
        fileName: downloadRes.data.fileName,
        mimeType: downloadRes.data.mimeType,
        encoding: downloadRes.data.encoding,
        size: downloadRes.data.size,
        pdfBase64: downloadRes.data.pdfBase64
    }, "Đã tải bản trình ký hoàn tất để in.");
}

/*
 * Entry point cho External action uploadExpenseSignedFileECM.
 * Addon gọi sau khi DSM trả new Object ID của PDF đã ký.
 */
function runSignedUploadIntegration() {
    var gatewayFile = vars["$L.file"];
    if (!gatewayFile) return;
    try {
        var payload = getCommon().safeParseJson(gatewayFile.queryString, {});
        var expenseId = payload.id;
        var signedPair = payload.objectIds && payload.objectIds[0] || {};

        var result = replaceCurrentVersion({
            expenseId: expenseId,
            currentUser: payload.userad,
            oldObjectId: signedPair.old,
            newObjectId: signedPair.new,
            newDocId: signedPair.newDocId,
            cifNum: payload.cifNum || expenseId,
            accNum: payload.accNum || expenseId
        });

        gatewayFile.queryReturn = JSON.stringify({
            statusCode: result.success === true ? "00" : "99",
            statusDesc: result.message,
            success: result.success === true,
            code: result.code,
            detail: result.detail,
            data: result.data
        });
    } catch (error) {
        gatewayFile.queryReturn = JSON.stringify({
            statusCode: "99",
            statusDesc: String(error),
            success: false
        });
    }
}

