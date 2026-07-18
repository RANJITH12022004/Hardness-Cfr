/**
 * profile_compliance.js - RBAC profiles, manage profiles, audit trails (from DUMMY)
 */
var API_BASE = (typeof API_BASE !== 'undefined' && API_BASE) ? API_BASE : '';

function _activeAddMemberPage() {
    var pages = document.querySelectorAll('#page-add-member');
    for (var i = 0; i < pages.length; i++) {
        if (pages[i].classList.contains('active')) return pages[i];
    }
    return pages.length ? pages[0] : null;
}

function _addMemberEl(id) {
    var page = _activeAddMemberPage();
    if (page) {
        var scoped = page.querySelector('#' + id);
        if (scoped) return scoped;
    }
    return document.getElementById(id);
}
var membersCache = membersCache || [];
var _addMemberFeatureOverrides = _addMemberFeatureOverrides || { allow: [], deny: [] };
var _editingMemberPermissionsActive = false;
var _addMemberLastSavedId = _addMemberLastSavedId || null;
var editingMemberId = editingMemberId || null;
var _auditLoadMessageTimers = _auditLoadMessageTimers || [];

function showModalCompat(msg, title) {
  if (typeof showAppModal === 'function') return showAppModal(msg, title);
  if (typeof showModal === 'function') {
    if (showModal.length >= 3) showModal(title || 'Notice', msg, null, false);
    else showModal(msg);
    return;
  }
  alert(msg);
}
function showConfirmModalCompat(msg, title) {
  if (typeof showConfirmModal === 'function') return showConfirmModal(msg, title);
  return Promise.resolve(confirm((title ? title + ': ' : '') + msg));
}
function formatAuditDetailsText(details) {
  return (details == null || details === '') ? '' : String(details);
}
function displayRoleLabel(role) {
    var r = String(role || '').trim();
    if (String(r).toLowerCase() === 'supervisor') return 'Reviewer';
    return r || '--';
}

function getStrongPasswordError(password) {
    var pwd = String(password || '');
    if (
        pwd.length >= 8 &&
        /[A-Z]/.test(pwd) &&
        /[a-z]/.test(pwd) &&
        /[0-9]/.test(pwd) &&
        /[^A-Za-z0-9]/.test(pwd)
    ) {
        return '';
    }
    return (
        'Password must meet all of the following:\n\n' +
        '• At least 8 characters long.\n' +
        '• At least one uppercase letter (A–Z).\n' +
        '• At least one lowercase letter (a–z).\n' +
        '• At least one number (0–9).\n' +
        '• At least one symbol (not only letters and digits).\n\n' +
        'Update your password to satisfy every item, then try again.'
    );
}

function sessionCanAssignFeatureOverrides() {
    var u = window.currentUser;
    var role = (typeof getCurrentRole === 'function') ? String(getCurrentRole() || '').toLowerCase() : '';
    if (role === 'factory' || (typeof isFactoryLikeRole === 'function' && isFactoryLikeRole(role, u))) {
        return true;
    }
    if (u && typeof canPerformAction === 'function') {
        return canPerformAction(u, 'user-add', 'create');
    }
    return false;
}

function canEditMembers() {
    var u = (typeof window !== 'undefined' && window.currentUser) ? window.currentUser : null;
    var role = (typeof getCurrentRole === 'function') ? getCurrentRole() : null;
    if (role === 'factory' || (typeof isFactoryLikeRole === 'function' && isFactoryLikeRole(role, u))) {
        return true;
    }
    if (u && typeof canPerformAction === 'function') {
        return canPerformAction(u, 'user-manage', 'edit');
    }
    return false;
}

function _isEditingOwnMemberProfile(memberId) {
    if (memberId == null) return false;
    var u = window.currentUser;
    if (!u) return false;
    if (u.id != null && Number(u.id) === Number(memberId)) return true;
    var members = Array.isArray(membersCache) ? membersCache : [];
    var target = members.find(function (m) { return Number(m.id) === Number(memberId); });
    if (!target) return false;
    var curUn = String(u.username || '').trim().toLowerCase();
    var tgtUn = String(target.username || '').trim().toLowerCase();
    return !!(curUn && tgtUn && curUn === tgtUn);
}

function _setAddMemberPageMode(isEdit, isSelfEdit) {
    var titleEl = document.getElementById('add-member-page-title');
    var saveBtn = document.getElementById('add-member-save-btn');
    var userIdEl = _addMemberEl('add-userid');
    var pwdLabel = document.getElementById('add-password-label');
    var confirmPwdLabel = document.getElementById('add-confirm-password-label');
    var roleContainer = document.querySelector('#page-add-member .role-selection-container');
    var headerTitle = document.getElementById('header-title');
    if (titleEl) titleEl.textContent = isEdit ? 'Edit Profile' : 'Add New Member';
    if (saveBtn) saveBtn.textContent = isEdit ? 'Update Profile' : 'Save Profile';
    if (headerTitle) headerTitle.textContent = isEdit ? 'Edit Profile' : (PAGE_TITLES['add-member'] || 'Add New Member');
    if (userIdEl) {
        userIdEl.readOnly = !!isEdit;
        userIdEl.disabled = !!isEdit;
        if (isEdit) userIdEl.classList.add('input-readonly');
        else userIdEl.classList.remove('input-readonly');
    }
    if (pwdLabel) pwdLabel.textContent = isEdit ? 'New Password (optional)' : 'Password';
    if (confirmPwdLabel) confirmPwdLabel.textContent = isEdit ? 'Confirm New Password (optional)' : 'Confirm Password';
    if (roleContainer) roleContainer.style.display = isSelfEdit ? 'none' : '';
    if (isSelfEdit) {
        var panel = document.getElementById('add-member-permissions-panel');
        if (panel) {
            panel.classList.add('is-hidden');
            panel.setAttribute('aria-hidden', 'true');
        }
    } else if (typeof _refreshAddMemberPermissionsPanelVisibility === 'function') {
        _refreshAddMemberPermissionsPanelVisibility();
    }
}

function _loadMemberOverridesIntoPanel(overrides) {
    var norm = (typeof normalizeFeatureOverrides === 'function')
        ? normalizeFeatureOverrides(overrides)
        : { allow: [], deny: [] };
    _addMemberFeatureOverrides = {
        allow: (norm.allow || []).slice(),
        deny: []
    };
}

