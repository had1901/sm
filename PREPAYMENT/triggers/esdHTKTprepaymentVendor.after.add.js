
var prepayId = record["prepayment.id"];

if (prepayId != null && prepayId !== "") {
    var totalAmount = 0;
    var vendorFile = new SCFile("esdHTKTprepaymentVendor", SCFILE_READONLY);
    var query = 'prepayment.id="' + prepayId + '"';
    
    try {
        var rcVendor = vendorFile.doSelect(query);
        while (rcVendor === RC_SUCCESS) {
            // Lấy số tiền của từng dòng NCC
            var rawAmt = vendorFile["amount"];
            var numAmt = 0;
            
            // Xử lý an toàn: Xóa dấu phẩy (nếu có) và parse sang số thực
            if (rawAmt != null && rawAmt !== "") {
                var cleanString = String(rawAmt).replace(/,/g, '');
                numAmt = parseFloat(cleanString);
                if (isNaN(numAmt)) numAmt = 0;
            }
            
            totalAmount += numAmt;
            rcVendor = vendorFile.getNext();
        }
    } catch(ex) {
        print("[ERROR] Lỗi khi tính tổng tiền Vendor: " + ex);
    } finally {
        try { if(vendorFile) vendorFile.doClose(); } catch(e) {}
    }

    // Tiến hành update vào bảng chính esdHTKTprepayment
    var prepayFile = new SCFile("esdHTKTprepayment");
    try {
        var rcPrepay = prepayFile.doSelect('id="' + prepayId + '"');
        if (rcPrepay === RC_SUCCESS) {
             prepayFile["amount"] = totalAmount;

            prepayFile.doUpdate();
        }
    } catch(ex) {
        print("[ERROR] Lỗi khi update bảng esdHTKTprepayment: " + ex);
    } finally {
        try { if(prepayFile) prepayFile.doClose(); } catch(e) {}
    }
}


system.library.ESD_HTKT_PREPAYMENT_ENTRY
    .syncPrepaymentEntryBySourceChange(
        "esdHTKTprepaymentVendor",
        record
    );