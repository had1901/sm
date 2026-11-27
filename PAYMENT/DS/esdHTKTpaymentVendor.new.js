try {
  if (system.functions.filename(vars.$L_file) == "ModuleStatus") {
    lib.custom.selectWfPhaseByWorkflow(vars.$L_file.workflow);
  }

  // custom back action
  var table = system.functions.filename(vars.$L_file);
  lib.ESD_Utils.backQueue(table);
} catch (e) { }

// Biến Mã NCC trên FD; HHDV giữ mã cũ, loader XDCB sẽ điền mã đã lưu tại S6.
vars.$supplierCode = vars.$supplierId || "";

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
vars.$showContractDossier = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.loadContractDossierScreen(vars.$L_file) === true;
print('vars.$showContractDossier - new = ', vars.$showContractDossier);

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
  // BƯỚC 1: LẤY THÔNG TIN TỪ BẢNG THANH TOÁN (Nếu chưa có contractId hoặc des)
  // =========================================================================
  var paymentDescription = "";
  var paymentFile = new SCFile("esdHTKTpayment");
  var rcPayment = paymentFile.doSelect('id="' + String(paymentId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
  if (rcPayment == RC_SUCCESS) {
    if (!contractId) {
      contractId = paymentFile["contract.id"];
      vars.$L_file['contract.id'] = contractId;
    }
    paymentDescription = paymentFile["description"] || "";
  }
  try { if (paymentFile) paymentFile.doClose(); } catch (eP) { }

  // =========================================================================
  // BƯỚC 2: LOGIC LOẠI TRỪ DÀNH CHO DỰ CHI (DC)
  // =========================================================================
  var excludedSupplierIds = {};

  if (isDC) {
    var paymentVendorFile = new SCFile("esdHTKTpaymentVendor");
    var paymentVendorQuery = 'payment.id="' + String(paymentId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    if (contractId) {
      paymentVendorQuery += ' and contract.id="' + String(contractId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }
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
    try { if (paymentVendorFile) paymentVendorFile.doClose(); } catch (ePV) { }
  }

  // =========================================================================
  // BƯỚC 3: QUERY LẤY NCC TRỰC TIẾP TỪ HỢP ĐỒNG (esdHDcontractSupplier)
  // =========================================================================
  arrVendors = [];
  var seenSupplierIds = {};

  if (contractId) {
    var hdVendorFile = new SCFile("esdHDcontractSupplier");
    var hdVendorQuery = 'contract.id="' + String(contractId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    var rcHdVendor = hdVendorFile.doSelect(hdVendorQuery);

    while (rcHdVendor == RC_SUCCESS) {
      var currentSupplierId = hdVendorFile["supplier.id"];

      // CHỈ DỰ CHI: Bỏ qua nếu NCC này đã có ở món khác
      if (isDC && excludedSupplierIds[currentSupplierId]) {
        rcHdVendor = hdVendorFile.getNext();
        continue;
      }

      if (currentSupplierId && !seenSupplierIds[currentSupplierId]) {
        // Lấy thông tin bổ sung từ danh mục esdDMSupplier (MST, Address, Type)
        var taxCode = "";
        var address = "";
        var dmType = "";

        var dmSupplierFile = new SCFile("esdDMSupplier");
        var rcDm = dmSupplierFile.doSelect('id="' + String(currentSupplierId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');
        if (rcDm == RC_SUCCESS) {
          taxCode = dmSupplierFile["tax.code"] || "";
          address = dmSupplierFile["address"] || "";
          dmType = dmSupplierFile["type"] || "";
        }
        try { if (dmSupplierFile) dmSupplierFile.doClose(); } catch (eDm) { }

        arrVendors.push({
          "supplier.id": currentSupplierId,
          "supplier.name": hdVendorFile["supplier.name"],
          "payment.method": hdVendorFile["payment.method"],
          "remaining.amount": hdVendorFile["unpaid.amount"],
          "tax.code": taxCode,
          "bank": hdVendorFile["bank"],
          "expire.date": hdVendorFile["expire.date"],
          "address": address,
          "type": dmType,
          "transaction.des": paymentDescription
        });

        seenSupplierIds[currentSupplierId] = true;
      }

      rcHdVendor = hdVendorFile.getNext();
    }
    try { if (hdVendorFile) hdVendorFile.doClose(); } catch (eHd) { }
  }

  // Gán mô tả giao dịch từ dòng đầu tiên
  if (arrVendors.length > 0 && arrVendors[0]["transaction.des"]) {
    if (!vars.$L_file["transaction.des"]) {
      vars.$L_file["transaction.des"] = arrVendors[0]["transaction.des"];
    }
    vars.$G_description = arrVendors[0]["transaction.des"];
  }

  // Set vào biến cho droplist
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