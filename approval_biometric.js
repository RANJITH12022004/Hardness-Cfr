// Ported from DUMMY kiosk/script.js by _port_approval.py

var appModalResolve = null;

function closeAppModal() {
    var overlay = document.getElementById('app-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    if (appModalResolve) {
        appModalResolve(false);
        appModalResolve = null;
    }
}

function showAppModal(message, title, onClose) {
    var overlay = document.getElementById('app-modal-overlay');
    var titleEl = document.getElementById('app-modal-title');
    var msgEl = document.getElementById('app-modal-message');
    var buttonsEl = document.getElementById('app-modal-buttons');
    if (!overlay || !titleEl || !msgEl || !buttonsEl) {
        window.alert(message);
        if (typeof onClose === 'function') onClose();
        return;
    }
    titleEl.textContent = title || 'Message';
    msgEl.textContent = message || '';
    buttonsEl.innerHTML = '';
    var okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn-role-select btn-role-user';
    okBtn.textContent = 'OK';
    okBtn.onclick = function () {
        if (appModalResolve) {
            appModalResolve(true);
            appModalResolve = null;
        }
        overlay.style.display = 'none';
        if (typeof onClose === 'function') onClose();
    };
    buttonsEl.appendChild(okBtn);
    overlay.style.display = 'flex';
}


var biometricEnabledSetting = true;
var approvalVerifyResolve = null;
var approvalVerifyReject = null;
var adminApprovalVerifyResolve = null;
var adminApprovalVerifyReject = null;
var _approvalVerifyModalOriginal = null;
var _approvalVerifyReturnPage = 'home';

function openApprovalVerifyModal(options) {
    return new Promise(function (resolve, reject) {
        _approvalVerifyReturnPage = (typeof getActivePageName === 'function' ? getActivePageName() : '') || 'home';
        if (typeof goToPage === 'function') goToPage('approval-verify');
        var els = _getApprovalVerifyModalElements();
        if (!els) {
            reject(new Error('QA verification UI is missing.'));
            return;
        }
        approvalVerifyResolve = resolve;
        approvalVerifyReject = reject;
        _storeApprovalVerifyModalOriginalUiOnce();
        _restoreApprovalVerifyModalOriginalUi();
        _setApprovalVerifyModalButtonHandlers(submitApprovalVerifyModal, cancelApprovalVerifyModal);
        var o = options == null ? {} : options;
        _approvalVerifyPurpose = o.purpose || 'recipe';
        if (o.titleText && els.titleEl) els.titleEl.textContent = o.titleText;
        if (o.titleText) {
            var headerTitle = document.querySelector('.page-title');
            if (headerTitle) headerTitle.textContent = o.titleText;
        }
        if (o.subtitleText && els.subtitleEl) els.subtitleEl.textContent = o.subtitleText;
        if (o.usernameLabelText && els.usernameLabelEl) els.usernameLabelEl.textContent = o.usernameLabelText;
        if (o.usernamePlaceholder && els.usernameEl) els.usernameEl.setAttribute('placeholder', o.usernamePlaceholder);
        _approvalVerifyEmptyCredentialsMessage = o.emptyCredentialsMessage || 'Enter QA username and password.';
        if (els.errEl) {
            els.errEl.textContent = '';
            els.errEl.style.display = 'none';
        }
        els.usernameEl.value = '';
        els.passwordEl.value = '';
        if (!els.passwordEl._approvalVerifyEnterHandler) {
            els.passwordEl._approvalVerifyEnterHandler = function (e) {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    if (adminApprovalVerifyResolve) submitAdminApprovalVerifyModal();
                    else submitApprovalVerifyModal();
                }
            };
            els.passwordEl.addEventListener('keydown', els.passwordEl._approvalVerifyEnterHandler);
        }
    });
}

function closeApprovalVerifyModal() {
    if (typeof goToPage === 'function') goToPage(_approvalVerifyReturnPage || 'home');
}

function cancelApprovalVerifyModal() {
    closeApprovalVerifyModal();
    _restoreApprovalVerifyModalOriginalUi();
    if (approvalVerifyResolve) {
        approvalVerifyResolve(null);
        approvalVerifyResolve = null;
    }
    if (approvalVerifyReject) approvalVerifyReject = null;
}

function submitApprovalVerifyModal() {
    var usernameEl = document.getElementById('approval-verify-username');
    var passwordEl = document.getElementById('approval-verify-password');
    var errEl = document.getElementById('approval-verify-error');
    var username = usernameEl ? String(usernameEl.value || '').trim() : '';
    var password = passwordEl ? String(passwordEl.value || '') : '';
    if (!username || !password) {
        if (errEl) {
            errEl.textContent = _approvalVerifyEmptyCredentialsMessage;
            errEl.style.display = 'block';
        }
        return;
    }
    apiRequest(API_BASE + '/api/data/auth/approval-verify', {
        method: 'POST',
        body: { method: 'credentials', username: username, password: password, purpose: _approvalVerifyPurpose }
    }).then(function (data) {
        if (!data || !data.ok || !data.token) {
            if (errEl) {
                errEl.textContent = (data && data.error) ? String(data.error) : 'Verification failed.';
                errEl.style.display = 'block';
            }
            return;
        }
        closeApprovalVerifyModal();
        _restoreApprovalVerifyModalOriginalUi();
        if (approvalVerifyResolve) {
            approvalVerifyResolve(String(data.token));
            approvalVerifyResolve = null;
        }
        if (approvalVerifyReject) approvalVerifyReject = null;
    }).catch(function (err) {
        if (errEl) {
            errEl.textContent = 'Verification failed: ' + (err && err.message ? err.message : 'Error');
            errEl.style.display = 'block';
        }
    });
}

function submitApprovalVerifyBiometricModal() {
    var errEl = document.getElementById('approval-verify-error');
    if (!biometricEnabledSetting) {
        if (errEl) {
            errEl.textContent = 'Biometric verification is disabled by Factory Settings.';
            errEl.style.display = 'block';
        }
        return;
    }
    if (errEl) {
        errEl.textContent = '';
        errEl.style.display = 'none';
    }
    runBiometricVerifyWithRetry({
        purpose: _approvalVerifyPurpose,
        title: 'Verify Fingerprint',
        message: 'Place an Admin/QA fingerprint on the scanner to authorize this action.',
        failureHint: 'Place your finger on the scanner and tap Try again.'
    }).then(function (result) {
        if (!result || !result.ok) {
            if (result && result.error !== 'cancelled' && errEl) {
                errEl.textContent = result.message || result.error || 'Fingerprint verification failed.';
                errEl.style.display = 'block';
            }
            return;
        }
        closeApprovalVerifyModal();
        _restoreApprovalVerifyModalOriginalUi();
        if (approvalVerifyResolve) {
            approvalVerifyResolve(String(result.token));
            approvalVerifyResolve = null;
        }
        if (approvalVerifyReject) approvalVerifyReject = null;
    });
}

function _getApprovalVerifyModalElements() {
    var overlay = document.getElementById('page-approval-verify');
    var usernameEl = document.getElementById('approval-verify-username');
    var passwordEl = document.getElementById('approval-verify-password');
    var errEl = document.getElementById('approval-verify-error');
    if (!overlay || !usernameEl || !passwordEl || !errEl) return null;
    var usernameLabelEl = overlay.querySelector('label[for="approval-verify-username"]');
    var actionsRow = overlay.querySelector('.add-member-actions');
    var userBtn = actionsRow ? actionsRow.querySelector('button.btn-primary') : null;
    var cancelBtn = null;
    if (actionsRow) {
        var secs = actionsRow.querySelectorAll('button.btn-secondary');
        for (var i = 0; i < secs.length; i++) {
            var oc = secs[i].getAttribute('onclick') || '';
            if (oc.indexOf('cancelApprovalVerifyModal') >= 0 || oc.indexOf('cancelAdminApprovalVerifyModal') >= 0) {
                cancelBtn = secs[i];
                break;
            }
        }
    }
    var titleEl = document.getElementById('approval-verify-title');
    var subtitleEl = document.getElementById('approval-verify-subtitle');
    return { overlay: overlay, usernameEl: usernameEl, passwordEl: passwordEl, errEl: errEl, usernameLabelEl: usernameLabelEl, userBtn: userBtn, cancelBtn: cancelBtn, titleEl: titleEl, subtitleEl: subtitleEl };
}