function openEditMember(id) {
    if (!id) return;
    if (typeof canEditMembers === 'function' && !canEditMembers()) {
        showModalCompat('You do not have permission to edit profiles.', 'Permission');
        return;
    }
    apiRequest(API_BASE + '/api/data/members/' + id, { method: 'GET' })
        .then(function (data) {
            var member = (data && data.member) ? data.member : null;
            if (!member || member.id == null) throw new Error('Member not found');
            var uname = String(member.username || '').trim().toUpperCase();
            if (uname === FACTORY_USERNAME) {
                showModalCompat('The factory account cannot be edited here.', 'Edit Profile');
                return;
            }
            editingMemberId = member.id;
            var isSelf = _isEditingOwnMemberProfile(member.id);
            _editingMemberPermissionsActive = !isSelf;
            ['add-password', 'add-confirm-password'].forEach(function (id) {
                var el = _addMemberEl(id);
                if (el) el.value = '';
            });
            var fullNameEl = _addMemberEl('add-fullname');
            var userIdEl = _addMemberEl('add-userid');
            if (fullNameEl) fullNameEl.value = member.name || '';
            if (userIdEl) userIdEl.value = member.username || '';
            if (!isSelf && typeof selectRole === 'function') {
                selectRole(member.role || 'User');
            }
            if (!isSelf) {
                _loadMemberOverridesIntoPanel(member.featureOverrides);
            }
            _setAddMemberPageMode(true, isSelf);
            if (!isSelf && typeof renderAddMemberPermissionCards === 'function') {
                renderAddMemberPermissionCards();
            }
            goToPage('add-member');
            setTimeout(function () {
                if (typeof ensureAddMemberPageScroll === 'function') ensureAddMemberPageScroll();
            }, 60);
        })
        .catch(function (err) {
            showModalCompat('Failed to load profile: ' + (err && err.message ? err.message : 'Unknown error'), 'Edit Profile');
        });
}

function saveMemberForm() {
    if (editingMemberId != null) {
        saveEditedMember();
        return;
    }
    saveNewMember();
}

function saveEditedMember() {
    var memberId = editingMemberId;
    if (memberId == null) return;
    var modalTitle = 'Edit Profile';
    var fullNameEl = _addMemberEl('add-fullname');
    var userIdEl = _addMemberEl('add-userid');
    var pwdEl = _addMemberEl('add-password');
    var confirmPwdEl = _addMemberEl('add-confirm-password');
    var roleHidden = _addMemberEl('selected-role');

    var fullName = fullNameEl && fullNameEl.value ? fullNameEl.value.trim() : '';
    var username = userIdEl && userIdEl.value ? userIdEl.value.trim() : '';
    var password = pwdEl && pwdEl.value ? pwdEl.value : '';
    var confirmPassword = confirmPwdEl && confirmPwdEl.value ? confirmPwdEl.value : '';
    var role = roleHidden && roleHidden.value ? roleHidden.value : 'User';
    var isSelf = _isEditingOwnMemberProfile(memberId);

    if (!fullName || !username) {
        showModalCompat('Full name and User ID are required.', modalTitle);
        return;
    }
    if (username.toUpperCase() === FACTORY_USERNAME) {
        showModalCompat('This User ID is reserved for the factory account.', modalTitle);
        return;
    }
    if (password || confirmPassword) {
        if (password !== confirmPassword) {
            showModalCompat('Password and Confirm Password do not match.', modalTitle);
            return;
        }
        var pwdErr = getStrongPasswordError(password);
        if (pwdErr) {
            showModalCompat(pwdErr, modalTitle);
            return;
        }
    }

    apiRequest(API_BASE + '/api/data/members/' + memberId, { method: 'GET' })
        .then(function (data) {
            var member = (data && data.member) ? data.member : null;
            if (!member) throw new Error('Member not found');
            member.name = fullName;
            member.username = username;
            if (!isSelf) {
                member.role = role;
            }
            if (password) {
                member.password = password;
            }
            var savedAllowList = null;
            if (!isSelf && sessionCanAssignFeatureOverrides() && _editingMemberPermissionsActive) {
                var overrides = _addMemberFeatureOverrides || { allow: [], deny: [] };
                savedAllowList = (overrides.allow || []).slice();
                if (savedAllowList.length < 1) {
                    showModalCompat('Select at least one user functionality to continue.', modalTitle);
                    return Promise.reject(new Error('permissions'));
                }
                member.featureOverrides = { allow: savedAllowList, deny: [] };
            }
            return apiRequest(API_BASE + '/api/data/members/' + memberId, {
                method: 'PUT',
                body: member
            }).then(function (res) {
                return { res: res, savedAllowList: savedAllowList };
            });
        })
        .then(function (payload) {
            var res = payload && payload.res ? payload.res : null;
            var savedAllowList = payload && payload.savedAllowList ? payload.savedAllowList : null;
            if (savedAllowList && savedAllowList.indexOf('perm_calibration_test') !== -1) {
                var savedMember = res && res.member ? res.member : null;
                var persisted = savedMember && savedMember.featureOverrides && savedMember.featureOverrides.allow;
                if (!persisted || persisted.indexOf('perm_calibration_test') === -1) {
                    showModalCompat(
                        'Calibration access was not saved. Restart the server (run_dev.bat), hard-refresh the browser, then edit the member and save again.',
                        modalTitle
                    );
                    return Promise.reject(new Error('calibration not persisted'));
                }
            }
            var savedId = memberId;
            editingMemberId = null;
            _editingMemberPermissionsActive = false;
            _clearAddMemberForm();
            loadMembersAndRender();
            var refreshP = Promise.resolve();
            var cur = (typeof window !== 'undefined' && window.currentUser) ? window.currentUser : null;
            if (cur && savedId != null && Number(cur.id) === Number(savedId) && typeof refreshSessionUserFromServer === 'function') {
                refreshP = refreshSessionUserFromServer();
            }
            return refreshP.then(function () {
                var msg = 'Profile updated successfully.';
                if (savedAllowList && cur && savedId != null && Number(cur.id) !== Number(savedId)) {
                    msg += ' The member must log out and log in again for permission changes to apply.';
                }
                showModalCompat(msg, modalTitle);
                goToPage('manage-members');
            });
        })
        .catch(function (err) {
            if (err && err.message === 'permissions') return;
            if (err && err.message === 'calibration not persisted') return;
            showModalCompat('Failed to update profile: ' + (err && err.message ? err.message : 'Unknown error'), modalTitle);
        });
}

