var COMMON_CONNECT_TIMEOUT = 600;
var COMMON_READ_TIMEOUT = 600;
var COMMON_RECEIVE_TIMEOUT = 30;

var SYSTEMS = ['ogl', 'vatin'];


/**
 * Hàm gọi API dùng chung bằng doHTTPRequest của OpenText SM
 */
function extractHttpStatus(responseHeaders, errorMessage) {
    var statusPattern = /(?:HTTP\/\d(?:\.\d)?\s+|(?:response|return)\s+code:\s*)([1-5]\d{2})/i;
    var statusHeaderNames = {
        ":status": true,
        "status": true,
        "status-code": true,
        "http-status": true,
        "response-code": true,
        "returncode": true,
        "return-code": true
    };

    if (responseHeaders) {
        for (var name in responseHeaders) {
            var headerName = String(name).toLowerCase();
            var headerValue = String(responseHeaders[name]);

            if (statusHeaderNames[headerName]) {
                var directStatus = /([1-5]\d{2})/.exec(headerValue);
                if (directStatus) {
                    return parseInt(directStatus[1], 10);
                }
            }

            var statusLine = statusPattern.exec(headerValue);
            if (statusLine) {
                return parseInt(statusLine[1], 10);
            }
        }
    }

    if (errorMessage) {
        var errorStatus = statusPattern.exec(String(errorMessage));
        if (errorStatus) {
            return parseInt(errorStatus[1], 10);
        }
    }

    return null;
}

function sendRequest(method, url, headers, body) {
    var responseHeaders = {};

    try {
        var responseBody = doHTTPRequest(
            method,
            url,
            headers,
            body,
            COMMON_CONNECT_TIMEOUT,
            COMMON_READ_TIMEOUT,
            COMMON_RECEIVE_TIMEOUT,
            responseHeaders
        );
        var statusCode = extractHttpStatus(responseHeaders, null);

        return {
            success: statusCode === null || (statusCode >= 200 && statusCode < 300),
            statusCode: statusCode,
            body: responseBody === null || responseBody === undefined ? null : String(responseBody),
            headers: responseHeaders,
            error: null
        };
    } catch (e) {
        var errorMessage = String(e);
        var errorStatusCode = extractHttpStatus(responseHeaders, errorMessage);
        print('HTTP error. status=' + errorStatusCode + ', message=' + errorMessage);

        return {
            success: false,
            statusCode: errorStatusCode,
            body: null,
            headers: responseHeaders,
            error: errorMessage
        };
    }
}

function postJson(url, body, headers) {
//    return lib.ESD_COMMON_HTTP.postJson(url, body, headers);
    return sendRequest('POST', url, headers, body);
}

function get(url, headers) {
//    return lib.ESD_COMMON_HTTP.get(url, headers);
    return sendRequest('GET', url, headers, null);
}

/**
 * Lay token theo username va apiKey
 */
function getAccessToken(system, baseUrl, username, apiKey) {
    var url = baseUrl + "/auth/token/access";
    var headers = [new Header("Content-Type", "application/json")];
    var payload = { "username": username, "apiKey": apiKey };

    var jsonStr = rteJSONStringify(payload);
    var response = sendRequest("POST", url, headers, jsonStr);

    if (response && response.body) {
        var responseObj = rteJSONParse(response.body);
        if (responseObj && responseObj.success === true && responseObj.data) {
            var currentTime = getUnixTimestamp();
            var config = new Map();
            config.set('AccessToken', responseObj.data.accessToken);
            config.set('AccessTokenExpired', +responseObj.data.expiration - 30);
            config.set('RefreshToken', responseObj.data.refreshToken);
            config.set('RefreshTokenExpired', +responseObj.data.expiration + 1500 - 30);
            //             config.set('RefreshTokenExpired', +responseObj.data.expiration + 86400 - 30);
            updateConfig(system, config);
            return responseObj.data.accessToken;
        }
    }
    return null;
}

/**
 * Lay token goi core theo clientId va clientSecret
 */
