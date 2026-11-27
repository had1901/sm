// =========================================================================
// THỰC HIỆN ĐỌC CONTEXT PHIẾU CHA 1 LẦN VÀ VALIDATE TRƯỚC TIÊN
// =========================================================================
var timingStart = new Date().getTime();
var expenseSourceContext = null;
var sourceContextError = null;
try {
  expenseSourceContext = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.getExpenseSupplierContext(
    vars.$L_file, "", false
  );
} catch (sourceError) {
  sourceContextError = String(sourceError.message || sourceError);
}
var timingContext = new Date().getTime();

// Lỗi "Số tiền dự chi vượt Giá trị còn lại của hợp đồng": vẫn hiện thông báo nhưng không chặn lưu.
// Các lỗi khác vẫn chặn lưu như cũ.
var amountWarnings = [];
var errorMss = lib.ESD_HTKT_EXPENSE_VENDOR.validateVendorAndPaymentDetails(
  vars.$L_file,
  amountWarnings,
  expenseSourceContext
) || [];
var amountWarningText = amountWarnings.join("\n - ");
if (sourceContextError) {
  errorMss.push(sourceContextError);
}
var timingValidate = new Date().getTime();
var timingVendor = timingValidate;
var timingSync = timingValidate;
var timingSiteNum = timingValidate;
var timingSiteList = timingValidate;

