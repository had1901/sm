// Chỉ chọn và điền NCC; không tạo master, site hoặc lưu dòng TU tại bước này.
if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(vars.$L_file)) {
    try {
        lib.ESD_HTKT_PAYMENT_VENDOR.selectPaymentXdcbSupplier(vars.$L_file, vars.$supplierId);
        vars.$G_hasError = false;
    } catch (sourceError) {
        vars.$supplierCode = "";
        vars.$G_hasError = true;
        vars.$G_errMsg = String(sourceError.message || sourceError);
        vars.$L_action = "do nothing";
    }
} else {
var findVendor = arrVendors.find(x => x['supplier.id'] == vars.$supplierId);

if (findVendor) {

    // Map mã ngân hàng -> tên ngân hàng
    var bankName = findVendor["bank"];

    if (bankName) {
        var bankFile = new SCFile("esdDMcategoryItems");
        var rcBank = bankFile.doSelect(
            'category.id="dmhd_ngan_hang" and item.id="' + bankName + '"'
        );

        if (rcBank == RC_SUCCESS) {
            bankName = bankFile["item.name"];
        }

        try {
            bankFile.doClose();
        } catch (e) {}
    }

    vars.$supplierId = findVendor['supplier.id'];
    vars.$supplierCode = vars.$supplierId || "";
    vars.$supplierName = findVendor['supplier.name'];
    vars.$taxCode = findVendor['tax.code'];
    vars.$remainingAmt = findVendor['remaining.amount'];
//    vars.$L_file['payment.method'] = findVendor['payment.method'];
    vars.$L_file['transaction.des'] = findVendor['description'];
    vars.$L_file['phone'] = findVendor['phone'];
    vars.$supplierAddress = findVendor['address'];
//    vars.$guaranteeNo = findVendor["guarantee.no"];

    // Hiển thị tên ngân hàng thay vì mã
//    vars.$issuingBank = bankName;
//
//    vars.$guaranteeAmount = findVendor["guarantee.amount"];
//    vars.$expireDate = findVendor["expire.date"];
    vars.$currency = "VND";
    vars.$vendorType = findVendor["type"];
}
}