function saveNewMember() {
    var fullNameEl = _addMemberEl('add-fullname');
    var userIdEl = _addMemberEl('add-userid');
    var pwdEl = _addMemberEl('add-password');
    var confirmPwdEl = _addMemberEl('add-confirm-password');
    var roleHidden = _addMemberEl('selected-role');

    var fullName = fullNameEl && fullNameEl.value ? fullNameEl.value.trim() : '';
    var username = userIdEl && userIdEl.value ? userIdEl.value.trim() : '';
    var password = pwdEl && pwdEl.value ? pwdEl.value : '';
    var confirmPassword = confirmPwdEl && confirmPwdEl.value ? confirmPwdEl.value : '';
    var role = roleHidden && roleHidden.value ? roleHidden.value : 'User';

    if (!fullName || !username || !password || !confirmPassword) {
        showModalCompat('Please fill all fields.', 'Add Member');
        return;
    }
    if (username.toUpperCase() === FACTORY_USERNAME) {
        showModalCompat('This User ID is reserved for the factory account and cannot be used.', 'Add Member');
        return;
    }
    if (password !== confirmPassword) {
        showModalCompat('Password and Confirm Password do not match.', 'Add Member');
        return;
    }
    var passwordError = getStrongPasswordError(password);
    if (passwordError) {
        showModalCompat(passwordError, 'Add Member');
        return;
    }

    var overrides = _addMemberFeatureOverrides || { allow: [], deny: [] };
    var hasOverrides = (overrides.allow && overrides.allow.length) || (overrides.deny && overrides.deny.length);
    if (hasOverrides && !sessionCanAssignFeatureOverrides()) {
        showModalCompat('You do not have permission to assign permission cards when creating a member.', 'Add Member');
        return;
    }
    if (typeof _addMemberPermissionsPanelShouldShow === 'function' && _addMemberPermissionsPanelShouldShow()) {
        var allowList = (overrides.allow && overrides.allow.length) ? overrides.allow : [];
        if (allowList.length < 1) {
            showModalCompat('Select at least one user functionality to continue.', 'Add Member');
            return;
        }
    }

    var payload = {
        name: fullName,
        username: username,
        password: password,
        role: role,
        featureOverrides: {
            allow: (overrides.allow || []).slice(),
            deny: []
        }
    };

    apiRequest(API_BASE + '/api/data/members', {
        method: 'POST',
        body: payload
    }).then(function (data) {
        if (data && data.id) {
            _addMemberLastSavedId = data.id;
            var savedMember = (data && data.member) ? data.member : {
                id: data.id, name: fullName, username: username, role: role
            };
            _clearAddMemberForm();
            if (biometricEnabledSetting) {
                _populateMemberBiometricSummary(savedMember);
                goToPage('member-biometric');
            } else {
                showModalCompat('Member saved successfully.', 'Add Member');
                goToPage('user-profile');
            }
        } else {
            showModalCompat((data && data.error) || 'Failed to save member.', 'Add Member');
        }
    }).catch(function (err) {
        showModalCompat('Failed to save member: ' + (err && err.message ? err.message : 'Network error'), 'Add Member');
    });
}
function closeRoleModal() {
    var overlay = document.getElementById('role-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    currentMemberIdForRoleEdit = null;
}

function openRoleModal(id) {
    if (!id) return;
    var members = Array.isArray(membersCache) ? membersCache : [];
    var member = members.find(function (m) { return m.id === id; });
    if (!member) return;
    currentMemberIdForRoleEdit = id;
    var titleEl = document.getElementById('role-modal-title');
    var currentEl = document.getElementById('role-modal-current');
    if (titleEl) titleEl.textContent = 'Change Role for ' + (member.name || member.username || '');
    if (currentEl) currentEl.textContent = 'Current Role: ' + displayRoleLabel(member.role);
    var overlay = document.getElementById('role-modal-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function confirmRoleChange(newRole) {
    if (!currentMemberIdForRoleEdit) return;
    if (typeof canPerformAction === 'function' && typeof getCurrentRole === 'function') {
        var role = getCurrentRole();
        if (!canPerformAction(role, 'user-change-role', 'change')) {
            showModalCompat('You do not have permission to change user roles.', 'Permission');
            closeRoleModal();
            return;
        }
    }
    var id = currentMemberIdForRoleEdit;
    apiRequest(API_BASE + '/api/data/members/' + id, {
        method: 'GET'
    }).then(function (data) {
        var member = data && data.member ? data.member : null;
        if (!member) throw new Error('Member not found');
        member.role = newRole;
        return apiRequest(API_BASE + '/api/data/members/' + id, {
            method: 'PUT',
            body: JSON.stringify(member)
        });
    }).then(function () {
        closeRoleModal();
        loadMembersAndRender();
    }).catch(function (err) {
        console.error('Failed to update member role', err);
        showModalCompat('Failed to update role: ' + (err && err.message ? err.message : 'Unknown error'), 'Members');
    });
}

function disableMember(id) {
    if (!id) return;
    if (typeof canPerformAction === 'function' && typeof getCurrentRole === 'function') {
        var role = getCurrentRole();
        if (!canPerformAction(role, 'user-delete', 'delete')) {
            showModalCompat('You do not have permission to disable members.', 'Permission');
            return;
        }
    }
    showConfirmModalCompat('Are you sure you want to disable this member?', 'Disable Member').then(function (ok) {
        if (!ok) return;
        apiRequest(API_BASE + '/api/data/members/' + id, { method: 'DELETE' })
            .then(function () {
                loadMembersAndRender();
            })
            .catch(function (err) {
                console.error('Failed to disable member', err);
                showModalCompat('Failed to disable member: ' + (err && err.message ? err.message : 'Unknown error'), 'Members');
            });
    });
}

// ----- Add Member: form, permission overrides -----

function _isProtectedFeatureKey(key) {
    return key === 'dashboard' || key === 'factory-settings' || key === 'factory-reset';
}

function _addMemberPermissionsPanelShouldShow() {
    return typeof sessionCanAssignFeatureOverrides === 'function' && sessionCanAssignFeatureOverrides();
}

function _refreshAddMemberPermissionsPanelVisibility() {
    var panel = document.getElementById('add-member-permissions-panel');
    if (!panel) return;
    var show = _addMemberPermissionsPanelShouldShow();
    panel.classList.toggle('is-hidden', !show);
    panel.setAttribute('aria-hidden', show ? 'false' : 'true');
    if (show) renderAddMemberPermissionCards();
    if (show && typeof ensureAddMemberPageScroll === 'function') {
        setTimeout(ensureAddMemberPageScroll, 0);
    }
}

function renderAddMemberPermissionCards() {
    var grid = document.getElementById('permission-cards-grid');
    if (!grid) return;
    grid.innerHTML = '';
    var catalog = (typeof getPermissionCardCatalog === 'function')
        ? getPermissionCardCatalog()
        : ((typeof getFeatureCatalog === 'function') ? getFeatureCatalog() : []);
    if (!_addMemberFeatureOverrides) _addMemberFeatureOverrides = { allow: [], deny: [] };
    _addMemberFeatureOverrides.deny = [];
    catalog.forEach(function (feature) {
        var key = feature.key;
        if (_isProtectedFeatureKey(key)) return;
        var selected = _addMemberFeatureOverrides.allow.indexOf(key) !== -1;
        var accent = feature.accent != null ? feature.accent : 0;
        var card = document.createElement('div');
        card.className = 'permission-card' + (selected ? ' is-selected permission-card--accent-' + accent : '');
        card.setAttribute('data-feature-key', key);
        card.setAttribute('title', 'Select or clear this functionality');
        card.innerHTML =
            '<div class="permission-card-title">' + feature.label + '</div>' +
            '<div class="permission-card-desc">' + (feature.description || '') + '</div>';
        card.addEventListener('click', function () { togglePermissionCardAllow(key); });
        grid.appendChild(card);
    });
}

function togglePermissionCardAllow(featureKey) {
    if (!featureKey || _isProtectedFeatureKey(featureKey)) return;
    if (!_addMemberFeatureOverrides) _addMemberFeatureOverrides = { allow: [], deny: [] };
    var i = _addMemberFeatureOverrides.allow.indexOf(featureKey);
    if (i === -1) _addMemberFeatureOverrides.allow.push(featureKey);
    else _addMemberFeatureOverrides.allow.splice(i, 1);
    _addMemberFeatureOverrides.deny = [];
    renderAddMemberPermissionCards();
}

function cyclePermissionCardState(featureKey) {
    togglePermissionCardAllow(featureKey);
}

function resetPermissionOverrides() {
    _addMemberFeatureOverrides = { allow: [], deny: [] };
    renderAddMemberPermissionCards();
}

function setAllPermissionOverrides() {
    renderAddMemberPermissionCards();
}

function _clearAddMemberForm() {
    editingMemberId = null;
    _editingMemberPermissionsActive = false;
    ['add-fullname', 'add-userid', 'add-password', 'add-confirm-password'].forEach(function (id) {
        var el = _addMemberEl(id);
        if (el) el.value = '';
    });
    var userIdEl = _addMemberEl('add-userid');
    if (userIdEl) {
        userIdEl.readOnly = false;
        userIdEl.disabled = false;
        userIdEl.classList.remove('input-readonly');
    }
    if (typeof selectRole === 'function') selectRole('User');
    _addMemberFeatureOverrides = { allow: [], deny: [] };
    _setAddMemberPageMode(false, false);
}

function openAddMember() {
    if (typeof canPerformAction === 'function' && typeof getCurrentRole === 'function') {
        var role = getCurrentRole();
        var who = (typeof window !== 'undefined' && window.currentUser) ? window.currentUser : role;
        if (!canPerformAction(who, 'user-add', 'create')) {
            showModalCompat('You do not have permission to add new members.', 'Permission');
            return;
        }
    }
    _editingMemberPermissionsActive = true;
    editingMemberId = null;
    _clearAddMemberForm();
    _refreshAddMemberPermissionsPanelVisibility();
    goToPage('add-member');
    setTimeout(function () {
        if (typeof ensureAddMemberPageScroll === 'function') ensureAddMemberPageScroll();
    }, 60);
}

function cancelAddMemberEdit() {
    var returnToManage = editingMemberId != null;
    _clearAddMemberForm();
    goToPage(returnToManage ? 'manage-members' : 'user-profile');
}

function loadMembersAndRender() {
    apiRequest(API_BASE + '/api/data/members', {
        method: 'GET'
    }).then(function (data) {
        var members = (data && data.members && Array.isArray(data.members)) ? data.members : [];
        membersCache = members;
        renderMembersView();
    }).catch(function (err) {
        console.error('Failed to load members', err);
        renderMembersView(); // still clear tables / empty state
    });
}

function renderMembersView() {
    var members = Array.isArray(membersCache) ? membersCache : [];
    var active = [];
    var locked = [];
    var disabled = [];
    members.forEach(function (m) {
        var status = (m && m.status ? String(m.status) : 'active').toLowerCase();
        if (status === 'locked') locked.push(m);
        else if (status === 'disabled') disabled.push(m);
        else active.push(m);
    });

    function renderTable(bodyId, emptyId, rows, options) {
        options = options || {};
        var tbody = document.getElementById(bodyId);
        var emptyEl = document.getElementById(emptyId);
        if (!tbody) return;
        tbody.innerHTML = '';
        if (!rows || rows.length === 0) {
            if (emptyEl) emptyEl.style.display = '';
            return;
        }
        if (emptyEl) emptyEl.style.display = 'none';
        var currentRole = (typeof getCurrentRole === 'function') ? getCurrentRole() : ((window.currentUser && window.currentUser.role) ? String(window.currentUser.role).toLowerCase() : null);
        var canUnlock = !(typeof canPerformAction === 'function') || canPerformAction(currentRole, 'user-unlock', 'change');
        var canEnable = !(typeof canPerformAction === 'function') || canPerformAction(currentRole, 'user-enable', 'change');
        var canEdit = typeof canEditMembers === 'function' && canEditMembers();
        // Sort by name for a consistent list
        rows.slice().sort(function (a, b) {
            var an = (a && a.name ? String(a.name) : '').toLowerCase();
            var bn = (b && b.name ? String(b.name) : '').toLowerCase();
            if (an < bn) return -1;
            if (an > bn) return 1;
            return 0;
        }).forEach(function (m) {
            var tr = document.createElement('tr');
            var name = m.name || '';
            var username = m.username || '';
            var role = m.role || '';
            if (options.style === 'active') {
                var roleKey = String(role || '').toLowerCase();
                var roleClass = 'member-role-badge ';
                if (roleKey === 'admin') roleClass += 'member-role-admin';
                else if (roleKey === 'supervisor') roleClass += 'member-role-supervisor';
                else if (roleKey === 'qa') roleClass += 'member-role-qa';
                else roleClass += 'member-role-user';
                var editBtn = canEdit
                    ? '<button class="btn-member-action btn-edit" onclick="openEditMember(' + (m.id || 0) + ')">Edit Profile</button>'
                    : '';
                tr.innerHTML =
                    '<td>' + name + '</td>' +
                    '<td>' + (username || '-') + '</td>' +
                    '<td><span class="' + roleClass + '">' + displayRoleLabel(role) + '</span></td>' +
                    '<td class="member-actions-cell">' +
                    editBtn +
                    '<button class="btn-member-action btn-role" onclick="openRoleModal(' + (m.id || 0) + ')">Change Role</button>' +
                    '<button class="btn-member-action btn-disable" onclick="disableMember(' + (m.id || 0) + ')">Disable</button>' +
                    '</td>';
            } else {
                var actionBtn = '';
                if (options.style === 'locked') {
                    actionBtn = '<button class="btn-member-action btn-unlock" ' + (canUnlock ? '' : 'disabled') + ' onclick="unlockMember(' + (m.id || 0) + ')">Unlock</button>';
                } else if (options.style === 'disabled') {
                    actionBtn = '<button class="btn-member-action btn-enable" ' + (canEnable ? '' : 'disabled') + ' onclick="enableMember(' + (m.id || 0) + ')">Enable</button>';
                }
                tr.innerHTML =
                    '<td>' + name + '</td>' +
                    '<td>' + (username || '-') + '</td>' +
                    '<td>' + displayRoleLabel(role) + '</td>' +
                    '<td class="member-actions-cell member-actions-cell-single">' + actionBtn + '</td>';
            }
            tbody.appendChild(tr);
        });
    }

    renderTable('members-list-body', 'members-empty-state', active, { style: 'active' });
    renderTable('locked-members-table-body', 'locked-members-empty-state', locked, { style: 'locked' });
    renderTable('disabled-members-table-body', 'disabled-members-empty-state', disabled, { style: 'disabled' });
}

function unlockMember(id) {
    if (!id) return;
    if (typeof canPerformAction === 'function' && typeof getCurrentRole === 'function') {
        var role = getCurrentRole();
        if (!canPerformAction(role, 'user-unlock', 'change')) {
            showModalCompat('You do not have permission to unlock accounts.', 'Permission');
            return;
        }
    }
    showConfirmModalCompat('Unlock this account?', 'Unlock Account').then(function (ok) {
        if (!ok) return;
        var headers = { 'Content-Type': 'application/json' };
        if (window.currentUser && window.currentUser.role) headers['X-User-Role'] = window.currentUser.role;
        fetch((API_BASE || '') + '/api/data/members/' + id + '/unlock', { method: 'POST', headers: headers })
            .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, status: r.status, body: b }; }); })
            .then(function (res) {
                if (!res.ok) throw new Error((res.body && res.body.error) ? res.body.error : ('HTTP ' + res.status));
                loadMembersAndRender();
                showModalCompat('Account unlocked.', 'Unlock');
            })
            .catch(function (err) {
                showModalCompat('Failed to unlock: ' + (err && err.message ? err.message : 'Unknown error'), 'Unlock');
            });
    });
}