if (errorMss && errorMss.length > 0) {
  vars.$G_hasError = true;
  vars.$G_errMsg = "Dữ liệu chưa hợp lệ:\n - " + errorMss.join("\n - ") +
    (amountWarningText ? "\n - " + amountWarningText : "");
  vars.$L_action = "do nothing";
} else if (expenseSourceContext.category === "XDCB") {
  // Dữ liệu NCC lấy lại từ S4 khi lưu; lỗi OGL giữ NCC S6 để thử lại bằng nút Đồng bộ.
  try {
    var xdcbSyncResult = lib.ESD_HTKT_EXPENSE_CONTRACT_SUPPLIER.saveExpenseXdcbDetails(
      vars.$L_file,
      expenseSourceContext
    );
    timingSync = new Date().getTime();
    vars.$G_hasError = false;
    vars.$G_errMsg = "";
    var xdcbVendorId = String(vars.$L_file["vendor.id"] || "").replace(/^\s+|\s+$/g, "");
    if (xdcbSyncResult && xdcbSyncResult.success && xdcbVendorId) {
      try {
        lib.ESD_HTKT_EXPENSE_VENDOR.syncExpenseVendorNumberToSite(xdcbVendorId, vars.$taxCode);
      } catch (xdcbSiteNumberError) {
        print("Không cập nhật được mã số thuế vào các site OGL XDCB: " + String(xdcbSiteNumberError.message || xdcbSiteNumberError));
      }
    }
    timingSiteNum = new Date().getTime();
    timingSiteList = timingSiteNum;
    if (!xdcbSyncResult.success) print("Đồng bộ NCC/Site XDCB chưa thành công: " + xdcbSyncResult.message);
  } catch (xdcbSaveError) {
    vars.$G_hasError = true;
    vars.$G_errMsg = String(xdcbSaveError.message || xdcbSaveError);
    vars.$L_action = "do nothing";
  }
} else {
  vars.$G_hasError = false;
  vars.$G_errMsg = "";

  var supplierId = String(vars.$supplierId || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  var taxCode = String(vars.$taxCode || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  var vendorId = (expenseSourceContext && expenseSourceContext._exactVendorId)
    ? expenseSourceContext._exactVendorId
    : null;

  if (!vendorId) {
    var queryVendor =
      'vendor.number="' + taxCode + '" and supplier.id="' + supplierId + '"';
    var vendorCheck = new SCFile("esdHTKTvendor", SCFILE_READONLY);
    try {
      vendorCheck.setFields(["id"]);
      if (vendorCheck.doSelect(queryVendor) === RC_SUCCESS) {
        vendorId = vendorCheck["id"];
      }
    } finally {
      try {
        vendorCheck.doClose();
      } catch (closeCheckError) {}
    }
  }

  if (!vendorId) {
    var itemVendor = new SCFile("esdHTKTvendor");
    try {
      var generatedVendorId = new SCDatum();
      var numberRc = new SCDatum();
      numberRc.setValue(-1);

      system.functions.rtecall(
        "getnumber",
        numberRc,
        generatedVendorId,
        "esdHTKTvendor"
      );

      if (String(numberRc.getText()) !== "0" || !generatedVendorId.getText()) {
        throw new Error("Không sinh được mã nhà cung cấp.");
      }

      vendorId = generatedVendorId.getText();

      itemVendor["id"] = vendorId;
      itemVendor["vendor.name"] = vars.$supplierName || "";
      itemVendor["vendor.number"] = vars.$taxCode || "";
      itemVendor["username"] = vars.$lo_operator["name"];
      itemVendor["ogl.country"] = "VN";
      itemVendor["address"] = vars.$supplierAddress || "";
      itemVendor["supplier.id"] = vars.$supplierId || "";

      var addRc = itemVendor.doAction("add");
      if (addRc !== RC_SUCCESS) {
        throw new Error(
          "Không tạo được nhà cung cấp. Code: " +
            addRc +
            ", message: " +
            itemVendor.getMessages()
        );
      }
    } finally {
      try {
        itemVendor.doClose();
      } catch (closeError) {}
    }
  }

  if (vars.$amount == null || vars.$amount === "") {
    vars.$L_file["amount"] = "0";
  }

  vars.$L_file["vendor.id"] = vendorId;
  vars.$L_file["currency"] = vars.$currency;
  timingVendor = new Date().getTime();

  try {
    var defaultVendorSiteInfo =
      lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorDefaultSiteInfo();
    var syncResult = lib.ESD_HTKT_PREPAYMENT_VENDOR.syncVendorToOgl(
      vars.$L_file,
      vars.$branchCode,
      vars.$entityCode
    );
    timingSync = new Date().getTime();

    if (syncResult && syncResult.success) {
      lib.ESD_HTKT_EXPENSE_VENDOR.syncExpenseVendorNumberToSite(vendorId, vars.$taxCode);
      timingSiteNum = new Date().getTime();
      var vendorSites = lib.ESD_HTKT_ACCOUNTING_UTILS.getVendorSiteList(
        vendorId,
        vars.$branchCode
      );
      timingSiteList = new Date().getTime();

      vars.$vendorSiteOptValue = [];
      vars.$vendorSiteOptDisp = [];

      if (vendorSites && vendorSites.length > 0) {
        // 1. Chỉ đẩy danh sách Site vào mảng Dropdown
        for (var i = 0; i < vendorSites.length; i++) {
          var vendorSite = vendorSites[i];
          vars.$vendorSiteOptValue.push(vendorSite["id"]);
          vars.$vendorSiteOptDisp.push(vendorSite["ogl.site.code"]);
        }

        // =====================================================================
        // 2. AUTO-FILL SITE NCC KHI LƯU
        // =====================================================================
        if (!vars.$L_file["vendor.site.id"] || vars.$L_file["vendor.site.id"] == "") {
          var matchedSiteId = null;

          // 2.1 Tìm site khớp cấu hình default
          if (defaultVendorSiteInfo && defaultVendorSiteInfo.siteCode) {
            for (var j = 0; j < vendorSites.length; j++) {
              if (vendorSites[j]["ogl.site.code"] == defaultVendorSiteInfo.siteCode) {
                matchedSiteId = vendorSites[j]["id"];
                break;
              }
            }
          }

          // 2.2 Nếu khớp thì gán site đó, nếu KHÔNG khớp thì gán site ĐẦU TIÊN
          if (matchedSiteId) {
            vars.$L_file["vendor.site.id"] = matchedSiteId;
          } else {
            vars.$L_file["vendor.site.id"] = vendorSites[0]["id"];
          }
        }
        // =====================================================================

        vars.$canEditSite = true;
      }
    } else {
      timingSiteNum = timingSync;
      timingSiteList = timingSync;
      print(
        "Đồng bộ thông tin NCC/Site không thành công: " +
          String(
            syncResult && syncResult.message
              ? syncResult.message
              : "Không xác định được nguyên nhân."
          )
      );
    }
  } catch (syncError) {
    print(
      "Đồng bộ thông tin NCC/Site không thành công: " +
        String(syncError.message || syncError)
    );
  }
}

try {
  var timingEnd = new Date().getTime();
  print(
    "[EXP_SAVE_VENDOR][TIMING] id=" + String((vars.$L_file && vars.$L_file["id"]) || "") +
    " cat=" + String((expenseSourceContext && expenseSourceContext.category) || "") +
    " ctx=" + (timingContext - timingStart) + "ms" +
    " val=" + (timingValidate - timingContext) + "ms" +
    " vendor=" + (timingVendor - timingValidate) + "ms" +
    " sync=" + (timingSync - timingVendor) + "ms" +
    " siteNum=" + (timingSiteNum - timingSync) + "ms" +
    " siteList=" + (timingSiteList - timingSiteNum) + "ms" +
    " total=" + (timingEnd - timingStart) + "ms"
  );
} catch (logSaveTimingErr) {}

// Vượt giá trị còn lại HĐ: hiện cùng popup "Dữ liệu chưa hợp lệ" như trước
// nhưng KHÔNG đặt $L_action = "do nothing", nên bản ghi vẫn được lưu.
if (amountWarningText && vars.$L_action !== "do nothing") {
  vars.$G_hasError = true;
  vars.$G_errMsg = "Dữ liệu chưa hợp lệ:\n - " + amountWarningText;
}
