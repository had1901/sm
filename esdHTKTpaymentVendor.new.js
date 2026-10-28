try {
  if (system.functions.filename(vars.$L_file) == "ModuleStatus") {
    lib.custom.selectWfPhaseByWorkflow(vars.$L_file.workflow);
  }

  //custom back action
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



// 1. Lấy payment.id từ biến $G.payment.id (hoặc fallback về $L.file nếu cần)
var paymentId = vars.$L_file['payment.id'] || vars.$G_payment_id;
var contractId = vars.$L_file['contract.id'] || vars.$G_contract_id;
if (!paymentId && vars.$L_file && vars.$L_file.payment_id != null) {
  paymentId = vars.$L_file.payment_id;
}
vars.$L_file['payment.id'] = paymentId;
vars.$L_file['contract.id'] = contractId;

// Chỉ thực hiện truy vấn nếu có paymentId
if (paymentId || vars.$L_file['payment.id']) {
  var usedSupplierIds = {};
  var paymentVendorFile = new SCFile("esdHTKTpaymentVendor");
  var paymentVendorQuery = 'payment.id="' + paymentId + '"';
  if (contractId) {
    paymentVendorQuery += ' and contract.id="' + contractId + '"';
  }
  var rc = paymentVendorFile.doSelect(paymentVendorQuery);

  while (rc == RC_SUCCESS) {
    var vId = paymentVendorFile["vendor.id"];

    // Nếu vId rỗng, nó sẽ không vào block if này -> không thêm vào danh sách lọc
    if (vId != null && vId != "") {
      var vendorFile = new SCFile("esdHTKTvendor");
      var rcVendor = vendorFile.doSelect('id="' + vId + '"');

      if (rcVendor == RC_SUCCESS) {
        var sId = vendorFile["supplier.id"];
        // Chỉ thêm vào danh sách loại trừ nếu có supplier.id hợp lệ
        if (sId != null && sId != "") {
          usedSupplierIds[sId] = true;
        }
      }
    }
    rc = paymentVendorFile.getNext();
  }
  try {
    if (paymentVendorFile) paymentVendorFile.doClose();
  } catch (e) { }
  // BƯỚC B: Query lấy NCC từ Hợp đồng và lọc
  arrVendors = [];
  var itemFile = new SCFile("esdHTKTpayment");

  var contractJoinCondition = contractId
    ? 'hdVendor.contract.id = "' + String(contractId).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"'
    : 'htktPayment.contract.id = hdVendor.contract.id';

  var itemQuery =
    `select hdVendor.contract.id as contract.id, hdVendor.supplier.id as supplier.id, hdVendor.supplier.name as supplier.name,` +
    ` hdVendor.payment.method as payment.method, hdVendor.unpaid.amount as unpaid.amount,` +
    ` dmVendor.tax.code as tax.code,htktPayment.description as description, dmVendor.address as address, dmVendor.type as type,` +
    ` htktPayment.unit.lv1 as unit.lv1` + // Lấy unit.lv1 từ phiếu cha
    ` from esdHTKTpayment htktPayment` +
    ` JOIN esdHDcontractSupplier hdVendor ON (` + contractJoinCondition + `)` +
    ` JOIN esdDMSupplier dmVendor ON (hdVendor.supplier.id = dmVendor.id)` +
    ` where htktPayment.id = "` +
    paymentId +
    `"`;

  var rcItem = itemFile.doSelect(itemQuery);
    
  while (rcItem == RC_SUCCESS) {
    var currentSupplierId = itemFile["supplier.id"];
    var currentContractId = itemFile['contract.id'];

    // Lấy thông tin bảo lãnh từ kết quả query
    // Lưu ý: Tên field trong itemFile sẽ tương ứng với các alias đã đặt trong SELECT
    if (!usedSupplierIds[currentSupplierId]) {

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
      usedSupplierIds[currentSupplierId] = true;
    }
    rcItem = itemFile.getNext();
    if(arrVendors[0]) vars.$L_file["transaction.des"] = arrVendors[0]["transaction.des"]
    if(arrVendors[0]) vars.$G_description = arrVendors[0]["transaction.des"]
  }
  try {
    if (itemFile) itemFile.doClose();
  } catch (e) { }

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
