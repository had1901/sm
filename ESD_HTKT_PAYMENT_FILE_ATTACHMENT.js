/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_FILE_ATTACHMENT
 * -----------------------------------------------------------------------------
 * Module       : HTKT - Đề nghị thanh toán
 * Version      : 1.0.0
 * Chức năng:
 * - Quản lý danh sách các tệp đính kèm (esdHTKTpaymentAttachment) thuộc đề nghị thanh toán.
 * - Thực hiện thêm mới, cập nhật, xóa và liên kết tài liệu với từng hạng mục/nhà cung cấp.
 * - Kiểm tra tính hợp lệ và đồng bộ thông tin file đính kèm giữa NextJS và Service Manager.
 * -----------------------------------------------------------------------------
 */

var createActivity = lib.ESD_Utils.createActivity;

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
            case 'addFileAttachment':
                result = addFileAttachment(input);
                break;

            case 'viewFileAttachment':
                result = viewFileAttachment(input);
                break;

            case 'downloadFileAttachment':
                result = downloadFileAttachment(input);
                break;

            case 'deleteFileAttachment':
                result = deleteFileAttachment(input);
                break;

            default:
                result = { success: false, message: "Hành động (name) không hợp lệ: " + name };
        }

        // Ép kiểu chuỗi JSON gọn gàng trả ra cổng API Gateway
        input.queryReturn = JSON.stringify(result);

    } catch (e) {
        if (vars['$L.file']) {
            vars['$L.file'].queryReturn = JSON.stringify({ success: false, error: 'Gateway Error: ' + e.toString() });
        }
    }
}

function addFileAttachment(fileInput) {
    var rawQueryString = fileInput.queryString;
    if (!rawQueryString) {
        return { success: false, message: "Thiếu dữ liệu trong trường queryString" };
    }

    try {
        var dataObj = JSON.parse(rawQueryString);
        if (!Array.isArray(dataObj) || dataObj.length === 0) {
            return { success: false, message: "Dữ liệu không phải là mảng hoặc mảng trống" };
        }

        // Tạo mảng để lưu lại danh sách tên các file thêm thành công
        var successFileNames = [];

        for (var i = 0; i < dataObj.length; i++) {
            var feeData = dataObj[i];

            var feeId = nextId1("esdHTKTpaymentAttachment");
            var itemRec = new SCFile("esdHTKTpaymentAttachment");


            mapPaymentAttachment(itemRec, feeData, feeId);

            var rc = itemRec.doInsert();

            if (rc === true || rc == RC_SUCCESS) {
                // Đẩy tên file vào mảng lưu trữ khi insert thành công
                var fileName = feeData['name'] || "File không tên";
                successFileNames.push(fileName);
            } else {
                // console.error("Không thể chèn file đính kèm: " + feeData['name'] + ". Mã lỗi hệ thống: " + rc);
            }
        }


        if (successFileNames.length === dataObj.length) {
            return {
                success: true,
                message: "Đã thêm thành công tất cả các file: " + successFileNames.join(", ")
            };
        } else if (successFileNames.length > 0) {
            return {
                success: true,
                message: "Thêm thành công các file: " + successFileNames.join(", ") + " (Thất bại " + (dataObj.length - successFileNames.length) + " file)"
            };
        } else {
            return {
                success: false,
                message: "Lưu file đính kèm thất bại. Không có file nào được thêm vào hệ thống."
            };
        }

    } catch (parseError) {
        return { success: false, message: "Bị lỗi khi xử lý dữ liệu: " + parseError.toString() };
    }
}

function mapPaymentAttachment(itemRec, feeData, feeId) {
    itemRec['id'] = feeId;
    itemRec['payment.id'] = feeData['transactionId'];

    itemRec['ecm.doc.id'] = feeData['doc.id'];
    itemRec['ecm.object.id'] = feeData['attach.id'];

    itemRec['name'] = feeData['name'];

    itemRec['uploaded.by'] = feeData['executor'] ;

    if (feeData['size'] !== undefined && feeData['size'] !== null) {
        itemRec['size'] = feeData['size'].toString();
    } else if (feeData['sizeKb'] !== undefined && feeData['sizeKb'] !== null) {
        itemRec['size'] = feeData['sizeKb'].toString();
    } else {
        itemRec['size'] = "0";
    }
    itemRec['doc.code'] = feeData['document.type'] || "DINH_KEM";
    itemRec['uploaded.at'] = new Date();
    itemRec['type'] = "TL_S2";
}

