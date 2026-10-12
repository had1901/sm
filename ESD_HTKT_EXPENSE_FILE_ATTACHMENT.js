/**
 * ScriptLibrary : ESD_HTKT_EXPENSE_FILE_ATTACHMENT
 * Quản lý tệp đính kèm của đề nghị Dự chi.
 */

function run() {
    try {
        var input = vars["$L.file"];
        if (!input) return;

        var result;
        switch (input.name) {
            case "addExpenseFileAttachment":
                result = addFileAttachment(input);
                break;
            case "getExpenseFileAttachments":
                result = getFileAttachments(input);
                break;
            case "viewExpenseFileAttachment":
                result = viewFileAttachment(input);
                break;
            case "downloadExpenseFileAttachment":
                result = downloadFileAttachment(input);
                break;
            case "deleteExpenseFileAttachment":
                result = deleteFileAttachment(input);
                break;
            default:
                result = { success: false, message: "Hành động (name) không hợp lệ: " + input.name };
        }

        input.queryReturn = JSON.stringify(result);
    } catch (error) {
        if (vars["$L.file"]) {
            vars["$L.file"].queryReturn = JSON.stringify({
                success: false,
                error: "Gateway Error: " + error.toString()
            });
        }
    }
}

function addFileAttachment(fileInput) {
    var dataObj = parseExpenseAttachmentInput(fileInput);
    if (!(dataObj instanceof Array) || dataObj.length === 0) {
        return { success: false, message: "Dữ liệu không phải là mảng hoặc mảng trống" };
    }

    var successFileNames = [];
    for (var i = 0; i < dataObj.length; i++) {
        var fileData = dataObj[i] || {};
        var attachmentId = nextExpenseAttachmentId("esdHTKTpaymentAttachment");
        var attachmentFile = new SCFile("esdHTKTpaymentAttachment");

        try {
            mapExpenseAttachment(attachmentFile, fileData, attachmentId);
            var insertRc = attachmentFile.doInsert();
            if (insertRc === true || insertRc === RC_SUCCESS) {
                successFileNames.push(fileData.name || fileData.fileName || "File không tên");
            }
        } finally {
            closeExpenseAttachmentFile(attachmentFile);
        }
    }

    if (successFileNames.length === dataObj.length) {
        return {
            success: true,
            message: "Đã thêm thành công tất cả các file: " + successFileNames.join(", ")
        };
    }
    if (successFileNames.length > 0) {
        return {
            success: true,
            message: "Thêm thành công các file: " + successFileNames.join(", ") +
                " (Thất bại " + (dataObj.length - successFileNames.length) + " file)"
        };
    }
    return {
        success: false,
        message: "Lưu file đính kèm Dự chi thất bại. Không có file nào được thêm vào hệ thống."
    };
}

function mapExpenseAttachment(record, data, attachmentId) {
    var paymentVendorId = String(data.paymentVendorId || data["payment.vendor.id"] || "").trim();
    if (!paymentVendorId) {
        throw new Error("Thiếu paymentVendorId khi thêm tài liệu cho món Dự chi.");
    }

    record["id"] = attachmentId;
    record["payment.id"] = data.transactionId || data.paymentId || "";
    record["ref.id"] = paymentVendorId;
    record["ecm.doc.id"] = data["doc.id"] || data.docId || data.ecmDocId || data.id || "";
    record["ecm.object.id"] = data["attach.id"] || data.attachId || data.ecmObjectId || "";
    record["name"] = data.name || data.fileName || "";
    record["uploaded.by"] = data.executor || data.uploadedBy || "";

    var size = data.size;
    if (size === undefined || size === null) size = data.sizeKb;
    if (size === undefined || size === null) size = data.fileSize;
    record["size"] = String(size || "0");
    record["doc.code"] = data["document.type"] || data.documentType || "DINH_KEM";
    record["uploaded.at"] = new Date();
    record["type"] = "TL_S2";
}

