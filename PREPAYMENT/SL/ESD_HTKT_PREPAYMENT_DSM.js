/**
 * ScriptLibrary: ESD_HTKT_PREPAYMENT_DSM
 * -----------------------------------------------------------------------------
 * Module  : HTKT - Đề nghị tạm ứng
 * Version : 1.0.1
 *
 * Adapter kỹ thuật riêng của HTKT để gọi Keycloak/DSM UAT.
 * Không chứa logic workflow, attachment hoặc nghiệp vụ phê duyệt.
 * Không phụ thuộc và không sửa ESD_DIGITAL_SIGNATURE dùng chung.
 * -----------------------------------------------------------------------------
 */

/* =============================================================================
 * 1. CẤU HÌNH MÔI TRƯỜNG
 * ============================================================================= */

/* Khi test UAT, chỉ đổi DSM_USERINFO_DOMAIN thành DSM_SIGNAPI_DOMAIN. */
var DSM_SIGNAPI_DOMAIN = "https://api-internal-uat.vietinbank.vn";
//var DSM_USERINFO_DOMAIN = "https://mockapi.smartsolutionvn.com.vn";
var DSM_AUTH_DOMAIN = "https://authentication-uat.vietinbank.vn";
var CLIENT_ID = "A452_DSM";
var CLIENT_SECRET = "ETXwzhFzkUrFz1SqbckROHJH388gLXOu";
var CLIENT_PASSWORD = "Aa123456";
var DSM_SIGNAPI_BASE_PATH = "/api-internal/uat/dsm/signapi/api/v1/sign";
var URL = {
    getToken: DSM_AUTH_DOMAIN + "/realms/Api-Internal/protocol/openid-connect/token",
    getUserInfo: DSM_USERINFO_DOMAIN + DSM_SIGNAPI_BASE_PATH + "/userinfo",
    signRequest: DSM_SIGNAPI_DOMAIN + DSM_SIGNAPI_BASE_PATH + "/request",
    signStatus: DSM_SIGNAPI_DOMAIN + DSM_SIGNAPI_BASE_PATH + "/status",
    getTokenHSM: DSM_SIGNAPI_DOMAIN + DSM_SIGNAPI_BASE_PATH + "/get-hsm-token"
};

var HTKT_DSM_SERVICE_NAME = "ESD_HTKT_PREPAYMENT_DSM";
var HTKT_DSM_SERVICE_VERSION = "1.0.1";


/* =============================================================================
 * 2. HELPER HTTP/RESPONSE
 * ============================================================================= */

function htktDsmError(code, message, detail, data) {
    return {
        success: false,
        code: code || "DSM_ERROR",
        message: message || "Có lỗi khi gọi DSM.",
        detail: detail || "",
        data: data || null
    };
}

