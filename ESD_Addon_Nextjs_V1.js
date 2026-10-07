function renderPageNextJS(endpoint, input, extraData) {
    const aesjs = lib.ESD_Addon_Crypto.aesjsCrypto();
    const key = [90, 5, 158, 97, 147, 177, 222, 117, 15, 139, 237, 123, 191, 126, 170, 44];

    const lastbusy = system.user.lastbusy;
    const lastbusyDate = new Date(lastbusy * 1000);

    // Chuẩn hóa tài khoản đăng nhập để so sánh.
    const userLogin = String(system.user.name || '')
        .trim()
        .toLowerCase();

    /**
     * Tài khoản phát triển được trỏ vào localhost.
     * Các tài khoản còn lại sử dụng máy chủ triển khai. 
     */
    const iframeUrl =
        //    userLogin === 'vtb.htkt.115' ||
        //    userLogin === 'vtb.htkt.113' ||
        userLogin === 'vtb.htkt.112' ||
        //    userLogin === 'vtb.htkt.100' ||
        userLogin === 'vtb.htkt.178' ||
        //    userLogin === 'vtb.htkt.147'  ||
        userLogin === 'vtb.htkt.146' ||
//        userLogin === 'vtb.htkt.145' ||
        //    userLogin === 'vtb.htkt.19'  ||
        //    userLogin === 'vtb.htkt.16'  ||
//            userLogin === 'vtb.htkt.117'  ||
            userLogin === 'vtb.htkt.116'  ||
//        userLogin === 'vtb.htkt.16' ||
        //     userLogin === 'vtb.htkt.16'  ||
//        userLogin === 'vtb.htkt.132' ||
        // userLogin === 'vtb.htkt.122'  ||
//        userLogin === 'vtb.htkt.121' ||
//            userLogin === 'vtb.htkt.126'  ||
//        userLogin === 'vtb.htkt.129' ||
//        userLogin === 'vtb.htkt.124' ||
        userLogin === 'vtb.htkt.123' ||
//            userLogin === 'vtb.htkt.127'  ||
//            userLogin === 'vtb.htkt.123'  ||  
//        userLogin === 'vtb.htkt.130' ||
        //    userLogin === 'vtb.htkt.124'  ||
        //        userLogin === 'vtb.htkt.17'  ||
        //                userLogin === 'vtb.htkt.120'  ||
//            userLogin === 'vtb.htkt.126'  ||
        userLogin === 'vtb.htkt.146' ||
        userLogin === 'vtb.htkt.148' ||
        //    userLogin === 'vtb.htkt.123'  ||
        //        userLogin === 'vtb.htkt.199'  ||
        //    userLogin === 'vtb.htkt.42'  ||
        //    userLogin === 'vtb.htkt.47'  ||
        //    userLogin === 'vtb.htkt.48'  ||
        userLogin === 'vtb.htkt.111' ||
        userLogin === 'vtb.htkt.118' ||
        userLogin === 'vtb.htkt.11' ?
        'http://localhost:3001' :
        'http://10.2.18.9:5010';

    //  const iframeUrl = 'http://localhost:3001';
    var rights = vars['$G.rights'];

    // Payload ban đầu để build URL.
    const payload = {
        isFromSm: 1,
        userName: userLogin,
        lastbusy: lastbusyDate,
        endpoint: endpoint,
    };

    // Encrypt payload.
    const text = JSON.stringify(payload);
    const textBytes = aesjs.utils.utf8.toBytes(text);
    const aesCtr = new aesjs.ModeOfOperation.ctr(
        key,
        new aesjs.Counter(5)
    );
    const encryptedBytes = aesCtr.encrypt(textBytes);
    const encryptedHex = aesjs.utils.hex.fromBytes(encryptedBytes);

    const src =
        iframeUrl +
        '/ess/' +
        encryptedHex +
        '/path/' +
        endpoint +
        (input || '');

    // Tạo HTML.
    return `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>

<script
  type="text/javascript"
  load-once="1"
  src="../js/9.80.0016/sm.base.js">
</script>

<style>
.loading-mask {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 73vh;
    background: rgba(255, 255, 255, 0.6);
    z-index: 2000;
    display: none;
    justify-content: center;
    align-items: center;
    cursor: wait;
}

.loading-box {
    width: 140px;
    height: 54px;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px;
    border: 1px solid #ccc;
    background: #fff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    font-size: 18px;
    color: #555;
}
</style>
</head>

<body>
<div id="loading" class="loading-mask">
    <div class="loading-box">
        <img
          src="../images/9.80.0016/default/grid/mask-loading.gif"
          width="30"
          height="30"
          alt="loading"
        />
        <span>Loading...</span>
    </div>
</div>

<iframe
  id="addonIframe"
  src="${src}"
  style="height:100vh;width:100vw;border:none;outline:none">
</iframe>

<script>
const iframe = document.getElementById("addonIframe");
const allowedIframeOrigin = "${iframeUrl}";
console.log("allowedIframeOrigin =", allowedIframeOrigin);
document.cookie =
  "x-user-right=${encodeURIComponent(
    Array.isArray(rights) ? rights.join(',') : String(rights || '')
  )};path=/";

function openTaskDetails(fileName, taskNumber, fieldId, actionType, u, exp, sig) {
    const queryFilter = encodeURIComponent(
        fieldId + '="' + taskNumber + '"'
    );

    const builder = parent.cwc.getDetailURLBuilder();
    builder.addParam('ctx', 'docEngine');
    builder.addParam('wflink', 'true');
    builder.addParam('file', fileName);
    builder.addParam('query', queryFilter);

    builder.addParam('u', u);
    builder.addParam('exp', exp);
    builder.addParam('sig', sig);
    const wfUrl = builder.toURL();

    parent.cwc.updateActiveTab(wfUrl);
}

function openAndCloseTaskDetails(
    fileName,
    taskNumber,
    fieldId,
    messageData, 
    u, 
    exp, 
    sig
) {
    openTaskDetails(
        fileName,
        taskNumber,
        fieldId, 
        u, 
        exp, 
        sig
    );

    setTimeout(function () {
        try {
            const activePopup = top.cwc.getActivePopup();

            if (activePopup) {
                activePopup.close();
            }
        } catch (e) {
            console.log("close popup error:", e);
        }
    }, 500);

    if (
        messageData &&
        Array.isArray(messageData.items) &&
        messageData.items.length
    ) {
        setTimeout(function () {
            showMessageBar({
                items: messageData.items.map(function (item) {
                    return {
                        module: "evmsg",
                        msg: item.msg || "",
                        severity: item.severity || "3",
                        time: item.time || ""
                    };
                })
            }, 2000);
        }, 800);
    }
}

function showMessageBar(msg, duration) {
    duration = duration || 3000;

    try {
        const manager = parent.topCwc.messageManager;

        manager.showMessageBar(msg, false);

        setTimeout(function () {
            try {
                manager.hideMessageBar();
            } catch (e) {
                console.log("clear message error:", e);
            }
        }, duration);
    } catch (e) {
        console.log("show message bar error:", e);
    }
}

function handleClosePopup(messageData) {
    try {
        const activePopup = top.cwc.getActivePopup();

        if (activePopup) {
            activePopup.close();
        }
    } catch (e) {
        console.log("close popup error:", e);
    }

    if (
        messageData &&
        Array.isArray(messageData.items) &&
        messageData.items.length
    ) {
        setTimeout(function () {
            showMessageBar({
                items: messageData.items.map(function (item) {
                    return {
                        module: "evmsg",
                        msg: item.msg || "",
                        severity: item.severity || "3",
                        time: item.time || ""
                    };
                })
            }, 3000);
        }, 800);
    }
}

function handleOnMaskWindowLoading() {
    top.cwc.maskWindow("LOADING");
}


// Nhận message từ iframe.
window.addEventListener('message', function (event) {
    /**
     * Chỉ nhận message từ đúng địa chỉ iframe:
     * - vtb.htkt.100: http://localhost:3001
     * - tài khoản khác: http://10.2.18.9:5010
     */
    if (event.origin !== allowedIframeOrigin) {
//        console.log(
//            "Blocked message from invalid origin:",
//            event.origin
//        );
        return;
    }

    const data = event.data;

    if (!data || typeof data !== "object") {
        return;
    }

    console.log("data SM =", data);

    if (data.action === "readyToReceiveInitialData") {
        const initialPayload = {
            action: "initData",
            value: ${JSON.stringify(extraData)}
        };

        if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage(
                initialPayload,
                allowedIframeOrigin
            );
        }

        console.log("Sent initData:", initialPayload);
        return;
    }

    if (data.action === "navigate") {
        console.log('navigate - ', data);
        if (
            parent.cwc &&
            typeof parent.cwc.navigateTo === "function"
        ) {
            parent.cwc.navigateTo(data.url);
        } else {
            parent.cwc.updateActiveTab(data.url);
        }

        return;
    }

    if (
        data.action === "openTaskDetails" ||
        data.action === "navigate-detail"
    ) {
        console.log('openTaskDetails = ', data);

        openTaskDetails(
            data.fileName,
            data.taskNumber,
            data.fieldId,
            data.actionType,
            data.u,
            data.exp,
            data.sig
        );

        return;
    }

    if (data.action === "closePopUp") {
        handleClosePopup(data.messageBar);
        return;
    }

    if (data.action === "showLoading") {
        const loadingElement = document.getElementById("loading");

        if (loadingElement) {
            loadingElement.style.display = "flex";
        }

        return;
    }

    if (data.action === "hideLoading") {
        const loadingElement = document.getElementById("loading");

        if (loadingElement) {
            loadingElement.style.display = "none";
        }

        return;
    }

    if (data.action === "openAndCloseTaskDetails") {
        openAndCloseTaskDetails(
            data.fileName,
            data.taskNumber,
            data.fieldId,
            data.messageBar,
            data.u,
            data.exp,
            data.sig
        );

        return;
    }

    if (
        data.action === "messageBarEvent" &&
        Array.isArray(data.items) &&
        data.items.length
    ) {
        showMessageBar({
            items: data.items.map(function (item) {
                return {
                    module: "evmsg",
                    msg: item.msg || "",
                    severity: item.severity || "3",
                    time: item.time || ""
                };
            })
        }, 3000);

        return;
    }

    if (data.action === "onMaskWindowLoading") {
        try {
            handleOnMaskWindowLoading();
        } catch (e) {
            console.log("maskWindow error:", e);
        }

        return;
    }

    if (data.action === "offMaskWindowLoading") {
        try {
            top.cwc.unmaskWindow();
        } catch (e) {
            console.log("unmaskWindow error:", e);
        }
    }
});
</script>
</body>
</html>
  `;
}