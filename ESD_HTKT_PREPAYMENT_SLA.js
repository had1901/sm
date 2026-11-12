/**
 * ScriptLibrary: ESD_HTKT_PREPAYMENT_SLA
 * Khung Thông tin SLA Tạm ứng: sao chép bố cục và client từ Dự chi.
 * HTML Viewer: Input = id; HTML Generating Script = ESD_HTKT_PREPAYMENT_SLA.renderInfor
 * Render riêng cho TU, dữ liệu/lịch và phép tính dùng ESD_HTKT_SLA_ENGINE.
 * Job cập nhật Tracking dùng chung ESD_HTKT_SLA_JOB.runBatch().
 */
function prepaymentSlaClient(rootId, options, calculate) {
    // SM may evaluate HTML Viewer scripts without document.currentScript.
    // Resolve the exact panel, including when script evaluation precedes insertion.
    var root = document.getElementById(rootId);
    if (!root) {
        options.mountAttempts = (options.mountAttempts || 0) + 1;
        if (options.mountAttempts < 20) {
            window.setTimeout(function () { prepaymentSlaClient(rootId, options, calculate); }, 100);
        }
        return;
    }
    if (root.htktSlaCleanup) root.htktSlaCleanup();
    var timer = null;
    // Anchor to SM time; measure elapsed time independently of the client clock.
    var loaded = window.performance.now();
    var layoutFrame = null;
    var layoutWindow = null;
    var layoutObserver = null;
    var layoutReference = null;
    var layoutTimer = null;
    var layoutStyles = [];
    var frameTransform = '';
    var disposed = false;

    function setLayoutStyle(element, property, value) {
        var found = false;
        for (var i = 0; i < layoutStyles.length; i++) {
            if (layoutStyles[i].element === element && layoutStyles[i].property === property) found = true;
        }
        if (!found) layoutStyles.push({ element: element, property: property, value: element.style[property] });
        if (element.style[property] !== value) element.style[property] = value;
    }

    function alignWithNote() {
        if (disposed || !layoutFrame) return;
        if (!document.documentElement.contains(root)) { cleanup(); return; }
        // This stable wrapper class was verified in the native SM textarea DOM.
        // Match the visible multiline field immediately to the left, in this row.
        var frameRect = layoutFrame.getBoundingClientRect();
        var fields = layoutFrame.ownerDocument.querySelectorAll('.xEdit.xTextArea');
        var reference = null;
        var bestScore = Infinity;
        for (var i = 0; i < fields.length; i++) {
            var rect = fields[i].getBoundingClientRect();
            if (rect.width <= 0 || rect.height < 50 || rect.right > frameRect.left ||
                Math.abs(rect.top - frameRect.top) > rect.height / 2) continue;
            var score = Math.abs(rect.top - frameRect.top) + (frameRect.left - rect.right) / 100;
            if (score < bestScore) { reference = fields[i]; bestScore = score; }
        }
        if (!reference) { root.setAttribute('data-sla-layout', 'note-not-found'); return; }

        var height = reference.getBoundingClientRect().height + 'px';
        var panel = root.querySelector('[data-sla-panel]');
        // Draw the outline on the aligned iframe's border box. A panel sized
        // from the outer frame can exceed its inner viewport and lose an edge.
        // Keep the original panel border for Viewers without frame access.
        setLayoutStyle(layoutFrame, 'height', height);
        setLayoutStyle(layoutFrame, 'boxSizing', 'border-box');
        if (!layoutReference) {
            setLayoutStyle(layoutFrame, 'border', panel.style.border);
            setLayoutStyle(layoutFrame, 'borderRadius', panel.style.borderRadius);
        }
        setLayoutStyle(layoutFrame, 'margin', '0');
        setLayoutStyle(layoutFrame, 'padding', '0');
        setLayoutStyle(layoutFrame, 'display', 'block');
        setLayoutStyle(layoutFrame, 'verticalAlign', 'top');
        // Grow only wrappers dedicated to this Viewer, so the extra pixels are
        // not clipped. Containers with labels or other controls stay intact.
        var child = layoutFrame;
        for (var level = 0; level < 2; level++) {
            var wrapper = child.parentNode;
            if (!wrapper || wrapper === layoutFrame.ownerDocument.body ||
                wrapper === layoutFrame.ownerDocument.documentElement ||
                wrapper.childElementCount !== 1 || wrapper.firstElementChild !== child) break;
            setLayoutStyle(wrapper, 'height', height);
            setLayoutStyle(wrapper, 'boxSizing', 'border-box');
            setLayoutStyle(wrapper, 'padding', '0');
            setLayoutStyle(wrapper, 'border', '0');
            setLayoutStyle(wrapper, 'overflow', 'visible');
            child = wrapper;
        }
        setLayoutStyle(root, 'height', '100%');
        setLayoutStyle(panel, 'height', '100%');
        setLayoutStyle(panel, 'maxHeight', '100%');
        setLayoutStyle(panel, 'minHeight', '0');
        setLayoutStyle(panel, 'border', '0');
        // Reset to the original transform before measuring to prevent drift
        // when resizing or when the HTML Viewer initializes more than once.
        setLayoutStyle(layoutFrame, 'transform', frameTransform);
        var offset = reference.getBoundingClientRect().top - layoutFrame.getBoundingClientRect().top;
        setLayoutStyle(layoutFrame, 'transform', (frameTransform ? frameTransform + ' ' : '') +
            'translateY(' + offset + 'px)');
        root.setAttribute('data-sla-layout', 'aligned-note');
        if (layoutReference !== reference && layoutWindow && layoutWindow.ResizeObserver) {
            if (layoutObserver) layoutObserver.disconnect();
            layoutObserver = new layoutWindow.ResizeObserver(scheduleAlignment);
            layoutObserver.observe(reference);
        }
        layoutReference = reference;
    }

    function scheduleAlignment() {
        if (disposed) return;
        if (layoutTimer !== null) window.clearTimeout(layoutTimer);
        layoutTimer = window.setTimeout(function () {
            layoutTimer = null;
            alignWithNote();
        }, 50);
    }
    // Use the highest accessible SM window. A portal above SM may have a
    // different origin, so accessing window.top.document can be forbidden.
    var hostWindow = window;
    while (hostWindow !== hostWindow.parent) {
        try {
            var parentWindow = hostWindow.parent;
            if (!parentWindow.document) break;
            hostWindow = parentWindow;
        } catch (parentAccessError) { break; }
    }
    function stopTimer() {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
    }
    // postMessage crosses the addon/SM origin boundary. Accept only the actual
    // approval iframe, including when it is nested in another HTML Viewer.
    function trustedSource(frameDocument, event) {
        var frames = frameDocument.querySelectorAll('iframe,frame');
        for (var f = 0; f < frames.length; f++) {
            var frame = frames[f];
            if (frame.contentWindow === event.source) {
                var link = frameDocument.createElement('a');
                link.href = frame.src;
                return link.protocol + '//' + link.host === event.origin &&
                    options.approvalPath &&
                    link.pathname.replace(/\/$/, '').slice(-options.approvalPath.length) === options.approvalPath;
            }
            try {
                if (frame.contentDocument && trustedSource(frame.contentDocument, event)) return true;
            } catch (frameAccessError) { }
        }
        return false;
    }
    function assignmentSaved(event) {
        if (!document.documentElement.contains(root)) { cleanup(); return; }
        var data = event.data;
        if (data && data.action === 'htktSlaAssignmentSaved' && data.paymentId === options.paymentId) {
            root.setAttribute('data-sla-event', 'received');
        }
        if (!data || data.action !== 'htktSlaAssignmentSaved' || data.paymentId !== options.paymentId ||
            data.field !== options.actorField || typeof data.previousValue !== 'string' ||
            typeof data.value !== 'string' || !data.value.replace(/^\s+|\s+$/g, '') ||
            !options.currentUser || data.previousValue.toLowerCase() !== options.currentUser.toLowerCase() ||
            data.value.toLowerCase() === options.currentUser.toLowerCase()) return;
        try { if (!trustedSource(hostWindow.document, event)) return; }
        catch (hostAccessError) { return; }
        stopTimer();
        var badge = root.querySelector('[data-sla-status]');
        badge.textContent = 'Không tính SLA';
        badge.style.color = badge.style.borderColor = '#94a3b8';
        badge.style.background = '#f1f5f9';
        root.querySelector('[data-sla-panel]').style.borderColor = '#94a3b8';
        if (layoutFrame && layoutReference) setLayoutStyle(layoutFrame, 'borderColor', '#94a3b8');
        root.querySelector('[data-sla-label]').textContent = 'Thời gian còn lại: ';
        root.querySelector('[data-sla-time]').textContent = 'N/A';
        root.querySelector('[data-sla-due]').textContent = 'N/A';
        root.setAttribute('data-sla-event', 'applied');
        try {
            var diagnostic = JSON.parse(root.getAttribute('data-sla-diagnostic'));
            diagnostic.reason = 'CURRENT_CONTACT_NOT_ACTOR';
            diagnostic.actor = data.value;
            root.setAttribute('data-sla-diagnostic', JSON.stringify(diagnostic));
        } catch (diagnosticError) { }
    }
    function cleanup() {
        disposed = true;
        stopTimer();
        if (layoutTimer !== null) window.clearTimeout(layoutTimer);
        if (layoutObserver) layoutObserver.disconnect();
        if (layoutWindow) layoutWindow.removeEventListener('resize', scheduleAlignment, false);
        for (var i = layoutStyles.length - 1; i >= 0; i--) {
            var savedStyle = layoutStyles[i];
            savedStyle.element.style[savedStyle.property] = savedStyle.value;
        }
        hostWindow.removeEventListener('message', assignmentSaved, false);
        window.removeEventListener('unload', cleanup, false);
    }
    hostWindow.addEventListener('message', assignmentSaved, false);
    window.addEventListener('unload', cleanup, false);
    root.htktSlaCleanup = cleanup;
    root.setAttribute('data-sla-client', 'listening-v4');
    try {
        layoutFrame = window.frameElement;
        if (layoutFrame) {
            frameTransform = layoutFrame.style.transform || '';
            layoutWindow = layoutFrame.ownerDocument.defaultView;
            if (layoutWindow) layoutWindow.addEventListener('resize', scheduleAlignment, false);
            alignWithNote();
            scheduleAlignment();
        }
    } catch (layoutAccessError) {
        root.setAttribute('data-sla-layout', 'frame-unavailable');
    }
    if (options.running && options.remainingMs !== null) {
        timer = window.setInterval(function () {
            if (!document.documentElement.contains(root)) { cleanup(); return; }
            var now = options.referenceMs + (window.performance.now() - loaded);
            var left = options.remainingMs - calculate(options.referenceMs, now, options.hours, options.holidays);
            var seconds = Math.floor(Math.abs(left) / 1000);
            var breached = left <= 0;
            var time = root.querySelector('[data-sla-time]');
            var panel = root.querySelector('[data-sla-panel]');
            time.textContent = (left < 0 ? '-' : '') + Math.floor(seconds / 3600) + ' giờ ' +
                Math.floor(seconds % 3600 / 60) + ' phút ' + seconds % 60 + ' giây';
            root.querySelector('[data-sla-label]').textContent = 'Thời gian còn lại: ';
            time.style.color = breached ? options.breachColor : options.timeColor;
            panel.style.borderColor = breached ? options.breachColor : options.panelColor;
            var status = root.querySelector('[data-sla-status]');
            if (status) {
                status.textContent = breached ? 'Vi ph\u1ea1m' : options.status;
                status.style.color = breached ? options.breachColor : options.statusColor;
                status.style.borderColor = breached ? options.breachColor : options.statusColor;
                status.style.background = breached ? options.breachBackground : options.statusBackground;
            }
            if (layoutFrame && layoutReference) {
                setLayoutStyle(layoutFrame, 'borderColor', breached ? options.breachColor : options.panelColor);
            }
        }, 1000);
    }
}

