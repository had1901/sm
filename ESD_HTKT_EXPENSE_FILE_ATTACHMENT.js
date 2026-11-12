/**
 * ScriptLibrary : ESD_HTKT_EXPENSE_FILE_ATTACHMENT
 * Quản lý tệp đính kèm của đề nghị Dự chi.
 * Phần 1: thêm/xem/tải/bỏ tài liệu đã gắn với món Dự chi, giữ phân biệt TL_S2 và TL_S4.
 * Phần 2 cuối file: lấy và xác minh tài liệu nguồn qua SHTL cho XDCB; HHDV ủy quyền reader S2.
 */

function run() {
    try {
        var input = vars["$L.file"];
        if (!input) return;

        var result;
        switch (input.name) {
            case "listExpenseSourceDocuments": // Phần 2: nguồn tài liệu SHTL XDCB, HHDV dùng S2.
                result = listExpenseSourceDocuments(input);
                break;
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

    // Xác minh toàn bộ lựa chọn S4 trước Insert dòng đầu; HHDV giữ dữ liệu/mapper cũ.
    for (var p = 0; p < dataObj.length; p++) {
        dataObj[p] = prepareExpenseSourceAttachment(dataObj[p] || {});
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
    record["type"] = data._expenseShtlSource === true ? "TL_S4" : "TL_S2";
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
        // Tệp SHTL S4 chỉ là tham chiếu: bỏ liên kết ở món, không xóa tài liệu gốc trên ECM/SHTL.
        if (String(attachmentFile["type"] || "") === "TL_S4") {
            var sourceContext = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseSupplierContext(
                { "payment.id": attachmentFile["payment.id"] }, dataObj.currentUser, true
            );
            if (sourceContext.category !== "XDCB" || sourceContext.payment.id !== dataObj.paymentId) {
                return { success: false, message: "Tài liệu không thuộc phiếu Dự chi XDCB này." };
            }
            var unlinkRc = attachmentFile.doDelete();
            return {
                success: unlinkRc === RC_SUCCESS,
                message: unlinkRc === RC_SUCCESS ? "Đã bỏ tài liệu khỏi món Dự chi." : "Không bỏ được liên kết tài liệu SHTL."
            };
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

// ============================================================================
// PHẦN 2 - NGUỒN TÀI LIỆU SHTL CHO DỰ CHI XDCB (S4)
// TH1: SHTL -> HĐ. TH2: SHTL -> hồ sơ -> HĐ; lấy tài liệu qua esdHDtlks.parent.id.
// HHDV ủy quyền reader S2; các hàm dưới không ghi tiến độ hoặc tổng tiền S4.
// Giữ kiểm tra actor/phase/phạm vi khi chọn và kiểm tra lại tài liệu/ECM trước Insert.
// ============================================================================

/** Dự chi XDCB: món -> SHTL TH1/TH2 -> esdHDtlks.parent.id. HHDV ủy quyền reader S2. */
function listExpenseSourceDocuments(input) {
    try {
        var params = lib.ESD_HTKT_EXPENSE_CONTRACT.expenseContractParams(input);
        var actor = sourceDocumentText(params.currentUser);
        if (!actor) throw new Error("Không xác định được người lấy tài liệu.");
        var context = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseSupplierContext(
            { "payment.id": params.paymentId },
            actor,
            true
        );
        if (context.category === "HHDV") {
            // HHDV giữ query S2; chuyển queryReturnArray thành JSON cho action Dự chi.
            var legacy = { queryString: JSON.stringify(params) };
            lib.ESD_HTKT_PAYMENT_CREATE_REQUEST.listFileAttachment(legacy);
            var values = legacy.queryReturnArray || [];
            if (values.toArray) values = values.toArray();
            var oldRows = [];
            for (var l = 0; l < values.length; l++) {
                var raw = values[l];
                // Datum hoặc Java String qua scope SL không nhất thiết có typeof === string.
                if (raw && typeof raw.getText === "function") raw = raw.getText();
                var text = sourceDocumentText(raw);
                var value =
                    typeof raw === "string" || text.charAt(0) === "{" ? JSON.parse(text) : raw;
                oldRows.push(value.esdHDtlks || value);
            }
            return { success: true, data: oldRows, contractCategory: "HHDV" };
        }
        var source = expenseSourceDocumentContext(params, context, actor);
        var rows = readShtlSourceDocuments(source.ids);
        return { success: true, data: rows, contractCategory: "XDCB" };
    } catch (error) {
        return { success: false, data: [], message: String(error.message || error) };
    }
}

/** Kiểm tra món thuộc phiếu, phân giải HĐ qua SHTL; TH2 giới hạn theo NCC đã lưu nếu có. */
function expenseSourceDocumentContext(params, context, actor) {
    var itemId = sourceDocumentText(params.paymentVendorId);
    if (!itemId) throw new Error("Thiếu mã món Dự chi khi lấy tài liệu SHTL.");
    var item = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.expenseSupplierReadOne(
        "esdHTKTpaymentVendor",
        'id="' +
            sourceDocumentQuote(itemId) +
            '" and payment.id="' +
            sourceDocumentQuote(context.payment.id) +
            '"',
        ["id", "payment.id", "contract.id", "vendor.id"],
        true
    );
    if (
        params.contractId &&
        sourceDocumentText(params.contractId) !== sourceDocumentText(item["contract.id"])
    ) {
        throw new Error("HĐ lấy tài liệu khác HĐ đã lưu trên món Dự chi.");
    }
    var contract = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseXdcbSelection(
        item["contract.id"],
        actor,
        context.payment.id
    );
    var tax = "";
    if (sourceDocumentText(item["vendor.id"])) {
        var vendor = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseAccountingVendor(
            item["vendor.id"]
        );
        tax = sourceDocumentText(vendor["vendor.number"]);
        lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.resolveExpenseXdcbSupplier(contract, "", tax);
    }
    var ids = [];
    var refs = contract.digitizationReferences || [];
    for (var i = 0; i < refs.length; i++) {
        if (refs[i].sourceCase === "TH1" || !tax || sourceDocumentText(refs[i].taxCode) === tax)
            ids.push(refs[i].id);
    }
    if (!ids.length) throw new Error("Không có SHTL phù hợp HĐ/NCC của món Dự chi.");
    return { ids: ids, contract: contract };
}

/** Dùng field thực sizeKb/executor; chuyển ngày khi cursor còn mở, giữ ID ECM nguồn. */
function sourceDocumentRow(file) {
    return {
        id: sourceDocumentText(file.id),
        name: sourceDocumentText(file.name),
        sizeKb: file.sizeKb == null ? null : Number(file.sizeKb),
        size: file.sizeKb == null ? null : Number(file.sizeKb) * 1024,
        "created.at": lib.ESD_HTKT_EXPENSE_CONTRACT.expenseContractDate(file["created.at"]),
        executor: sourceDocumentText(file.executor),
        "doc.id": sourceDocumentText(file["doc.id"]),
        "attach.id": sourceDocumentText(file["attach.id"]),
        "parent.id": sourceDocumentText(file["parent.id"]),
        "document.type": sourceDocumentText(file["document.type"]),
        status: sourceDocumentText(file.status),
        source: "S4"
    };
}

/** Kiểm tra lại tài liệu XDCB trước Insert, lấy metadata từ nguồn thay vì tin ECM/name từ client. */
function prepareExpenseSourceAttachment(data) {
    // Chỉ server được đánh dấu tham chiếu S4.
    data._expenseShtlSource = false;
    var actor = sourceDocumentText(data.currentUser);
    var context = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseSupplierContext(
        { "payment.id": data.paymentId || data.transactionId },
        actor,
        false
    );
    if (context.category !== "XDCB") return data;
    var result = listExpenseSourceDocuments({
        details: {
            currentUser: actor,
            paymentId: context.payment.id,
            paymentVendorId: data.paymentVendorId
        }
    });
    if (!result.success) throw new Error(result.message);
    var selectedId = sourceDocumentText(data.id);
    var selectedDoc = sourceDocumentText(data["doc.id"] || data.ecmDocId);
    for (var i = 0; i < result.data.length; i++) {
        var row = result.data[i];
        if (row.id !== selectedId) continue;
        if (!row["doc.id"] || (selectedDoc && row["doc.id"] !== selectedDoc)) {
            throw new Error("Tài liệu SHTL không có hoặc không khớp ID ECM.");
        }
        row.paymentId = context.payment.id;
        row.transactionId = context.payment.id;
        row.paymentVendorId = data.paymentVendorId;
        row.currentUser = actor;
        row._expenseShtlSource = true;
        return row;
    }
    throw new Error("Tài liệu đã chọn không thuộc SHTL của HĐ/NCC này.");
}

/** Chuẩn hóa text, giữ nguyên số 0 đầu của ID/MST. */
function sourceDocumentText(value) {
    return value == null ? "" : String(value).replace(/^\s+|\s+$/g, "");
}

/** Escape giá trị cho native query; không nhận tên bảng/field từ client. */
function sourceDocumentQuote(value) {
    return sourceDocumentText(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Reader SHTL dùng chung TT/DC: caller đã xác minh quyền/nguồn trước khi truyền ID.
 * Không truy ngược HĐ, không ghi DB/ECM. DC giữ size byte; TT đổi DTO sang kB theo UI đang dùng.
 */
function readShtlSourceDocuments(ids, sizeUnit) {
    var rows = [];
    var seen = {};
    for (var start = 0; start < ids.length; start += 100) {
        var conditions = [];
        var batchIds = ids.slice(start, start + 100);
        for (var n = 0; n < batchIds.length; n++)
            conditions.push('parent.id="' + sourceDocumentQuote(batchIds[n]) + '"');
        var query = "(" + conditions.join(" or ") + ') and status="So hoa thanh cong"';
        var docs = lib.ESD_HTKT_EXPENSE_CONTRACT.expenseDigitizationReadRows(
            "esdHDtlks",
            query,
            [
                "id",
                "name",
                "sizeKb",
                "created.at",
                "executor",
                "doc.id",
                "parent.id",
                "attach.id",
                "document.type",
                "status"
            ],
            "expense-source-documents",
            sourceDocumentRow
        );
        for (var d = 0; d < docs.length; d++) {
            if (!seen["$" + docs[d].id]) {
                rows.push(docs[d]);
                seen["$" + docs[d].id] = true;
            }
        }
    }
    if (sizeUnit === "KB") {
        for (var i = 0; i < rows.length; i++) rows[i].size = rows[i].sizeKb;
    }
    return rows;
}