function viewFileAttachment(fileInput) {
    var rawQueryString = fileInput.queryString;
    if (!rawQueryString) {
        return { success: false, message: "Thiếu dữ liệu trong trường queryString" };
    }

    try {
        var dataObj = JSON.parse(rawQueryString);
        var ids = dataObj.objectIds || dataObj.objectId;

        if (!ids || (Array.isArray(ids) && ids.length === 0)) {
            return { success: false, message: "Thiếu 'objectIds' hoặc 'objectId' trong cấu trúc JSON" };
        }

        return lib.ESD_HTKT_INVOICE_ECM.downloadObjectId(ids);
    } catch (parseError) {
        return { success: false, message: "Bị lỗi khi bóc tách JSON (JSON.parse): " + parseError.toString() };
    }
}

function downloadFileAttachment(fileInput) {
    var rawQueryString = fileInput.queryString;
    if (!rawQueryString) {
        return { success: false, message: "Thiếu dữ liệu trong trường queryString" };
    }

    try {
        var dataObj = JSON.parse(rawQueryString);

        var ids = dataObj.objectIds || dataObj.objectId;

        if (!ids || (Array.isArray(ids) && ids.length === 0)) {
            return { success: false, message: "Thiếu 'objectIds' hoặc 'objectId' trong cấu trúc JSON" };
        }

        // Gọi hàm downloadObjectId xử lý tải theo objectId

        return lib.ESD_HTKT_INVOICE_ECM.downloadObjectId(ids);
    } catch (parseError) {
        return { success: false, message: "Bị lỗi khi bóc tách JSON (JSON.parse): " + parseError.toString() };
    }
}

function deleteFileAttachment(fileInput) {
    var rawQueryString = fileInput.queryString;
    if (!rawQueryString) {
        return { success: false, message: "Thiếu dữ liệu trong trường queryString" };
    }

    try {
        var dataObj = JSON.parse(rawQueryString);
        var id = dataObj.docId;

        if (!id) {
            return { success: false, message: "Thiếu trường 'docId' để thực hiện xóa" };
        }

        // Thư viện deleteDocId của bạn nhận vào một string đơn lẻ
        return lib.ESD_HTKT_INVOICE_ECM.deleteDocId(id);
    } catch (parseError) {
        return { success: false, message: "Bị lỗi khi bóc tách JSON (JSON.parse): " + parseError.toString() };
    }
}

function nextId1(name) {
    var rc = new SCDatum();
    var nextNumber = new SCDatum();

    funcs.rtecall("getnumber", rc, nextNumber, name);

    return String(nextNumber || "");
}

// ============================================================================
// TT XDCB - TÀI LIỆU NGUỒN SHTL. Không gọi entrypoint DC, không sao chép/xóa file ECM.
// TH2 qua hồ sơ để tìm HĐ, gộp nguồn SHTL theo HĐ như DC; chưa lưu khóa hồ sơ S6.
// ============================================================================

/** API TT -> phiếu cha đã lưu -> category thật; không tin contract/category/actor từ form. */
function paymentSourceParent(params) {
    var id = String(params.paymentId || params.transactionId || "").trim();
    if (id.indexOf("TT.") !== 0 || !params.currentUser) {
        throw new Error("Thiếu phiếu TT/người thực hiện.");
    }
    var parent = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.expenseSupplierReadOne(
        "esdHTKTpayment",
        'id="' + escapePaymentSourceQuery(id) + '"',
        [
            "id",
            "transaction.type",
            "original.contract.category",
            "contract.id",
            "created.by",
            "initial.role",
            "current.phase"
        ],
        true
    );
    if (parent["transaction.type"] !== "Thanh toán") {
        throw new Error("Phiếu không thuộc luồng Thanh toán.");
    }
    if (params.contractId && String(params.contractId) !== String(parent["contract.id"]))
        throw new Error("HĐ lấy tài liệu khác HĐ trên phiếu TT.");
    return parent;
}

