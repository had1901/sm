
/* =========================================================
 * 1. HÀM DÙNG CHUNG
 * ========================================================= */
function escapeKySoQueryValue(value) {
    return String(value == null ? "" : value)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
}


function closeKySoFile(file) {
    if (!file) {
        return;
    }

    try {
        file.doClose();
    } catch (eCloseFile) {}
}


function readKySoValue(record, fieldNames) {
    if (!record || !fieldNames) {
        return "";
    }

    for (var i = 0; i < fieldNames.length; i++) {
        try {
            var value = record[fieldNames[i]];

            if (
                value !== null &&
                value !== undefined &&
                String(value).trim() !== ""
            ) {
                return value;
            }
        } catch (eReadField) {}
    }

    return "";
}


function readKySoString(record, fieldNames) {
    var value = readKySoValue(record, fieldNames);

    if (value === null || value === undefined) {
        return "";
    }

    return String(value).trim();
}


function normalizeKySoNumber(value) {
    if (
        value === null ||
        value === undefined ||
        String(value).trim() === ""
    ) {
        return 0;
    }

    if (typeof value === "number") {
        return isNaN(value) ? 0 : value;
    }

    var text = String(value)
        .replace(/\s/g, "")
        .trim();

    var lastDot = text.lastIndexOf(".");
    var lastComma = text.lastIndexOf(",");

    if (lastDot >= 0 && lastComma >= 0) {
        if (lastComma > lastDot) {
            // Dạng Việt Nam: 1.339.559.520,2
            text = text
                .replace(/\./g, "")
                .replace(/,/g, ".");
        } else {
            // Dạng quốc tế: 1,339,559,520.2
            text = text.replace(/,/g, "");
        }
    } else if (lastComma >= 0) {
        var commaDecimalLength = text.length - lastComma - 1;

        if (commaDecimalLength > 0 && commaDecimalLength <= 2) {
            text = text.replace(/,/g, ".");
        } else {
            text = text.replace(/,/g, "");
        }
    } else if (lastDot >= 0) {
        var dotParts = text.split(".");

        if (dotParts.length > 2) {
            var decimalPart = dotParts.pop();
            text = dotParts.join("") + "." + decimalPart;
        }
    }

    var result = Number(text);
    return isNaN(result) ? 0 : result;
}


function readKySoNumber(record, fieldNames) {
    return normalizeKySoNumber(
        readKySoValue(record, fieldNames)
    );
}


function selectKySoFile(tableName, fieldNames, value) {
    if (!tableName || !fieldNames || String(value || "").trim() === "") {
        return null;
    }

    for (var i = 0; i < fieldNames.length; i++) {
        var file = null;

        try {
            file = new SCFile(
                tableName,
                SCFILE_READONLY
            );

            var query =
                fieldNames[i] +
                '="' +
                escapeKySoQueryValue(value) +
                '"';

            var rc = file.doSelect(query);

            if (rc == RC_SUCCESS) {
                return file;
            }
        } catch (eSelectFile) {}

        closeKySoFile(file);
    }

    return null;
}

function getKySoCurrentFile() {
    var currentFile = null;

    try {
        if (system.vars && system.vars.$L_file) {
            currentFile = system.vars.$L_file;
        }
    } catch (eSystemFile) {}

    if (!currentFile) {
        try {
            if (vars.$L_file) {
                currentFile = vars.$L_file;
            }
        } catch (eLocalFile1) {}
    }

    if (!currentFile) {
        try {
            if (vars["$L.file"]) {
                currentFile = vars["$L.file"];
            }
        } catch (eLocalFile2) {}
    }

    return currentFile;
}

function buildKySoErrorHtml(title, message) {
    return (
        '<div style="font-family:Arial,sans-serif;padding:20px;color:#b91c1c;background:#ffffff;">' +
            '<div style="font-size:16px;font-weight:bold;margin-bottom:8px;">' +
                String(title || "Có lỗi xảy ra") +
            '</div>' +
            '<div>' +
                String(message || "") +
            '</div>' +
        '</div>'
    );
}