function getCoreAccessToken(url, clientId, clientSecret) {
    var headers = [
        new Header("Content-Type", "application/x-www-form-urlencoded"),
        new Header("Accept", "application/json")
    ];
    var httpBody = "client_id=" + encodeURIComponent(clientId) + "&client_secret=" + encodeURIComponent(clientSecret) + "&grant_type=client_credentials";
    var response = sendRequest("POST", url, headers, httpBody);

    if (response && response.body) {
        var responseObj = rteJSONParse(response.body);
        if (responseObj) {
            var currentTime = getUnixTimestamp();
            var config = new Map();
            config.set('accessToken', responseObj['access_token']);
            config.set('accessTokenExpired', currentTime + (+responseObj['expires_in']) - 30);
            this.oglConfig['coreAccessToken'] = responseObj['access_token'];
            this.oglConfig['coreAccessTokenExpired'] = currentTime + (+responseObj['expires_in']) - 30;
            updateConfig('core', config);
            return responseObj['access_token'];
        }
    }
    return null;
}

/**
 * 1. Làm mới Access Token bằng Refresh Token (Token Refresh)
 * @param {string} currentRefreshToken - Chuỗi refreshToken hiện tại đang lưu trữ
 * @returns {string|null} Trả về accessToken mới hoặc null nếu thất bại.
 * Sau khi refresh thành công, xóa refreshToken để lần cấp tiếp theo dùng username/apiKey.
 */
function refreshAccessToken(system, baseUrl, currentRefreshToken) {
    var url = baseUrl + "/auth/token/refresh";
    var headers = [
        new Header("Content-Type", "application/json"),
    ];

    var payload = {
        "refreshToken": currentRefreshToken
    };

    var jsonStr = rteJSONStringify(payload);
    var response = sendRequest("POST", url, headers, jsonStr);
    if (response && response.body) {
        var responseObj = rteJSONParse(response.body);
        if (responseObj && responseObj.success === true && responseObj.data && responseObj.data.accessToken) {
            var currentTime = getUnixTimestamp();
            var config = new Map();
            config.set('AccessToken', responseObj.data.accessToken);
            config.set('AccessTokenExpired', currentTime + 300 - 30);
            //            config.set('AccessTokenExpired', currentTime + responseObj.data.expiration - 30);
            // Không lưu lại refreshToken, kể cả khi API trả về token mới.
            config.set('RefreshToken', '');
            config.set('RefreshTokenExpired', 0);
            updateConfig(system, config);
            return responseObj.data.accessToken;
        }
    }
    return null;
}

/**
 * 2. Cấp lại API Key mới (Reissue API Key)
 * @returns {string|null} Trả về chuỗi apiKey mới hoặc null nếu thất bại
 */
function reissueApiKey(system, baseUrl, token, username, apiKey) {
    var url = baseUrl + "/auth/api-key/reissue";
    var headers = [
        new Header("Content-Type", "application/json"),
        new Header("Authorization", "Bearer " + token)
    ];

    var payload = {
        "username": username,
        "apiKey": apiKey
    };

    var jsonStr = rteJSONStringify(payload);
    var response = sendRequest("POST", url, headers, jsonStr);

    if (response && response.body) {
        var responseObj = rteJSONParse(response.body);
        if (responseObj && responseObj.success === true && responseObj.data) {
            var currentTime = getUnixTimestamp();
            var config = new Map();
            config.set('ApiKey', responseObj.data.apiKey);
            config.set('ReissueAt', currentTime);
            updateConfig(system, config);
            return responseObj.data.apiKey;
        }
    }
    return null;
}