function _storeApprovalVerifyModalOriginalUiOnce() {
    if (_approvalVerifyModalOriginal) return;
    var els = _getApprovalVerifyModalElements();
    if (!els) return;
    _approvalVerifyModalOriginal = {
        titleText: els.titleEl ? els.titleEl.textContent : null,
        subtitleText: els.subtitleEl ? els.subtitleEl.textContent : null,
        usernameLabelText: els.usernameLabelEl ? els.usernameLabelEl.textContent : null,
        usernamePlaceholder: els.usernameEl ? els.usernameEl.getAttribute('placeholder') : null
    };
    _approvalVerifyButtonOriginal = {
        userBtnOnclick: els.userBtn ? els.userBtn.onclick : null,
        cancelBtnOnclick: els.cancelBtn ? els.cancelBtn.onclick : null
    };
}

function _restoreApprovalVerifyModalOriginalUi() {
    var els = _getApprovalVerifyModalElements();
    if (!els || !_approvalVerifyModalOriginal) return;
    if (els.titleEl && _approvalVerifyModalOriginal.titleText != null) els.titleEl.textContent = _approvalVerifyModalOriginal.titleText;
    if (els.subtitleEl && _approvalVerifyModalOriginal.subtitleText != null) els.subtitleEl.textContent = _approvalVerifyModalOriginal.subtitleText;
    if (els.usernameLabelEl && _approvalVerifyModalOriginal.usernameLabelText != null) els.usernameLabelEl.textContent = _approvalVerifyModalOriginal.usernameLabelText;
    if (els.usernameEl && _approvalVerifyModalOriginal.usernamePlaceholder != null) els.usernameEl.setAttribute('placeholder', _approvalVerifyModalOriginal.usernamePlaceholder);
    if (_approvalVerifyButtonOriginal) {
        if (els.userBtn) els.userBtn.onclick = _approvalVerifyButtonOriginal.userBtnOnclick;
        if (els.cancelBtn) els.cancelBtn.onclick = _approvalVerifyButtonOriginal.cancelBtnOnclick;
    }
}

function _setApprovalVerifyModalButtonHandlers(verifyFn, cancelFn) {
    var els = _getApprovalVerifyModalElements();
    if (!els) return;
    if (els.userBtn) els.userBtn.onclick = verifyFn;
    if (els.cancelBtn) els.cancelBtn.onclick = cancelFn;
}

function _normUserKey(v) {
    return String(v || '').trim().toLowerCase();
}

// Admin-only verification modal for starting a test run.
function openAdminApprovalVerifyModal(options) {
    return new Promise(function (resolve, reject) {
        _approvalVerifyReturnPage = (typeof getActivePageName === 'function' ? getActivePageName() : '') || 'home';
        if (typeof goToPage === 'function') goToPage('approval-verify');
        var els = _getApprovalVerifyModalElements();
        var opts = options || {};
        if (!els) {
            reject(new Error('Admin verification UI is missing.'));
            return;
        }

        _storeApprovalVerifyModalOriginalUiOnce();
        adminApprovalVerifyResolve = resolve;
        adminApprovalVerifyReject = reject;

        els.errEl.textContent = '';
        els.errEl.style.display = 'none';
        els.usernameEl.value = '';
        els.passwordEl.value = '';

        var adminTitle = opts.titleText || 'Admin approval required';
        if (els.titleEl) els.titleEl.textContent = adminTitle;
        var headerTitle = document.querySelector('.page-title');
        if (headerTitle) headerTitle.textContent = adminTitle;
        if (els.subtitleEl) els.subtitleEl.textContent = opts.subtitleText || 'Enter admin credentials to continue.';
        if (els.usernameLabelEl) els.usernameLabelEl.textContent = 'Admin username';
        if (els.usernameEl) els.usernameEl.setAttribute('placeholder', 'Enter admin username');

        _setApprovalVerifyModalButtonHandlers(submitAdminApprovalVerifyModal, cancelAdminApprovalVerifyModal);
    });
}

function cancelAdminApprovalVerifyModal() {
    closeApprovalVerifyModal();
    _restoreApprovalVerifyModalOriginalUi();
    if (adminApprovalVerifyResolve) {
        adminApprovalVerifyResolve(null);
        adminApprovalVerifyResolve = null;
    }
    if (adminApprovalVerifyReject) adminApprovalVerifyReject = null;
}

function submitAdminApprovalVerifyModal() {
    var els = _getApprovalVerifyModalElements();
    if (!els) return;

    var username = els.usernameEl ? String(els.usernameEl.value || '').trim() : '';
    var password = els.passwordEl ? String(els.passwordEl.value || '') : '';

    if (!username || !password) {
        els.errEl.textContent = 'Enter admin username and password.';
        els.errEl.style.display = 'block';
        return;
    }

    apiRequest(API_BASE + '/api/data/auth/approval-verify', {
        method: 'POST',
        body: { method: 'credentials', username: username, password: password, purpose: 'recipe' }
    }).then(function (data) {
        if (!data || !data.ok || !data.token) {
            els.errEl.textContent = (data && data.error) ? String(data.error) : 'Verification failed.';
            els.errEl.style.display = 'block';
            return;
        }

        closeApprovalVerifyModal();
        _restoreApprovalVerifyModalOriginalUi();
        if (adminApprovalVerifyResolve) {
            adminApprovalVerifyResolve({
                token: String(data.token),
                username: _normUserKey(data.verifier && data.verifier.username),
                role: role
            });
            adminApprovalVerifyResolve = null;
        }
        if (adminApprovalVerifyReject) adminApprovalVerifyReject = null;
    }).catch(function (err) {
        els.errEl.textContent = 'Verification failed: ' + (err && err.message ? err.message : 'Error');
        els.errEl.style.display = 'block';
    });
}

function distributeTotalTaps(total, stepCount) {
    var t = parseInt(total, 10);
    var n = Math.max(1, parseInt(stepCount, 10) || 1);
    if (isNaN(t) || t < n) return null;
    var base = Math.floor(t / n);
    var rem = t - base * n;
    var arr = [];
    for (var i = 0; i < n; i++) {
        arr.push(base + (i < rem ? 1 : 0));
    }
    return arr;
}

function computeStandardUspTaps(stepCount) {
    var taps = [];
    var n = Math.max(1, parseInt(stepCount, 10) || 1);
    for (var i = 0; i < n; i++) {
        taps.push(i === 0 ? 10 : (i === 1 ? 500 : 1250));
    }
    return taps;
}

var USP_DEFAULT_STEP_COUNT = 10;

function isUspStandardProcedureMode(mode) {
    mode = String(mode || '').toUpperCase();
    return mode === 'USP1' || mode === 'USP2';
}

function applyStandardUspStepDefaults(target) {
    var n = USP_DEFAULT_STEP_COUNT;
    var taps = computeStandardUspTaps(n);
    if (target === 'quick' || target === 'both') {
        window._quickStepCount = n;
        window._quickStepTaps = taps.slice();
    }
    if (target === 'create' || target === 'both') {
        window._createRecipeStepCount = n;
        window._createRecipeStepTaps = taps.slice();
    }
}

function formatUspStandardTapsSummary(stepCount) {
    var n = Math.max(1, Math.min(10, parseInt(stepCount, 10) || 1));
    var taps = computeStandardUspTaps(n);
    var parts = [];
    for (var i = 0; i < n; i++) {
        parts.push('Step ' + (i + 1) + ': ' + taps[i]);
    }
    return parts.join('  |  ');
}

