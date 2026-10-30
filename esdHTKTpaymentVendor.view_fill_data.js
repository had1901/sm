//var findVendor = arrVendors.find(x => x['supplier.id'] == vars.$supplierId);
//
//if (findVendor) {
//    vars.$supplierId = findVendor['supplier.id'];
//    vars.$supplierName = findVendor['supplier.name'];
//    vars.$taxCode = findVendor['tax.code'];
//    vars.$L_file['transaction.des'] = findVendor['description'];
//    vars.$currency = "VND";
//    vars.$G_supplier_id = findVendor['supplier.id'];
//}



if (lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseSupplierContext(vars.$L_file, "", false).category === "XDCB") {
    try {
        lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.selectExpenseSupplier(vars.$L_file, vars.$supplierId);
        vars.$G_hasError = false;
        vars.$G_errMsg = "";
    } catch (supplierError) {
        lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.clearExpenseSupplierScreenDraft();
        // Xóa thông tin lựa chọn lỗi để Save không dùng lại tên/MST của NCC trước.
        vars.$supplierId = "";
        vars.$supplierName = "";
        vars.$taxCode = "";
        vars.$supplierAddress = "";
        vars.$G_supplier_id = "";
        vars.$vendorType = "";
        vars.$G_hasError = true;
        vars.$G_errMsg = String(supplierError.message || supplierError);
        vars.$L_action = "do nothing";
    }
} else {
    // Giữ nguyên Pre JavaScript của DO view_fill_data cho HHDV.
    // Danh sách từ SM có thể là Datum; duyệt đúng option đang có, không nạp lại form.
    var supplierOptions = typeof arrVendors !== "undefined" ? arrVendors : [];
    if (supplierOptions && typeof supplierOptions.toArray === "function") {
        supplierOptions = supplierOptions.toArray();
    }
    var findVendor = null;
    for (var supplierIndex = 0; supplierOptions && supplierIndex < supplierOptions.length; supplierIndex++) {
        if (supplierOptions[supplierIndex] && supplierOptions[supplierIndex]["supplier.id"] == vars.$supplierId) {
            findVendor = supplierOptions[supplierIndex];
            break;
        }
    }
    if (findVendor) {
        vars.$supplierId = findVendor["supplier.id"];
        vars.$supplierName = findVendor["supplier.name"];
        vars.$taxCode = findVendor["tax.code"];
        vars.$L_file["transaction.des"] = findVendor["description"];
        vars.$currency = "VND";
        vars.$G_supplier_id = findVendor["supplier.id"];
    }
}