function getConfig() {
    var config = {};
    if (this.oglConfig) {
        return this.oglConfig;
    }
    var configItem = lib.ESD_HTKT_CONFIG.getConfigByName("esdHTKTOglConnect");
    if (configItem != null) {
        SYSTEMS.forEach(sys => {
            config[sys + "BaseUrl"] = configItem.getConfigParameterValue(sys + "BaseUrl");
            config[sys + "Username"] = configItem.getConfigParameterValue(sys + "Username");
            config[sys + "ApiKey"] = configItem.getConfigParameterValue(sys + "ApiKey");
            config[sys + "AccessToken"] = configItem.getConfigParameterValue(sys + "AccessToken");
            config[sys + "AccessTokenExpired"] = configItem.getConfigParameterValue(sys + "AccessTokenExpired");
            config[sys + "RefreshToken"] = configItem.getConfigParameterValue(sys + "RefreshToken");
            config[sys + "RefreshTokenExpired"] = configItem.getConfigParameterValue(sys + "RefreshTokenExpired");
            config[sys + "ReissueAt"] = configItem.getConfigParameterValue(sys + "ReissueAt");
        });
    }

    var configItemCore = lib.ESD_HTKT_CONFIG.getConfigByName("esdHTKTCoreConnect");
    if (configItemCore != null) {
        config["coreBaseUrl"] = configItemCore.getConfigParameterValue("coreBaseUrl");
        config["coreUsername"] = configItemCore.getConfigParameterValue("username");
        config["corePassword"] = configItemCore.getConfigParameterValue("password");
        config["coreChannel"] = configItemCore.getConfigParameterValue("channel");
        config["coreClientId"] = configItemCore.getConfigParameterValue("clientId");
        config["coreAccessToken"] = configItemCore.getConfigParameterValue("accessToken");
        config["coreAccessTokenExpired"] = configItemCore.getConfigParameterValue("accessTokenExpired");
        config["coreAuthUrl"] = configItemCore.getConfigParameterValue("authUrl");
        config["coreAuthClientId"] = configItemCore.getConfigParameterValue("authClientId");
        config["coreAuthClientSecret"] = configItemCore.getConfigParameterValue("authClientSecret");
    }

    this.oglConfig = config;
    return config;
}

function updateConfig(system, config) {
    try {
        var configItem;
        if (system === 'core') {
            configItem = lib.ESD_HTKT_CONFIG.getConfigByName("esdHTKTCoreConnect");
            config.forEach((value, key) => {
                configItem.setConfigParameterValue(key, value + "");
            });
        } else {
            configItem = lib.ESD_HTKT_CONFIG.getConfigByName("esdHTKTOglConnect");
            config.forEach((value, key) => {
                configItem.setConfigParameterValue(system + key, value + "");
                this.oglConfig[system + key] = value;
            });
        }

        lib.ESD_HTKT_CONFIG.updateConfig(configItem);
    } catch (e) {
        print('updateConfigError: ' + e);
    }
}

function getActiveToken(system) {
    const timestampSeconds = getUnixTimestamp();
    var config = getConfig();
    if (system === 'core') {
        if (config && config['coreAccessToken'] && config['coreAccessTokenExpired'] && +config['coreAccessTokenExpired'] > timestampSeconds) {
            //            print('from cache');
            return config['coreAccessToken'];
        } else {
            //            print('cache invalid');
            return getCoreAccessToken(config['coreAuthUrl'], config['coreAuthClientId'], config['coreAuthClientSecret']);
        }
    } else {
        //        print('get ogl or vatin token');
        if (config && config[system + 'AccessToken'] && config[system + 'AccessTokenExpired'] && +config[system + 'AccessTokenExpired'] > timestampSeconds) {
            return config[system + 'AccessToken'];
        } else if (config && config[system + 'RefreshToken'] && config[system + 'RefreshTokenExpired'] && +config[system + 'RefreshTokenExpired'] > timestampSeconds) {
            try {
                var refreshedToken = refreshAccessToken(system, config[system + 'BaseUrl'], config[system + 'RefreshToken']);
                if (refreshedToken) {
                    return refreshedToken;
                }
            } catch (e) {
                print('Token refresh failed; requesting a new access token.');
            }
        }
        if (config) {
            return getAccessToken(system, config[system + 'BaseUrl'], config[system + 'Username'], config[system + 'ApiKey']);
        }
    }
}

function reissueApiSystem(system) {
    var token = getActiveToken(system);
    return reissueApiKey(system, this.oglConfig[system + "BaseUrl"], token, this.oglConfig[system + "Username"], this.oglConfig[system + "ApiKey"]);
}

function getConfigSystem() {
    return this.oglConfig;
}

function getUnixTimestamp() {
    return Math.floor(Date.now() / 1000);
}