/** Nguồn TT: HHDV ủy quyền reader S2 cũ; XDCB dùng SHTL -> HS-HĐ (TH2) -> HĐ -> esdHDtlks. */
function listPaymentSourceDocuments(input) {
    try {
        var params = parsePaymentSourceInput(input);
        var parent = paymentSourceParent(params);
        if (String(parent["original.contract.category"] || "").toUpperCase() !== "XDCB") {
            var legacy = {
                queryString: JSON.stringify({
                    status: "So hoa thanh cong",
                    contractId: parent["contract.id"],
                    createdBy: parent["created.by"],
                    role: parent["current.phase"] === "initial_kttc" ? "kttc" : parent["initial.role"]
                })
            };
            lib.ESD_HTKT_PAYMENT_CREATE_REQUEST.listFileAttachment(legacy);
            var values = legacy.queryReturnArray || [];
            if (values.toArray) values = values.toArray();
            var legacyRows = [];
            for (var l = 0; l < values.length; l++) {
                var raw = values[l];
                if (raw && typeof raw.getText === "function") {
                    raw = raw.getText();
                }
                var row = typeof raw === "string" ? JSON.parse(raw) : raw;
                legacyRows.push(row.esdHDtlks || row);
            }
            return { 
                success: true, 
                data: legacyRows, 
                contractCategory: "HHDV" 
            };
        }
        lib.ESD_HTKT_PAYMENT_VENDOR.getPaymentXdcbContext(
            { "payment.id": parent.id },
            true,
            params.currentUser
        );
        var source = lib.ESD_HTKT_EXPENSE_CONTRACT.expenseDigitizationReadSourceLinks({
            contractId: parent["contract.id"]
        });
        var refs = source.references["$" + parent["contract.id"]] || [];
        if (!refs.length) {
            return { 
                success: true, 
                data: [], 
                contractCategory: "XDCB"
            };
        }
        var ids = [];
        for (var i = 0; i < refs.length; i++) {
            if (ids.indexOf(refs[i].id) < 0) {
                ids.push(refs[i].id);
            }
        }
        var rows = lib.ESD_HTKT_EXPENSE_FILE_ATTACHMENT.readShtlSourceDocuments(ids, "KB");
        // Giống S2: ngoài KTTC chỉ chọn tài liệu do người tạo phiếu thực hiện số hóa.
        // Dùng phase/role/created.by đã lưu trên phiếu, không dùng role hoặc executor từ client.
        // Lọc riêng tại luồng TT để reader SHTL dùng chung với Dự chi giữ nguyên điều kiện.
        var sourceRole = parent["current.phase"] === "initial_kttc" ? "kttc" : parent["initial.role"];
        if (sourceRole !== "kttc" && parent["created.by"]) {
            var creatorKey = String(parent["created.by"]).toLowerCase();
            rows = rows.filter(function (row) {
                return String(row.executor || "").toLowerCase() === creatorKey;
            });
        }
        return { 
            success: true, 
            data: rows, 
            contractCategory: "XDCB" 
        };
    } catch (error) {
        return { 
            success: false, 
            data: [], 
            message: String(error.message || error) 
        };
    }
}

