try {
  if (system.functions.filename(vars.$L_file) == "ModuleStatus") {
    lib.custom.selectWfPhaseByWorkflow(vars.$L_file.workflow);
  }

  // custom back action
  var table = system.functions.filename(vars.$L_file);
  lib.ESD_Utils.backQueue(table);
} catch (e) { }

vars.$canEditSite = false;
vars.$approvedInvoiceAmount = 0;
vars.$amount = 0;
vars.$refundAmount = 0;
vars.$payableAmount = 0;

// Chỉ gán false nếu biến này CHƯA TỪNG ĐƯỢC TẠO (lần đầu vào màn hình)
if (vars.$isSupplierDisabled === undefined || vars.$isSupplierDisabled === null || vars.$isSupplierDisabled === "null") {
  vars.$isSupplierDisabled = false;
}

vars.$L_mode = (vars.$isSupplierDisabled === true || vars.$isSupplierDisabled === "true") ? "view" : "add";

// 1. Lấy payment.id và contract.id từ biến $G hoặc $L.file
var paymentId = vars.$L_file['payment.id'] || vars.$G_payment_id;
var contractId = vars.$L_file['contract.id'] || vars.$G_contract_id;
if (!paymentId && vars.$L_file && vars.$L_file.payment_id != null) {
  paymentId = vars.$L_file.payment_id;
}
vars.$L_file['payment.id'] = paymentId;
vars.$L_file['contract.id'] = contractId;

// Dùng khóa hồ sơ đúng nguồn TT/DC, chỉ điền các biến đọc cho hàng thông tin TH2.
lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.loadContractDossierScreen(vars.$L_file);

// ID của món hiện tại (nếu đang ở màn hình xem/sửa món đã tồn tại)
var currentItemId = vars.$L_file ? (vars.$L_file['id'] || vars.$L_file.id || vars.$G_payment_vendor_id) : null;

// CỜ KIỂM TRA PHIẾU DỰ CHI (DC)
var isDC = (paymentId && String(paymentId).indexOf("DC.") === 0) ||
           (vars.$L_file && (vars.$L_file["transaction.type"] === "Dự chi" || vars.$L_file.transaction_type === "Dự chi"));

arrVendors = [];