function computeCreateRecipeStepTapsForStepCount(stepCount) {
    var n = Math.max(1, Math.min(10, parseInt(stepCount, 10) || 10));
    if (getCreateUspMode() === 'CUSTOM') {
        if (window._createRecipeStepTaps && window._createRecipeStepTaps.length === n) {
            return window._createRecipeStepTaps.slice();
        }
        return null;
    }
    return computeStandardUspTaps(n);
}

function refreshActiveQaCount() {
    return apiRequest(API_BASE + '/api/data/members').then(function (data) {
        var list = (data && data.members) ? data.members : [];
        var n = 0;
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (String(m.role || '').toLowerCase() !== 'qa') continue;
            if (String(m.status || 'active').toLowerCase() === 'active') n++;
        }
        window._activeQaCount = n;
    }).catch(function () { window._activeQaCount = 0; });
}

function refreshActiveSupervisorCount() {
    return apiRequest(API_BASE + '/api/data/members').then(function (data) {
        var list = (data && data.members) ? data.members : [];
        var n = 0;
        for (var i = 0; i < list.length; i++) {
            var m = list[i];
            if (String(m.role || '').toLowerCase() !== 'supervisor') continue;
            if (String(m.status || 'active').toLowerCase() === 'active') n++;
        }
        window._activeSupervisorCount = n;
    }).catch(function () { window._activeSupervisorCount = 0; });
}

function userCanApproveByQaRule() {
    var role = (typeof getCurrentRole === 'function' ? getCurrentRole() : '') || '';
    role = String(role).toLowerCase();
    if (role === 'factory') return true;
    var u = window.currentUser;
    if (u && typeof userHasInternalKey === 'function') {
        return userHasInternalKey(u, 'recipe-approve');
    }
    return false;
}

/** Test reports: must have test-report-approve permission (Factory bypass in UI). */
function userCanApproveTestReport() {
    var role = (typeof getCurrentRole === 'function' ? getCurrentRole() : '') || '';
    role = String(role).toLowerCase();
    if (role === 'factory') return true;
    var u = window.currentUser;
    if (u && typeof userHasInternalKey === 'function') {
        return userHasInternalKey(u, 'test-report-approve');
    }
    return false;
}

function userCanApproveValidationReport() {
    var role = (typeof getCurrentRole === 'function' ? getCurrentRole() : '') || '';
    role = String(role).toLowerCase();
    if (role === 'factory') return true;
    var u = window.currentUser;
    if (u && typeof userHasInternalKey === 'function') {
        return userHasInternalKey(u, 'validation-report-approve');
    }
    return false;
}

function userCanApproveCalibrationReport() {
    var role = (typeof getCurrentRole === 'function' ? getCurrentRole() : '') || '';
    role = String(role).toLowerCase();
    if (role === 'factory') return true;
    var u = window.currentUser;
    if (u && typeof userHasInternalKey === 'function') {
        return userHasInternalKey(u, 'calibration-report-approve');
    }
    return false;
}

function getReportTypeNorm(preview) {
    return String((preview || window._lastReportPreview || {}).type || 'test').trim().toLowerCase();
}

function reportTypeRequiresApproval(reportTypeNorm) {
    var t = String(reportTypeNorm || '').trim().toLowerCase();
    return t === 'test' || t === 'validation' || t === 'calibration';
}

function userCanApproveReportForType(reportTypeNorm) {
    var t = String(reportTypeNorm || '').trim().toLowerCase();
    if (t === 'validation') return userCanApproveValidationReport();
    if (t === 'calibration') return userCanApproveCalibrationReport();
    return userCanApproveTestReport();
}

function getCurrentReportApprovalType() {
    return getReportTypeNorm(window._lastReportPreview);
}


window._reportApprovalGate = null;
var _reportApprovalPollTimerId = null;

function normalizeReportUsername(u) {
    return String(u || '').trim().toLowerCase();
}

function getCurrentReportUsername() {
    var u = window.currentUser;
    if (!u) return '';
    return normalizeReportUsername(u.username || u.name || '');
}

function getReportOperatedByUsername(preview) {
    var p = preview || window._lastReportPreview || {};
    var td = p.testData || {};
    return normalizeReportUsername(p.operatedByUsername || td.operatedByUsername || td.employeeId || p.employeeId);
}

function isReportPendingApproval(preview) {
    var st = String((preview || window._lastReportPreview || {}).reportApprovalStatus || '').trim().toLowerCase();
    return st === 'pending';
}

function isReportApproved(preview) {
    var st = String((preview || window._lastReportPreview || {}).reportApprovalStatus || '').trim().toLowerCase();
    return st === 'approved';
}

function isCurrentUserReportOperator(preview) {
    var op = getReportOperatedByUsername(preview);
    var cur = getCurrentReportUsername();
    return !!(op && cur && op === cur);
}

function isReportPreviewNavigationLocked(preview) {
    var p = preview || window._lastReportPreview || {};
    var reportTypeNorm = String(p.type || 'test').trim().toLowerCase();
    // Hardness includes calibration reports in the pending-approval navigation lock.
    if (reportTypeNorm !== 'test' && reportTypeNorm !== 'validation' && reportTypeNorm !== 'calibration') return false;
    return isReportPendingApproval(p);
}

/** @deprecated Use isReportPreviewNavigationLocked for navigation; kept for compatibility. */
function isReportPreviewLockedForCurrentUser(preview) {
    return isReportPreviewNavigationLocked(preview);
}

function hasActiveReportApprovalGate() {
    return !!(window._reportApprovalGate && window._reportApprovalGate.reportId != null);
}

function guardReportPreviewNavigation(targetPage) {
    if (!isReportPreviewNavigationLocked(window._lastReportPreview)) return false;
    if (targetPage === 'report-preview') return false;
    if (typeof showAppModal === 'function') {
        showAppModal(
            'This report is awaiting approval. Complete Pass/Fail and sign on this screen, or power off will save it as Aborted (power interruption).',
            'Report'
        );
    } else {
        alert('This report is awaiting approval. Complete Pass/Fail and sign before leaving.');
    }
    var active = document.querySelector('.page.active');
    if (!active || active.id !== 'page-report-preview') {
        var rid = (typeof currentReportId !== 'undefined' ? currentReportId : null) ||
            (window._reportApprovalGate && window._reportApprovalGate.reportId);
        if (rid && typeof openReportPreview === 'function') openReportPreview(rid, { bypassRbac: true });
    } else {
        if (typeof scrollReportApprovePanelIntoView === 'function') scrollReportApprovePanelIntoView();
        if (typeof scrollReportPendingBannerIntoView === 'function') scrollReportPendingBannerIntoView();
    }
    return true;
}

function setReportApprovalGate(reportId, operatedByUsername) {
    if (reportId == null) {
        window._reportApprovalGate = null;
        return;
    }
    window._reportApprovalGate = {
        reportId: reportId,
        operatedByUsername: normalizeReportUsername(operatedByUsername)
    };
}

function clearReportApprovalGate() {
    window._reportApprovalGate = null;
    stopReportApprovalPoll();
    if (typeof clearHardnessTestRunCheckpoint === 'function') clearHardnessTestRunCheckpoint();
    if (typeof clearSidebarInteractionLock === 'function') clearSidebarInteractionLock();
}

function setReportApprovalGateFromPreview(preview, reportId) {
    if (!isReportPendingApproval(preview)) {
        clearReportApprovalGate();
        return;
    }
    var reportTypeNorm = String((preview || {}).type || 'test').trim().toLowerCase();
    if (reportTypeNorm === 'test' || reportTypeNorm === 'validation' || reportTypeNorm === 'calibration') {
        setReportApprovalGate(reportId, getReportOperatedByUsername(preview));
    } else {
        clearReportApprovalGate();
    }
}

function clearSidebarInteractionLock() {
    var app = document.querySelector('.app-container');
    if (app) app.classList.remove('report-approval-locked');
    if (typeof resetReportPreviewNavigationUi === 'function') resetReportPreviewNavigationUi();
}

