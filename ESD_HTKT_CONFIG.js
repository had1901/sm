var REGISTRY_TABLE = "SMISRegistry";

/**
 * 1. Khởi tạo đối tượng Config của một Registry (Tương tự smis_ConfigurationManager.getInstanceConfig)
 * @param {string} registryName - Tên của cấu hình (Ví dụ: "VtbOglConnect")
 * @returns {Object|null} Trả về đối tượng cấu hình hoặc null nếu không tìm thấy
 */
function getConfigByName(registryName) {
    var registry = new SCFile(REGISTRY_TABLE);
    var sql = "name=\"" + registryName + "\"";

    if (registry.doSelect(sql) === RC_SUCCESS) {
        // Khởi tạo một thực thể Object dạng Class đóng gói
        return new CustomConfigItem(registryName, registry);
    }

    return null;
}

/**
 * 2. Hàm cập nhật cấu hình xuống Database (Tương tự smis_ConfigurationManager.updateInstanceConfig)
 * @param {Object} configItem - Đối tượng được tạo ra từ hàm getInstanceConfig
 * @returns {boolean} Trả về true nếu update database thành công
 */
function updateConfig(configItem) {
    if (!configItem || typeof configItem.saveToDatabase !== "function") {
        return false;
    }
    // Gọi hàm nội tại của đối tượng để ghi dữ liệu
    return configItem.saveToDatabase();
}


/**
 * =========================================================================
 * CẤU TRÚC ĐỐI TƯỢNG ĐÓNG GÓI (CLASS DEFINITION)
 * =========================================================================
 */
function CustomConfigItem(name, scfileRecord) {
    this.name = name;
    this._record = scfileRecord; // Lưu giữ buffer record gốc của SM
    this._paramCache = {}; // Bộ nhớ cache lưu trữ các param đã giải mã (RAM)
    this._dirtyKeys = {}; // Đánh dấu các key đã bị thay đổi (để cập nhật hàng loạt)

    // Tự động phân tích mảng paramInfo của SM và nạp vào bộ nhớ Cache khi khởi tạo
    var params = this._record.paramInfo;
    if (params) {
        for (var key in params) {
            if (params.hasOwnProperty(key) && params[key] !== null) {
                var pName = params[key]["2"]; // Trường 2: Parameter Name
                var pValue = params[key]["3"]; // Trường 3: Parameter Value
                var isEncrypted = params[key]["4"]; // Trường 4: Is Encrypted (true/false)

                if (pName) {
                    // Nếu trường yêu cầu mã hóa, tự động giải mã khi nạp vào bộ nhớ RAM
                    if (isEncrypted === true && pValue) {
                        try {
                            pValue = decrypt(pValue);
                        } catch (e) {
                            // Bỏ qua hoặc log nếu lỗi
                        }
                    }
                    this._paramCache[pName] = pValue;
                }
            }
        }
    }

    /**
     * Hàm lấy giá trị của một Parameter từ bộ nhớ RAM Cache
     */
    this.getConfigParameterValue = function(paramName) {
        return this._paramCache.hasOwnProperty(paramName) ? this._paramCache[paramName] : null;
    };

    /**
     * Hàm cập nhật giá trị của Parameter vào bộ nhớ RAM Cache (Chưa ghi xuống DB)
     */
    this.setConfigParameterValue = function(paramName, newValue) {
        this._paramCache[paramName] = newValue;
        this._dirtyKeys[paramName] = true; // Đánh dấu là đã thay đổi để chuẩn bị lưu
    };

    /**
     * Hàm nội tại chịu trách nhiệm map ngược dữ liệu từ RAM Cache vào SCFile và doUpdate xuống DB
     * (Hàm này sẽ được gọi gián tiếp thông qua updateInstanceConfig)
     */
    this.saveToDatabase = function() {
        var params = this._record.paramInfo;
        var isModified = false;

        if (params) {
            for (var key in params) {
                if (params.hasOwnProperty(key) && params[key] !== null) {
                    var pName = params[key]["2"];

                    // Chỉ xử lý những key thực sự bị thay đổi qua hàm setConfigParameterValue
                    if (pName && this._dirtyKeys.hasOwnProperty(pName)) {
                        var valToSave = this._paramCache[pName];
                        var isEncrypted = params[key]["4"];

                        // Tự động mã hóa lại dữ liệu nếu trường trong DB yêu cầu mã hóa bảo mật
                        if (isEncrypted === true && valToSave) {
                            try {
                                valToSave = encrypt(valToSave);
                            } catch (e) {
                                print("ESD_LOG [Warning]: Lỗi mã hóa khi lưu trường " + pName);
                            }
                        }

                        params[key]["3"] = valToSave; // Ghi đè vào buffer field của bản ghi
                        isModified = true;
                    }
                }
            }

            // Thực hiện I/O đơn nhất xuống DB
            if (isModified) {
                var result = this._record.doUpdate();
                if (result === RC_SUCCESS) {
                    this._dirtyKeys = {}; // Reset lại trạng thái sau khi lưu thành công
                    return true;
                }
            } else {
                return true; // Không có thay đổi gì thì coi như "lưu" thành công
            }
        }
        return false;
    };
}
