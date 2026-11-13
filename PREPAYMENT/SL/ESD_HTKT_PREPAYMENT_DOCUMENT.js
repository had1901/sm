/**
 * ScriptLibrary: ESD_HTKT_PREPAYMENT_DOCUMENT
 * -----------------------------------------------------------------------------
 * Module      : HTKT - Đề nghị tạm ứng
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
    SERVICE_NAME: "ESD_HTKT_PREPAYMENT_DOCUMENT",
    SERVICE_VERSION: "2.1.0",
    ATTACHMENT_TABLE: "esdHTKTprepaymentAttachment",
    DOCUMENT_CODE: "TRINH_KY",
    /* Gia tri truong type luu tren bang attachment (danh muc loai tai lieu EDMS). */
    DOCUMENT_TYPE: "TL_S6",
    GROUP_PREFIX: "HTKT_TK",
    NAME_PREFIX: "Phieu-de-nghi-tam-ung-",
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
    /* REAL UAT:
    if (!lib.ESD_ENV_CONFIG ||
        typeof lib.ESD_ENV_CONFIG.getENV !== "function" ||
        typeof lib.ESD_ENV_CONFIG.esdEcmService !== "function") {
        throw new Error("Thiếu contract ESD_ENV_CONFIG cho Document Service.");
    }

    var environment = getCommon().toUpper(lib.ESD_ENV_CONFIG.getENV());
    var provider = environment === "SIT" ? "MOCK" : "REAL";
    var storageBaseUrl;

    if (provider === "MOCK") {
        storageBaseUrl = CONFIG.MOCK_STORAGE_BASE_URL;
    } else {
        storageBaseUrl = lib.ESD_ENV_CONFIG.esdEcmService();
    }

    storageBaseUrl = getCommon().trim(storageBaseUrl).replace(/\/+$/, "");
    if (!storageBaseUrl) {
        throw new Error(
            "URL ECM đang để trống trong ESD_ENV_CONFIG cho môi trường " +
            environment +
            "."
        );
    }
    */

    var environment = "SIT";
    var provider = "MOCK";
    var storageBaseUrl = CONFIG.MOCK_STORAGE_BASE_URL;

    if (requireEform === true &&
        (!lib.ESD_HTKT_EFORM_SERVICE || typeof lib.ESD_HTKT_EFORM_SERVICE.generatePresentationPdf !== "function")) {
        throw new Error("Thiếu thư viện ESD_HTKT_EFORM_SERVICE.");
    }

    /* REAL UAT:
    if (provider === "REAL" && (!lib.ESD_ECM_SERVICE ||
        typeof lib.ESD_ECM_SERVICE.uploadFileTaiLieu !== "function" ||
        typeof lib.ESD_ECM_SERVICE.downloadDocument !== "function" ||
        typeof lib.ESD_ECM_SERVICE.deleteDocument !== "function")) {
        throw new Error("Thiếu hoặc sai contract thư viện ESD_ECM_SERVICE (upload/download/delete).");
    }
    */
    return {
        ENVIRONMENT: environment,
        PROVIDER: provider,
        STORAGE_BASE_URL: storageBaseUrl
    };
}

function resolvePrepaymentId(input) {
    var prepaymentId = getCommon().getCurrentPrepaymentId(input);
    if (!prepaymentId) {
        return responseFail("MISSING_PREPAYMENT_ID", "Không xác định được mã đề nghị tạm ứng.", "");
    }
    return responseOk({ prepaymentId: prepaymentId });
}