function reapplyReportPreviewLockIfNeeded() {
    if (!hasActiveReportApprovalGate()) {
        clearSidebarInteractionLock();
        return;
    }
    var rid = window._reportApprovalGate.reportId;
    if (rid == null) return;
    var base = (typeof API_BASE !== 'undefined' ? API_BASE : '');
    apiRequest(base + '/api/reports/' + rid + '/preview').then(function (data) {
        if (!data || !data.preview) return;
        window._lastReportPreview = data.preview;
        if (typeof currentReportId !== 'undefined') currentReportId = rid;
        setReportApprovalGateFromPreview(data.preview, rid);
        applyReportPreviewLockUi(data.preview);
        if (typeof startReportApprovalPollIfLocked === 'function') startReportApprovalPollIfLocked();
        var active = document.querySelector('.page.active');
        if (!active || active.id !== 'page-report-preview') {
            if (typeof openReportPreview === 'function') openReportPreview(rid, { setGate: true, bypassRbac: true });
        }
    }).catch(function () {});
}

function stopReportApprovalPoll() {
    if (_reportApprovalPollTimerId != null) {
        clearInterval(_reportApprovalPollTimerId);
        _reportApprovalPollTimerId = null;
    }
}

function startReportApprovalPollIfLocked() {
    stopReportApprovalPoll();
    var preview = window._lastReportPreview;
    if (!preview || !isReportPendingApproval(preview)) return;
    var rid = window.currentReportId;
    if (rid == null) return;
    _reportApprovalPollTimerId = setInterval(function () {
        if (!isReportPendingApproval(window._lastReportPreview)) {
            stopReportApprovalPoll();
            return;
        }
        apiRequest(API_BASE + '/api/reports/' + rid + '/preview').then(function (data) {
            if (!data || !data.preview) return;
            var st = String(data.preview.reportApprovalStatus || '').trim().toLowerCase();
            if (st === 'approved') {
                populateReportPreview(data.preview);
                clearReportApprovalGate();
                applyReportPreviewLockUi(data.preview);
                _saveReportPdfSilent(rid);
                showAppModal('Report has been approved. You may now print or leave this screen.', 'Report');
                if (typeof scrollReportPreviewActionsIntoView === 'function') {
                    setTimeout(scrollReportPreviewActionsIntoView, 300);
                }
            } else if (st === 'aborted' || (st && st !== 'pending')) {
                // Power-loss / server abort: unlock UI so Submit approval is not left stale.
                handleReportApprovalNoLongerPending(data.preview, rid, st);
            }
        }).catch(function () {});
    }, 5000);
}

/** Unlock approval UI when report is no longer pending (aborted, approved elsewhere, etc.). */
function handleReportApprovalNoLongerPending(preview, reportId, status) {
    stopReportApprovalPoll();
    window._lastReportPreview = preview || window._lastReportPreview;
    clearReportApprovalGate();
    if (typeof populateReportPreview === 'function' && preview) {
        populateReportPreview(preview);
    } else if (typeof applyReportPreviewLockUi === 'function') {
        applyReportPreviewLockUi(preview);
    }
    if (typeof updateReportApprovePanelForPreview === 'function') {
        updateReportApprovePanelForPreview(preview);
    }
    var st = String(status || (preview && preview.reportApprovalStatus) || '').trim().toLowerCase();
    var msg;
    if (st === 'aborted') {
        msg = 'This report was aborted (power interruption) and no longer needs approval. You can leave this screen.';
    } else if (st === 'approved') {
        msg = 'Report has been approved. You may now print or leave this screen.';
    } else {
        msg = 'This report is no longer pending approval.';
    }
    if (typeof showAppModal === 'function') {
        showAppModal(msg, 'Report');
    }
    if (st === 'approved' && reportId != null && typeof _saveReportPdfSilent === 'function') {
        _saveReportPdfSilent(reportId);
    }
}

function setReportApproveBiometricRetryVisible(visible) {
    var btn = document.getElementById('btn-report-approve-biometric-retry');
    if (btn) btn.style.display = visible ? '' : 'none';
}

function clearReportApproveVerifyError() {
    var errEl = document.getElementById('report-approve-verify-error');
    if (!errEl) return;
    errEl.textContent = '';
    errEl.style.display = 'none';
    setReportApproveBiometricRetryVisible(false);
}

function resetReportApproveForm() {
    var ta = document.getElementById('report-approve-remarks-input');
    if (ta) ta.value = '';
    var userEl = document.getElementById('report-approve-verifier-username');
    var passEl = document.getElementById('report-approve-verifier-password');
    if (userEl) userEl.value = '';
    if (passEl) passEl.value = '';
    var passRadio = document.querySelector('input[name="report-approve-pass-fail"][value="PASS"]');
    if (passRadio) passRadio.checked = true;
    clearReportApproveVerifyError();
}

function setReportApproveVerifyError(message, options) {
    options = options || {};
    var errEl = document.getElementById('report-approve-verify-error');
    if (!errEl) return;
    errEl.textContent = message ? String(message) : '';
    errEl.style.display = message ? 'block' : 'none';
    if (options.showBiometricRetry) {
        setReportApproveBiometricRetryVisible(true);
    }
}

function wireReportApproveVerifierListeners() {
    if (window._reportApproveVerifierListenersWired) return;
    window._reportApproveVerifierListenersWired = true;
    var userEl = document.getElementById('report-approve-verifier-username');
    if (!userEl) return;
    userEl.addEventListener('input', function () {
        setReportApprovePanelInteractionState(window._lastReportPreview);
    });
}

function setReportApprovePanelInteractionState(preview) {
    var apprPanel = document.getElementById('report-approve-panel');
    if (!apprPanel) return;
    wireReportApproveVerifierListeners();
    var pending = isReportPendingApproval(preview);
    var isOp = isCurrentUserReportOperator(preview);
    var isFactory = typeof isFactorySessionUser === 'function' && isFactorySessionUser();
    var fieldsEnabled = !!pending;
    var usernameEl = document.getElementById('report-approve-verifier-username');
    var entered = usernameEl && typeof normalizeReportUsername === 'function'
        ? normalizeReportUsername(usernameEl.value)
        : (usernameEl ? String(usernameEl.value || '').trim().toLowerCase() : '');
    var opUser = typeof getReportOperatedByUsername === 'function'
        ? getReportOperatedByUsername(preview) : '';
    var canCredentialSubmit = fieldsEnabled && (!isOp || isFactory || (entered && opUser && entered !== opUser));
    apprPanel.classList.toggle('is-operator-view', !!(pending && isOp && !isFactory));
    var hintEl = document.getElementById('report-approve-operator-hint');
    if (hintEl) hintEl.style.display = (pending && isOp && !isFactory) ? 'block' : 'none';
    ['#report-approve-remarks-input', 'input[name="report-approve-pass-fail"]',
        '#report-approve-verifier-username', '#report-approve-verifier-password'].forEach(function (sel) {
        apprPanel.querySelectorAll(sel).forEach(function (el) { el.disabled = !fieldsEnabled; });
    });
    var submitBtn = document.getElementById('btn-report-approve-submit');
    if (submitBtn) submitBtn.disabled = !canCredentialSubmit;
    var bioBtn = document.getElementById('btn-report-approve-biometric');
    if (bioBtn) bioBtn.disabled = !fieldsEnabled;
    apprPanel.querySelectorAll('.report-approve-card-wrap').forEach(function (wrap) {
        if (fieldsEnabled) wrap.classList.remove('is-disabled');
        else wrap.classList.add('is-disabled');
    });
}

