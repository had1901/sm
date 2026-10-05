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
            //Danh sách Đề nghị theo nhà cung cấp
            case 'getListPrepaymentVendor':
                var data = lib.ESD_HTKT_PREPAYMENT_VENDOR.getListPrepaymentVendor(input);
                result = { success: true, data: data };
                break;
                //tổng nhà cung cấp
            case 'totalContractSuppliers':
                var data = lib.ESD_HTKT_PREPAYMENT_VENDOR.totalContractSuppliers(input);
                result = { success: true, data: data };
                break;
                //Gỡ hóa đơn vào nhà cung cấp
            case 'deletePrepaymentVendor':
                var data = lib.ESD_HTKT_PREPAYMENT_VENDOR.deletePrepaymentVendor(input);
                result = { success: true, data: data };
                break;
                //Danh sách Hóa đơn có thể chọn theo nhà cung cấp
            case 'getListInvoinVendor':
                var data = lib.ESD_HTKT_PREPAYMENT_VENDOR.getListInvoinVendor(input);
                result = { success: true, data: data };
                break;
                //Danh sách Hóa đơn đã được gán với nhà cung cấp
            case 'getInvoicesBySupplier':
                var data = lib.ESD_HTKT_PREPAYMENT_VENDOR.getInvoicesBySupplier(input);
                result = { success: true, data: data };
                break;
                //Gán hóa đơn vào nhà cung cấp
            case 'createListInvoinVendor':
                var data = lib.ESD_HTKT_PREPAYMENT_VENDOR.createListInvoinVendor(input);
                result = { success: true, data: data };
                break;
                //cập nhật Loại khấu trừ thuế 
            case 'updateListInvoinVendor':
                var data = lib.ESD_HTKT_PREPAYMENT_VENDOR.updateListInvoinVendor(input);
                result = { success: true, data: data };
                break;

                // ho so dinh kem
            case 'addFileAttachment':
                result = lib.ESD_HTKT_PREPAYMENT_FILE_ATTACHMENT.addFileAttachment(input);
                break;

            case 'viewFileAttachment':
                result = lib.ESD_HTKT_PREPAYMENT_FILE_ATTACHMENT.viewFileAttachment(input);
                break;

            case 'downloadFileAttachment':
                result = lib.ESD_HTKT_PREPAYMENT_FILE_ATTACHMENT.downloadFileAttachment(input);
                break;

            case 'deleteFileAttachment':
                result = lib.ESD_HTKT_PREPAYMENT_FILE_ATTACHMENT.deleteFileAttachment(input);
                break;

                // cong no
            case 'getListSupplierLedger':
                var invoices = lib.ESD_HTKT_PREPAYMENT_SUPPLIER_LEDGER_LIST.getListSupplierLedger(input);
                result = { success: true, data: invoices };
                break;
            case 'getListAccountsPayable':
                var invoices = lib.ESD_HTKT_PREPAYMENT_SUPPLIER_LEDGER_LIST.getListAccountsPayable(input);
                result = { success: true, data: invoices };
                break;

                //
            case 'getListPrepaymentInvoice':
                var invoices = lib.ESD_HTKT_PREPAYMENT_INVOICE.getListPrepaymentInvoice(input);
                result = { success: true, data: invoices };
                break;

            case 'deletePrepaymentInvoice':
                var invoices = lib.ESD_HTKT_PREPAYMENT_INVOICE.deletePrepaymentInvoice(input);
                result = { success: true, data: invoices };
                break;


                // truong hach toan

                // Danh sach hach toan
            case 'getListPrepaymentEntry':
                result = lib.ESD_HTKT_PREPAYMENT_ENTRY.getListPrepaymentEntryByInputDetails(input);
                break;

                // Sinh but toan tu dong
            case 'syncPrepaymentEntry':
                result = lib.ESD_HTKT_PREPAYMENT_ENTRY.syncPrepaymentEntryNowByInputDetails(input);
                break;

                // Sinh but toan tu dong khi nguon sinh thay doi
            case 'syncPrepaymentEntryBySourceChange':
                result = lib.ESD_HTKT_PREPAYMENT_ENTRY.syncPrepaymentEntryBySourceChange(
                    safeString(details.sourceTable || input.sourceTable).trim(),
                    details
                );
                break;

                // Luu chinh sua
            case 'savePrepaymentEntryEdit':
                result = lib.ESD_HTKT_PREPAYMENT_ENTRY.savePrepaymentEntryEdit(input);
                break;

                // Lay tai khoan tam ung, GL
            case 'getListGlAccount':
                result = lib.ESD_HTKT_PREPAYMENT_ENTRY.getListGlAccount();
                break;
                
             //tao phieu tam ung
             case 'createAdvanceRequest':
                result = lib.ESD_HTKT_PREPAYMENT_CREATE_ADVANCE_REQUEST.createAdvanceRequest(input);
                break;
                
            // Danh sách hợp đồng
            case 'listPurchaseContracts': 
			    result = lib.ESD_HTKT_PREPAYMENT_CREATE_ADVANCE_REQUEST.listPurchaseContracts(input);
			    break;  

            case 'listFileAttachment':
                lib.ESD_HTKT_PREPAYMENT_CREATE_ADVANCE_REQUEST.listFileAttachment(input);
                break;
             //bao cao
             case 'getListReportPayment':
                var data = lib.ESD_HTKT_REPORT.getListReportPayment(input);
                result = { success: true, data: data };
                break;
             case 'getListLiabilities':
                var data = lib.ESD_HTKT_REPORT.getListLiabilities(input);
                result = { success: true, data: data };
                break;
             case 'getListVendor':
                lib.ESD_HTKT_REPORT.getListVendor(input);
                break;
             case 'saveReportHistory':
                var data = lib.ESD_HTKT_REPORT.saveReportHistoryAndSchedule(input);
                result = { success: true, data: data };
                break;
             case 'getListReportHistory':
                lib.ESD_HTKT_REPORT.getListReportHistory(input);
                break;
             // 
             
             case 'getPrepaymentApprovalOptions':
                var optionsDetails = {};
                try { optionsDetails = JSON.parse(input.queryString || "{}"); } catch(e) {}
                result = lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX.getPrepaymentApprovalOptions(optionsDetails);
                break;

            case 'savePrepaymentApprovalField':
                var saveDetails = {};
                try { saveDetails = JSON.parse(input.queryString || "{}"); } catch(e) {}
                result = lib.ESD_HTKT_PREPAYMENT_LOAD_APRROVAL_COMBOBOX.savePrepaymentApprovalField(saveDetails);
                break;
            // =================================

            default:
                result = { success: false, error: 'Hanh dong (name) khong hop le: ' + name };
        }

        input.queryReturn = JSON.stringify(result);
    } catch (e) {
        if (vars['$L.file']) {
            vars['$L.file'].queryReturn = JSON.stringify({ success: false, error: 'Gateway Error: ' + e.toString() });
        }
    }
}