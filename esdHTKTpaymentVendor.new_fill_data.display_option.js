//Button du chi
var findVendor = arrVendors.find(x => x['supplier.id'] == vars.$supplierId);
if (findVendor) {
    vars.$supplierId = findVendor['supplier.id'];
    vars.$supplierName = findVendor['supplier.name'];
    vars.$taxCode = findVendor['tax.code'];
    vars.$L_file['transaction.des'] = findVendor['description'];
    vars.$currency = "VND";
    vars.$vendorType = findVendor["type"];
    vars.$G_supplier_id = findVendor['supplier.id'];
    vars.$L_file["transaction.des"] = vars.$G_description
}