if (lib.ESD_HTKT_PAYMENT_VENDOR.isPaymentXdcb(vars.$L_file)) {
  // TT XDCB: loader đọc nguồn SHTL và lọc NCC đã có theo MST; không JOIN danh mục S2.
  arrVendors = lib.ESD_HTKT_PAYMENT_VENDOR.loadPaymentXdcbVendorInfoSafe(vars.$L_file);
} else if (paymentId || vars.$L_file['payment.id']) { // Chỉ thực hiện truy vấn nếu có paymentId

  // =========================================================================
  // LOGIC DÀNH RIÊNG CHO DỰ CHI (DC):
  // Nếu là TT hoặc các loại khác thì bỏ qua khối này, excludedSupplierIds luôn rỗng
  // =========================================================================
  var excludedSupplierIds = {};

  if (isDC) {
    var paymentVendorFile = new SCFile("esdHTKTpaymentVendor");
    var paymentVendorQuery = 'payment.id="' + String(paymentId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    if (contractId) {
      paymentVendorQuery += ' and contract.id="' + String(contractId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }
    // Nếu đang xem/sửa món đã có: loại trừ chính món đó ra để vẫn hiển thị NCC của món này
    if (currentItemId) {
      paymentVendorQuery += ' and id~="' + String(currentItemId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    var rc = paymentVendorFile.doSelect(paymentVendorQuery);
    while (rc == RC_SUCCESS) {
      var vId = paymentVendorFile["vendor.id"];
      if (vId != null && vId != "") {
        var vendorFile = new SCFile("esdHTKTvendor");
        var rcVendor = vendorFile.doSelect('id="' + String(vId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
        if (rcVendor == RC_SUCCESS) {
          var sId = vendorFile["supplier.id"];
          if (sId != null && sId != "") {
            excludedSupplierIds[sId] = true;
          }
        }
        try { vendorFile.doClose(); } catch (eVendor) { }
      }
      rc = paymentVendorFile.getNext();
    }
    try {
      if (paymentVendorFile) paymentVendorFile.doClose();
    } catch (ePV) { }
  }

  // =========================================================================
  // BƯỚC B: Query lấy NCC từ Hợp đồng
  // =========================================================================
  arrVendors = [];
  var seenSupplierIds = {}; // Biến dedup nguyên bản của logic cũ (chạy cho TT, TU, DC...)
  var itemFile = new SCFile("esdHTKTpayment");

  var contractJoinCondition = contractId
    ? 'hdVendor.contract.id = "' + String(contractId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
    : 'htktPayment.contract.id = hdVendor.contract.id';

  var itemQuery =
    `select hdVendor.contract.id as contract.id, hdVendor.supplier.id as supplier.id, hdVendor.supplier.name as supplier.name,` +
    ` hdVendor.payment.method as payment.method, hdVendor.unpaid.amount as unpaid.amount,` +
    ` dmVendor.tax.code as tax.code, htktPayment.description as description, dmVendor.address as address, dmVendor.type as type,` +
    ` htktPayment.unit.lv1 as unit.lv1` +
    ` from esdHTKTpayment htktPayment` +
    ` JOIN esdHDcontractSupplier hdVendor ON (` + contractJoinCondition + `)` +
    ` JOIN esdDMSupplier dmVendor ON (hdVendor.supplier.id = dmVendor.id)` +
    ` where htktPayment.id = "` + String(paymentId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + `"`;

  var rcItem = itemFile.doSelect(itemQuery);

  while (rcItem == RC_SUCCESS) {
    var currentSupplierId = itemFile["supplier.id"];
    var currentContractId = itemFile['contract.id'];

    // CHỈ DỰ CHI: Bỏ qua nếu NCC này đã có ở món khác của hợp đồng này trong cùng ĐNDC
    if (isDC && excludedSupplierIds[currentSupplierId]) {
      rcItem = itemFile.getNext();
      continue;
    }

    // LOGIC CŨ CHO TT & TU (và các NCC hợp lệ của DC): Chống nhân bản dòng do SQL JOIN
    if (!seenSupplierIds[currentSupplierId]) {
      arrVendors.push({
        "supplier.id": currentSupplierId,
        "supplier.name": itemFile["supplier.name"],
        "payment.method": itemFile["payment.method"],
        "remaining.amount": itemFile['unpaid.amount'],
        "tax.code": itemFile["tax.code"],
        "bank": itemFile["bank"],
        "expire.date": itemFile["expire.date"],
        "address": itemFile["address"],
        "type": itemFile["type"],
        "transaction.des": itemFile["description"]
      });
      seenSupplierIds[currentSupplierId] = true;
    }
    rcItem = itemFile.getNext();
  }
  try {
    if (itemFile) itemFile.doClose();
  } catch (eItem) { }

  // Gán mô tả giao dịch từ dòng đầu tiên (chạy 1 lần ngoài vòng lặp)
  if (arrVendors.length > 0 && arrVendors[0]["transaction.des"]) {
    if (!vars.$L_file["transaction.des"]) {
      vars.$L_file["transaction.des"] = arrVendors[0]["transaction.des"];
    }
    vars.$G_description = arrVendors[0]["transaction.des"];
  }

  // 4. Set vào biến cho droplist và các biến bảo lãnh (lấy dòng đầu tiên nếu có)
  vars.$supplierdisplays = arrVendors.map((x) => x["supplier.name"]);
  vars.$suppliervalues = arrVendors.map((x) => x["supplier.id"]);
} else {
  vars.$supplierdisplays = [];
  vars.$suppliervalues = [];
}

// droplist ngan hang thu huong
var bankList = lib.ESD_HTKT_ACCOUNTING_UTILS.getBankDroplist();
vars.$bankcode = bankList.map(b => `${b.code}|${b.citad}|${b.napas}`);
vars.$bankname = bankList.map(b => b.name);