function getKySoPrepaymentById(prepaymentId) {
    var prepaymentFile = selectKySoFile(
        "esdHTKTprepayment",
        ["id"],
        prepaymentId
    );

    if (!prepaymentFile) {
        return null;
    }

    var createdBy = readKySoString(
        prepaymentFile,
        ["created.by", "created_by"]
    );

    var createdByName = readKySoString(
        prepaymentFile,
        [
            "created.by.name",
            "created_by_name",
            "requester.name",
            "requester_name"
        ]
    );

    if (!createdByName) {
        createdByName = createdBy;
    }

    var department = readKySoString(
        prepaymentFile,
        [
            "department.name",
            "department_name",
            "department"
        ]
    );

    var result = {
        id: readKySoString(
            prepaymentFile,
            ["id"]
        ),

        transactionType: readKySoString(
            prepaymentFile,
            ["transaction.type", "transaction_type"]
        ),

        department: department,

        description: readKySoString(
            prepaymentFile,
            ["description"]
        ),

        createdAt: readKySoString(
            prepaymentFile,
            [
                "created.at",
                "created_at",
                "created.date",
                "created_date"
            ]
        ),

        createdBy: createdBy,
        createdByName: createdByName,

        amount: readKySoNumber(
            prepaymentFile,
            ["amount"]
        ),

        currency: readKySoString(
            prepaymentFile,
            ["currency"]
        ),

        contractId: readKySoString(
            prepaymentFile,
            ["contract.id", "contract_id"]
        ),

        currentPhase: readKySoString(
            prepaymentFile,
            ["current.phase", "current_phase"]
        ),

        status: readKySoString(
            prepaymentFile,
            ["status"]
        )
    };

    closeKySoFile(prepaymentFile);
    return result;
}


/* =========================================================
 * 3. DỮ LIỆU NGƯỜI/ĐƠN VỊ THỤ HƯỞNG
 *    Bảng: esdHTKTprepaymentVendor
 * ========================================================= */

function getKySoPrepaymentVendors(prepaymentId, defaultCurrency) {
    var result = [];

    var linkFile = selectKySoFile(
        "esdHTKTprepaymentVendor",
        ["prepayment.id", "prepayment_id"],
        prepaymentId
    );

    if (!linkFile) {
        return result;
    }

    var rc = RC_SUCCESS;

    while (rc == RC_SUCCESS) {
        var beneficiaryName = readKySoString(
            linkFile,
            ["beneficiary.name", "beneficiary_name"]
        );

        var transactionDescription = readKySoString(
            linkFile,
            ["transaction.des", "transaction_des"]
        );

        result.push({
            id: readKySoString(
                linkFile,
                ["id"]
            ),

            prepaymentId: prepaymentId,

            vendorId: readKySoString(
                linkFile,
                ["vendor.id", "vendor_id"]
            ),

            vendorSiteId: readKySoString(
                linkFile,
                ["vendor.site.id", "vendor_site_id"]
            ),

            amount: readKySoNumber(
                linkFile,
                ["amount"]
            ),

            currency: readKySoString(
                linkFile,
                ["currency"]
            ) || defaultCurrency || "",

            paymentMethod: readKySoString(
                linkFile,
                ["payment.method", "payment_method"]
            ),

            beneficiaryAccount: readKySoString(
                linkFile,
                ["beneficiary.account", "beneficiary_account"]
            ),

            beneficiaryName: beneficiaryName,

            beneficiaryBank: readKySoString(
                linkFile,
                ["beneficiary.bank", "beneficiary_bank"]
            ),

            transactionDescription: transactionDescription,

            identityNumber: readKySoString(
                linkFile,
                ["identity.number", "identity_number"]
            ),

            issuedDate: readKySoString(
                linkFile,
                ["issued.date", "issued_date"]
            ),

            issuedPlace: readKySoString(
                linkFile,
                ["issued.place", "issued_place"]
            ),

            phone: readKySoString(
                linkFile,
                ["phone"]
            ),
            payeeName: beneficiaryName,
            payeeAccount: readKySoString(
                linkFile,
                ["beneficiary.account", "beneficiary_account"]
            ),
            payeeBank: readKySoString(
                linkFile,
                ["beneficiary.bank", "beneficiary_bank"]
            ),
            transferContent: transactionDescription
        });

        try {
            rc = linkFile.getNext();
        } catch (eGetNextVendor) {
            break;
        }
    }

    closeKySoFile(linkFile);
    return result;
}