function htktDsmParse(value) {
    if (typeof value !== "string") {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch (error) {
        return value;
    }
}

function htktDsmNormalize(rawResponse) {
    var response = htktDsmParse(rawResponse);
    var nested;

    if (response === null || response === undefined || response === "") {
        return htktDsmError(
            "DSM_EMPTY_RESPONSE",
            "DSM không trả về dữ liệu."
        );
    }

    if (response && response.success === false) {
        return htktDsmError(
            response.code || "DSM_HTTP_FAILED",
            response.message || response.error || "Gọi DSM thất bại.",
            response.detail || "",
            response.data || response
        );
    }

    /* Hỗ trợ wrapper của ESD_COMMON_HTTP: {success:true,data/body:...}. */
    if (
        response &&
        response.success === true &&
        !response.statusCode &&
        !response.access_token
    ) {
        nested = response.data !== undefined
            ? response.data
            : response.body;
        nested = htktDsmParse(nested);

        if (nested !== undefined && nested !== null && nested !== "") {
            return nested;
        }
    }

    return response;
}

function htktDsmHeaders(accessToken, requestId, requestTime) {
    var headers = [];

    headers.push(new Header("Authorization", "Bearer " + String(accessToken || "")));
    headers.push(new Header("ClientId", CLIENT_ID));
    headers.push(new Header("ClientPassword", CLIENT_PASSWORD));
    headers.push(new Header("RequestId", String(requestId || "")));
    headers.push(new Header("RequestTime", String(requestTime || "")));
    headers.push(new Header("Content-Type", "application/json"));

    return headers;
}

function htktDsmPostJson(url, params) {
    var body;
    var rawResponse;

    params = params || {};

    if (!params.accessToken) {
        return htktDsmError(
            "DSM_ACCESS_TOKEN_REQUIRED",
            "Thiếu accessToken gọi DSM."
        );
    }

    if (!params.requestId || !params.requestTime) {
        return htktDsmError(
            "DSM_REQUEST_HEADER_REQUIRED",
            "Thiếu requestId hoặc requestTime gọi DSM."
        );
    }

    body = params.body || {};

    try {
        rawResponse = lib.ESD_COMMON_HTTP.postJson(
            url,
            JSON.stringify(body),
            htktDsmHeaders(
                params.accessToken,
                params.requestId,
                params.requestTime
            )
        );

        return htktDsmNormalize(rawResponse);
    } catch (error) {
        return htktDsmError(
            "DSM_HTTP_EXCEPTION",
            "Có lỗi kết nối DSM.",
            String(error)
        );
    }
}


/* =============================================================================
 * 3. PUBLIC API
 * ============================================================================= */

function run() {
    var input = vars["$L.file"];
    var action;
    var params;
    var result;

    if (!input) {
        return;
    }

    try {
        action = String(input.name || "");
        params = input.queryString ? JSON.parse(input.queryString) : {};

        switch (action) {
            case "getTokenKeycloak":
                result = getTokenKeycloak();
                break;
            case "getUserInfo":
                result = getUserInfo(params);
                break;
            case "getTokenHSM":
                result = getTokenHSM(params);
                break;
            case "signRequestFileECM":
                result = signRequestFileECM(params);
                break;
            case "getStatusSign":
                result = getStatusSign(params);
                break;
            default:
                result = htktDsmError(
                    "DSM_ACTION_INVALID",
                    "Hanh dong DSM khong hop le: " + action
                );
        }

        input.queryReturn = JSON.stringify(result);
    } catch (error) {
        input.queryReturn = JSON.stringify(
            htktDsmError(
                "DSM_GATEWAY_ERROR",
                "Co loi khi xu ly yeu cau DSM.",
                String(error)
            )
        );
    }
}

function getVersion() {
    return HTKT_DSM_SERVICE_VERSION;
}

function getConfig() {
    return {
        success: true,
        data: {
            serviceName: HTKT_DSM_SERVICE_NAME,
            serviceVersion: HTKT_DSM_SERVICE_VERSION,
            baseUrl: DSM_SIGNAPI_DOMAIN,
            userInfoDomain: DSM_USERINFO_DOMAIN,
            clientId: CLIENT_ID,
            signApiBasePath: DSM_SIGNAPI_BASE_PATH,
            urls: {
                getToken: URL.getToken,
                getUserInfo: URL.getUserInfo,
                signRequest: URL.signRequest,
                signStatus: URL.signStatus,
                getTokenHSM: URL.getTokenHSM
            },
            secretsExposed: false
        }
    };
}

function getTokenKeycloak() {
    var headers = [];
    var body;
    var response;

    body = "grant_type=client_credentials" +
        "&client_id=" + encodeURIComponent(CLIENT_ID) +
        "&client_secret=" + encodeURIComponent(CLIENT_SECRET);

    try {
        headers.push(new Header(
            "Content-Type",
            "application/x-www-form-urlencoded"
        ));

        response = htktDsmNormalize(
            lib.ESD_COMMON_HTTP.postForm(URL.getToken, body, headers)
        );
    } catch (error) {
        return htktDsmError(
            "KEYCLOAK_HTTP_EXCEPTION",
            "Không lấy được Keycloak token.",
            String(error)
        );
    }

    if (!response || response.success === false || !response.access_token) {
        return htktDsmError(
            "KEYCLOAK_TOKEN_INVALID",
            response && (response.message || response.error)
                ? String(response.message || response.error)
                : "Keycloak không trả về access_token.",
            "",
            response || null
        );
    }

    return response;
}

function getUserInfo(params) {
    return htktDsmPostJson(URL.getUserInfo, params);
}

function getTokenHSM(params) {
    return htktDsmPostJson(URL.getTokenHSM, params);
}

function signRequestFileECM(params) {
    return htktDsmPostJson(URL.signRequest, params);
}

function getStatusSign(params) {
    return htktDsmPostJson(URL.signStatus, params);
}

/* =============================================================================
 * UAT DEBUG TESTS - APPEND ONLY - KHONG TU DONG CHAY
 * ----------------------------------------------------------------------------
 * Khong in Keycloak/HSM token, password, secret hoac Base64 anh chu ky.
 * ============================================================================= */

//function UAT_DSM_print(value) {
//    var text = "";
//    try {
//        text = typeof rteJSONStringify === "function"
//            ? rteJSONStringify(value)
//            : JSON.stringify(value);
//    } catch (error) {
//        text = String(value);
//    }
//    print("[UAT_DSM] " + text);
//}
//
//function UAT_DSM_requestId(prefix) {
//    return String(prefix || "UAT_DSM") + "_" + String(new Date().getTime()) + "_" + String(Math.floor(Math.random() * 1000000));
//}
//
//function UAT_DSM_requestTime() {
//    var now = new Date();
//    try { return now.toISOString(); } catch (ignoreIso) {}
//    return String(now);
//}
//
//function UAT_DSM_currentUser(input) {
//    var user = input && input.userAd ? String(input.userAd) : "";
//    if (user) return user;
//    try { user = String(vars.$lo_operator["contact.name"] || ""); } catch (ignore1) {}
//    if (!user) {
//        try { user = String(vars["$lo.contact.name"] || ""); } catch (ignore2) {}
//    }
//    return user;
//}
//
//function UAT_DSM_envelope(requestId, userAd, requestTime, data) {
//    return {
//        requestId: requestId,
//        username: userAd || null,
//        password: null,
//        clientDt: requestTime,
//        channel: "A100_IBC",
//        reftype: "x",
//        refid: null,
//        sessionkey: null,
//        spname: null,
//        data: data || {}
//    };
//}
//
//function UAT_DSM_tokenSummary(response) {
//    var token = response && (response.access_token || response.accessToken) ? String(response.access_token || response.accessToken) : "";
//    return {
//        success: !!token,
//        tokenReceived: !!token,
//        tokenLength: token.length,
//        expiresIn: response ? response.expires_in : null,
//        tokenType: response ? response.token_type : "",
//        error: response && response.success === false ? {
//            code: response.code,
//            message: response.message,
//            detail: response.detail
//        } : null
//    };
//}
//
//function UAT_DSM_profilesSummary(data) {
//    var profiles = data && (data.userInfor || data.userInfo) ? (data.userInfor || data.userInfo) : [];
//    var result = [];
//    var i;
//    var p;
//    if (!Array.isArray(profiles)) return result;
//    for (i = 0; i < profiles.length; i++) {
//        p = profiles[i] || {};
//        result.push({
//            userad: p.userad || "",
//            ident: p.ident || p.user_id || "",
//            signTech: p.sign_tech || p.signTech || "",
//            serialNumber: p.serialnumber || p.serial_number || "",
//            issuer: p.issuer || "",
//            validFrom: p.validfrom || "",
//            validTo: p.validto || ""
//        });
//    }
//    return result;
//}
//
//function UAT_DSM_imagesSummary(data) {
//    var images = data && (data.image || data.images) ? (data.image || data.images) : [];
//    var result = [];
//    var i;
//    var image;
//    if (!Array.isArray(images)) return result;
//    for (i = 0; i < images.length; i++) {
//        image = images[i] || {};
//        result.push({ id: image.id || "", imageLength: image.image ? String(image.image).length : 0 });
//    }
//    return result;
//}
//
//function UAT_DSM_getKeycloakRaw() {
//    return getTokenKeycloak();
//}
//
//function UAT_DSM_testConfig() {
//    return { test: "DSM_CONFIG", result: getConfig() };
//}
//
//function UAT_DSM_testKeycloak() {
//    return { test: "DSM_KEYCLOAK", result: UAT_DSM_tokenSummary(UAT_DSM_getKeycloakRaw()) };
//}
//
//function UAT_DSM_testUserInfo(input) {
//    input = input || {};
//    var tokenResponse = UAT_DSM_getKeycloakRaw();
//    var token = tokenResponse && tokenResponse.access_token ? String(tokenResponse.access_token) : "";
//    if (!token) return { test: "DSM_USER_INFO", success: false, token: UAT_DSM_tokenSummary(tokenResponse) };
//
//    var userAd = UAT_DSM_currentUser(input);
//    var requestId = UAT_DSM_requestId("UAT_USERINFO");
//    var requestTime = UAT_DSM_requestTime();
//    var response = getUserInfo({
//        accessToken: token,
//        requestId: requestId,
//        requestTime: requestTime,
//        body: UAT_DSM_envelope(requestId, userAd, requestTime, {
//            app_id: "A452_DSM",
//            userad: userAd
//        })
//    });
//    var data = response && response.data ? response.data : {};
//    return {
//        test: "DSM_USER_INFO",
//        userAdRequested: userAd,
//        requestId: requestId,
//        statusCode: response ? response.statusCode : "",
//        statusDesc: response ? response.statusDesc : "",
//        success: !!(response && response.statusCode === "00"),
//        profiles: UAT_DSM_profilesSummary(data),
//        images: UAT_DSM_imagesSummary(data),
//        error: response && response.success === false ? response : null
//    };
//}
//
//function UAT_DSM_testHsmToken(input) {
//    input = input || {};
//    if (input.allowHsmToken !== true) {
//        return { test: "DSM_HSM_TOKEN", success: false, code: "UAT_HSM_TOKEN_LOCKED", message: "Dat allowHsmToken=true." };
//    }
//    var password = input.password ? String(input.password) : "";
//    if (!password) return { test: "DSM_HSM_TOKEN", success: false, code: "UAT_HSM_PASSWORD_REQUIRED", message: "Thieu password HSM tam thoi." };
//
//    var tokenResponse = UAT_DSM_getKeycloakRaw();
//    var keycloakToken = tokenResponse && tokenResponse.access_token ? String(tokenResponse.access_token) : "";
//    if (!keycloakToken) return { test: "DSM_HSM_TOKEN", success: false, token: UAT_DSM_tokenSummary(tokenResponse) };
//
//    var userAd = UAT_DSM_currentUser(input);
//    var requestId = UAT_DSM_requestId("UAT_HSM_TOKEN");
//    var requestTime = UAT_DSM_requestTime();
//    var response = getTokenHSM({
//        accessToken: keycloakToken,
//        requestId: requestId,
//        requestTime: requestTime,
//        body: { grantType: "password", username: userAd, password: password }
//    });
//    password = "";
//    var hsmToken = response && response.data && response.data.access_token ? String(response.data.access_token) : "";
//    return {
//        test: "DSM_HSM_TOKEN",
//        userAdRequested: userAd,
//        requestId: requestId,
//        statusCode: response ? response.statusCode : "",
//        statusDesc: response ? response.statusDesc : "",
//        success: !!hsmToken,
//        hsmTokenReceived: !!hsmToken,
//        hsmTokenLength: hsmToken.length,
//        expiresIn: response && response.data ? response.data.expires_in : null,
//        error: response && response.success === false ? response : null
//    };
//}
//
//function UAT_DSM_testSignRequest(input) {
//    input = input || {};
//    if (input.allowRealSign !== true || input.confirmationText !== "DSM_REAL_SIGN_HTKT_UAT") {
//        return { test: "DSM_SIGN_REQUEST", success: false, code: "UAT_REAL_SIGN_LOCKED", message: "Dat allowRealSign=true va confirmationText=DSM_REAL_SIGN_HTKT_UAT." };
//    }
//
//    var tokenResponse = UAT_DSM_getKeycloakRaw();
//    var keycloakToken = tokenResponse && tokenResponse.access_token ? String(tokenResponse.access_token) : "";
//    if (!keycloakToken) return { test: "DSM_SIGN_REQUEST", success: false, token: UAT_DSM_tokenSummary(tokenResponse) };
//
//    var userAd = UAT_DSM_currentUser(input);
//    var hsmToken = "";
//    var signTech = String(input.signTech || "");
//    var requestId;
//    var requestTime;
//    var hsmResponse;
//
//    if (signTech.toUpperCase() === "HSM") {
//        requestId = UAT_DSM_requestId("UAT_HSM_FOR_SIGN");
//        requestTime = UAT_DSM_requestTime();
//        hsmResponse = getTokenHSM({
//            accessToken: keycloakToken,
//            requestId: requestId,
//            requestTime: requestTime,
//            body: { grantType: "password", username: userAd, password: String(input.password || "") }
//        });
//        hsmToken = hsmResponse && hsmResponse.data && hsmResponse.data.access_token ? String(hsmResponse.data.access_token) : "";
//        input.password = "";
//        if (!hsmToken) {
//            return {
//                test: "DSM_SIGN_REQUEST",
//                success: false,
//                code: "UAT_HSM_TOKEN_FAILED",
//                statusCode: hsmResponse ? hsmResponse.statusCode : "",
//                statusDesc: hsmResponse ? hsmResponse.statusDesc : ""
//            };
//        }
//    }
//
//    requestId = UAT_DSM_requestId("UAT_SIGN_REQUEST");
//    requestTime = UAT_DSM_requestTime();
//    var response = signRequestFileECM({
//        accessToken: keycloakToken,
//        requestId: requestId,
//        requestTime: requestTime,
//        body: UAT_DSM_envelope(requestId, userAd, requestTime, {
//            app_id: "A452_DSM",
//            user_id: input.userId || "",
//            userad: userAd,
//            fullname: input.fullName || userAd,
//            accessToken: hsmToken,
//            transaction_desc: input.transactionDescription || "UAT HTKT signature debug",
//            file_type: "pdf",
//            sign_type: "file",
//            sign_tech: signTech,
//            serial_number: input.serialNumber || "",
//            image: input.imageId || "",
//            sign_files: [{
//                data_to_be_signed: input.objectId || "",
//                doc_id: input.docId || "",
//                file_type: "pdf",
//                page: input.page || 1,
//                lowerLeftX: String(input.lowerLeftX || 0),
//                lowerLeftY: String(input.lowerLeftY || 0),
//                upperRightX: String(input.upperRightX || 0),
//                upperRightY: String(input.upperRightY || 0),
//                fontsize: input.fontSize || 10,
//                visibletype: input.visibleType || 5
//            }]
//        })
//    });
//    hsmToken = "";
//    return {
//        test: "DSM_SIGN_REQUEST",
//        success: !!(response && response.statusCode === "00"),
//        requestId: requestId,
//        statusCode: response ? response.statusCode : "",
//        statusDesc: response ? response.statusDesc : "",
//        transactionId: response ? (response.transaction_id || response.transactionId || "") : "",
//        directObjectId: response ? (response.data_to_be_signed || response.dataToBeSigned || "") : "",
//        additionalStatus: response ? response.additionalStatus : null,
//        error: response && response.success === false ? response : null
//    };
//}
//
//function UAT_DSM_testSignStatus(input) {
//    input = input || {};
//    if (input.allowStatusCheck !== true) {
//        return { test: "DSM_SIGN_STATUS", success: false, code: "UAT_STATUS_CHECK_LOCKED", message: "Dat allowStatusCheck=true." };
//    }
//    var tokenResponse = UAT_DSM_getKeycloakRaw();
//    var token = tokenResponse && tokenResponse.access_token ? String(tokenResponse.access_token) : "";
//    if (!token) return { test: "DSM_SIGN_STATUS", success: false, token: UAT_DSM_tokenSummary(tokenResponse) };
//
//    var userAd = UAT_DSM_currentUser(input);
//    var requestId = UAT_DSM_requestId("UAT_SIGN_STATUS");
//    var requestTime = UAT_DSM_requestTime();
//    var response = getStatusSign({
//        accessToken: token,
//        requestId: requestId,
//        requestTime: requestTime,
//        body: UAT_DSM_envelope(requestId, userAd, requestTime, {
//            app_id: "A452_DSM",
//            transaction_id: input.transactionId || ""
//        })
//    });
//    var signed = response && response.data && Array.isArray(response.data.signed) ? response.data.signed : [];
//    var summary = [];
//    var i;
//    var item;
//    for (i = 0; i < signed.length; i++) {
//        item = signed[i] || {};
//        summary.push({
//            status: item.status || "",
//            objectid: item.objectid || "",
//            objectidext: item.objectidext || "",
//            docidext: item.docidext || "",
//            userad: item.userad || "",
//            signdesc: item.signdesc || ""
//        });
//    }
//    return {
//        test: "DSM_SIGN_STATUS",
//        success: !!(response && response.statusCode === "00"),
//        requestId: requestId,
//        transactionId: input.transactionId || "",
//        statusCode: response ? response.statusCode : "",
//        statusDesc: response ? response.statusDesc : "",
//        signed: summary,
//        error: response && response.success === false ? response : null
//    };
//}
//
//function UAT_DSM_run(testName, input) {
//    var name = String(testName || "").toUpperCase();
//    if (name === "CONFIG") return UAT_DSM_testConfig();
//    if (name === "KEYCLOAK") return UAT_DSM_testKeycloak();
//    if (name === "USER_INFO") return UAT_DSM_testUserInfo(input);
//    if (name === "HSM_TOKEN") return UAT_DSM_testHsmToken(input);
//    if (name === "SIGN_REQUEST") return UAT_DSM_testSignRequest(input);
//    if (name === "SIGN_STATUS") return UAT_DSM_testSignStatus(input);
//    return { success: false, code: "UAT_TEST_NOT_SUPPORTED", message: "DSM test khong duoc ho tro: " + name };
//}

/* RUNNER MAU - CHI BO COMMENT MOT KHOI. */
/*
UAT_DSM_print(UAT_DSM_run("CONFIG", {}));
*/
/*
UAT_DSM_print(UAT_DSM_run("KEYCLOAK", {}));
*/
/*
UAT_DSM_print(UAT_DSM_run("USER_INFO", {
    userAd: "DIEN_USER_AD_UAT_HOAC_DE_RONG_DE_LAY_CURRENT_USER"
}));
*/
/*
var UAT_DSM_TEMP_PASSWORD = "DIEN_PIN_TAM_THOI_ROI_XOA_NGAY";
UAT_DSM_print(UAT_DSM_run("HSM_TOKEN", {
    userAd: "DIEN_USER_AD_UAT",
    password: UAT_DSM_TEMP_PASSWORD,
    allowHsmToken: true
}));
UAT_DSM_TEMP_PASSWORD = "";
*/
/*
var UAT_DSM_SIGN_PASSWORD = "DIEN_PIN_TAM_THOI_NEU_HSM";
UAT_DSM_print(UAT_DSM_run("SIGN_REQUEST", {
    userAd: "DIEN_USER_AD_UAT",
    userId: "DIEN_IDENT_TU_USER_INFO",
    fullName: "DIEN_HO_TEN",
    signTech: "HSM",
    serialNumber: "DIEN_SERIAL_TU_USER_INFO",
    imageId: "DIEN_IMAGE_ID_TU_USER_INFO",
    password: UAT_DSM_SIGN_PASSWORD,
    objectId: "DIEN_ECM_OBJECT_ID_CURRENT",
    docId: "DIEN_ECM_DOC_ID_CURRENT",
    page: 1,
    lowerLeftX: 100,
    lowerLeftY: 100,
    upperRightX: 250,
    upperRightY: 160,
    fontSize: 10,
    visibleType: 5,
    allowRealSign: true,
    confirmationText: "DSM_REAL_SIGN_HTKT_UAT"
}));
UAT_DSM_SIGN_PASSWORD = "";
*/
/*
UAT_DSM_print(UAT_DSM_run("SIGN_STATUS", {
    userAd: "DIEN_USER_AD_UAT",
    transactionId: "DIEN_TRANSACTION_ID",
    allowStatusCheck: true
}));
*/