function getFileAttachments(fileInput) {
    var params = parseExpenseAttachmentInput(fileInput);
    var paymentVendorId = String(params.paymentVendorId || params["payment.vendor.id"] || "").trim();
    if (!paymentVendorId) {
        return { success: false, message: "Thiếu paymentVendorId khi lấy tài liệu của món Dự chi.", data: [] };
    }

    var list = [];
    var file = new SCFile("esdHTKTpaymentAttachment", SCFILE_READONLY);
    try {
        var rc = file.doSelect('ref.id="' + escapeExpenseAttachmentQueryValue(paymentVendorId) + '"');
        while (rc === RC_SUCCESS) {
            list.push({
                id: String(file["id"] || ""),
                paymentId: String(file["payment.id"] || ""),
                paymentVendorId: String(file["ref.id"] || ""),
                name: String(file["name"] || ""),
                fileName: String(file["name"] || ""),
                ecmDocId: String(file["ecm.doc.id"] || ""),
                ecmObjectId: String(file["ecm.object.id"] || ""),
                executor: String(file["uploaded.by"] || ""),
                size: String(file["size"] || "0"),
                uploadedAt: file["uploaded.at"] || "",
                documentType: String(file["doc.code"] || "")
            });
            rc = file.getNext();
        }
    } finally {
        closeExpenseAttachmentFile(file);
    }
    return { success: true, data: list };
}

function viewFileAttachment(fileInput) {
    return downloadFileAttachment(fileInput);
}

function downloadFileAttachment(fileInput) {
    var dataObj = parseExpenseAttachmentInput(fileInput);
    var ids = dataObj.objectIds || dataObj.objectId;
    if (!ids || (ids instanceof Array && ids.length === 0)) {
        return { success: false, message: "Thiếu 'objectIds' hoặc 'objectId' trong cấu trúc JSON" };
    }
    return lib.ESD_HTKT_INVOICE_ECM.downloadObjectId(ids);
}

function deleteFileAttachment(fileInput) {
    var dataObj = parseExpenseAttachmentInput(fileInput);
    var attachmentId = String(dataObj.attachmentId || dataObj.id || dataObj.docId || "").trim();
    var paymentVendorId = String(dataObj.paymentVendorId || dataObj["payment.vendor.id"] || "").trim();
    if (!attachmentId || !paymentVendorId) {
        return { success: false, message: "Thiếu attachmentId hoặc paymentVendorId để xóa tài liệu Dự chi." };
    }

    var attachmentFile = new SCFile("esdHTKTpaymentAttachment");
    try {
        var query = 'id="' + escapeExpenseAttachmentQueryValue(attachmentId) +
            '" and ref.id="' + escapeExpenseAttachmentQueryValue(paymentVendorId) + '"';
        if (attachmentFile.doSelect(query) !== RC_SUCCESS) {
            return { success: false, message: "Không tìm thấy tài liệu thuộc món Dự chi." };
        }
        var ecmDocId = String(attachmentFile["ecm.doc.id"] || "").trim();
        if (!ecmDocId) {
            return { success: false, message: "Tài liệu Dự chi chưa có ecm.doc.id để xóa trên ECM." };
        }

        var ecmResult;
        try {
            ecmResult = lib.ESD_HTKT_INVOICE_ECM.deleteDocId(ecmDocId);
        } catch (ecmError) {
            return {
                success: false,
                message: "Xóa tài liệu trên ECM thất bại: " + ecmError.toString()
            };
        }

        if (ecmResult && ecmResult.success === false) {
            return {
                success: false,
                message: ecmResult.message || ecmResult.error || "Xóa tài liệu trên ECM thất bại."
            };
        }

        // Chỉ xóa bản ghi liên kết sau khi ECM đã xử lý thành công.
        var deleteRc = attachmentFile.doDelete();
        if (deleteRc !== RC_SUCCESS) {
            return {
                success: false,
                message: "Đã xóa tài liệu trên ECM nhưng xóa bản ghi esdHTKTpaymentAttachment thất bại. Code: " + deleteRc
            };
        }
        return { success: true, message: "Xóa tài liệu Dự chi thành công." };
    } finally {
        closeExpenseAttachmentFile(attachmentFile);
    }
}

function parseExpenseAttachmentInput(input) {
    var raw = input ? (input.queryString || input.details) : null;
    if (!raw) return {};
    try {
        return typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch (error) {
        throw new Error("Dữ liệu tệp đính kèm không hợp lệ: " + error.toString());
    }
}

function nextExpenseAttachmentId(name) {
    var rc = new SCDatum();
    var nextNumber = new SCDatum();
    funcs.rtecall("getnumber", rc, nextNumber, name);
    return String(nextNumber || "");
}

function closeExpenseAttachmentFile(file) {
    if (!file) return;
    try { file.doClose(); } catch (error) {}
}

function escapeExpenseAttachmentQueryValue(value) {
    return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