/* =========================================================
 * 4. MAP DỮ LIỆU ĐÚNG THEO TEMPLATE 03/TUCK
 * ========================================================= */
function buildKySoPrintData(prepayment, vendors) {
    var paymentRows = [];
    var totalPaymentAmount = 0;
    var paymentMethod = "";

    for (var i = 0; i < vendors.length; i++) {
        var vendor = vendors[i];
        var rowAmount = normalizeKySoNumber(vendor.amount);

        totalPaymentAmount += rowAmount;

        if (!paymentMethod && vendor.paymentMethod) {
            paymentMethod = vendor.paymentMethod;
        }

        paymentRows.push({
            stt: i + 1,
            payeeName: vendor.payeeName || "",
            payeeAccount: vendor.payeeAccount || "",
            payeeBank: vendor.payeeBank || "",
            transferContent:
                vendor.transferContent ||
                prepayment.description ||
                "",
            amount: rowAmount,
            currency:
                vendor.currency ||
                prepayment.currency ||
                ""
        });
    }

    return {
        templateCode: "03/TUCK",

        // Phần đầu phiếu.
        unit: prepayment.department || "",
        createdAt: prepayment.createdAt || "",
        transactionId: prepayment.id || "",

        // Thông tin đề nghị tạm ứng.
        recipient: "",
        requesterName: prepayment.createdByName || prepayment.createdBy || "",
        requesterDepartment: prepayment.department || "",
        requestDescription: prepayment.description || "",
        requestAmount: normalizeKySoNumber(prepayment.amount),
        requestCurrency: prepayment.currency || "",
        requestAmountInWords: "",

        // Bảng nội dung chi tiết.
        detailRows: [
            {
                stt: 1,
                content: prepayment.description || "",
                amountBeforeVat: 0,
                vatAmount: 0,
                totalAmount: normalizeKySoNumber(prepayment.amount),
                note: ""
            }
        ],

        detailTotalBeforeVat: 0,
        detailTotalVat: 0,
        detailTotalAmount: normalizeKySoNumber(prepayment.amount),

        // Nghĩa vụ thanh toán khác: chưa có dữ liệu.
        otherPaymentRows: [],

        // Hình thức thanh toán và bảng người thụ hưởng.
        paymentMethod: paymentMethod,
        paymentRows: paymentRows,
        totalPaymentAmount: totalPaymentAmount,

        // Phần hạch toán kế toán: hiện chưa lấy dữ liệu.
        accountingAdvanceAmount: 0,
        accountingAmountInWords: "",

        // Field phụ để đối chiếu khi cần.
        contractId: prepayment.contractId || "",
        transactionType: prepayment.transactionType || "",
        currentPhase: prepayment.currentPhase || "",
        status: prepayment.status || ""
    };
}


/* =========================================================
 * 5. TẠO PAYLOAD GỬI SANG NEXTJS
 * ========================================================= */