/** HTML Viewer: khung SLA Tạm ứng. */
function renderInfor(endpoint, input, extraData) {
    var data = lib.ESD_HTKT_SLA_ENGINE.getTrackingViewData(endpoint, input, extraData, "TU");
    var paymentId = data.paymentId;
    var selectCode = data.selectCode;
    var diagnostic = data.diagnostic;
    var workingHours = data.workingHours;
    var holidays = data.holidays;
    var referenceMs = data.referenceMs;
    var overdue = data.overdue;
    var status = data.status;
    var dueAt = data.dueAt;
    var endedAt = data.endedAt;
    var remainingMs = data.remainingMs;
    var running = data.running;
    var color = data.color;
    var background = data.background;

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function pad(value) {
        return value < 10 ? '0' + value : String(value);
    }

    function wallTime(value) {
        return value.getTime() + 7 * 3600000;
    }

    function formatDate(value) {
        if (!value) return '---';
        var local = new Date(wallTime(value));
        return pad(local.getUTCDate()) + '/' + pad(local.getUTCMonth() + 1) + '/' + local.getUTCFullYear() +
            ' ' + pad(local.getUTCHours()) + ':' + pad(local.getUTCMinutes()) + ':' + pad(local.getUTCSeconds());
    }

    function formatDuration(value) {
        if (value === null) return '---';
        var seconds = Math.floor(Math.abs(value) / 1000);
        return (value < 0 ? '-' : '') + Math.floor(seconds / 3600) + ' giờ ' + Math.floor(seconds % 3600 / 60) +
            ' phút ' + seconds % 60 + ' giây';
    }

    var breachColor = '#ef4444';
    var breachBackground = '#fef2f2';
    var displayBreached = overdue || (running && remainingMs !== null && remainingMs <= 0);
    if (displayBreached) {
        status = 'Vi ph\u1ea1m';
        color = breachColor;
        background = breachBackground;
    }
    var panelColor = displayBreached ? breachColor : color;
    var timeColor = displayBreached ? breachColor : '#7c8ba5';
    var timeLabel = endedAt ? 'Thời gian còn lại khi kết thúc: ' : 'Thời gian còn lại: ';
    var rootId = 'htkt-sla-' + new Date().getTime() + '-' + Math.floor(Math.random() * 1000000000);
    var html = '<style>html,body{margin:0!important;padding:0!important;width:100%;height:100%;overflow:hidden!important;}' +
        '[data-sla-view],[data-sla-view] *{box-sizing:border-box;}</style>' +
        '<div id="' + rootId + '" data-sla-view data-payment-id="' + escapeHtml(paymentId) + '" data-sla-select-code="' + escapeHtml(selectCode) +
        '" data-sla-diagnostic="' + escapeHtml(JSON.stringify(diagnostic)) +
        '" style="width:100%;min-width:0;display:flex;flex-direction:column;padding:0;background:#fff;font-family:Arial,sans-serif;">' +
        '<div data-sla-panel style="height:126px;max-height:100vh;flex-shrink:0;min-width:0;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;gap:6px;border:1px solid ' + panelColor + ';border-radius:6px;padding:8px;">' +
        '<div style="line-height:18px;font-size:13px;font-weight:600;color:#304970;">Chi tiết SLA: SLA xử lý</div>' +
        '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 8px;line-height:18px;font-size:13px;color:#7c8ba5;">' +
        '<div>Trạng thái xử lý: <span data-sla-status style="display:inline-block;margin-left:3px;padding:0 3px;border:1px solid ' + color +
        ';border-radius:10px;color:' + color + ';background:' + background + ';font-size:13px;">' + escapeHtml(status) + '</span></div>' +
        '<div><span data-sla-label>' + timeLabel + '</span><span data-sla-time style="color:' + timeColor + ';">' + (status === 'Không tính SLA' ? 'N/A' : formatDuration(remainingMs)) + '</span></div></div>' +
        '<div style="line-height:18px;font-size:13px;color:#7c8ba5;">Hạn xử lý: <span data-sla-due>' +
        (status === 'Không tính SLA' ? 'N/A' : escapeHtml(formatDate(dueAt))) + '</span></div></div>';

    // Dem nguoc tai trinh duyet, khong goi lai SM moi giay. Dung khi viewer bi thao khoi DOM.
    var clientOptions = {
        paymentId: paymentId, actorField: diagnostic.actorField || '', currentUser: diagnostic.currentUser || '',
        approvalPath: /^TU\./i.test(paymentId) ? '/TamUngMuaSam/ThongTinPheDuyet' :
            /^TT\./i.test(paymentId) ? '/HachToanKeToan/ThanhToan/TabThongTinPheDuyet' :
            '/HachToanKeToan/DuChi/TabThongTinPheDuyet',
        running: running, remainingMs: remainingMs, referenceMs: referenceMs, hours: workingHours, holidays: holidays,
        status: status, statusColor: color, statusBackground: background,
        breachColor: breachColor, breachBackground: breachBackground,
        panelColor: panelColor, timeColor: timeColor
    };
    html += '<script>(' + prepaymentSlaClient.toString() +
        ')(' + JSON.stringify(rootId) + ',' +
        JSON.stringify(clientOptions).replace(/</g, '\\u003c') + ',' +
        lib.ESD_HTKT_SLA_ENGINE.slaViewWorkingMilliseconds.toString() + ');</script>';
    return html + '</div>';
}