function enableMember(id) {
    if (!id) return;
    if (typeof canPerformAction === 'function' && typeof getCurrentRole === 'function') {
        var role = getCurrentRole();
        if (!canPerformAction(role, 'user-enable', 'change')) {
            showModalCompat('You do not have permission to enable accounts.', 'Permission');
            return;
        }
    }
    showConfirmModalCompat('Enable this account?', 'Enable Account').then(function (ok) {
        if (!ok) return;
        var headers = { 'Content-Type': 'application/json' };
        if (window.currentUser && window.currentUser.role) headers['X-User-Role'] = window.currentUser.role;
        fetch((API_BASE || '') + '/api/data/members/' + id + '/enable', { method: 'POST', headers: headers })
            .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, status: r.status, body: b }; }); })
            .then(function (res) {
                if (!res.ok) throw new Error((res.body && res.body.error) ? res.body.error : ('HTTP ' + res.status));
                loadMembersAndRender();
                showModalCompat('Account enabled.', 'Enable');
            })
            .catch(function (err) {
                showModalCompat('Failed to enable: ' + (err && err.message ? err.message : 'Unknown error'), 'Enable');
            });
    });
}

function denyPermission(actionLabel) {
    showModalCompat(
        'You do not have permission to ' + (actionLabel || 'perform this action') + '.',
        'Permission'
    );
}