function buildKySoPrepaymentPayload(prepaymentId) {
    var totalStartedAt = new Date().getTime();

    var prepaymentStartedAt = new Date().getTime();
    var prepayment = getKySoPrepaymentById(prepaymentId);
    var prepaymentQueryMs =
        new Date().getTime() - prepaymentStartedAt;

    if (!prepayment) {
        return {
            success: false,
            message:
                "Không tìm thấy phiếu " +
                prepaymentId +
                " trong bảng esdHTKTprepayment",
            id: prepaymentId,
            prepaymentId: prepaymentId,
            printData: null,
            prepayment: null,
            vendors: []
        };
    }

    var vendorStartedAt = new Date().getTime();
    var vendors = getKySoPrepaymentVendors(
        prepaymentId,
        prepayment.currency
    );
    var vendorQueryMs =
        new Date().getTime() - vendorStartedAt;

    var currentUser = "";

    try {
        currentUser = String(
            vars["$lo.contact.name"] || ""
        ).trim();
    } catch (eCurrentUser) {
        currentUser = "";
    }

    var printData = buildKySoPrintData(
        prepayment,
        vendors
    );

    return {
        success: true,
        message: "",

        id: prepaymentId,
        prepaymentId: prepaymentId,

        mode: "pdf-template-03-tuck",
        readOnly: true,

        // NextJS nên dùng object này để gen PDF.
        printData: printData,

        // Giữ lại để đối chiếu trong giai đoạn tích hợp.
        prepayment: prepayment,
        vendors: vendors,

        currentUser: currentUser,
        generatedAt: String(new Date()),

        debug: {
            prepaymentQueryMs: prepaymentQueryMs,
            vendorQueryMs: vendorQueryMs,
            totalQueryMs:
                new Date().getTime() - totalStartedAt,
            vendorCount: vendors.length,
            queriedTables: [
                "esdHTKTprepayment",
                "esdHTKTprepaymentVendor"
            ]
        },

        source:
            "ESD_HTKT_PREPAYMENT_KY_SO.renderTestPhieu"
    };
}


/* =========================================================
 * 6. RENDER NEXTJS
 * ========================================================= */

function renderKySoNextJs(endpoint, payload) {
    try {
        return lib
            .ESD_Addon_Nextjs_V1_local
            .renderPageNextJS_local(
                endpoint,
                "",
                payload
            );
    } catch (eLocal) {
        try {
            return lib
                .ESD_Addon_Nextjs_V1
                .renderPageNextJS(
                    endpoint,
                    "",
                    payload
                );
        } catch (eServer) {
            return buildKySoErrorHtml(
                "Không mở được màn hình NextJS",
                "Local: " +
                    String(eLocal) +
                    " | Server: " +
                    String(eServer)
            );
        }
    }
}


/* =========================================================
 * 7. HÀM ĐƯỢC HTML VIEWER GỌI
 * ========================================================= */

/**
 * HTML-Generating Script:
 * ESD_HTKT_PREPAYMENT_KY_SO.renderTestPhieu
 */
function renderTestPhieu() {
    var currentFile = getKySoCurrentFile();

    var prepaymentId = currentFile
        ? readKySoString(currentFile, ["id"])
        : "";

    if (!prepaymentId) {
        try {
            prepaymentId = String(
                vars["$L.prepayment.id"] ||
                vars["$L.id"] ||
                ""
            ).trim();
        } catch (eLocalId) {
            prepaymentId = "";
        }
    }

    if (!prepaymentId) {
        return buildKySoErrorHtml(
            "Không lấy được dữ liệu phiếu",
            "Không xác định được ID phiếu hiện tại."
        );
    }

    var payload = buildKySoPrepaymentPayload(
        prepaymentId
    );

    if (!payload.success) {
        return buildKySoErrorHtml(
            "Không lấy được dữ liệu phiếu",
            payload.message
        );
    }

    return renderKySoNextJs(
        "TamUngMuaSam/TestGenPhieu",
        payload
    );
}


/**
 * Alias tương thích với tên hàm cũ.
 */
function renderTestGenPhieu() {
    return renderTestPhieu();
}
