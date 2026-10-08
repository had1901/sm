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