/** Thêm tài liệu TT: xác minh tất cả ID nguồn trước ghi; tên/ECM metadata luôn đọc lại từ SM. */
function addPaymentSourceDocuments(input) {
    try {
        var params = parsePaymentSourceInput(input);
        var parent = paymentSourceParent(params);
        if (String(parent["original.contract.category"] || "").toUpperCase() !== "XDCB") {
            var oldRows = params.documents || [];
            for (var k = 0; k < oldRows.length; k++) {
                oldRows[k].transactionId = parent.id;
            } 
            return addFileAttachment({ queryString: JSON.stringify(oldRows) });
        }
        // Đọc lại danh sách theo quyền/phase/executor hiện tại trước khi ghi, tránh gửi ID ngoài phạm vi.
        var available = listPaymentSourceDocuments({ details: params });
        if (!available.success) {
            throw new Error(available.message);
        }
        var selected = params.documents || [];
        if (Object.prototype.toString.call(selected) !== "[object Array]" || !selected.length)
            throw new Error("Chưa chọn tài liệu.");
        var validated = [],
            seen = {};
        for (var i = 0; i < selected.length; i++) {
            var found = null;
            for (var j = 0; j < available.data.length; j++)
                if (String(available.data[j].id) === String(selected[i].id)) found = available.data[j];
            if (!found || !found["doc.id"] || !found["attach.id"])
                throw new Error("Tài liệu không thuộc nguồn SHTL của HĐ TT hoặc thiếu ECM ID.");
            if (!seen["$" + found["doc.id"]]) {
                validated.push(found);
            }
            seen["$" + found["doc.id"]] = true;
        }
        var added = 0;
        for (var v = 0; v < validated.length; v++) {
            var doc = validated[v];
            var exists = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.expenseSupplierReadOne(
                "esdHTKTpaymentAttachment",
                'payment.id="' +
                    escapePaymentSourceQuery(parent.id) +
                    '" and ecm.doc.id="' +
                    escapePaymentSourceQuery(doc["doc.id"]) +
                    '"',
                ["id"],
                false
            );
            if (exists) continue; // Retry sau lỗi một phần không tạo trùng liên kết.
            var target = new SCFile("esdHTKTpaymentAttachment");
            try {
                mapPaymentAttachment(target, doc, nextId1("esdHTKTpaymentAttachment"));
                target["payment.id"] = parent.id;
                target["type"] = "TL_S4";
                if (target.doInsert() !== RC_SUCCESS)
                    throw new Error("Không lưu được liên kết tài liệu TT: " + doc.name);
                added++;
            } finally {
                target.doClose();
            }
        }
        return { 
            success: true, 
            added: added, 
            message: "Đã gắn tài liệu SHTL vào phiếu TT." 
        };
    } catch (error) {
        return { 
            success: false, 
            message: String(error.message || error) 
        };
    }
}

/** Bỏ tài liệu S4 khỏi TT: khớp ID + payment.id, giữ nguyên tài liệu nguồn SHTL và ECM. */
function deletePaymentSourceDocument(input) {
    var file = null;
    try {
        var params = parsePaymentSourceInput(input);
        var parent = paymentSourceParent(params);

        lib.ESD_HTKT_PAYMENT_VENDOR.getPaymentXdcbContext(
            { "payment.id": parent.id },
            true,
            params.currentUser
        );

        if (!params.attachmentId) {
            throw new Error("Thiếu ID liên kết tài liệu TT.");
        }

        file = new SCFile("esdHTKTpaymentAttachment");
        var rc = file.doSelect(
            'id="' +
                escapePaymentSourceQuery(params.attachmentId) +
                '" and payment.id="' +
                escapePaymentSourceQuery(parent.id) +
                '" and type="TL_S4"'
        );
        if (rc !== RC_SUCCESS) {
            throw new Error("Không tìm thấy tài liệu S4 trên phiếu TT.");
        }
            
        if (file.doDelete() !== RC_SUCCESS) {
            throw new Error("Không bỏ được liên kết tài liệu TT.");
        }
        return { success: true };
    } catch (error) {
        return { 
            success: false, 
            message: String(error.message || error) 
        };
    } finally {
        if (file) file.doClose();
    }
}

/** Hỗ trợ hai envelope của dispatcher, không dùng eval hoặc JSON từ biến form. */
function parsePaymentSourceInput(input) {
    var raw = (input && (input.details || input.queryString)) || {};
    return typeof raw === "string" ? JSON.parse(raw) : raw;
}

/** Escape giá trị khóa ở native query SM. */
function escapePaymentSourceQuery(value) {
    return String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}