function resolveCurrentUser(input) {
    var user = getCommon().getCurrentUser();
    if (!user) {
        user = getCommon().readString(input, ["currentUser", "current_user", "uploadedBy", "uploaded_by", "userad"], "");
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

// Upload theo contract ECM thật; nhánh MOCK được giữ lại trong comment để đối chiếu.
function uploadDocument(input) {
    try {
        var environmentConfig = assertDependencies(false);
        var provider = getCommon().toUpper(environmentConfig.PROVIDER);
        var prepaymentId = getCommon().trim(input.prepaymentId);
        var cifNum = getCommon().trim(input.cifNum) || prepaymentId;
        var accNum = getCommon().trim(input.accNum) || prepaymentId;
        var rawResponse;

        if (provider === "MOCK") {
            rawResponse = postDocumentJson(environmentConfig.STORAGE_BASE_URL + "/CDM/service/document/upload", {
                fileName: input.fileName,
                content: input.pdfBase64
            });
        }
        /* REAL UAT:
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
        */

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
        return responseOk({
            docId: getCommon().trim(item.DocId || item.docId),
            objectId: getCommon().trim(item.ObjectId || item.objectId),
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
        /* REAL UAT:
        else {
            rawResponse = lib.ESD_ECM_SERVICE.downloadDocument([{
                DOC_OBJECTID: documentIdentity.objectId,
                APP_ID: CONFIG.ECM_REQUEST.APP_ID,
                SESSION_ID: CONFIG.ECM_REQUEST.SESSION_ID
            }]);
        }
        */

        var parsed = parseDocumentStorageResponse(rawResponse);
        if (parsed.success !== true) return parsed;

        var responseData = parsed.data;
        var dataObject = responseData.data;
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
        /* REAL UAT:
        else {
            rawResponse = lib.ESD_ECM_SERVICE.deleteDocument([{
                DOC_ID: safeDocId,
                APP_ID: CONFIG.ECM_REQUEST.APP_ID,
                SESSION_ID: CONFIG.ECM_REQUEST.SESSION_ID
            }]);
        }
        */

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
        prepaymentId: getCommon().readString(file, ["prepayment.id"], ""),
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
        versionNo: 0
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
    } catch (ignore) {
        records = [];
    } finally {
        getCommon().closeFile(file);
    }

    if (typeof sortFn === "function") {
        records.sort(sortFn);
    }
    return records;
}

function listByPrepayment(prepaymentId) {
    var safeId = getCommon().trim(prepaymentId);
    if (!safeId) return [];

    var records = listAttachmentsByQuery(
        'prepayment.id="' + getCommon().escapeQueryValue(safeId) + '" and type="' + CONFIG.DOCUMENT_TYPE + '"',
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

function findActiveAttachments(prepaymentId) {
    var list = listByPrepayment(prepaymentId);
    var active = [];
    for (var i = 0; i < list.length; i++) {
        if (list[i].status === STATUS.CURRENT || list[i].status === STATUS.COMPLETED) {
            active.push(list[i]);
        }
    }
    return active;
}

function findCompletedAttachments(prepaymentId) {
    var list = listByPrepayment(prepaymentId);
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
    var prepaymentId = getCommon().trim(input.prepaymentId);
    var objectId = getCommon().trim(input.ecmObjectId);
    var name = getCommon().trim(input.name);
    var uploadedBy = getCommon().trim(input.uploadedBy);
    var groupCode = getCommon().trim(input.groupCode);
    var status = getCommon().toUpper(input.status);
    var versionNo = getCommon().toNumber(input.versionNo, 0);

    if (!prepaymentId || !objectId || !name || !uploadedBy || !groupCode || !status) {
        return responseFail("ATTACHMENT_INPUT_INVALID", "Không đủ dữ liệu để lưu bản trình ký.", "", input);
    }

    var file = null;
    try {
        file = new SCFile(CONFIG.ATTACHMENT_TABLE);
        file["id"] = attachmentId;
        file["prepayment.id"] = prepaymentId;
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
        prepaymentId: attachment.prepaymentId,
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
                prepaymentId: "prepayment.id",
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
    var idRes = resolvePrepaymentId(input);
    if (idRes.success !== true) return idRes;

    var activeList = findActiveAttachments(idRes.data.prepaymentId);
    if (!activeList.length) {
        return responseFail("DOCUMENT_NOT_FOUND", "Phiếu chưa có bản trình ký hiện hành.", "prepaymentId=" + idRes.data.prepaymentId);
    }
    if (activeList.length > 1) {
        return responseFail("DOCUMENT_CURRENT_CONFLICT", "Phiếu đang có nhiều hơn một bản trình ký hiện hành.", "", activeList);
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
function get_file_ecm_HTKT(file) {
    try {
        var input = file || {};
        var queryString = getCommon().readString(input, ["queryString"], "");
        if (queryString) {
            input = getCommon().safeParseJson(queryString, input);
        }

        var idRes = resolvePrepaymentId(input);
        if (idRes.success !== true) return idRes;

        var prepaymentId = idRes.data.prepaymentId;
        var query =
            'prepayment.id="' + getCommon().escapeQueryValue(prepaymentId) + '"' +
            ' and type="' + CONFIG.DOCUMENT_TYPE + '"';
        var activeList = [];
        var attachmentFile = null;
        var count = 0;

        // trưởng thêm: Query trực tiếp attachment theo mã phiếu và loại phiếu trình ký.
        try {
            attachmentFile = getCommon().newReadOnlyFile(CONFIG.ATTACHMENT_TABLE);
            var rc = attachmentFile.doSelect(query);

            while (rc === RC_SUCCESS && count < CONFIG.MAX_SCAN_RECORDS) {
                var attachment = mapAttachment(attachmentFile);
                if (attachment && (attachment.status === STATUS.CURRENT || attachment.status === STATUS.COMPLETED)) {
                    activeList.push(attachment);
                }
                count++;
                rc = attachmentFile.getNext();
            }
        } finally {
            getCommon().closeFile(attachmentFile);
        }

        if (!activeList.length) {
            return responseFail(
                "DOCUMENT_NOT_FOUND",
                "Không tìm thấy bản trình ký của phiếu " + prepaymentId + ".",
                query
            );
        }
        if (activeList.length > 1) {
            return responseFail(
                "DOCUMENT_CURRENT_CONFLICT",
                "Phiếu đang có nhiều hơn một bản trình ký hiện hành.",
                query,
                activeList
            );
        }

        var currentDocument = activeList[0];
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
    var idRes = resolvePrepaymentId(input);
    var userRes = resolveCurrentUser(input);
    if (idRes.success !== true) return idRes;
    if (userRes.success !== true) return userRes;

    var prepaymentId = idRes.data.prepaymentId;
    var pdfBase64 = normalizePdfBase64(getCommon().readString(input, ["pdfBase64", "pdf_base64", "fileBytes"], ""));

    if (!isPdfBase64(pdfBase64)) {
        return responseFail("INVALID_PDF_BASE64", "Nội dung truyền vào không phải PDF Base64 hợp lệ.", "Bắt buộc bắt đầu bằng JVBERi0.");
    }

    var fileName = getCommon().sanitizeFileName(getCommon().readString(input, ["fileName", "file_name", "name"], CONFIG.NAME_PREFIX + prepaymentId + ".pdf"));
    if (!/\.pdf$/i.test(fileName)) fileName += ".pdf";

    var uploadRes = uploadDocument({
        prepaymentId: prepaymentId,
        documentName: getCommon().readString(input, ["documentName", "document_name"], "Phiếu đề nghị tạm ứng - " + prepaymentId),
        fileName: fileName,
        pdfBase64: pdfBase64,
        cifNum: getCommon().readString(input, ["cifNum"], prepaymentId),
        accNum: getCommon().readString(input, ["accNum"], prepaymentId)
    });
    if (uploadRes.success !== true) return uploadRes;

    // trưởng thêm: Chuyển phase upload ECM
    return responseOk({
        prepaymentId: prepaymentId,
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
    var idRes = resolvePrepaymentId(input);
    var userRes = resolveCurrentUser(input);
    if (idRes.success !== true) return idRes;
    if (userRes.success !== true) return userRes;

    var prepaymentId = idRes.data.prepaymentId;
    var activeList = findActiveAttachments(prepaymentId);

    if (activeList.length > 1) {
        return responseFail("DOCUMENT_CURRENT_CONFLICT", "Phiếu đang có nhiều hơn một bản trình ký hiện hành.", "", activeList);
    }
    if (activeList.length === 1) {
        return responseFail("DOCUMENT_CURRENT_EXISTS", "Phiếu đã có bản trình ký còn hiệu lực.", "Phải hủy hiệu lực vòng hiện tại trước khi sinh vòng mới.", activeList[0]);
    }

    var genRes;
    try {
        genRes = lib.ESD_HTKT_EFORM_SERVICE.generatePresentationPdf({
            prepaymentId: prepaymentId,
            useCache: false,
            forceRegenerate: true,
            includeTemplateData: false
        });
    } catch (error) {
        return responseFailException("EFORM_GENERATE_CALL_EXCEPTION", "Không gọi được EFORM Service để sinh PDF.", error, { prepaymentId: prepaymentId });
    }

    if (!genRes || genRes.success !== true) {
        return responseFail("EFORM_GENERATE_FAILED", genRes && genRes.message ? genRes.message : "Không sinh được PDF bản trình ký.", genRes && genRes.detail ? genRes.detail : "", genRes ? genRes.data : null);
    }

    var genData = genRes.data || {};
    var uploadRes = uploadPresentationPdf({
        prepaymentId: prepaymentId,
        currentUser: userRes.data.currentUser,
        pdfBase64: genData.pdfBase64,
        fileName: genData.fileName,
        documentName: "Phiếu đề nghị tạm ứng - " + prepaymentId
    });
    if (uploadRes.success !== true) return uploadRes;

    var groupCode = getCommon().generateRequestId(CONFIG.GROUP_PREFIX);
    var insertRes = insertAttachment({
        prepaymentId: prepaymentId,
        ecmDocId: uploadRes.data.ecmDocId,
        ecmObjectId: uploadRes.data.ecmObjectId,
        name: uploadRes.data.fileName,
        uploadedBy: userRes.data.currentUser,
        size: uploadRes.data.size,
        groupCode: groupCode,
        status: STATUS.CURRENT,
        versionNo: 1
    });

    if (insertRes.success !== true) {
        return responseFail("ATTACHMENT_INSERT_AFTER_UPLOAD_FAILED", "Đã upload PDF lên ECM nhưng không lưu được bản trình ký.", insertRes.message, {
            ecmDocId: uploadRes.data.ecmDocId,
            ecmObjectId: uploadRes.data.ecmObjectId,
            cleanupRecommended: true,
            attachmentError: insertRes
        });
    }

    return responseOk({
        prepaymentId: prepaymentId,
        groupCode: groupCode,
        document: insertRes.data,
        generated: {
            templateId: genData.templateId,
            templateCode: genData.templateCode,
            mimeType: genData.mimeType,
            encoding: genData.encoding,
            fromCache: genData.fromCache === true
        }
    }, "Sinh và lưu bản trình ký thành công.");
}

/*
 * Upload the signed PDF and insert its attachment first.
 * The previous ECM file and attachment are deliberately preserved here.
 */
function insertSignedDigitizedDocument(prepaymentId, attachmentId, ecmFile) {
    var attachment = null;
    var prepayment = null;
    var document = null;
    try {
        attachment = selectAttachmentById(attachmentId, true);
        if (!attachment) {
            return responseFail("SIGNED_ATTACHMENT_NOT_SAVED", "Khong tim thay attachment co chu ky vua luu.", "id=" + attachmentId);
        }
        prepayment = getCommon().newReadOnlyFile("esdHTKTprepayment");
        var rc = prepayment.doSelect('id="' + getCommon().escapeQueryValue(prepaymentId) + '"');
        if (rc !== RC_SUCCESS || !prepayment["created.at"]) {
            return responseFail("PREPAYMENT_CREATED_AT_MISSING", "Khong lay duoc ngay lap giao dich tam ung.", "id=" + prepaymentId);
        }
        document = new SCFile("esdHDtlks");
        document["id"] = lib.ESD_Utils.generateNextNumber("esdHDtlks");
        document["status"] = "So hoa thanh cong";
        document["parent.id"] = "";
        document["document.type"] = "";
        document["category"] = "";
        document["document.source"] = "";
        document["function"] = "";
        document["doc.id"] = ecmFile.DocId;
        document["attach.id"] = ecmFile.ObjectId;
        document["table"] = CONFIG.ATTACHMENT_TABLE;
        document["original.id"] = attachmentId;
        document["document.date"] = prepayment["created.at"];
        rc = document.doInsert();
        if (rc !== RC_SUCCESS) {
            return responseFail("SIGNED_DOCUMENT_INSERT_FAILED", "Khong luu duoc tai lieu so hoa esdHDtlks.", "doInsert RC=" + rc);
        }
        return responseOk({ id: getCommon().toString(document["id"]) });
    } finally {
        getCommon().closeFile(attachment);
        getCommon().closeFile(prepayment);
        getCommon().closeFile(document);
    }
}

function addFileECM_HTKT(file) {
    try {
        file = file || {};
        var currentRes = getCurrentPresentation(file);
        if (currentRes.success !== true) return currentRes;

        var oldDocument = currentRes.data;
        var prepaymentId = oldDocument.prepaymentId;
        var currentUser = getCommon().getCurrentUser() || file.currentUser;
        var signedFile = downloadDocument({ objectId: file.newObjectId });
        if (signedFile.success !== true) return signedFile;

        assertDependencies(false);
        var result = lib.ESD_ECM_SERVICE.uploadFileTaiLieu({
            "docCat": CONFIG.ECM_REQUEST.DOC_CATEGORY,
            "docName": file.documentName || "Phieu de nghi tam ung - " + prepaymentId,
            "cifNum": file.cifNum || prepaymentId,
            "accNum": file.accNum || prepaymentId,
            "docCreated": system.functions.tod(),
            "sourceId": CONFIG.ECM_REQUEST.SOURCE_ID,
            "sessionId": CONFIG.ECM_REQUEST.SESSION_ID,
            "appId": CONFIG.ECM_REQUEST.APP_ID,
            "fileBytes": signedFile.data.pdfBase64,
            "fileName": oldDocument.name,
            "seq": CONFIG.ECM_REQUEST.SEQUENCE,
            "userId": currentUser
        });
        result = JSON.parse(result);

        if (result && result.Data && result.Data[0]) {
            var ecmFile = result.Data[0];
            var nextId = lib.ESD_Utils.generateNextNumber(CONFIG.ATTACHMENT_TABLE);

            lib.ESD_Utils.CreateTicket(CONFIG.ATTACHMENT_TABLE, {
                "id": nextId,
                "prepayment.id": prepaymentId,
                "ecm.doc.id": ecmFile.DocId,
                "ecm.object.id": ecmFile.ObjectId,
                "name": oldDocument.name,
                "uploaded.by": currentUser,
                "size": signedFile.data.size,
                "doc.code": CONFIG.DOCUMENT_CODE,
                "group.code": oldDocument.groupCode,
                "uploaded.at": system.functions.tod(),
                "status": STATUS.CURRENT,
                "type": CONFIG.DOCUMENT_TYPE
            });

            var digitizedRes = insertSignedDigitizedDocument(prepaymentId, nextId, ecmFile);
            if (digitizedRes.success !== true) return digitizedRes;

            return responseOk({
                digitizedDocumentId: digitizedRes.data.id,
                deletePayload: {
                    prepaymentId: prepaymentId,
                    oldAttachmentId: oldDocument.id,
                    newAttachmentId: nextId
                }
            }, "Da upload ECM va luu attachment co chu ky.");
        }

        return responseFail("SIGNED_ADD_FAILED", "Upload ECM that bai.", "");
    } catch (err) {
        return responseFail("SIGNED_ADD_FAILED", "That bai: " + err, "");
    }
}
/* Delete the previous file only after the new attachment can be verified. */
function deleteFileECM_HTKT(input) {
    try {
        input = input || {};

        var oldFile = selectAttachmentById(input.oldAttachmentId, true);
        var newFile = selectAttachmentById(input.newAttachmentId, true);
        var oldDocument = mapAttachment(oldFile);
        var newDocument = mapAttachment(newFile);
        getCommon().closeFile(oldFile);
        getCommon().closeFile(newFile);

        var resECM = oldDocument.ecmDocId === newDocument.ecmDocId
            ? { success: true }
            : deleteStoredDocument(oldDocument.ecmDocId);

        if (resECM && resECM.success === true) {
            var resSM = deleteAttachmentRecord(oldDocument.id);
            if (resSM && resSM.success === true) {
                return responseOk({
                    deletedAttachmentId: oldDocument.id,
                    currentAttachmentId: newDocument.id
                }, "Cap nhat file sau ky thanh cong.");
            }
        }

        return responseFail("SIGNED_DELETE_FAILED", "Xoa file cu that bai.", "");
    } catch (err) {
        return responseFail("SIGNED_DELETE_FAILED", "That bai: " + err, "");
    }
}

/*
 * Backward-compatible workflow API. It now follows the safe order too:
 * add/upload/save the new attachment first, then remove the previous one.
 */
function replaceCurrentVersion(input) {
    var addRes = addFileECM_HTKT(input);
    if (addRes.success !== true || (addRes.data && addRes.data.idempotent === true)) {
        return addRes;
    }

    var deleteRes = deleteFileECM_HTKT(addRes.data.deletePayload || {});
    if (deleteRes.success !== true) {
        return responseFail(
            "SIGNED_REPLACEMENT_DELETE_FAILED",
            "Da luu attachment moi nhung khong xoa duoc ban cu.",
            deleteRes.message,
            {
                addResult: addRes,
                deleteResult: deleteRes,
                newAttachmentPreserved: true
            }
        );
    }

    return responseOk({
        idempotent: false,
        previousDocument: addRes.data.previousDocument,
        deletedDocument: deleteRes.data.deletedDocument,
        currentDocument: addRes.data.currentDocument,
        signedSource: addRes.data.signedSource,
        uploadedDocument: addRes.data.uploadedDocument
    }, "Da upload ECM, luu attachment moi va xoa ban cu.");
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
    var idRes = resolvePrepaymentId(input);
    if (idRes.success !== true) return idRes;

    var prepaymentId = idRes.data.prepaymentId;
    var activeList = findActiveAttachments(prepaymentId);

    if (!activeList.length) {
        /* Dọn các bản ghi đã xóa ECM nhưng còn sót trong DB từ luồng cũ. */
        var staleList = listByPrepayment(prepaymentId);
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
            prepaymentId: prepaymentId,
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
                    prepaymentId: prepaymentId,
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
                        prepaymentId: prepaymentId,
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
                    prepaymentId: prepaymentId,
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
        prepaymentId: prepaymentId,
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
    var idRes = resolvePrepaymentId(input);
    if (idRes.success !== true) return idRes;

    var prepaymentId = idRes.data.prepaymentId;
    var completedList = findCompletedAttachments(prepaymentId);

    if (!completedList.length) {
        return responseFail("COMPLETED_DOCUMENT_NOT_FOUND", "Phiếu chưa có bản trình ký hoàn tất để in.", "prepaymentId=" + prepaymentId);
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
 * Entry point cho External action uploadPrepaymentSignedFileECM.
 * Addon gọi sau khi DSM trả new Object ID của PDF đã ký.
 */
function runSignedUploadIntegration() {
    var gatewayFile = vars["$L.file"];
    if (!gatewayFile) return;
    try {
        var payload = getCommon().safeParseJson(gatewayFile.queryString, {});
        var prepaymentId = payload.id;
        var signedPair = payload.objectIds && payload.objectIds[0] || {};

        var result = replaceCurrentVersion({
            prepaymentId: prepaymentId,
            currentUser: payload.userad,
            oldObjectId: signedPair.old,
            newObjectId: signedPair.new,
            newDocId: signedPair.newDocId,
            cifNum: payload.cifNum || prepaymentId,
            accNum: payload.accNum || prepaymentId
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