function isFactorySessionUser(userObj) {
    var u = userObj || window.currentUser;
    if (!u) return false;
    var role = (u.role != null ? String(u.role) : '').toLowerCase();
    if (typeof isFactoryLikeRole === 'function') return isFactoryLikeRole(role, u);
    return role === 'factory';
}

function userCanViewReports(userObj) {
    var u = userObj || window.currentUser;
    if (!u) return false;
    if (isFactorySessionUser(u)) return true;
    return typeof canAccess === 'function' && canAccess(u, 'reports-view');
}

function userCanPrintReports(userObj) {
    var u = userObj || window.currentUser;
    if (!u) return false;
    if (isFactorySessionUser(u)) return true;
    return userCanViewReports(u);
}

function userCanExportToUsb(userObj) {
    var u = userObj || window.currentUser;
    if (!u) return false;
    if (isFactorySessionUser(u)) return true;
    if (typeof userHasInternalKey === 'function' && userHasInternalKey(u, 'export-usb')) return true;
    return false;
}

function canViewAuditLog() {
    var role = (typeof getCurrentRole === 'function' ? getCurrentRole() : '') || '';
    role = String(role).toLowerCase();
    if (role === 'factory') return true;
    var u = window.currentUser;
    if (u && typeof userHasInternalKey === 'function') {
        return userHasInternalKey(u, 'audit-view');
    }
    return false;
}

function initAuditReportsVisibility() {
    document.querySelectorAll('.reports-filter-audit').forEach(function (auditBtn) {
        if (!canViewAuditLog()) {
            auditBtn.style.display = 'none';
        } else {
            auditBtn.style.display = '';
        }
    });
}

function refreshReportsActionButtons() {
    var u = window.currentUser;
    var canExport = u && typeof userCanExportToUsb === 'function' && userCanExportToUsb(u);
    document.querySelectorAll('.reports-filter-export').forEach(function (expBtn) {
        expBtn.style.display = canExport ? '' : 'none';
    });
    document.querySelectorAll('.audit-filter-export').forEach(function (audEx) {
        audEx.style.display = canExport ? '' : 'none';
    });
    if (typeof updateReportPreviewPrintExportButtons === 'function') {
        updateReportPreviewPrintExportButtons(window._lastReportPreview || null);
    }
}

function _friendlyExportError(err) {
    var raw = '';
    if (err && err.message) raw = String(err.message);
    else if (typeof err === 'string') raw = err;
    var t = raw.toLowerCase();
    if (t.indexOf('no external pendrive') !== -1 || t.indexOf('not detected') !== -1) {
        return 'No external pendrive detected. Please connect a USB pendrive and try again.';
    }
    if (t.indexOf('multiple pendrives') !== -1) {
        return 'Multiple pendrives detected. Please disconnect extras and try again.';
    }
    if (t.indexOf('could not access') !== -1 || t.indexOf('not authorized') !== -1 || t.indexOf('mount') !== -1) {
        return 'Could not access the pendrive. Reconnect it and try again.';
    }
    if (t.indexOf('disk full') !== -1 || t.indexOf('no space') !== -1) {
        return 'Pendrive is full. Free space or use a different pendrive.';
    }
    return 'Failed to export. Please format the pendrive (FAT32 or exFAT) and try again.';
}

var _usbPickerResolve = null;

function pickPendrive(devices) {
    return new Promise(function (resolve) {
        var overlay = document.getElementById('usb-picker-overlay');
        var list = document.getElementById('usb-picker-list');
        if (!overlay || !list) {
            resolve(null);
            return;
        }
        list.innerHTML = '';
        (devices || []).forEach(function (d) {
            var card = document.createElement('div');
            card.className = 'usb-picker-card';
            var label = d.label || '(no label)';
            var size = d.size_human || '';
            var fs = (d.fs_type || '').toUpperCase();
            var path = d.path || '';
            card.innerHTML =
                '<div class="usb-picker-card-meta">' +
                    '<span class="usb-picker-card-label">' + label + '</span>' +
                    '<span class="usb-picker-card-sub">' + path + ' \u2014 ' + size + (fs ? ' \u2014 ' + fs : '') + '</span>' +
                '</div>' +
                '<button type="button" class="btn btn-primary">Choose</button>';
            card.addEventListener('click', function () {
                hideUsbPicker();
                if (_usbPickerResolve) { _usbPickerResolve(d.path); _usbPickerResolve = null; }
            });
            list.appendChild(card);
        });
        _usbPickerResolve = resolve;
        overlay.style.display = 'flex';
    });
}

function hideUsbPicker() {
    var overlay = document.getElementById('usb-picker-overlay');
    if (overlay) overlay.style.display = 'none';
}

function cancelUsbPicker() {
    hideUsbPicker();
    if (_usbPickerResolve) {
        _usbPickerResolve(null);
        _usbPickerResolve = null;
    }
}