function updateReportApprovePanelForPreview(preview) {
    var apprPanel = document.getElementById('report-approve-panel');
    if (!apprPanel) return;
    var pending = isReportPendingApproval(preview);
    var rid = window.currentReportId;
    if (pending && rid != null && rid !== window._reportApproveFormReportId) {
        resetReportApproveForm();
        window._reportApproveFormReportId = rid;
    }
    if (!pending) {
        window._reportApproveFormReportId = null;
    }
    var reportTypeNorm = getReportTypeNorm(preview);
    var titleEl = document.getElementById('report-approve-panel-title') || apprPanel.querySelector('h3');
    if (titleEl) {
        if (reportTypeNorm === 'validation') {
            titleEl.textContent = 'Validation report approval';
        } else if (reportTypeNorm === 'calibration') {
            titleEl.textContent = 'Calibration report approval';
        } else {
            titleEl.textContent = 'Test report approval';
        }
    }
    apprPanel.style.display = pending ? 'block' : 'none';
    if (!pending) clearReportApproveVerifyError();
    setReportApprovePanelInteractionState(preview);
    var bioBtn = document.getElementById('btn-report-approve-biometric');
    var bioWrap = document.getElementById('report-approve-biometric-wrap');
    var showBio = typeof biometricEnabledSetting === 'undefined' || biometricEnabledSetting;
    if (bioBtn) bioBtn.style.display = showBio ? '' : 'none';
    if (bioWrap) bioWrap.style.display = showBio ? '' : 'none';
}

