try {
    if (system.functions.filename(vars.$L_file)=="ModuleStatus")
    {
        lib.custom.selectWfPhaseByWorkflow(vars.$L_file.workflow);
    }
    
    //custom back action
    var table = system.functions.filename(vars.$L_file);
    lib.ESD_Utils.backQueue(table);
} catch (e) {}

//custom back action
vars.$showSyncVendorOgl = false;
vars.$canEditSite = false;
var table = system.functions.filename(vars.$L_file);
lib.ESD_Utils.backQueue(table);
if (vars.$L_file.payment_method == null || vars.$L_file.payment_method == "") {
    vars.$L_file.payment_method = "CHUYENKHOAN";
}

// 1. Lấy prepayment.id từ biến $G.prepayment.id (hoặc fallback về $L.file nếu cần)
var prepaymentId = vars.$G_prepayment_id; 
if (!prepaymentId && vars.$L_file && vars.$L_file.prepayment_id != null) {
        prepaymentId = vars.$L_file.prepayment_id;
    vars.$L_file.prepayment_id = prepaymentId;
}
// Chỉ thực hiện truy vấn nếu có prepaymentId
if (prepaymentId) {
    var usedSupplierIds = {}; 
    var prepaymentVendorFile = new SCFile("esdHTKTprepaymentVendor"); 
    var rc = prepaymentVendorFile.doSelect("prepayment.id=\"" + prepaymentId + "\""); 
//    var firstPaymentMethod = "";
    while (rc == RC_SUCCESS) {
//     if (!firstPaymentMethod && prepaymentVendorFile["payment.method"]) {
//        firstPaymentMethod = prepaymentVendorFile["payment.method"];
//    }
        var vId = prepaymentVendorFile['vendor.id']; 
        
        // Nếu vId rỗng, nó sẽ không vào block if này -> không thêm vào danh sách lọc
        if (vId != null && vId != "") {
            var vendorFile = new SCFile("esdHTKTvendor"); 
            var rcVendor = vendorFile.doSelect("id=\"" + vId + "\"");
            
            if (rcVendor == RC_SUCCESS) {
                var sId = vendorFile['supplier.id']; 
                // Chỉ thêm vào danh sách loại trừ nếu có supplier.id hợp lệ
                if (sId != null && sId != "") {
                    usedSupplierIds[sId] = true; 
                }
            }
        }
        rc = prepaymentVendorFile.getNext();
    }
    try { if (prepaymentVendorFile) prepaymentVendorFile.doClose(); } catch (e) {}
    // BƯỚC B: Query lấy NCC từ Hợp đồng và lọc
    arrVendors = [];
    var itemFile = new SCFile("esdHTKTprepayment");
    
var itemQuery = `select htktPrepayment.contract.id as contract.id, hdVendor.supplier.id as supplier.id, hdVendor.supplier.name as supplier.name,` +
        ` hdVendor.payment.method as payment.method, hdVendor.unpaid.amount as remaining.amount,` +
        ` dmVendor.tax.code as tax.code,htktPrepayment.description as description, dmVendor.address as address, dmVendor.type as type,` +
        ` g.doc.no as guarantee.no, g.issuing.bank as bank, g.guarantee.amount as guarantee.amount, g.expire.date as expire.date` +
        ` from esdHTKTprepayment htktPrepayment` +
        ` JOIN esdHDcontractSupplier hdVendor ON (htktPrepayment.contract.id = hdVendor.contract.id)` +
        ` JOIN esdDMSupplier dmVendor ON (hdVendor.supplier.id = dmVendor.id)` +
        ` LEFT JOIN esdHDcontractDocInfo g ON (htktPrepayment.contract.id = g.contract.id AND g.doc.type = "BAOLANHTU" AND g.status = "Co hieu luc")` +
        ` where htktPrepayment.id = "` + prepaymentId + `"`;
        
    var rcItem = itemFile.doSelect(itemQuery);
var isGuaranteeFilled = false;
while (rcItem == RC_SUCCESS) {


if (!isGuaranteeFilled) {
            vars.$guaranteeNo     = itemFile['guarantee.no'];
//            vars.$issuingBank             = itemFile['bank'];
            vars.$guaranteeAmount = itemFile['guarantee.amount'];
            vars.$expireDate      = itemFile['expire.date'];
            var bankCode = itemFile['bank'];
            var bankNameDisplay = bankCode; // Mặc định hiển thị mã nếu không map được
            
            if (bankCode) {
                var bankMapFile = new SCFile("esdDMcategoryItems", SCFILE_READONLY);
                var rcBankMap = bankMapFile.doSelect('category.id="dmhd_ngan_hang" and item.id="' + bankCode + '"');
                
                if (rcBankMap == RC_SUCCESS) {
                    bankNameDisplay = bankMapFile["item.name"]; // Lấy tên ngân hàng
                }
                
                try { bankMapFile.doClose(); } catch (e) {}
            }
            vars.$issuingBank = bankNameDisplay;
            
            isGuaranteeFilled = true;
        }
        
        var currentSupplierId = itemFile['supplier.id'];
        var currentContractId = itemFile['contract.id'];

        if (!usedSupplierIds[currentSupplierId]) {
                
                // Không tính lại số tiền còn lại tại đây vì remaining.amount
                // đã lấy trực tiếp từ hdVendor.unpaid.amount.
                // Tổng tiền đã tạm ứng của NCC trong các phiếu
                // approved / accounted
//                var finalRemainingAmount = String(itemFile['remaining.amount'] || "0");
//                var totalApprovedAmount = "0";
//                
//                var hasApprovedTicket = false;
//                
//                var checkFile =
//                    new SCFile("esdHTKTprepaymentVendor");
//                
//                var checkQuery =
//                    `select pv.amount as amount ` +
//                    `from esdHTKTprepaymentVendor pv ` +
//                    `join esdHTKTprepayment p ` +
//                    `on (pv.prepayment.id = p.id) ` +
//                    `join esdHTKTvendor v ` +
//                    `on (pv.vendor.id = v.id) ` +
//                    `where p.contract.id = "` +
//                    currentContractId +
//                    `" and v.supplier.id = "` +
//                    currentSupplierId +
//                    `" and (p.status = "approved" or p.status = "accounted")`;
//                
//                var rcCheck =
//                    checkFile.doSelect(checkQuery);
//                
//                while (rcCheck == RC_SUCCESS) {
//                
//                    hasApprovedTicket = true;
//                
//                    totalApprovedAmount =
//                        lib.ESD_HTKT_Utils.addStringsManual(
//                            totalApprovedAmount,
//                            String(checkFile["amount"] || "0")
//                        );
//                
//                    rcCheck =
//                        checkFile.getNext();
//                }
//                
//                try {
//                    if (checkFile) {
//                        checkFile.doClose();
//                    }
//                } catch (e) {}
//                
//                
//            // ----------------------------------------------------------------
//            // 2. TỔNG TIỀN ĐÃ THANH TOÁN (THÊM MỚI Ở ĐÂY)
//            // ----------------------------------------------------------------
//            var totalPaidAmount = "0";
//            var hasPaidTicket = false;
//            
//            // THAY ĐỔI TÊN BẢNG THANH TOÁN TẠI ĐÂY NẾU HỆ THỐNG KHÔNG PHẢI LÀ esdHTKTpaymentVendor / esdHTKTpayment
//            var checkPaymentFile = new SCFile("esdHTKTpaymentVendor"); 
//            
//            var checkPaymentQuery =
//                `select pv.amount as amount ` +
//                `from esdHTKTpaymentVendor pv ` +
//                `join esdHTKTpayment p on (pv.payment.id = p.id) ` +
//                `join esdHTKTvendor v on (pv.vendor.id = v.id) ` +
//                `where p.contract.id = "` + currentContractId +
//                `" and v.supplier.id = "` + currentSupplierId +
//                `" and (p.status = "approved" or p.status = "accounted")`;
//            
//            var rcPaymentCheck = checkPaymentFile.doSelect(checkPaymentQuery);
//            
//            while (rcPaymentCheck == RC_SUCCESS) {
//                hasPaidTicket = true;
//                totalPaidAmount = lib.ESD_HTKT_Utils.addStringsManual(
//                    totalPaidAmount,
//                    String(checkPaymentFile["amount"] || "0")
//                );
//                rcPaymentCheck = checkPaymentFile.getNext();
//            }
//            try { if (checkPaymentFile) { checkPaymentFile.doClose(); } } catch (e) {}
//            
//            
//            // ================================================================
//            // SỐ TIỀN CÒN LẠI = Tổng tiền ban đầu - Tổng đã tạm ứng - Tổng đã thanh toán
//            // ================================================================
//            // Trừ tiền tạm ứng
//            if (hasApprovedTicket) {
//                finalRemainingAmount = lib.ESD_HTKT_Utils.subtractStringsManual(
//                    finalRemainingAmount,
//                    totalApprovedAmount
//                );
//            }
//            
//            // Trừ tiền thanh toán
//            if (hasPaidTicket) {
//                finalRemainingAmount = lib.ESD_HTKT_Utils.subtractStringsManual(
//                    finalRemainingAmount,
//                    totalPaidAmount
//                );
//            }
                
            arrVendors.push({
                "supplier.id": currentSupplierId, 
                "supplier.name": itemFile['supplier.name'],
//              "payment.method": itemFile['payment.method'],
//              "payment.method": firstPaymentMethod
//              ? firstPaymentMethod
//              : itemFile["payment.method"],
//                "remaining.amount": finalRemainingAmount,
                "remaining.amount": itemFile['remaining.amount'],
                "tax.code": itemFile['tax.code'],
//                "guarantee.no": itemFile['guarantee.no'],
//                "bank": itemFile['bank'],
//                "guarantee.amount": itemFile['guarantee.amount'],
//                "expire.date": itemFile['expire.date'],
                "description": itemFile['description'],
                "address": itemFile['address'],
                 "type": itemFile['type'],
            });
            usedSupplierIds[currentSupplierId] = true;
        }
        rcItem = itemFile.getNext();
    }
    try { if (itemFile) itemFile.doClose(); } catch (e) {}

    // 4. Set vào biến cho droplist và các biến bảo lãnh (lấy dòng đầu tiên nếu có)
    vars.$supplierdisplays = arrVendors.map(x => x["supplier.name"]);
    vars.$suppliervalues = arrVendors.map(x => x["supplier.id"]);
} else {
    vars.$supplierdisplays = [];
    vars.$suppliervalues = [];
}


// droplist ngan hang thu huong
var bankList = lib.ESD_HTKT_ACCOUNTING_UTILS.getBankDroplist();
vars.$bankcode = bankList.map(b => `${b.code}|${b.citad}|${b.napas}`);
vars.$bankname = bankList.map(b => b.name);