function _ensureExportApprovalToken() {
    var role = typeof getCurrentRole === 'function' ? String(getCurrentRole() || '').toLowerCase() : '';
    if (role === 'factory') return Promise.resolve('');
    if (typeof openApprovalVerifyModal !== 'function') return Promise.resolve('');
    return openApprovalVerifyModal({
        purpose: 'export',
        titleText: 'Export approval',
        subtitleText: 'Enter credentials of a user with export approval permission.',
        usernameLabelText: 'Verifier username',
        usernamePlaceholder: 'Username',
        emptyCredentialsMessage: 'Enter verifier username and password.'
    }).then(function (token) {
        return token || '';
    });
}

function exportAuditTrails() {
    if (typeof canViewAuditLog === 'function' && !canViewAuditLog()) {
        showModalCompat("You Don't Have Access to Audit Trail", 'Audit');
        return;
    }
    var u = window.currentUser;
    if (!userCanExportToUsb(u)) {
        showModalCompat('You do not have permission to export audit trails to USB.', 'Export');
        return;
    }
    var role = typeof getCurrentRole === 'function' ? String(getCurrentRole() || '').toLowerCase() : '';

    var userEl = document.getElementById('audit-filter-user');
    var roleEl = document.getElementById('audit-filter-role');
    var actionEl = document.getElementById('audit-filter-action');
    var fromDate = document.getElementById('audit-filter-from-date');
    var fromTime = document.getElementById('audit-filter-from-time');
    var toDate = document.getElementById('audit-filter-to-date');
    var toTime = document.getElementById('audit-filter-to-time');

    var fromTs = '';
    var toTs = '';

    if (fromDate && fromDate.value) {
        var parts = fromDate.value.split('-');
        var h = fromTime && fromTime.value ? parseInt(fromTime.value.slice(0, 2), 10) : 0;
        var m = fromTime && fromTime.value ? parseInt(fromTime.value.slice(3, 5), 10) : 0;
        fromTs = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), h, m, 0, 0).getTime();
    }
    if (toDate && toDate.value) {
        var parts2 = toDate.value.split('-');
        var h2 = toTime && toTime.value ? parseInt(toTime.value.slice(0, 2), 10) : 23;
        var m2 = toTime && toTime.value ? parseInt(toTime.value.slice(3, 5), 10) : 59;
        toTs = new Date(parseInt(parts2[0], 10), parseInt(parts2[1], 10) - 1, parseInt(parts2[2], 10), h2, m2, 59, 999).getTime();
    }

    var filters = {};
    if (userEl && userEl.value) filters.user = userEl.value;
    if (roleEl && roleEl.value) filters.role = roleEl.value;
    if (actionEl && actionEl.value) filters.action = actionEl.value;
    if (fromTs) filters.from = fromTs;
    if (toTs) filters.to = toTs;

    var titleText = 'Export Audit';
    _ensureExportApprovalToken().then(function (token) {
        if (role !== 'factory' && !token) {
            showModalCompat('Export cancelled — approval is required.', titleText);
            return;
        }
        var exportHeaders = token ? { 'X-Approval-Verify-Token': token } : {};
        showLoadingOverlay(titleText, 'Detecting external pendrive...', { cancellable: false, progress: true });
        setLoadingProgress(5, 'Detecting external pendrive...', '');
        apiRequest(API_BASE + '/api/usb/list').then(function (data) {
            var devices = (data && data.devices) ? data.devices : [];
            if (!devices.length) {
                hideLoadingOverlay();
                showModalCompat('No external pendrive detected. Please connect a USB pendrive and try again.', titleText);
                return;
            }
            var pickPromise;
            if (devices.length === 1) {
                pickPromise = Promise.resolve(devices[0].path);
            } else {
                hideLoadingOverlay();
                pickPromise = pickPendrive(devices);
            }
            pickPromise.then(function (devicePath) {
                if (!devicePath) return;
                showLoadingOverlay(titleText, 'Generating audit-trail PDF...', { cancellable: false, progress: true });
                setLoadingProgress(25, 'Mounting pendrive...', devicePath);
                setTimeout(function () { setLoadingProgress(60, 'Rendering audit-trail PDF...', ''); }, 600);
                apiRequest(API_BASE + '/api/audit/export', {
                    method: 'POST',
                    headers: exportHeaders,
                    body: { filters: filters, device_path: devicePath }
                }).then(function (res) {
                    if (res && res.success) {
                        setLoadingProgress(95, 'Writing to pendrive...', '');
                        setTimeout(function () {
                            setLoadingProgress(100, 'Export complete', '');
                            setTimeout(function () {
                                hideLoadingOverlay();
                                showModalCompat('Audit trail export successful.', titleText);
                            }, 350);
                        }, 250);
                    } else {
                        hideLoadingOverlay();
                        showModalCompat(_friendlyExportError((res && res.error) || 'audit export failed'), titleText);
                    }
                }).catch(function (err) {
                    hideLoadingOverlay();
                    showModalCompat(_friendlyExportError(err), titleText);
                });
            });
        }).catch(function (err) {
            hideLoadingOverlay();
            showModalCompat(_friendlyExportError(err), titleText);
        });
    });
}

function applyAuditFiltersAndRefresh() {
    loadReports('audit');
}


function saveUserProfile() {
    var fullNameEl = document.getElementById('profile-fullname');
    var passwordEl = document.getElementById('profile-password');
    var newName = fullNameEl ? (fullNameEl.value || '').trim() : '';
    var newPassword = passwordEl ? (passwordEl.value || '') : '';
    if (newPassword) {
        var profilePasswordError = getStrongPasswordError(newPassword);
        if (profilePasswordError) {
            if (typeof showModalCompat === 'function') showModalCompat(profilePasswordError, 'User Profile');
            return;
        }
    }

    var user = (typeof window.currentUser !== 'undefined' && window.currentUser) ? window.currentUser : (typeof currentUser !== 'undefined' && currentUser) ? currentUser : null;
    if (!user) {
        if (typeof showModalCompat === 'function') showModalCompat('No user logged in.', 'User Profile');
        return;
    }

    var memberId = user.id;
    var isFactory = (memberId === 0 || memberId === undefined || memberId === null);

    function updateLocalName(name) {
        if (window.currentUser) window.currentUser.name = name;
        if (typeof currentUser !== 'undefined') { currentUser = currentUser || {}; currentUser.name = name; }
        try { localStorage.setItem('currentUser', JSON.stringify(window.currentUser || currentUser)); } catch (e) {}
        var displayEl = document.getElementById('profile-name-display');
        if (displayEl) displayEl.textContent = name || '---';
    }

    if (isFactory) {
        updateLocalName(newName || user.name || user.username || 'Factory');
        if (passwordEl) passwordEl.value = '';
        if (typeof showModalCompat === 'function') showModalCompat('Profile updated.', 'User Profile');
        return;
    }

    var payload = {};
    if (newName) payload.name = newName;
    if (newPassword) payload.password = newPassword;
    if (!payload.name && !payload.password) {
        if (typeof showModalCompat === 'function') {
            showModalCompat('Enter a new full name and/or password to save.', 'User Profile');
        }
        return;
    }
    if (!payload.name) {
        payload.name = (user.name || user.username || '').trim();
    }

    apiRequest(API_BASE + '/api/data/auth/profile', {
        method: 'PUT',
        body: payload
    })
        .then(function (result) {
            var updated = (result && result.member) ? result.member : result;
            var nameToSet = (updated && updated.name) ? updated.name : newName;
            updateLocalName(nameToSet || newName || (user.name || user.username));
            if (passwordEl) passwordEl.value = '';
            if (typeof showModalCompat === 'function') showModalCompat('Profile updated.', 'User Profile');
        })
        .catch(function (err) {
            var msg = (err && err.message) ? err.message : 'Failed to update profile.';
            if (typeof showModalCompat === 'function') showModalCompat(msg, 'User Profile');
        });
}