function scrollReportApprovePanelIntoView() {
    var panel = document.getElementById('report-approve-panel');
    if (!panel || panel.style.display === 'none') return;
    try {
        panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch (e) {
        panel.scrollIntoView(true);
    }
}

function scrollReportPendingBannerIntoView() {
    var banner = document.getElementById('report-pending-lock-banner');
    if (!banner || banner.style.display === 'none') return;
    try {
        banner.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
        banner.scrollIntoView(true);
    }
}

function resetReportPreviewNavigationUi() {
    var app = document.querySelector('.app-container');
    if (app) app.classList.remove('report-approval-locked');
    document.querySelectorAll('.nav-item[data-page]').forEach(function (btn) {
        btn.style.pointerEvents = '';
        btn.style.opacity = '';
        btn.removeAttribute('aria-disabled');
    });
    var profileEl = document.querySelector('.sidebar .user-profile');
    var logoutBtn = document.querySelector('.sidebar .logout-btn');
    [profileEl, logoutBtn].forEach(function (el) {
        if (!el) return;
        el.style.pointerEvents = '';
        el.style.opacity = '';
        el.removeAttribute('aria-disabled');
    });
    var closeBtn = document.querySelector('#report-preview-actions .btn-close');
    if (closeBtn) closeBtn.style.display = '';
    var backBtn = document.getElementById('header-back-btn');
    if (backBtn) backBtn.style.visibility = '';
}

function applyReportPreviewLockUi(preview) {
    preview = preview || window._lastReportPreview;
    var locked = isReportPreviewNavigationLocked(preview);
    var app = document.querySelector('.app-container');
    if (app) app.classList.toggle('report-approval-locked', !!locked);
    var banner = document.getElementById('report-pending-lock-banner');
    if (banner) banner.style.display = locked ? 'block' : 'none';
    var closeBtn = document.querySelector('#report-preview-actions .btn-close');
    if (closeBtn) closeBtn.style.display = locked ? 'none' : '';
    var backBtn = document.getElementById('header-back-btn');
    if (backBtn) backBtn.style.visibility = locked ? 'hidden' : '';
    var logoEl = document.getElementById('header-logo');
    if (logoEl) {
        logoEl.style.pointerEvents = locked ? 'none' : '';
        logoEl.style.opacity = locked ? '0.45' : '';
    }
    document.querySelectorAll('.nav-item[data-page]').forEach(function (btn) {
        btn.style.pointerEvents = locked ? 'none' : '';
        btn.style.opacity = locked ? '0.45' : '';
        if (locked) btn.setAttribute('aria-disabled', 'true');
        else btn.removeAttribute('aria-disabled');
    });
    var profileEl = document.querySelector('.sidebar .user-profile');
    var logoutBtn = document.querySelector('.sidebar .logout-btn');
    [profileEl, logoutBtn].forEach(function (el) {
        if (!el) return;
        el.style.pointerEvents = locked ? 'none' : '';
        el.style.opacity = locked ? '0.45' : '';
        if (locked) el.setAttribute('aria-disabled', 'true');
        else el.removeAttribute('aria-disabled');
    });
    document.querySelectorAll('.test-card').forEach(function (el) {
        el.style.pointerEvents = locked ? 'none' : '';
        el.style.opacity = locked ? '0.45' : '';
    });
    document.querySelectorAll('#page-report-preview .btn-close, #page-report-preview .btn-secondary').forEach(function (el) {
        el.style.pointerEvents = locked ? 'none' : '';
        el.style.opacity = locked ? '0.45' : '';
        if (locked) el.setAttribute('aria-disabled', 'true');
        else el.removeAttribute('aria-disabled');
    });
    if (typeof updateReportApprovePanelForPreview === 'function') updateReportApprovePanelForPreview(preview);
    if (typeof updateReportPreviewPrintExportButtons === 'function') updateReportPreviewPrintExportButtons(preview);
}

function stampOperatorOnTestReportPayload(payload) {
    if (!payload) return payload;
    var u = window.currentUser || {};
    var un = normalizeReportUsername(u.username || u.name || '');
    var name = String(u.name || u.username || '—').trim();
    var emp = String(u.username || un || '').trim();
    payload.operatedByUsername = un;
    payload.operatorName = name;
    payload.employeeId = emp;
    payload.testData = payload.testData || {};
    payload.testData.operatedByUsername = un;
    payload.testData.operatorName = name;
    payload.testData.employeeId = emp;
    return payload;
}

function abortPendingReportOnLogout() {
    var gate = window._reportApprovalGate;
    if (!gate || gate.reportId == null) return Promise.resolve();
    if (typeof isFactorySessionUser === 'function' && isFactorySessionUser()) {
        clearReportApprovalGate();
        return Promise.resolve();
    }
    return apiRequest(API_BASE + '/api/data/reports/' + gate.reportId + '/abort', { method: 'POST' }).then(function () {
        clearReportApprovalGate();
    }).catch(function () {
        clearReportApprovalGate();
    });
}

function reportActionsBlockedForPreview(preview) {
    var p = preview || window._lastReportPreview || {};
    var reportTypeNorm = getReportTypeNorm(p);
    var approvalSt = String(p.reportApprovalStatus || '').trim().toLowerCase();
    return approvalSt === 'pending' && reportTypeRequiresApproval(reportTypeNorm);
}

function finishTestRunReportSaved(reportId) {
    if (typeof resetQuickTestFormAfterRunIfPending === 'function') {
        resetQuickTestFormAfterRunIfPending();
    }
    if (typeof unlockNavigation === 'function') {
        unlockNavigation();
    }
    if (typeof clearSidebarInteractionLock === 'function') {
        clearSidebarInteractionLock();
    }
    if (reportId) {
        if (typeof openReportPreview === 'function') {
            openReportPreview(reportId, { setGate: true });
        } else {
            goToPage('reports');
        }
    } else {
        goToPage('reports');
        if (typeof loadReports === 'function') loadReports();
    }
}

/** Recipe approval modal copy; verifier must have recipe-approve permission card. */
function _approvalVerifyModalOptionsForRecipe() {
    return {
        purpose: 'recipe',
        titleText: 'Recipe approval required',
        subtitleText: 'Enter credentials for a user with Recipe approval permission.',
        usernameLabelText: 'Username',
        usernamePlaceholder: 'Approver username',
        emptyCredentialsMessage: 'Enter username and password.'
    };
}

/** Test report approval: verifier must have test-report-approve permission card. */
function _approvalVerifyModalOptionsForReport() {
    return {
        purpose: 'report',
        titleText: 'Test report approval',
        subtitleText: 'Enter credentials for a user with Test report approval permission.',
        usernameLabelText: 'Username',
        usernamePlaceholder: 'Approver username',
        emptyCredentialsMessage: 'Enter username and password.'
    };
}

/** Pre-calibration authorization: verifier must have calibration-report-approve permission card. */
function _approvalVerifyModalOptionsForCalibrationStart() {
    return {
        purpose: 'calibration',
        titleText: 'Calibration authorization required',
        subtitleText: 'Enter credentials for a user with Calibration report approval permission.',
        usernameLabelText: 'Verifier username',
        usernamePlaceholder: 'Verifier username',
        emptyCredentialsMessage: 'Enter verifier username and password.'
    };
}

function getEffectiveRecipeApprovalStatus(recipe) {
    if (!recipe) return 'pending';
    var st = recipe.recipeApprovalStatus;
    if (st == null || st === '') return 'pending';
    return String(st).trim().toLowerCase();
}

function normalizeBiometricEnabled(value) {
    if (typeof value === 'string') {
        var v = value.trim().toLowerCase();
        if (v === 'disabled' || v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
        if (v === 'enabled' || v === 'true' || v === '1' || v === 'on' || v === 'yes') return true;
    }
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'boolean') return value;
    return true;
}

function applyBiometricSetting(enabled) {
    biometricEnabledSetting = normalizeBiometricEnabled(enabled);
    var loginDivider = document.getElementById('login-divider');
    if (loginDivider) {
        loginDivider.style.display = biometricEnabledSetting ? '' : 'none';
    }
    var loginBtn = document.getElementById('login-biometric-btn');
    if (loginBtn) {
        loginBtn.style.display = biometricEnabledSetting ? '' : 'none';
        loginBtn.disabled = !biometricEnabledSetting;
    }
    var enrollBtn = document.getElementById('enroll-biometric-btn');
    if (enrollBtn) {
        enrollBtn.style.display = biometricEnabledSetting ? '' : 'none';
        enrollBtn.disabled = !biometricEnabledSetting;
    }
}
function loginBiometric() {
    if (!biometricEnabledSetting) {
        showAppModal('Biometric login is disabled by Factory Settings.', 'Biometric Disabled');
        return;
    }
    if (window._loginBiometricInFlight) return;
    window._loginBiometricInFlight = true;
    var abortCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    window._loginBiometricAbort = function () {
        if (abortCtrl) abortCtrl.abort();
    };
    showBiometricProgressOverlay(
        'Biometric Login',
        'Activating fingerprint scanner. Place your finger on the sensor.'
    );
    var fetchOpts = {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
    };
    if (abortCtrl) fetchOpts.signal = abortCtrl.signal;
    fetch((API_BASE || '') + '/api/data/auth/login-biometric', fetchOpts).then(function (res) {
        var ct = res.headers.get('content-type') || '';
        var isJson = ct.indexOf('json') !== -1;
        if (isJson) {
            return res.json().then(function (body) {
                return { ok: res.ok, status: res.status, body: body };
            });
        }
        return res.text().then(function (text) {
            return { ok: res.ok, status: res.status, body: { error: text } };
        });
    }).then(function (result) {
        var data = result.body || {};
        if (result.ok && data.success && data.user) {
            // Hardness login path: setLoggedInUser (TapDensity used updateProfileFromCurrentUser, which is not defined here).
            if (typeof setLoggedInUser === 'function') {
                setLoggedInUser(data.user);
            } else {
                window.currentUser = data.user;
                try { localStorage.setItem('currentUser', JSON.stringify(data.user)); } catch (e) {}
                if (typeof currentUser !== 'undefined') currentUser = data.user;
                if (typeof updateUIForUser === 'function') updateUIForUser();
                if (typeof showAppContainer === 'function') showAppContainer();
                if (typeof goToPage === 'function') goToPage('home');
            }
            if (typeof refreshActiveQaCount === 'function') refreshActiveQaCount();
            return;
        }
        if (result.status === 403 && data && data.passwordChangeRequired && data.username) {
            if (typeof showMandatoryPasswordResetScreen === 'function') showMandatoryPasswordResetScreen(data.username);
            return;
        }
        var msg = (data && data.error) ? String(data.error) : 'Biometric login failed.';
        showAppModal(msg, 'Biometric Login');
    }).catch(function (err) {
        if (err && err.name === 'AbortError') return;
        showAppModal('Biometric login failed: ' + (err && err.message ? err.message : 'Network error'), 'Biometric Login');
    }).finally(function () {
        hideBiometricProgressOverlay();
        window._loginBiometricInFlight = false;
        window._loginBiometricAbort = null;
    });
}

var _biometricEnrollUsername = null;
var _biometricEnrollCancelled = false;

function _getBiometricEnrollUsername() {
    var bioUserEl = document.getElementById('member-biometric-username');
    var formUserEl = document.getElementById('add-userid');
    if (bioUserEl && bioUserEl.textContent && bioUserEl.textContent.trim() !== '--') {
        return bioUserEl.textContent.trim();
    }
    if (formUserEl && formUserEl.value) return formUserEl.value.trim();
    return '';
}

function _setBioEnrollStepActive(step) {
    var steps = document.querySelectorAll('#bio-enroll-steps .bio-enroll-step');
    steps.forEach(function (el) {
        var n = parseInt(el.getAttribute('data-step'), 10);
        el.classList.remove('active', 'done');
        if (n < step) el.classList.add('done');
        else if (n === step) el.classList.add('active');
    });
}

function _setBioFingerAnimState(state) {
    var stage = document.getElementById('bio-finger-stage');
    if (!stage) return;
    stage.classList.remove('state-place', 'state-scan', 'state-remove', 'state-done');
    if (state) stage.classList.add('state-' + state);
}

function setBiometricOverlayRetryVisible(visible) {
    var retryBtn = document.getElementById('biometric-progress-retry-btn');
    if (retryBtn) retryBtn.style.display = visible ? '' : 'none';
}

function showBiometricEnrollUi(opts) {
    opts = opts || {};
    var overlay = document.getElementById('biometric-progress-overlay');
    var titleEl = document.getElementById('biometric-progress-title');
    var msgEl = document.getElementById('biometric-progress-message');
    var hintEl = document.getElementById('biometric-progress-hint');
    var spinner = document.getElementById('biometric-progress-spinner');
    var stepsWrap = document.getElementById('bio-enroll-steps');
    var fingerStage = document.getElementById('bio-finger-stage');
    var enrollMode = !!opts.enrollMode;
    var verifyMode = !!opts.verifyMode;
    if (stepsWrap) stepsWrap.style.display = enrollMode ? 'flex' : 'none';
    if (fingerStage) fingerStage.style.display = (enrollMode || verifyMode) ? 'block' : 'none';
    if (titleEl && opts.title) titleEl.textContent = opts.title;
    if (msgEl && opts.message !== undefined) msgEl.textContent = opts.message || '';
    if (hintEl) hintEl.textContent = opts.hint || '';
    if (spinner) spinner.style.display = opts.scanning ? 'block' : 'none';
    if (opts.step) _setBioEnrollStepActive(opts.step);
    if (opts.fingerState) _setBioFingerAnimState(opts.fingerState);
    else if (verifyMode && opts.scanning) _setBioFingerAnimState('scan');
    else if (verifyMode && !opts.scanning) _setBioFingerAnimState('place');
    if (overlay) overlay.style.display = 'flex';
}

function showBiometricProgressOverlay(title, message) {
    setBiometricOverlayRetryVisible(false);
    showBiometricEnrollUi({
        title: title,
        message: message,
        enrollMode: false,
        verifyMode: true,
        scanning: true
    });
}

function showBiometricVerifyFailedOverlay(message, hint) {
    showBiometricEnrollUi({
        title: 'Fingerprint not recognized',
        message: message || 'Fingerprint verification failed.',
        hint: hint || 'Place your finger on the scanner and tap Try again.',
        enrollMode: false,
        verifyMode: true,
        scanning: false,
        fingerState: 'place'
    });
    setBiometricOverlayRetryVisible(true);
}

function hideBiometricProgressOverlay() {
    var overlay = document.getElementById('biometric-progress-overlay');
    if (overlay) overlay.style.display = 'none';
    _setBioFingerAnimState('');
    _biometricEnrollUsername = null;
    _biometricEnrollCancelled = false;
    setBiometricOverlayRetryVisible(false);
    window._biometricVerifyRetryFn = null;
    window._biometricVerifyCancelResolve = null;
    window._biometricVerifyActive = false;
}

function retryBiometricProgress() {
    setBiometricOverlayRetryVisible(false);
    if (typeof window._biometricVerifyRetryFn === 'function') {
        window._biometricVerifyRetryFn();
    }
}

function runBiometricVerifyWithRetry(opts) {
    opts = opts || {};
    var purpose = opts.purpose || 'report';
    if (window._biometricVerifyActive) {
        return Promise.resolve({ ok: false, error: 'cancelled', message: '' });
    }
    return new Promise(function (resolve) {
        if (!biometricEnabledSetting) {
            resolve({ ok: false, error: 'Biometric verification is disabled by Factory Settings.' });
            return;
        }
        window._biometricVerifyActive = true;
        var cancelled = false;
        var lastError = 'Fingerprint verification failed.';

        function finish(result) {
            window._biometricVerifyActive = false;
            resolve(result);
        }

        function finishCancel() {
            cancelled = true;
            hideBiometricProgressOverlay();
            finish({ ok: false, error: 'cancelled', message: lastError });
        }

        function attempt() {
            if (cancelled) return;
            showBiometricProgressOverlay(
                opts.title || 'Verify Fingerprint',
                opts.message || 'Place your finger on the scanner.'
            );
            apiRequest(API_BASE + '/api/data/auth/approval-verify', {
                method: 'POST',
                body: { method: 'biometric', purpose: purpose, reportType: opts.reportType || '' }
            }).then(function (data) {
                if (cancelled) return;
                if (data && data.ok && data.token) {
                    hideBiometricProgressOverlay();
                    finish({ ok: true, token: String(data.token) });
                    return;
                }
                lastError = (data && data.error) ? String(data.error) : 'Fingerprint verification failed.';
                showBiometricVerifyFailedOverlay(lastError, opts.failureHint);
                window._biometricVerifyRetryFn = attempt;
            }).catch(function (err) {
                if (cancelled) return;
                lastError = 'Fingerprint verification failed: ' + (err && err.message ? err.message : 'Error');
                showBiometricVerifyFailedOverlay(lastError, opts.failureHint);
                window._biometricVerifyRetryFn = attempt;
            });
        }

        window._biometricVerifyCancelResolve = finishCancel;
        window._biometricVerifyRetryFn = attempt;
        attempt();
    });
}

function _cancelBiometricEnrollSession() {
    var username = _biometricEnrollUsername;
    if (!username) return Promise.resolve();
    return apiRequest(API_BASE + '/api/biometric/enroll/cancel', {
        method: 'POST',
        body: { username: username }
    }).catch(function () {});
}

function cancelBiometricProgress() {
    _biometricEnrollCancelled = true;
    if (typeof window._loginBiometricAbort === 'function') {
        window._loginBiometricAbort();
        hideBiometricProgressOverlay();
        window._loginBiometricInFlight = false;
        window._loginBiometricAbort = null;
        return;
    }
    if (typeof window._biometricVerifyCancelResolve === 'function') {
        var cancelVerify = window._biometricVerifyCancelResolve;
        window._biometricVerifyCancelResolve = null;
        cancelVerify();
        return;
    }
    _cancelBiometricEnrollSession().finally(function () {
        hideBiometricProgressOverlay();
    });
}

function _delayMs(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function _biometricEnrollCaptureStep(username, step) {
    return apiRequest(API_BASE + '/api/biometric/enroll/capture', {
        method: 'POST',
        body: { username: username, step: step }
    });
}

function enrollMemberBiometric() {
    if (!biometricEnabledSetting) {
        showAppModal('Biometric enrollment is disabled by Factory Settings.', 'Biometric Disabled');
        return;
    }
    var username = _getBiometricEnrollUsername();
    if (!username) {
        showAppModal('No member selected for fingerprint enrollment. Save the member first.', 'Register Fingerprint');
        return;
    }
    _biometricEnrollUsername = username;
    _biometricEnrollCancelled = false;

    showBiometricEnrollUi({
        enrollMode: true,
        title: 'Register Fingerprint — Scan 1 of 2',
        message: 'Place your finger flat on the scanner.',
        hint: 'Hold still until the first scan is captured.',
        step: 1,
        fingerState: 'scan',
        scanning: true
    });

    _biometricEnrollCaptureStep(username, 1).then(function (data) {
        if (_biometricEnrollCancelled) return;
        if (!data || !data.ok) {
            hideBiometricProgressOverlay();
            showAppModal((data && data.error) || 'First scan failed.', 'Register Fingerprint');
            return;
        }
        showBiometricEnrollUi({
            enrollMode: true,
            title: 'Remove your finger',
            message: 'Lift your finger off the scanner.',
            hint: 'Wait a moment, then you will scan the same finger again.',
            step: 1,
            fingerState: 'remove',
            scanning: false
        });
        return _delayMs(1800);
    }).then(function () {
        if (_biometricEnrollCancelled) return;
        showBiometricEnrollUi({
            enrollMode: true,
            title: 'Register Fingerprint — Scan 2 of 2',
            message: 'Place the same finger on the scanner again.',
            hint: 'Use the same finger as the first scan. Hold still until complete.',
            step: 2,
            fingerState: 'scan',
            scanning: true
        });
        return _biometricEnrollCaptureStep(username, 2);
    }).then(function (data) {
        if (_biometricEnrollCancelled) return;
        if (!data) return;
        if (!data.ok) {
            hideBiometricProgressOverlay();
            showAppModal((data && data.error) || 'Second scan failed.', 'Register Fingerprint');
            return;
        }
        showBiometricEnrollUi({
            enrollMode: true,
            title: 'Saving fingerprint',
            message: 'Matching scans and saving template…',
            hint: '',
            step: 2,
            fingerState: 'scan',
            scanning: true
        });
        return _delayMs(400).then(function () { return data; });
    }).then(function (data) {
        if (_biometricEnrollCancelled || !data || !data.ok) return;
        showBiometricEnrollUi({
            enrollMode: true,
            title: 'Fingerprint registered',
            message: 'Both scans captured successfully.',
            hint: '',
            step: 2,
            fingerState: 'done',
            scanning: false
        });
        document.querySelectorAll('#bio-enroll-steps .bio-enroll-step').forEach(function (el) {
            el.classList.add('done');
            el.classList.remove('active');
        });
        return _delayMs(900);
    }).then(function () {
        if (_biometricEnrollCancelled) return;
        hideBiometricProgressOverlay();
        _addMemberLastSavedId = null;
        showAppModal('Fingerprint enrolled successfully.', 'Register Fingerprint');
        goToPage('user-profile');
    }).catch(function (err) {
        if (_biometricEnrollCancelled) return;
        hideBiometricProgressOverlay();
        showAppModal('Fingerprint enrollment failed: ' + (err && err.message ? err.message : 'Network error'), 'Register Fingerprint');
    });
}

function verifyReportApproverInline(method) {
    method = method === 'biometric' ? 'biometric' : 'credentials';
    clearReportApproveVerifyError();
    var reportType = getCurrentReportApprovalType();
    if (method === 'biometric') {
        return runBiometricVerifyWithRetry({
            purpose: 'report',
            reportType: reportType,
            title: 'Verify Fingerprint',
            message: 'Place a Reviewer or Admin fingerprint on the scanner to approve this report.',
            failureHint: 'Place your finger on the scanner and tap Try again.'
        }).then(function (result) {
            if (!result || !result.ok) {
                if (result && result.error !== 'cancelled') {
                    setReportApproveVerifyError(
                        result.message || result.error || 'Fingerprint verification failed.',
                        { showBiometricRetry: true }
                    );
                } else if (result && result.error === 'cancelled' && result.message) {
                    setReportApproveVerifyError(result.message, { showBiometricRetry: true });
                }
                return null;
            }
            setReportApproveBiometricRetryVisible(false);
            return result.token;
        });
    }
    var usernameEl = document.getElementById('report-approve-verifier-username');
    var passwordEl = document.getElementById('report-approve-verifier-password');
    var username = usernameEl ? String(usernameEl.value || '').trim() : '';
    var password = passwordEl ? String(passwordEl.value || '') : '';
    if (!username || !password) {
        setReportApproveVerifyError('Enter Reviewer or Admin User ID and password.');
        return Promise.resolve(null);
    }
    if (typeof isCurrentUserReportOperator === 'function' && isCurrentUserReportOperator(window._lastReportPreview)) {
        var opUser = typeof getReportOperatedByUsername === 'function'
            ? getReportOperatedByUsername(window._lastReportPreview) : '';
        var enteredNorm = typeof normalizeReportUsername === 'function'
            ? normalizeReportUsername(username) : String(username).trim().toLowerCase();
        if (opUser && enteredNorm && enteredNorm === opUser) {
            setReportApproveVerifyError('You cannot approve your own report. A Reviewer or Admin must sign below.');
            return Promise.resolve(null);
        }
    }
    return apiRequest(API_BASE + '/api/data/auth/approval-verify', {
        method: 'POST',
        body: { method: 'credentials', username: username, password: password, purpose: 'report', reportType: reportType }
    }).then(function (data) {
        if (!data || !data.ok || !data.token) {
            setReportApproveVerifyError((data && data.error) ? String(data.error) : 'Verification failed.');
            return null;
        }
        return String(data.token);
    }).catch(function (err) {
        setReportApproveVerifyError('Verification failed: ' + (err && err.message ? err.message : 'Error'));
        return null;
    });
}

function approveReportWithVerifier(reportId, passFail, remarks, verifyMethod) {
    verifyMethod = verifyMethod === 'biometric' ? 'biometric' : 'credentials';
    var role = (typeof getCurrentRole === 'function' ? String(getCurrentRole() || '').toLowerCase() : '');

    function unlockIfNoLongerPending(msg) {
        var lower = String(msg || '').toLowerCase();
        if (lower.indexOf('aborted') === -1 && lower.indexOf('invalid approval state') === -1) {
            setReportApproveVerifyError(msg);
            return Promise.resolve(null);
        }
        return apiRequest(API_BASE + '/api/reports/' + reportId + '/preview').then(function (prevData) {
            var preview = prevData && prevData.preview;
            if (typeof handleReportApprovalNoLongerPending === 'function') {
                handleReportApprovalNoLongerPending(
                    preview,
                    reportId,
                    (preview && preview.reportApprovalStatus) || 'aborted'
                );
            } else {
                setReportApproveVerifyError(msg);
            }
            return null;
        }).catch(function () {
            setReportApproveVerifyError(msg);
            if (typeof clearReportApprovalGate === 'function') clearReportApprovalGate();
            return null;
        });
    }

    function postReportApprove(extraHeaders) {
        return apiRequest(API_BASE + '/api/data/reports/' + reportId + '/approve', {
            method: 'POST',
            headers: extraHeaders || {},
            body: { passFail: passFail, remarks: remarks }
        }).then(function (data) {
            if (data && data.ok) return data;
            var msg = (data && data.error) ? String(data.error) : 'Approval failed.';
            return unlockIfNoLongerPending(msg);
        }).catch(function (err) {
            var msg = (err && err.message) ? String(err.message) : 'Approval failed.';
            return unlockIfNoLongerPending(msg);
        });
    }

    if (role === 'factory') {
        return postReportApprove({}).then(function (data) { return data && data.ok; });
    }

    return verifyReportApproverInline(verifyMethod).then(function (token) {
        if (!token) return null;
        return postReportApprove({ 'X-Approval-Verify-Token': token }).then(function (data) {
            return data && data.ok;
        });
    });
}

function submitReportApprove() {
    var id = window.currentReportId;
    if (id == null) return;
    var pfEl = document.querySelector('input[name="report-approve-pass-fail"]:checked');
    var pf = pfEl ? String(pfEl.value).toUpperCase() : '';
    if (pf !== 'PASS' && pf !== 'FAIL') {
        setReportApproveVerifyError('Select Pass or Fail.');
        return;
    }
    var ta = document.getElementById('report-approve-remarks-input');
    var remarks = ta ? ta.value.trim() : '';
    clearReportApproveVerifyError();
    approveReportWithVerifier(id, pf, remarks, 'credentials').then(function (ok) {
        if (ok === true) {
            resetReportApproveForm();
            window._reportApproveFormReportId = null;
            clearReportApprovalGate();
            showAppModal('Report approved.', 'Report');
            if (typeof openReportPreview === 'function') {
                openReportPreview(id);
            }
            setTimeout(function () {
                if (typeof _saveReportPdfSilent === 'function') _saveReportPdfSilent(id);
                if (typeof scrollReportPreviewActionsIntoView === 'function') {
                    scrollReportPreviewActionsIntoView();
                }
            }, 600);
        }
    }).catch(function (err) {
        setReportApproveVerifyError('Approval failed: ' + (err && err.message ? err.message : 'Error'));
    });
}

function submitReportApproveBiometric() {
    var id = window.currentReportId;
    if (id == null) return;
    var pfEl = document.querySelector('input[name="report-approve-pass-fail"]:checked');
    var pf = pfEl ? String(pfEl.value).toUpperCase() : '';
    if (pf !== 'PASS' && pf !== 'FAIL') {
        setReportApproveVerifyError('Select Pass or Fail.');
        return;
    }
    var ta = document.getElementById('report-approve-remarks-input');
    var remarks = ta ? ta.value.trim() : '';
    clearReportApproveVerifyError();
    setReportApproveBiometricRetryVisible(false);
    approveReportWithVerifier(id, pf, remarks, 'biometric').then(function (ok) {
        if (ok === true) {
            resetReportApproveForm();
            window._reportApproveFormReportId = null;
            clearReportApprovalGate();
            showAppModal('Report approved.', 'Report');
            if (typeof openReportPreview === 'function') {
                openReportPreview(id);
            }
            setTimeout(function () {
                if (typeof _saveReportPdfSilent === 'function') _saveReportPdfSilent(id);
                if (typeof scrollReportPreviewActionsIntoView === 'function') {
                    scrollReportPreviewActionsIntoView();
                }
            }, 600);
        }
    }).catch(function (err) {
        setReportApproveVerifyError('Approval failed: ' + (err && err.message ? err.message : 'Error'));
    });
}

function loadBiometricSetting() {
    apiRequest(API_BASE + '/api/data/factory-settings').then(function (result) {
        var settings = (result && result.settings) ? result.settings : (result || {});
        applyBiometricSetting(settings.biometricEnabled);
    }).catch(function () {
        try {
            var stored = localStorage.getItem('factorySettings');
            var settings = stored ? JSON.parse(stored) : {};
            applyBiometricSetting(settings.biometricEnabled);
        } catch (e) {
            applyBiometricSetting(true);
        }
    });
}

function _populateMemberBiometricSummary(member) {
    if (!member) return;
    var nameEl = document.getElementById('member-biometric-name');
    var userEl = document.getElementById('member-biometric-username');
    var roleEl = document.getElementById('member-biometric-role');
    if (nameEl) nameEl.textContent = member.name || '--';
    if (userEl) userEl.textContent = member.username || '--';
    if (roleEl) {
        var roleLabel = (typeof displayRoleLabel === 'function')
            ? displayRoleLabel(member.role)
            : (member.role || '--');
        roleEl.textContent = roleLabel;
    }
}

function skipMemberBiometricEnrollment() {
    window._addMemberLastSavedId = null;
    goToPage('user-profile');
}

function backToMemberAfterBiometric() {
    window._addMemberLastSavedId = null;
    goToPage('user-profile');
}
