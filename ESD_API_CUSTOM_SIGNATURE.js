run();

function safeParse(str) {
    try {
        return JSON.parse(str);
    } catch (e) {
        return str;
    }
}

function run() {
    var input = vars["$L.file"];
    var rawParams = input["queryString"];
    var name = input["name"];
    var parsed = {};

    var startTime = system.functions.tod();
    var TIMEOUT_MS = 636800;

    function isTimeout() {
        return system.functions.tod() - startTime > TIMEOUT_MS;
    }

    var isReturned = false;

    function safeReturn(obj) {
        if (isReturned) return;
        isReturned = true;

        input["queryReturn"] = JSON.stringify(obj);
        vars.$L_exit = "normal";
    }

    try {
        parsed = JSON.parse(rawParams);
    } catch (e) {
        input["queryReturn"] = JSON.stringify({
            success: false,
            error: "Invalid JSON in queryString",
        });
        return;
    }

    var result = null;
    try {
        switch (name) {
            case "downloadByDocId":
                result = lib.ESD_ECM_SERVICE.downloadDocumentByDocId(parsed);
                break;
            case "getTokenKeycloak":
                result = lib.ESD_DIGITAL_SIGNATURE.getTokenKeycloak();
                break;
            case "getUserInfo":
//                var reqId = "111";
//                var reqTime = "2222";
//                var payload = {
//                    accessToken: parsed.accessToken,
//                    ClientId: 'A452_DSM',
//                    ClientPassword: 'Aa123456',
//                    RequestId: reqId,
//                    RequestTime: reqTime,
//
//                    body: {
//                        requestId: reqId,
//                        username: null,
//                        password: null,
//                        clientDt: reqTime,
//                        channel: 'A100_IBC',
//                        reftype: 'x',
//                        refid: null,
//                        sessionkey: null,
//                        spname: null,
//                        data: {
//                            app_id: 'A452_DSM',
//                            userad: 'os.hpt-ducdm',
//                        },
//                    },
//
//                }
                result = lib.ESD_DIGITAL_SIGNATURE.getUserInfo(parsed);
                result = safeParse(result);
                break;
            case "signRequestFileECM":
                result = lib.ESD_DIGITAL_SIGNATURE.signRequestFileECM(parsed);
                result = safeParse(result);
                break;
            case "uploadFileTaiLieu":
                result = lib.ESD_ECM_SERVICE.uploadFileTaiLieu(parsed);
                break;
            case "downloadWithUrl":
                result = lib.ESD_ECM_SERVICE.downloadWithURL(parsed);
                break;
            case "getFileECM":
                result = lib.ESD_ACTIONS_INTEGRATIONS.get_file_ecm(parsed);
                break;
            case "getFileECM_HTKT":
                result = lib.ESD_HTKT_PREPAYMENT_DOCUMENT.get_file_ecm_HTKT(parsed);
                result = safeParse(result);
                break;
            case "getFileECM_HTKT_Expense":
                result = lib.ESD_HTKT_EXPENSE_DOCUMENT.get_file_ecm_HTKT_Expense(parsed);
                result = safeParse(result);
                break;
            case "getStatusSign":
                result = lib.ESD_DIGITAL_SIGNATURE.getStatusSign(parsed);
                result = safeParse(result);
                break;
            case "getStatusKySo_HTKT":
                result = lib.ESD_ACTIONS_INTEGRATIONS_HTKT.getStatusKySo_HTKT(parsed);
                result = safeParse(result);
                break;
            case "getStatusKySo_Expense_HTKT":
                result = lib.ESD_ACTIONS_INTEGRATIONS_HTKT.getStatusKySo_Expense_HTKT(parsed);
                result = safeParse(result);
                break;
            case "getTokenHSM":
                result = lib.ESD_DIGITAL_SIGNATURE.getTokenHSM(parsed);
                result = safeParse(result);
                break;
            case "ky-so_HTKT":
                result = lib.ESD_ACTIONS_INTEGRATIONS_HTKT.ky_so(parsed);
                result = safeParse(result);
                break;
            case "ky-so_HTKT_Expense":
                result = lib.ESD_ACTIONS_INTEGRATIONS_HTKT.ky_so_Expense_HTKT(parsed);
                result = safeParse(result);
                break;
            case "deleteFileECM":
                result = lib.ESD_ACTIONS_INTEGRATIONS.deleteFileECM(parsed);
                break;
            case "addFileECM":
                result = lib.ESD_ACTIONS_INTEGRATIONS.addFileECM(parsed);
                break;
            case "deleteFileECM_HTKT":
                result = lib.ESD_HTKT_PREPAYMENT_DOCUMENT.deleteFileECM_HTKT(parsed);
                break;
            case "addFileECM_HTKT":
                result = lib.ESD_HTKT_PREPAYMENT_DOCUMENT.addFileECM_HTKT(parsed);
                break;
            case "deleteFileECM_HTKT_Expense":
                result = lib.ESD_HTKT_EXPENSE_DOCUMENT.deleteFileECM_HTKT_Expense(parsed);
                break;
            case "addFileECM_HTKT_Expense":
                result = lib.ESD_HTKT_EXPENSE_DOCUMENT.addFileECM_HTKT_Expense(parsed);
                break;
            case "getStatusPhieu_HTKT": 
                result = lib.ESD_ACTIONS_INTEGRATIONS_HTKT.getStatusPhieu_HTKT(parsed);
                result = safeParse(result);
                break;
            case "getStatusPhieu_Expense_HTKT":
                result = lib.ESD_ACTIONS_INTEGRATIONS_HTKT.getStatusPhieu_Expense_HTKT(parsed);
                result = safeParse(result);
                break;
            case "test-minh": 
                result = lib.ESD_DIGITAL_SIGNATURE.testApi(parsed);
                break;
            default:
                result = { success: false, message: "Unknown action: " + name };
        }
    } catch (actionError) {
        return safeReturn({
            success: false,
            error: "ACTION_EXECUTION_ERROR",
            detail: actionError.message,
            action: name,
        });
    }


    if (isTimeout()) {
        return safeReturn({ success: false, error: "Timeout" });
    }

    safeReturn(result);
}