function logAuditEvent(action, details, options) {
    options = options || {};
    if (!window.currentUser) return Promise.resolve();
    var body = {
        action: action,
        details: details || '',
        outcome: options.outcome || 'success',
        eventType: options.eventType || 'lifecycle',
        entityType: options.entityType || '',
        entityName: options.entityName || '',
        entityId: options.entityId,
        reason: options.reason || '',
        extra: options.extra || {}
    };
    return apiRequest(API_BASE + '/api/data/audit-log/event', {
        method: 'POST',
        body: body
    }).catch(function () {});
}

function showAuditTrailsLoadingOverlay() {
    hideAuditTrailsLoadingOverlay();
    showLoadingOverlay('Audit Trails', 'Fetching audit trails...', { cancellable: false });
    _auditLoadMessageTimers.push(setTimeout(function () {
        setLoadingMessage('Processing audit trails...', 'Please wait.');
    }, 450));
    _auditLoadMessageTimers.push(setTimeout(function () {
        setLoadingMessage('Loading audit trails...', 'Please wait.');
    }, 950));
}

function hideAuditTrailsLoadingOverlay() {
    _auditLoadMessageTimers.forEach(function (id) { clearTimeout(id); });
    _auditLoadMessageTimers = [];
    hideLoadingOverlay();
}

function _populateAuditFilterDropdowns(userEl, actionEl, fullList) {
    var users = [];
    var actions = [];
    (fullList || []).forEach(function (e) {
        var u = e.user || '--';
        if (users.indexOf(u) === -1) users.push(u);
        var a = e.action || '';
        if (a && actions.indexOf(a) === -1) actions.push(a);
    });
    var coreActions = [
        'Login', 'Logout', 'Logout (inactivity timeout)', 'User logged in',
        'Entered screen', 'Exited screen',
        'Opened Quick Test', 'Opened Load Recipe', 'Opened Manage Recipe', 'Loaded recipe',
        'Opened disabled recipes',
        'Test started', 'Quick test started', 'Test finished', 'Test aborted', 'Test auto-aborted',
        'Test performed', 'Quick test performed',
        'Entered distance validation', 'Entered load validation',
        'Entered USP 1 validation', 'Entered USP 2 validation',
        'Validation started', 'Validation finished', 'Validation aborted',
        'holder error', 'check adaptor and holder', 'Holder check error',
        'Validation performed', 'Report saved', 'Report generated', 'Report approved',
        'Report aborted', 'Report aborted (power loss)', 'Report PDF generated',
        'Recipe created', 'Recipe edited', 'Recipe approved', 'Power interruption',
        'Approval verification', 'Disable Recipe', 'Recipe disabled',
        'Added new user', 'Password changed', 'User create', 'User update'
    ];
    coreActions.forEach(function (a) {
        if (actions.indexOf(a) === -1) actions.push(a);
    });
    users.sort();
    actions.sort();
    if (userEl) {
        userEl.innerHTML = '<option value="">All</option>';
        users.forEach(function (u) { userEl.appendChild(new Option(u, u)); });
    }
    if (actionEl) {
        actionEl.innerHTML = '<option value="">All</option>';
        actions.forEach(function (a) { actionEl.appendChild(new Option(a, a)); });
    }
}

function _renderAuditLogRows(tbody, list) {
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!list || !list.length) {
        var emptyRow = document.createElement('tr');
        emptyRow.innerHTML = '<td colspan="5">No audit entries match the filters.</td>';
        tbody.appendChild(emptyRow);
        return;
    }
    list.forEach(function (entry) {
        var row = document.createElement('tr');
        row.innerHTML = '<td>' + (entry.dateTime || '') + '</td><td>' + (entry.user || '--') + '</td><td>' + displayRoleLabel(entry.role || '--') + '</td><td>' + (entry.action || '') + '</td><td>' + formatAuditDetailsText(entry.details || '') + '</td>';
        tbody.appendChild(row);
    });
}

/** Reload session user from server (picks up permission changes without full re-login). */
function refreshSessionUserFromServer() {
    return apiRequest(API_BASE + '/api/data/auth/current-user', { method: 'GET' })
        .then(function (data) {
            var user = data && data.user ? data.user : null;
            if (!user) return null;
            if (typeof window !== 'undefined') window.currentUser = user;
            if (typeof currentUser !== 'undefined') currentUser = user;
            try {
                localStorage.setItem('currentUser', JSON.stringify(user));
            } catch (e) { /* ignore */ }
            if (typeof updateUIForUser === 'function') updateUIForUser();
            if (typeof refreshValidatePageAccess === 'function') refreshValidatePageAccess();
            return user;
        })
        .catch(function () {
            return null;
        });
}

/** On page load: restore server session with fresh permissions, or show login. */
function initAppSessionOnLoad() {
    return refreshSessionUserFromServer().then(function (user) {
        if (user && typeof goToPage === 'function') {
            goToPage('home');
            return user;
        }
        if (typeof currentUser !== 'undefined') currentUser = null;
        if (typeof window !== 'undefined') window.currentUser = null;
        try {
            localStorage.removeItem('currentUser');
        } catch (e) { /* ignore */ }
        if (typeof goToPage === 'function') goToPage('login');
        return null;
    }).catch(function () {
        if (typeof goToPage === 'function') goToPage('login');
        return null;
    });
}

/** Hide sidebar / home tiles the current user cannot access (RBAC). */
function refreshShellAccessVisibility() {
    var u = window.currentUser;
    document.querySelectorAll('.nav-item[data-page]').forEach(function (btn) {
        var page = btn.getAttribute('data-page');
        var feat = btn.getAttribute('data-rbac-nav');
        if (!feat && typeof SCREEN_FEATURE_MAP !== 'undefined' && SCREEN_FEATURE_MAP[page]) {
            feat = SCREEN_FEATURE_MAP[page];
        }
        if (!feat) feat = page;
        var ok = true;
        if (page === 'home') {
            ok = true;
        } else if (page === 'validate' && u && typeof canAccessValidationOrCalibration === 'function') {
            ok = canAccessValidationOrCalibration(u);
        } else if (u && typeof canAccess === 'function') {
            ok = canAccess(u, feat);
        } else if (!u) {
            ok = false;
        }
        btn.style.display = ok ? '' : 'none';
    });
    document.querySelectorAll('.test-card[data-rbac-nav]').forEach(function (el) {
        var feat = el.getAttribute('data-rbac-nav');
        var ok = u && typeof canAccess === 'function' && feat ? canAccess(u, feat) : false;
        el.style.display = ok ? '' : 'none';
    });
    var mp = document.querySelector('.profile-actions button[onclick*="manage-members"]');
    var am = document.querySelector('.profile-actions button[onclick*="openAddMember"]');
    if (mp) mp.style.display = u && typeof canAccess === 'function' && canAccess(u, 'user-manage') ? '' : 'none';
    if (am) am.style.display = u && typeof canAccess === 'function' && canAccess(u, 'user-add') ? '' : 'none';
    var valSettingsCard = document.querySelector('.settings-validation');
    if (valSettingsCard) {
        var showVal = u && typeof canAccessValidationOrCalibration === 'function' && canAccessValidationOrCalibration(u);
        valSettingsCard.style.display = showVal ? '' : 'none';
    }
    if (typeof initAuditReportsVisibility === 'function') initAuditReportsVisibility();
    if (typeof refreshReportsActionButtons === 'function') refreshReportsActionButtons();
    if (typeof updateSettingsVisibility === 'function') updateSettingsVisibility();
}

function updateUIForUser() {
    refreshShellAccessVisibility();
    if (typeof refreshReportsActionButtons === 'function') refreshReportsActionButtons();
    if (typeof updateSettingsVisibility === 'function') updateSettingsVisibility();
    if (typeof initAuditReportsVisibility === 'function') initAuditReportsVisibility();
    var user = window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null);
    if (!user) return;
    var profileNameEl = document.getElementById('profile-name-display');
    var profileRoleEl = document.getElementById('profile-role-display');
    var profileEditNameEl = document.getElementById('profile-fullname');
    if (profileNameEl) profileNameEl.textContent = user.name || '';
    if (profileRoleEl) profileRoleEl.textContent = displayRoleLabel(user.role || '');
    if (profileEditNameEl) profileEditNameEl.value = user.name || '';
}

(function () {
    var _baseLoadReports = typeof loadReports === 'function' ? loadReports : null;
    window.loadReports = function loadReports(filterType) {
        if (filterType === 'audit') {
            if (typeof currentReportFilter !== 'undefined') {
                currentReportFilter = 'audit';
            }
            var tbody = document.getElementById('reports-table-body');
            var theadRow = document.getElementById('reports-thead-row');
            var bar = document.getElementById('audit-filters-bar');
            if (!tbody) return;
            if (typeof initAuditReportsVisibility === 'function') initAuditReportsVisibility();
            tbody.innerHTML = '';
            if (typeof canViewAuditLog === 'function' && !canViewAuditLog()) {
                denyPermission('view audit trails');
                return;
            }
            if (bar) bar.style.display = '';
            if (theadRow) theadRow.innerHTML = '<th>Date & Time</th><th>User</th><th>Role</th><th>Action</th><th>Details</th>';
            var userEl = document.getElementById('audit-filter-user');
            var roleEl = document.getElementById('audit-filter-role');
            var actionEl = document.getElementById('audit-filter-action');
            var fromDate = document.getElementById('audit-filter-from-date');
            var fromTime = document.getElementById('audit-filter-from-time');
            var toDate = document.getElementById('audit-filter-to-date');
            var toTime = document.getElementById('audit-filter-to-time');
            var fromTs = '';
            var toTs = '';
            if (fromDate && fromDate.value) {
                var parts = fromDate.value.split('-');
                var h = fromTime && fromTime.value ? parseInt(fromTime.value.slice(0, 2), 10) : 0;
                var m = fromTime && fromTime.value ? parseInt(fromTime.value.slice(3, 5), 10) : 0;
                fromTs = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10), h, m, 0, 0).getTime();
            }
            if (toDate && toDate.value) {
                var parts2 = toDate.value.split('-');
                var h2 = toTime && toTime.value ? parseInt(toTime.value.slice(0, 2), 10) : 23;
                var m2 = toTime && toTime.value ? parseInt(toTime.value.slice(3, 5), 10) : 59;
                toTs = new Date(parseInt(parts2[0], 10), parseInt(parts2[1], 10) - 1, parseInt(parts2[2], 10), h2, m2, 59, 999).getTime();
            }
            var q = [];
            if (userEl && userEl.value) q.push('user=' + encodeURIComponent(userEl.value));
            if (roleEl && roleEl.value) q.push('role=' + encodeURIComponent(roleEl.value));
            if (actionEl && actionEl.value) q.push('action=' + encodeURIComponent(actionEl.value));
            if (fromTs) q.push('from=' + fromTs);
            if (toTs) q.push('to=' + toTs);
            var auditUrl = API_BASE + '/api/data/audit-log' + (q.length ? '?' + q.join('&') : '');
            showAuditTrailsLoadingOverlay();
            apiRequest(auditUrl).then(function (data) {
                var list = (data && data.entries) ? data.entries : [];
                var filterTask = Promise.resolve();
                if (userEl && userEl.options.length <= 1) {
                    filterTask = apiRequest(API_BASE + '/api/data/audit-log').then(function (full) {
                        var fullList = (full && full.entries) ? full.entries : [];
                        _populateAuditFilterDropdowns(userEl, actionEl, fullList);
                    }).catch(function () {});
                }
                return filterTask.then(function () {
                    _renderAuditLogRows(tbody, list);
                });
            }).catch(function () {
                tbody.innerHTML = '';
                var emptyRow = document.createElement('tr');
                emptyRow.innerHTML = '<td colspan="5">Unable to load audit log.</td>';
                tbody.appendChild(emptyRow);
            }).finally(function () {
                hideAuditTrailsLoadingOverlay();
            });
            return;
        }
        var bar = document.getElementById('audit-filters-bar');
        if (bar) bar.style.display = 'none';
        if (_baseLoadReports) return _baseLoadReports(filterType);
    };
})();

(function () {
    var _origGoToPage = typeof goToPage === 'function' ? goToPage : null;
    if (_origGoToPage && !_origGoToPage._complianceWrapped) {
        function goToPageWrapped(pageName) {
            var result = _origGoToPage.apply(this, arguments);
            if (pageName === 'add-member' && typeof _refreshAddMemberPermissionsPanelVisibility === 'function') {
                setTimeout(_refreshAddMemberPermissionsPanelVisibility, 0);
            }
            if (typeof refreshReportsActionButtons === 'function') {
                if (pageName === 'reports') {
                    refreshReportsActionButtons();
                } else if (pageName === 'report-preview') {
                    setTimeout(refreshReportsActionButtons, 50);
                }
            }
            return result;
        }
        goToPageWrapped._complianceWrapped = true;
        window.goToPage = goToPageWrapped;
    }
})();